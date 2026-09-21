/**
 * 게임 메인 엔진 모듈 (main.js)
 * 1회 프리로드, 문제 순차 진행, 타이머, 모션 피드백, 점수/콤보 및 애니메이션을 총괄합니다.
 */

document.addEventListener("DOMContentLoaded", () => {
  // DOM 요소
  const startScreen = document.getElementById("start-screen");
  const gameScreen = document.getElementById("game-screen");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loadingStatusText = document.getElementById("loading-status-text");

  const startBtn = document.getElementById("start-game-btn");
  const currentQNumEl = document.getElementById("current-q-num");
  const totalQNumEl = document.getElementById("total-q-num");
  const scoreValEl = document.getElementById("current-score-val");
  const comboValEl = document.getElementById("current-combo-val");
  const comboBadgeEl = document.getElementById("combo-badge");

  const questionCard = document.getElementById("question-card");
  const questionCategoryEl = document.getElementById("question-category");
  const questionTextEl = document.getElementById("question-text");
  const optionsContainer = document.getElementById("options-container");

  const timerTextEl = document.getElementById("timer-text");
  const timerCircleEl = document.getElementById("timer-circle-progress");
  const motionGuideText = document.getElementById("motion-guide-text");

  const videoEl = document.getElementById("webcam-video");
  const canvasEl = document.getElementById("webcam-canvas");
  const feedbackOverlay = document.getElementById("feedback-overlay");
  const feedbackText = document.getElementById("feedback-text");

  // 게임 상태 변수
  let gameSettings = {};
  let questions = [];
  let currentIndex = 0;
  let currentQuestion = null;

  let currentScore = 0;
  let currentCombo = 0;
  let maxCombo = 0;
  let correctCount = 0;

  let timerInterval = null;
  let timeLeft = 15;
  let timeLimit = 15;
  let isAnswerLocked = false;

  // 모션 디텍터 인스턴스
  let motionDetector = null;

  // 1. 게임 시작 버튼 클릭
  startBtn.addEventListener("click", async () => {
    await initAndStartGame();
  });

  // 키보드 폴백 (1, 2, 3, 4번 또는 좌/우 방향키)
  window.addEventListener("keydown", (e) => {
    if (isAnswerLocked || !gameScreen || gameScreen.classList.contains("hidden")) return;
    
    if (e.key === "ArrowLeft" || e.key === "1") {
      handleOptionSelected(1);
    } else if (e.key === "ArrowRight" || e.key === "2") {
      handleOptionSelected(2);
    } else if (e.key === "3") {
      handleOptionSelected(3);
    } else if (e.key === "4") {
      handleOptionSelected(4);
    }
  });

  /**
   * 초기화 및 게임 시작 (병렬 프리로드)
   */
  async function initAndStartGame() {
    startScreen.classList.add("hidden");
    loadingOverlay.classList.remove("hidden");
    loadingStatusText.textContent = "퀴즈 데이터와 카메라를 준비하고 있습니다...";

    try {
      // 1. API 데이터 1회 프리로드
      const gameDataPromise = ApiService.getGameData();

      // 2. 모션 인식기 초기화
      if (!motionDetector) {
        motionDetector = new MotionDetector({
          videoElement: videoEl,
          canvasElement: canvasEl,
          mode: "HEAD_TILT",
          onSelectionProgress: (optIdx, progress) => {
            updateOptionProgressUI(optIdx, progress);
          },
          onSelectionConfirm: (optIdx) => {
            if (!isAnswerLocked) {
              handleOptionSelected(optIdx);
            }
          },
          onStatusChange: (statusMsg, isReady) => {
            if (motionGuideText) motionGuideText.textContent = statusMsg;
          }
        });
      }

      const [gameData, detectorReady] = await Promise.all([
        gameDataPromise,
        motionDetector.init()
      ]);

      gameSettings = gameData.settings || {};
      questions = gameData.questions || [];
      timeLimit = parseInt(gameSettings.TIME_LIMIT_PER_Q, 10) || 15;

      if (!questions || questions.length === 0) {
        alert("출제할 문제가 없습니다. 관리자 페이지에서 문제를 등록해주세요.");
        location.reload();
        return;
      }

      // 게임 화면으로 전환
      loadingOverlay.classList.add("hidden");
      gameScreen.classList.remove("hidden");

      // 상태 초기화
      currentIndex = 0;
      currentScore = 0;
      currentCombo = 0;
      maxCombo = 0;
      correctCount = 0;
      updateScoreUI();

      totalQNumEl.textContent = questions.length;
      loadNextQuestion();
    } catch (err) {
      console.error("게임 초기화 실패:", err);
      loadingOverlay.classList.add("hidden");
      alert("게임 로딩 중 오류가 발생했습니다: " + err.message);
      startScreen.classList.remove("hidden");
    }
  }

  /**
   * 다음 문제 로드
   */
  function loadNextQuestion() {
    if (currentIndex >= questions.length) {
      endGame();
      return;
    }

    isAnswerLocked = false;
    currentQuestion = questions[currentIndex];
    currentQNumEl.textContent = currentIndex + 1;

    // 모션 모드 전환 (2지선다면 고개 기울임, 4지선다면 설정에 따라 손가락 또는 자동)
    if (currentQuestion.type === "4지선다") {
      motionDetector.setMode("FINGER_COUNT");
      motionGuideText.textContent = "💡 손가락 개수(1~4개)를 펴서 번호를 선택하세요!";
    } else {
      motionDetector.setMode("HEAD_TILT");
      motionGuideText.textContent = "💡 고개를 왼쪽(1번) 또는 오른쪽(2번)으로 기울이세요!";
    }
    motionDetector.resetSelection();

    // 칠판 UI 렌더링
    questionCategoryEl.textContent = currentQuestion.category || "국어";
    questionTextEl.textContent = currentQuestion.question;

    // 선택지 생성
    renderOptionsUI(currentQuestion);

    // 카드 회전 애니메이션
    questionCard.classList.remove("card-enter");
    void questionCard.offsetWidth; // 트리거 리플로우
    questionCard.classList.add("card-enter");

    // 타이머 시작
    startTimer();
  }

  /**
   * 선택지 렌더링
   */
  function renderOptionsUI(question) {
    optionsContainer.innerHTML = "";
    const is4 = question.type === "4지선다";
    optionsContainer.className = is4 ? "options-grid-4" : "options-grid-2";

    const opts = question.options || [];
    opts.forEach((optText, idx) => {
      const optIndex = idx + 1;
      const btn = document.createElement("div");
      btn.className = `option-bubble option-${optIndex}`;
      btn.id = `option-bubble-${optIndex}`;
      btn.innerHTML = `
        <div class="option-progress-bar" id="opt-prog-${optIndex}"></div>
        <div class="option-content">
          <span class="option-badge">${optIndex}</span>
          <span class="option-text">${escapeHtml(optText)}</span>
        </div>
      `;

      // 클릭 시 대체 선택 가능
      btn.addEventListener("click", () => {
        if (!isAnswerLocked) {
          handleOptionSelected(optIndex);
        }
      });

      optionsContainer.appendChild(btn);
    });
  }

  /**
   * 모션 유지 진행도 UI 업데이트
   */
  function updateOptionProgressUI(optIndex, progress) {
    const bubbles = document.querySelectorAll(".option-bubble");
    bubbles.forEach(b => b.classList.remove("highlighted"));

    if (optIndex > 0) {
      const targetBubble = document.getElementById(`option-bubble-${optIndex}`);
      const progressBar = document.getElementById(`opt-prog-${optIndex}`);
      if (targetBubble && progressBar) {
        targetBubble.classList.add("highlighted");
        progressBar.style.width = `${progress * 100}%`;
        if (progress > 0.05 && progress < 0.2) {
          AudioPlayer.playSelect();
        }
      }
    } else {
      document.querySelectorAll(".option-progress-bar").forEach(p => {
        p.style.width = "0%";
      });
    }
  }

  /**
   * 타이머 루프
   */
  function startTimer() {
    clearInterval(timerInterval);
    timeLeft = timeLimit;
    updateTimerUI();

    const circleLength = 2 * Math.PI * 45; // r=45 -> ~282.7

    timerInterval = setInterval(() => {
      timeLeft--;
      updateTimerUI();

      if (timeLeft <= 3 && timeLeft > 0) {
        AudioPlayer.playTick();
      }

      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        handleTimeOut();
      }
    }, 1000);
  }

  function updateTimerUI() {
    timerTextEl.textContent = timeLeft;
    const circleLength = 2 * Math.PI * 45;
    const offset = circleLength * (1 - timeLeft / timeLimit);
    timerCircleEl.style.strokeDasharray = `${circleLength}`;
    timerCircleEl.style.strokeDashoffset = `${offset}`;

    if (timeLeft <= 3) {
      timerCircleEl.style.stroke = "#ef4444";
    } else if (timeLeft <= 7) {
      timerCircleEl.style.stroke = "#f59e0b";
    } else {
      timerCircleEl.style.stroke = "#10b981";
    }
  }

  /**
   * 정답 선택 처리
   */
  function handleOptionSelected(chosenIndex) {
    if (isAnswerLocked) return;
    isAnswerLocked = true;
    clearInterval(timerInterval);

    const isCorrect = chosenIndex === currentQuestion.answer;
    showAnswerFeedback(isCorrect, chosenIndex);
  }

  /**
   * 시간 초과 처리
   */
  function handleTimeOut() {
    if (isAnswerLocked) return;
    isAnswerLocked = true;
    showAnswerFeedback(false, null, true);
  }

  /**
   * 정답/오답 피드백 및 점수 계산
   */
  function showAnswerFeedback(isCorrect, chosenIndex, isTimeout = false) {
    const targetBubble = chosenIndex ? document.getElementById(`option-bubble-${chosenIndex}`) : null;
    const correctBubble = document.getElementById(`option-bubble-${currentQuestion.answer}`);

    if (isCorrect) {
      correctCount++;
      currentCombo++;
      if (currentCombo > maxCombo) maxCombo = currentCombo;

      // 점수 공식: 기본 100점 + (남은시간 x 10) + (콤보 보너스 10%씩)
      const baseScore = 100;
      const speedBonus = timeLeft * 10;
      const comboMultiplier = 1 + (currentCombo - 1) * 0.1;
      const earned = Math.round((baseScore + speedBonus) * comboMultiplier);
      currentScore += earned;

      if (targetBubble) targetBubble.classList.add("correct-choice");
      
      AudioPlayer.playCorrect();
      if (currentCombo >= 2) {
        setTimeout(() => AudioPlayer.playCombo(), 250);
      }

      showFeedbackOverlay(true, `정답! +${earned}점`, currentCombo);
      triggerConfetti();
    } else {
      currentCombo = 0;
      if (targetBubble) targetBubble.classList.add("wrong-choice");
      if (correctBubble) correctBubble.classList.add("correct-choice");

      AudioPlayer.playWrong();
      questionCard.classList.add("shake-card");
      showFeedbackOverlay(false, isTimeout ? "시간 초과!" : "오답!", 0);
    }

    updateScoreUI();

    // 1.6초 후 다음 문제로
    setTimeout(() => {
      questionCard.classList.remove("shake-card");
      hideFeedbackOverlay();
      currentIndex++;
      loadNextQuestion();
    }, 1600);
  }

  function updateScoreUI() {
    scoreValEl.textContent = currentScore.toLocaleString();
    if (currentCombo >= 2) {
      comboBadgeEl.classList.remove("hidden");
      comboValEl.textContent = currentCombo;
    } else {
      comboBadgeEl.classList.add("hidden");
    }
  }

  function showFeedbackOverlay(isSuccess, text, combo) {
    feedbackOverlay.classList.remove("hidden", "feedback-correct", "feedback-wrong");
    feedbackOverlay.classList.add(isSuccess ? "feedback-correct" : "feedback-wrong");
    
    let comboHtml = combo >= 2 ? `<div class="feedback-combo">${combo} COMBO 🔥</div>` : "";
    feedbackText.innerHTML = `<span>${text}</span>${comboHtml}`;
  }

  function hideFeedbackOverlay() {
    feedbackOverlay.classList.add("hidden");
  }

  /**
   * 폭죽 컨페티 효과 (순수 Canvas 파티클)
   */
  function triggerConfetti() {
    const confettiContainer = document.getElementById("confetti-container");
    if (!confettiContainer) return;

    confettiContainer.innerHTML = "";
    const colors = ["#f43f5e", "#3b82f6", "#10b981", "#fbbf24", "#a855f7"];

    for (let i = 0; i < 40; i++) {
      const piece = document.createElement("div");
      piece.className = "confetti-particle";
      piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.top = `${Math.random() * 20}%`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      piece.style.animationDelay = `${Math.random() * 0.3}s`;
      piece.style.animationDuration = `${0.8 + Math.random() * 0.6}s`;
      confettiContainer.appendChild(piece);
    }

    setTimeout(() => {
      confettiContainer.innerHTML = "";
    }, 1800);
  }

  /**
   * 게임 종료
   */
  function endGame() {
    clearInterval(timerInterval);
    gameScreen.classList.add("hidden");
    AudioPlayer.playFanfare();

    RankingManager.showResult({
      totalScore: currentScore,
      correctCount: correctCount,
      totalCount: questions.length,
      maxCombo: maxCombo
    }, () => {
      // 재시작 시
      initAndStartGame();
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
});
