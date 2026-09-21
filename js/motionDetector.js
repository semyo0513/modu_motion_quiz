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
    this.stream = null;
    
    // 모션 판정 파라미터
    this.TILT_THRESHOLD_DEG = 12; // 고개 기울임 임계 각도 (도)
    this.HOLD_DURATION_MS = 550;  // 선택 확정을 위한 유지 시간 (ms)
    
    this.currentCandidate = null; // 현재 선택 중인 옵션 인덱스 (1, 2, 3, 4)
    this.candidateStartTime = 0;  // 선택 유지 시작 시각
    this.lastAngle = 0;
    this.isConfirmed = false;     // 현재 문제에서 이미 확정되었는지 여부
    
    this.animationFrameId = null;
  }

  /**
   * MediaPipe 모듈 및 웹캠 초기화
   */
  async init() {
    try {
      this.onStatusChange("AI 모션 인식 모델을 불러오는 중...", false);

      // MediaPipe Tasks-Vision 로딩 대기
      if (!window.FilesetResolver || !window.FaceLandmarker) {
        throw new Error("MediaPipe 스크립트가 아직 로드되지 않았습니다.");
      }

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      // 1. FaceLandmarker 초기화
      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU"
        },
        outputFaceBlendshapes: false,
        runningMode: "VIDEO",
        numFaces: 1
      });

      // 2. HandLandmarker 초기화 (손가락 모드용)
      if (window.HandLandmarker) {
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
      }

      // 웹캠 스트림 시작
      await this._startCamera();

      this.isRunning = true;
      this.onStatusChange("카메라와 모션 인식이 준비되었습니다!", true);
      this._predictLoop();
      return true;
    } catch (err) {
      console.error("[MotionDetector] 초기화 실패:", err);
      this.onStatusChange("웹캠 또는 AI 모델 로딩 실패 (클릭으로 플레이 가능)", false);
      return false;
    }
  }

  async _startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("이 브라우저는 웹캠 접근을 지원하지 않습니다.");
    }

    const constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      },
      audio: false
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
    }
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
   * 실시간 프레임 루프
   */
  _predictLoop() {
    if (!this.isRunning) return;

    if (this.videoElement && this.videoElement.readyState >= 2) {
      const startTimeMs = performance.now();
      
      let candidate = null;

      if (this.mode === "HEAD_TILT" && this.faceLandmarker) {
        candidate = this._detectHeadTilt(startTimeMs);
      } else if (this.mode === "FINGER_COUNT" && this.handLandmarker) {
        candidate = this._detectFingerCount(startTimeMs);
      } else if (this.faceLandmarker) {
        candidate = this._detectHeadTilt(startTimeMs);
      }

      // 선택 상태 업데이트 및 확정 처리
      this._updateSelectionState(candidate);
    }

    this.animationFrameId = requestAnimationFrame(() => this._predictLoop());
  }

  /**
   * 고개 기울임(Roll) 계산
   * 좌우 눈꼬리 랜드마크: 33 (오른눈 안/바깥쪽), 263 (왼눈 바깥쪽)
   */
  _detectHeadTilt(timestamp) {
    const results = this.faceLandmarker.detectForVideo(this.videoElement, timestamp);
    this._clearCanvas();

    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      return null;
    }

    const landmarks = results.faceLandmarks[0];
    const leftEye = landmarks[263];  // 사용자 기준 왼쪽 눈 (카메라 화면)
    const rightEye = landmarks[33];  // 사용자 기준 오른쪽 눈

    // 기울기 각도 계산 (라디안 -> 도)
    const dx = rightEye.x - leftEye.x;
    const dy = rightEye.y - leftEye.y;
    let angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

    // 미러링된 화면 기준 각도 보정
    // 사용자가 오른쪽으로 고개를 젖히면 화면 기준 오른쪽(선택지 2번), 왼쪽으로 젖히면 1번
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
    const wrist = hand[0];
    let count = 0;

    // 검지, 중지, 약지, 소지 끝(Tip) vs 관절(PIP) y위치 비교
    // 손끝(8, 12, 16, 20)이 해당 관절(6, 10, 14, 18)보다 위(y값이 더 작음)에 있으면 펴진 것으로 판정
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
      // 중립/인식 안 됨
      if (this.currentCandidate !== null) {
        this.currentCandidate = null;
        this.candidateStartTime = 0;
        this.onSelectionProgress(0, 0);
      }
    }
  }

  // ===== 캔버스 가이드 시각화 =====
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
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 중심 기준 수평 가이드 점선
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(midX - 40, midY);
    ctx.lineTo(midX + 40, midY);
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
      ctx.arc(pt.x * w, pt.y * h, 4, 0, 2 * Math.PI);
      ctx.fill();
    });

    // 손목 근처에 인식된 숫자 표시
    ctx.font = "bold 24px sans-serif";
    ctx.fillStyle = "#facc15";
    ctx.fillText(`${count}번`, hand[0].x * w, hand[0].y * h - 20);
    ctx.restore();
  }

  /**
   * 리소스 정리
   */
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
