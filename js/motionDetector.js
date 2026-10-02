/**
 * 모션 인식 전담 모듈 (motionDetector.js)
 * MediaPipe Tasks-Vision FaceLandmarker / HandLandmarker를 활용한
 * 전자칠판 고감도 다중 얼굴 인식, 중앙 최우선 도전자 타겟팅, 학급 단체 동시 집계 엔진입니다.
 */

class MotionDetector {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.canvasElement = options.canvasElement || null;
    this.mode = options.mode || "HEAD_TILT"; // "HEAD_TILT" | "FINGER_COUNT"
    this.playMode = options.playMode || "INDIVIDUAL"; // "INDIVIDUAL" (1인 중앙) | "GROUP" (단체)

    // 콜백 함수들
    this.onSelectionProgress = options.onSelectionProgress || (() => {}); // (optionIndex, progress: 0~1)
    this.onSelectionConfirm = options.onSelectionConfirm || (() => {});   // (optionIndex: 1, 2, 3, 4)
    this.onStatusChange = options.onStatusChange || (() => {});         // (statusMessage, isReady)
    this.onGroupVoteUpdate = options.onGroupVoteUpdate || (() => {});   // (groupVoteData)

    // 내부 상태
    this.faceLandmarker = null;
    this.handLandmarker = null;
    this.isRunning = false;
    this.isAiReady = false;
    this.stream = null;
    this.currentDeviceId = null;

    // 모션 판정 파라미터
    this.TILT_THRESHOLD_DEG = 11; // 고개 기울임 임계 각도 (도) - 전자칠판 원거리 감지 고려해 완화
    this.HOLD_DURATION_MS = 500;  // 선택 확정을 위한 유지 시간 (ms)

    this.currentCandidate = null; // 현재 선택 중인 옵션 인덱스 (1, 2, 3, 4)
    this.candidateStartTime = 0;  // 선택 유지 시작 시각
    this.lastAngle = 0;
    this.isConfirmed = false;     // 현재 문제에서 이미 확정되었는지 여부

    // 단체 모드 정오답 공개 상태
    this.isResultRevealed = false;
    this.currentCorrectAnswer = null;

