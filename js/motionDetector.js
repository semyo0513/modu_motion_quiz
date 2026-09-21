/**
 * 모션 인식 전담 모듈 (motionDetector.js)
 * MediaPipe Tasks-Vision FaceLandmarker / HandLandmarker를 활용한
 * 고개 기울임(Roll Angle) 및 손가락 개수 인식 엔진입니다.
 */

class MotionDetector {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.canvasElement = options.canvasElement || null;
    this.mode = options.mode || "HEAD_TILT"; // "HEAD_TILT" | "FINGER_COUNT"
    
    // 콜백 함수들
    this.onSelectionProgress = options.onSelectionProgress || (() => {}); // (optionIndex, progress: 0~1)
    this.onSelectionConfirm = options.onSelectionConfirm || (() => {});   // (optionIndex: 1, 2, 3, 4)
    this.onStatusChange = options.onStatusChange || (() => {});         // (statusMessage, isReady)

    // 내부 상태
    this.faceLandmarker = null;
    this.handLandmarker = null;
    this.isRunning = false;
    this.isAiReady = false;
    this.stream = null;
    
    // 모션 판정 파라미터
    this.TILT_THRESHOLD_DEG = 12; // 고개 기울임 임계 각도 (도)
    this.HOLD_DURATION_MS = 550;  // 선택 확정을 위한 유지 시간 (ms)
    
    this.currentCandidate = null; // 현재 선택 중인 옵션 인덱스 (1, 2, 3, 4)
    this.candidateStartTime = 0;  // 선택 유지 시작 시각
    this.lastAngle = 0;
    this.isConfirmed = false;     // 현재 문제에서 이미 확정되었는지 여부
    
    this.animationFrameId = null;
    this.lastVideoTime = -1;
  }

  /**
   * 1단계: 카메라 우선 실행 -> 2단계: 백그라운드 AI 모델 로딩
   */
  async init() {
    try {
      this.onStatusChange("카메라를 켜는 중입니다...", false);

      // 1. 카메라 스트림 즉시 시작 (화면에 영상이 바로 나오도록 최우선 처리)
      await this._startCamera();
      this.isRunning = true;
      this.onStatusChange("카메라 연결 성공! AI 인식 모델을 불러옵니다...", false);

      // 2. 백그라운드에서 AI 비전 모델 로드
      this._loadAiModels().then((success) => {
        if (success) {
          this.isAiReady = true;
          this.onStatusChange("모션 인식이 준비되었습니다! 고개를 기울여보세요.", true);
        } else {
          this.onStatusChange("모션 인식 모델 연결 실패 (마우스/키보드로 플레이 가능)", false);
        }
      }).catch(err => {
        console.warn("[MotionDetector] AI 모델 로드 경고:", err);
        this.onStatusChange("모션 인식 모델 로드 지연 (마우스/키보드로 즉시 플레이 가능)", false);
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
   * 웹캠 스트림 획득 및 video 태그 재생
   */
  async _startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("브라우저가 웹캠 접근을 지원하지 않습니다.");
    }

    const constraints = {
      video: {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
        facingMode: "user"
      },
      audio: false
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      this.videoElement.setAttribute("playsinline", "true");
      this.videoElement.setAttribute("autoplay", "true");
      this.videoElement.muted = true;

      // 비디오 메타데이터 로드 대기 (안전장치 2초 타임아웃 포함)
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
          setTimeout(resolve, 2000);
        }
      });

      // 명시적 play 호출
      try {
        await this.videoElement.play();
      } catch (playErr) {
        console.warn("[MotionDetector] video.play() 자동재생 차단 예외 처리:", playErr);
      }
    }
  }

  /**
   * MediaPipe Tasks-Vision 모델 로드
   */
  async _loadAiModels() {
    // FilesetResolver 로드 대기 (최대 10초 대기)
    let retries = 0;
    while ((!window.FilesetResolver || !window.FaceLandmarker) && retries < 20) {
      await new Promise(r => setTimeout(r, 500));
      retries++;
    }

    if (!window.FilesetResolver || !window.FaceLandmarker) {
      throw new Error("MediaPipe SDK 라이브러리를 불러올 수 없습니다.");
    }

    const vision = await window.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    // FaceLandmarker 생성
    this.faceLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      outputFaceBlendshapes: false,
      runningMode: "VIDEO",
      numFaces: 1
    });

    // HandLandmarker 생성 (손가락 모드)
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
      } catch (handErr) {
        console.warn("[MotionDetector] HandLandmarker 로드 실패 (고개 기울임 모드는 정상 작동):", handErr);
      }
    }

    return true;
  }

  setMode(mode) {
    this.mode = mode;
    this.resetSelection();
  }

  resetSelection() {
    this.currentCandidate = null;
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
            candidate = this._detectHeadTilt(startTimeMs);
          } else if (this.mode === "FINGER_COUNT" && this.handLandmarker) {
            candidate = this._detectFingerCount(startTimeMs);
          } else if (this.faceLandmarker) {
            candidate = this._detectHeadTilt(startTimeMs);
          }
        } catch (e) {
          // 비디오 프레임 동기화 일시 오류 무시
        }
      }

      // 선택 상태 업데이트 및 확정 처리
      this._updateSelectionState(candidate);
    }

    this.animationFrameId = requestAnimationFrame(() => this._predictLoop());
  }

  /**
   * 고개 기울임(Roll) 계산
   */
  _detectHeadTilt(timestamp) {
    const results = this.faceLandmarker.detectForVideo(this.videoElement, timestamp);
    this._clearCanvas();

    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      return null;
    }

    const landmarks = results.faceLandmarks[0];
    const leftEye = landmarks[263];  // 사용자 왼쪽 눈
    const rightEye = landmarks[33];  // 사용자 오른쪽 눈

    const dx = rightEye.x - leftEye.x;
    const dy = rightEye.y - leftEye.y;
    let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

    this.lastAngle = angleDeg;
    this._drawTiltGuide(leftEye, rightEye, angleDeg);

    if (angleDeg > this.TILT_THRESHOLD_DEG) {
      // 오른쪽 기울임 -> 2번 선택지
      return 2;
    } else if (angleDeg < -this.TILT_THRESHOLD_DEG) {
      // 왼쪽 기울임 -> 1번 선택지
      return 1;
    }

    return null; // 중립 상태
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
   * 지속 시간 체크 및 확정 로직
   */
  _updateSelectionState(candidate) {
    if (this.isConfirmed) return;

    const now = performance.now();

    if (candidate !== null) {
      if (this.currentCandidate === candidate) {
        const elapsed = now - this.candidateStartTime;
        const progress = Math.min(1, elapsed / this.HOLD_DURATION_MS);
        this.onSelectionProgress(candidate, progress);

        if (progress >= 1 && !this.isConfirmed) {
          this.isConfirmed = true;
          this.onSelectionConfirm(candidate);
        }
      } else {
        // 새로운 후보 선택 시작
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

  _drawTiltGuide(leftEye, rightEye, angle) {
    if (!this.canvasElement) return;
    const ctx = this.canvasElement.getContext("2d");
    const w = this.canvasElement.width;
    const h = this.canvasElement.height;

    const x1 = leftEye.x * w;
    const y1 = leftEye.y * h;
    const x2 = rightEye.x * w;
    const y2 = rightEye.y * h;

    ctx.save();
    ctx.strokeStyle = Math.abs(angle) > this.TILT_THRESHOLD_DEG ? "#4ade80" : "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(midX - 50, midY);
    ctx.lineTo(midX + 50, midY);
    ctx.stroke();

    ctx.restore();
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