    this.animationFrameId = null;
    this.lastVideoTime = -1;
  }

  /**
   * 1단계: 카메라 우선 실행 -> 2단계: 백그라운드 AI 모델 로딩
   */
  async init(preferredDeviceId = null) {
    try {
      this.onStatusChange("카메라를 켜는 중입니다...", false);

      // 1. 카메라 스트림 시작 (다단계 폴백 전략으로 전자칠판/스마트폰 100% 연결)
      await this._startCamera(preferredDeviceId);
      this.isRunning = true;
      this.onStatusChange("카메라 연결 성공! AI 인식 엔진을 불러옵니다...", false);

      // 2. 백그라운드에서 AI 비전 모델 로드
      this._loadAiModels().then((success) => {
        if (success) {
          this.isAiReady = true;
          const readyMsg = this.playMode === "GROUP"
            ? "우리 반 단체 모션 인식이 준비되었습니다! (여러 명 동시 참여)"
            : "모션 인식이 준비되었습니다! 화면 중앙에서 고개를 기울여보세요.";
          this.onStatusChange(readyMsg, true);
        } else {
          this.onStatusChange("모션 인식 모델 연결 실패 (마우스/키보드로 플레이 가능)", false);
        }
      }).catch(err => {
        console.warn("[MotionDetector] AI 모델 로드 경고:", err);
        this.onStatusChange("모션 인식 모델 로드 지연 (마우스/키보드로 플레이 가능)", false);
      });

      // 3. 루프 시작
      this._predictLoop();
      return true;
    } catch (err) {
      console.error("[MotionDetector] 카메라 실행 실패:", err);
      this.onStatusChange("카메라 접근 불가 (마우스/키보드로 플레이 가능)", false);
      return false;
    }
  }

  /**
   * 사용 가능한 카메라 디바이스 목록 반환
   */
  async getCameras() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return [];
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(d => d.kind === "videoinput");
    } catch (e) {
      console.warn("카메라 장치 목록 조회 실패:", e);
      return [];
    }
  }

  /**
   * 카메라 장치 변경 (전자칠판 내장/외장 카메라 스위칭)
   */
  async switchCamera(deviceId) {
    this.currentDeviceId = deviceId;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }
    await this._startCamera(deviceId);
  }

  /**
   * 웹캠 스트림 획득 (전자칠판 및 모바일 전방위 호환 다단계 폴백)
   */
  async _startCamera(deviceId = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("브라우저가 웹캠 접근을 지원하지 않습니다.");
    }

    const attempts = [
      // 1차 시도: 고화질 1080p (원거리 학생 얼굴 또렷하게 인식)
      {
        video: deviceId 
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, facingMode: "user" }
      },
      // 2차 시도: 표준 720p (호환성 최적)
      {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } }
      },
      // 3차 시도: 최소 제약조건 (전자칠판 특수 웹캠 대응)
      {
        video: deviceId ? { deviceId: { exact: deviceId } } : true
      }
    ];

    let stream = null;
    let lastErr = null;

    for (const constraint of attempts) {
      try {
        constraint.audio = false;
        stream = await navigator.mediaDevices.getUserMedia(constraint);
        if (stream) break;
      } catch (err) {
        lastErr = err;
        console.warn("[MotionDetector] 카메라 제약조건 시도 실패, 다음 단계 폴백:", constraint, err);
      }
    }

    if (!stream) {
      throw lastErr || new Error("카메라 스트림을 획득할 수 없습니다.");
    }

    this.stream = stream;

    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      this.videoElement.setAttribute("playsinline", "true");
      this.videoElement.setAttribute("autoplay", "true");
      this.videoElement.muted = true;

      // 비디오 준비 대기 (타임아웃 2.5초)
      await new Promise((resolve) => {
        if (this.videoElement.readyState >= 2) {
          resolve();
        } else {
          const onLoaded = () => {
            this.videoElement.removeEventListener("loadeddata", onLoaded);
            this.videoElement.removeEventListener("loadedmetadata", onLoaded);
            resolve();
          };
          this.videoElement.addEventListener("loadeddata", onLoaded);
          this.videoElement.addEventListener("loadedmetadata", onLoaded);
          setTimeout(resolve, 2500);
        }
      });

      try {
        await this.videoElement.play();
      } catch (playErr) {
        console.warn("[MotionDetector] video.play() 자동재생 차단 예외 처리:", playErr);
      }
    }
  }

  /**
   * MediaPipe Tasks-Vision 모델 로드 (GPU 실패 시 CPU 안전 폴백)
   */
  async _loadAiModels() {
    let retries = 0;
    while ((!window.FilesetResolver || !window.FaceLandmarker) && retries < 25) {
      await new Promise(r => setTimeout(r, 400));
      retries++;
    }

    if (!window.FilesetResolver || !window.FaceLandmarker) {
      throw new Error("MediaPipe SDK 라이브러리를 불러올 수 없습니다.");
    }

    const vision = await window.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    // 1. FaceLandmarker 생성 (전자칠판 고감도 & 다인원 15명 검출)
    const faceModelUrl = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
    
    // GPU 우선 시도 -> 실패 시 CPU 폴백
    try {
      this.faceLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: faceModelUrl,
          delegate: "GPU"
        },
        outputFaceBlendshapes: false,
        runningMode: "VIDEO",
        numFaces: 15, // 단체 모드 및 교실 다인원 인식
        minFaceDetectionConfidence: 0.25, // 원거리/작은 얼굴 강제 인식
        minFacePresenceConfidence: 0.25,
        minTrackingConfidence: 0.25
      });
    } catch (gpuErr) {
      console.warn("[MotionDetector] GPU delegate 실패, CPU 모드로 폴백 생성:", gpuErr);
      this.faceLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: faceModelUrl,
          delegate: "CPU"
        },
        outputFaceBlendshapes: false,
        runningMode: "VIDEO",
        numFaces: 15,
        minFaceDetectionConfidence: 0.25,
        minFacePresenceConfidence: 0.25,
        minTrackingConfidence: 0.25
      });
    }

    // 2. HandLandmarker 생성 (손가락 모드)
    if (window.HandLandmarker) {
      try {
        this.handLandmarker = await window.HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
      } catch (handGpuErr) {
        try {
          this.handLandmarker = await window.HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 1
          });
        } catch (handErr) {
          console.warn("[MotionDetector] HandLandmarker 로드 실패 (고개 기울임 모드는 정상 작동):", handErr);
        }
      }
    }

    return true;
  }

  setMode(mode) {
    this.mode = mode;
    this.resetSelection();
  }

  setPlayMode(playMode) {
    this.playMode = playMode; // "INDIVIDUAL" | "GROUP"
    this.resetSelection();
    this.setQuestionResultMode({ isRevealed: false, correctAnswer: null });
  }

  setQuestionResultMode({ isRevealed, correctAnswer }) {
    this.isResultRevealed = isRevealed;
    this.currentCorrectAnswer = correctAnswer;
  }

  resetSelection() {
    this.currentCandidate = null;
    this.confirmedCandidate = null;
    this.candidateStartTime = 0;
    this.isConfirmed = false;
    this.onSelectionProgress(0, 0);
  }

  /**
   * 실시간 비디오 프레임 루프
   */
  _predictLoop() {
    if (!this.isRunning) return;

    if (this.videoElement && this.videoElement.readyState >= 2) {
      // 캔버스 크기 비디오와 동기화
      if (this.canvasElement && this.videoElement.videoWidth > 0) {
        if (this.canvasElement.width !== this.videoElement.videoWidth || 
            this.canvasElement.height !== this.videoElement.videoHeight) {
          this.canvasElement.width = this.videoElement.videoWidth;
          this.canvasElement.height = this.videoElement.videoHeight;
        }
      }

      let candidate = null;

      // AI 모델이 준비되었을 때만 추론 실행
      if (this.isAiReady && this.videoElement.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.videoElement.currentTime;
        const startTimeMs = performance.now();

        try {
          if (this.mode === "HEAD_TILT" && this.faceLandmarker) {
            candidate = this._processFaces(startTimeMs);
          } else if (this.mode === "FINGER_COUNT" && this.handLandmarker) {
            candidate = this._detectFingerCount(startTimeMs);
          } else if (this.faceLandmarker) {
            candidate = this._processFaces(startTimeMs);
          }
        } catch (e) {
          // 비디오 프레임 동기화 일시 오류 무시
        }
      }

      // 개인 모드일 때만 단독 선택 확정 상태 업데이트
      if (this.playMode === "INDIVIDUAL") {
        this._updateSelectionState(candidate);
      }
    }

    this.animationFrameId = requestAnimationFrame(() => this._predictLoop());
  }

  /**
   * 얼굴 감지 및 모드별 처리 (개인 모드: 중앙 최우선 / 단체 모드: 다인원 집계)
   */
  _processFaces(timestamp) {
    const results = this.faceLandmarker.detectForVideo(this.videoElement, timestamp);
    this._clearCanvas();

    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      if (this.playMode === "GROUP") {
        this.onGroupVoteUpdate({ option1Count: 0, option2Count: 0, neutralCount: 0, totalCount: 0, faces: [] });
      }
      return null;
    }

    const allFaces = results.faceLandmarks;

    if (this.playMode === "GROUP") {
      // [2번 요구사항] 단체 모드: 모든 얼굴 분석 및 집계
      return this._handleGroupMode(allFaces);
    } else {
      // [1번 요구사항] 개인 모드: 중앙에 가장 크고 중심에 위치한 얼굴만 단독 인식
      return this._handleIndividualMode(allFaces);
    }
  }

  /**
   * [1번 요구사항] 개인 모드: 중앙 최우선 도전자 타겟팅 알고리즘
   */
  _handleIndividualMode(allFaces) {
    const scoredFaces = allFaces.map((landmarks, index) => {
      const box = this._getFaceBoundingBox(landmarks);
      const centerX = (box.minX + box.maxX) / 2;
      const centerY = (box.minY + box.maxY) / 2;
      const area = (box.maxX - box.minX) * (box.maxY - box.minY);

      // 화면 중심(0.5, 0.5)으로부터의 거리
      const distFromCenter = Math.hypot(centerX - 0.5, centerY - 0.5);

      // 점수 공식: 중심에 가까울수록, 크기가 클수록 압도적으로 높은 점수
      const score = area / (distFromCenter + 0.16);

      return { index, landmarks, box, score, centerX, centerY, area };
    });

    // 최고 점수(중앙 & 최대 크기) 얼굴 선정
    scoredFaces.sort((a, b) => b.score - a.score);
    const primary = scoredFaces[0];

    // 주변 다른 얼굴들 연한 보조 표시 렌더링
    for (let i = 1; i < scoredFaces.length; i++) {
      this._drawSecondaryFaceGuide(scoredFaces[i].box);
    }

    // 주인공 얼굴의 Roll 각도 계산
    const leftEye = primary.landmarks[263];
    const rightEye = primary.landmarks[33];
    const dx = rightEye.x - leftEye.x;
    const dy = rightEye.y - leftEye.y;
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    this.lastAngle = angleDeg;

    // 주인공 타겟 링 및 가이드 그리기
    this._drawPrimaryTargetGuide(primary.box, leftEye, rightEye, angleDeg);

    if (angleDeg > this.TILT_THRESHOLD_DEG) {
      return 2; // 오른쪽 기울임 -> 2번
    } else if (angleDeg < -this.TILT_THRESHOLD_DEG) {
      return 1; // 왼쪽 기울임 -> 1번
    }
    return null;
  }

  /**
   * [2번 요구사항] 단체 모드: 전원 얼굴 감지 & 실시간 1번/2번/대기 집계 및 캔버스 피드백
   */
  _handleGroupMode(allFaces) {
    let opt1 = 0;
    let opt2 = 0;
    let neutral = 0;

    const groupDetails = allFaces.map((landmarks, idx) => {
      const box = this._getFaceBoundingBox(landmarks);
      const leftEye = landmarks[263];
      const rightEye = landmarks[33];

      const dx = rightEye.x - leftEye.x;
      const dy = rightEye.y - leftEye.y;
      const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

      let vote = 0; // 0: 대기, 1: 1번, 2: 2번
      if (angleDeg > this.TILT_THRESHOLD_DEG) {
        vote = 2;
        opt2++;
      } else if (angleDeg < -this.TILT_THRESHOLD_DEG) {
        vote = 1;
        opt1++;
      } else {
        neutral++;
      }

      // 화면에 각 학생별 박스 및 뱃지 그리기
      this._drawGroupStudentBox(box, vote, idx + 1, angleDeg);

      return { id: idx + 1, box, vote, angleDeg };
    });

    // 실시간 단체 집계 콜백 전달
    this.onGroupVoteUpdate({
      option1Count: opt1,
      option2Count: opt2,
      neutralCount: neutral,
      totalCount: allFaces.length,
      faces: groupDetails
    });

    return null;
  }

  /**
   * 랜드마크로부터 얼굴 Bounding Box 정규화 좌표 계산
   */
  _getFaceBoundingBox(landmarks) {
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    // 얼굴 윤곽 및 눈/코 주요 점 기준
    for (let i = 0; i < landmarks.length; i += 3) {
      const p = landmarks[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    // 여백 확장 (머리둘레 고려)
    const paddingX = (maxX - minX) * 0.15;
    const paddingY = (maxY - minY) * 0.2;
    return {
      minX: Math.max(0, minX - paddingX),
      maxX: Math.min(1, maxX + paddingX),
      minY: Math.max(0, minY - paddingY),
      maxY: Math.min(1, maxY + paddingY)
    };
  }

  /**
   * 개인 모드 주인공 타겟팅 가이드 렌더링 (황금빛 타겟 링 & 도전자 라벨)
   */
  _drawPrimaryTargetGuide(box, leftEye, rightEye, angle) {
    if (!this.canvasElement) return;
    const ctx = this.canvasElement.getContext("2d");
    const w = this.canvasElement.width;
    const h = this.canvasElement.height;

    const bx = box.minX * w;
    const by = box.minY * h;
    const bw = (box.maxX - box.minX) * w;
    const bh = (box.maxY - box.minY) * h;

    ctx.save();

    // 1. 눈 가이드선
    const x1 = leftEye.x * w;
    const y1 = leftEye.y * h;
    const x2 = rightEye.x * w;
    const y2 = rightEye.y * h;

    const isTilted = Math.abs(angle) > this.TILT_THRESHOLD_DEG;
    ctx.strokeStyle = isTilted ? "#4ade80" : "rgba(255, 215, 0, 0.7)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 2. 황금빛 타겟 모서리 브라켓 (도전자 락온 효과)
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 4;
    const corner = Math.min(24, bw * 0.2);

    // 좌상단
    ctx.beginPath();
    ctx.moveTo(bx, by + corner);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + corner, by);
    ctx.stroke();

    // 우상단
    ctx.beginPath();
    ctx.moveTo(bx + bw - corner, by);
    ctx.lineTo(bx + bw, by);
    ctx.lineTo(bx + bw, by + corner);
    ctx.stroke();

    // 좌하단
    ctx.beginPath();
    ctx.moveTo(bx, by + bh - corner);
    ctx.lineTo(bx, by + bh);
    ctx.lineTo(bx + corner, by + bh);
    ctx.stroke();

    // 우하단
    ctx.beginPath();
    ctx.moveTo(bx + bw - corner, by + bh);
    ctx.lineTo(bx + bw, by + bh);
    ctx.lineTo(bx + bw, by + bh - corner);
    ctx.stroke();

    // 3. 도전자 라벨 뱃지
    const label = "🎯 도전자 (인식 중)";
    ctx.font = "bold 18px Pretendard, sans-serif";
    const textWidth = ctx.measureText(label).width;
    const badgeX = bx + (bw - textWidth) / 2 - 12;
    const badgeY = by - 14;

    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY - 22, textWidth + 24, 28, 6);
    ctx.fill();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#facc15";
    ctx.fillText(label, badgeX + 12, badgeY - 3);

    // 4. 기울임 방향 피드백 뱃지
    if (isTilted) {
      const choiceText = angle > 0 ? "👉 [2번] 선택 중" : "👈 [1번] 선택 중";
      const choiceColor = angle > 0 ? "#f43f5e" : "#38bdf8";
      ctx.fillStyle = choiceColor;
      ctx.font = "bold 20px Pretendard, sans-serif";
      ctx.fillText(choiceText, bx + (bw - ctx.measureText(choiceText).width) / 2, by + bh + 26);
    }

    ctx.restore();
  }

  /**
   * 개인 모드 주변 인물(비선택 얼굴) 점선 보조 표시
   */
  _drawSecondaryFaceGuide(box) {
    if (!this.canvasElement) return;
    const ctx = this.canvasElement.getContext("2d");
    const w = this.canvasElement.width;
    const h = this.canvasElement.height;

    const bx = box.minX * w;
    const by = box.minY * h;
    const bw = (box.maxX - box.minX) * w;
    const bh = (box.maxY - box.minY) * h;

    ctx.save();
    ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(bx, by, bw, bh);
    ctx.restore();
  }

  /**
   * 단체 모드 개별 학생 박스 & 투표/정오답 뱃지 렌더링
   */
  _drawGroupStudentBox(box, vote, studentId, angle) {
    if (!this.canvasElement) return;
    const ctx = this.canvasElement.getContext("2d");
    const w = this.canvasElement.width;
    const h = this.canvasElement.height;

    const bx = box.minX * w;
    const by = box.minY * h;
    const bw = (box.maxX - box.minX) * w;
    const bh = (box.maxY - box.minY) * h;

    ctx.save();

    // 정답 공개 모드인지 여부에 따라 색상 및 뱃지 분기
    let borderColor = "rgba(255, 255, 255, 0.4)";
    let badgeText = "대기";
    let badgeBg = "rgba(71, 85, 105, 0.85)";

    if (this.isResultRevealed) {
      // 정답 발표 상태
      const isCorrect = (vote === this.currentCorrectAnswer);
      if (isCorrect) {
        borderColor = "#22c55e"; // 정답 녹색
        badgeText = "⭕ 정답!";
        badgeBg = "rgba(34, 197, 94, 0.9)";
      } else {
        borderColor = "#ef4444"; // 오답 적색
        badgeText = "❌ 오답";
        badgeBg = "rgba(239, 68, 68, 0.9)";
      }
    } else {
      // 실시간 선택 중 상태
      if (vote === 1) {
        borderColor = "#38bdf8"; // 1번 파란색
        badgeText = "1번 👈";
        badgeBg = "rgba(14, 165, 233, 0.9)";
      } else if (vote === 2) {
        borderColor = "#f43f5e"; // 2번 붉은색
        badgeText = "👉 2번";
        badgeBg = "rgba(244, 63, 94, 0.9)";
      }
    }

    // 1. 얼굴 테두리 박스
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 8);
    ctx.stroke();

    // 2. 머리 위 상태 뱃지
    ctx.font = "bold 16px Pretendard, sans-serif";
    const textWidth = ctx.measureText(badgeText).width;
    const bwPadded = textWidth + 20;
    const bxCenter = bx + (bw - bwPadded) / 2;

    ctx.fillStyle = badgeBg;
    ctx.beginPath();
    ctx.roundRect(bxCenter, by - 26, bwPadded, 24, 6);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(badgeText, bxCenter + 10, by - 8);

    ctx.restore();
  }

  /**
   * 손가락 개수 계산 (1~4)
   */
  _detectFingerCount(timestamp) {
    const results = this.handLandmarker.detectForVideo(this.videoElement, timestamp);
    this._clearCanvas();

    if (!results || !results.landmarks || results.landmarks.length === 0) {
      return null;
    }

    const hand = results.landmarks[0];
    let count = 0;

    const fingerTips = [8, 12, 16, 20];
    const fingerPips = [6, 10, 14, 18];

    fingerTips.forEach((tipIdx, i) => {
      const pipIdx = fingerPips[i];
      if (hand[tipIdx].y < hand[pipIdx].y) {
        count++;
      }
    });

    this._drawHandFeedback(hand, count);

    if (count >= 1 && count <= 4) {
      return count;
    }
    return null;
  }

  /**
   * 지속 시간 체크 및 선택 반영 로직 (개인 모드 전용)
   * 고개를 기울여 일정 시간 유지하면 선택되고, 언제든 다른 번호로 변경 가능
   */
  _updateSelectionState(candidate) {
    const now = performance.now();

    if (candidate !== null) {
      if (this.currentCandidate === candidate) {
        const elapsed = now - this.candidateStartTime;
        const progress = Math.min(1, elapsed / this.HOLD_DURATION_MS);
        this.onSelectionProgress(candidate, progress);

        if (progress >= 1 && this.confirmedCandidate !== candidate) {
          this.confirmedCandidate = candidate;
          this.onSelectionConfirm(candidate);
        }
      } else {
        this.currentCandidate = candidate;
        this.candidateStartTime = now;
        this.onSelectionProgress(candidate, 0.05);
      }
    } else {
      if (this.currentCandidate !== null) {
        this.currentCandidate = null;
        this.candidateStartTime = 0;
        this.onSelectionProgress(0, 0);
      }
    }
  }

  _clearCanvas() {
    if (!this.canvasElement) return;
    const ctx = this.canvasElement.getContext("2d");
    ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
  }

  _drawHandFeedback(hand, count) {
    if (!this.canvasElement) return;
    const ctx = this.canvasElement.getContext("2d");
    const w = this.canvasElement.width;
    const h = this.canvasElement.height;

    ctx.save();
    ctx.fillStyle = "#38bdf8";
    hand.forEach(pt => {
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, 5, 0, 2 * Math.PI);
      ctx.fill();
    });

    ctx.font = "bold 28px sans-serif";
    ctx.fillStyle = "#facc15";
    ctx.fillText(`${count}번 선택 중`, hand[0].x * w, hand[0].y * h - 20);
    ctx.restore();
  }

  destroy() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }
}
