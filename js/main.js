/**
 * 게임 메인 엔진 모듈 (main.js)
 * 1회 프리로드, 문제 순차 진행, 타이머, 모션 피드백, 
 * 개인 모드(중앙 도전자 집중) 및 단체 모드(다인원 동시 투표 & 정오답자 수 집계) 총괄
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
  const gameModeBadgeEl = document.getElementById("game-mode-badge");

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

  // 모드 선택 버튼 및 카메라 선택 요소
  const modeIndividualBtn = document.getElementById("mode-individual-btn");
  const modeGroupBtn = document.getElementById("mode-group-btn");
  const cameraSelect = document.getElementById("camera-select");

  // 단체 모드 전용 UI 요소
  const groupHudStats = document.getElementById("group-hud-stats");
  const individualScoreDisplay = document.getElementById("individual-score-display");
  const detectedStudentsCountEl = document.getElementById("detected-students-count");

  const groupVotePanel = document.getElementById("group-vote-panel");
  const groupOpt1CountEl = document.getElementById("group-opt1-count");
  const groupOpt2CountEl = document.getElementById("group-opt2-count");
  const groupNeutralCountEl = document.getElementById("group-neutral-count");
  const voteBar1 = document.getElementById("vote-bar-1");
  const voteBar2 = document.getElementById("vote-bar-2");

  const groupResultOverlay = document.getElementById("group-result-overlay");
  const groupResultTitle = document.getElementById("group-result-title");
  const groupCorrectCountEl = document.getElementById("group-correct-count");
  const groupWrongCountEl = document.getElementById("group-wrong-count");
  const groupCorrectRateEl = document.getElementById("group-correct-rate");
  const groupResultDesc = document.getElementById("group-result-desc");

  // 결과 화면 요소
  const resultMainTitle = document.getElementById("result-main-title");
  const finalScoreLabel = document.getElementById("final-score-label");
  const finalScoreVal = document.getElementById("final-score-val");
  const statTitle1 = document.getElementById("stat-title-1");
  const statTitle2 = document.getElementById("stat-title-2");
  const statTitle3 = document.getElementById("stat-title-3");
  const correctStatEl = document.getElementById("correct-stat");
  const maxComboStatEl = document.getElementById("max-combo-stat");
  const accuracyStatEl = document.getElementById("accuracy-stat");
  const individualRankingSection = document.getElementById("individual-ranking-section");

  // 게임 상태 변수
  let playMode = "INDIVIDUAL"; // "INDIVIDUAL" | "GROUP"
  let selectedDeviceId = "";
  let gameSettings = {};
  let questions = [];
  let currentIndex = 0;
  let currentQuestion = null;

  // 개인 모드 기록
  let currentScore = 0;
  let currentCombo = 0;
  let maxCombo = 0;
  let correctCount = 0;

  // 단체 모드 기록
  let lastGroupVoteData = { option1Count: 0, option2Count: 0, neutralCount: 0, totalCount: 0, faces: [] };
  let groupStatsHistory = []; // 각 문제별 { questionIndex, correctCount, wrongCount, rate, totalDetected }
  let maxDetectedInGroup = 0;

  let timerInterval = null;
  let timeLeft = 15;
  let timeLimit = 15;
  let isAnswerLocked = false;
  let currentChosenOption = null; // 현재 문제에서 선택된 답 번호 (1, 2, 3, 4)
  let chosenTimeLeft = 0; // 답을 선택한 시점의 남은 시간 (속도 보너스 계산용)

  // 모션 디텍터 인스턴스
  let motionDetector = null;

  // 카메라 목록 채우기
  initCameraSelect();

  // 모드 선택 이벤트
  modeIndividualBtn.addEventListener("click", () => {
    playMode = "INDIVIDUAL";
    modeIndividualBtn.classList.add("active");
    modeGroupBtn.classList.remove("active");
  });

  modeGroupBtn.addEventListener("click", () => {
    playMode = "GROUP";
    modeGroupBtn.classList.add("active");
    modeIndividualBtn.classList.remove("active");
  });

  cameraSelect.addEventListener("change", (e) => {
    selectedDeviceId = e.target.value;
    if (motionDetector && motionDetector.isRunning) {
      motionDetector.switchCamera(selectedDeviceId);
    }
  });

  // 1. 게임 시작 버튼 클릭
  startBtn.addEventListener("click", async () => {
    await initAndStartGame();
  });

  // 키보드 조작
  window.addEventListener("keydown", (e) => {
    if (isAnswerLocked || !gameScreen || gameScreen.classList.contains("hidden")) return;
    
    if (playMode === "INDIVIDUAL") {
      if (e.key === "ArrowLeft" || e.key === "1") {
        handleOptionSelected(1);
      } else if (e.key === "ArrowRight" || e.key === "2") {
        handleOptionSelected(2);
      } else if (e.key === "3") {
        handleOptionSelected(3);
      } else if (e.key === "4") {
        handleOptionSelected(4);
      }
    } else {
      // 단체 모드: 스페이스바 또는 Enter 누르면 타이머 기다리지 않고 즉시 투표 마감
      if (e.key === " " || e.key === "Enter") {
        handleGroupQuestionEnd();
      }
    }
  });

  /**
   * 카메라 장치 목록 로드 (전자칠판 내장/외장 카메라 목록)
   */
  async function initCameraSelect() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === "videoinput");
      
      cameraSelect.innerHTML = `<option value="">기본 카메라 (자동 감지)</option>`;
      videoDevices.forEach((dev, idx) => {
        const opt = document.createElement("option");
        opt.value = dev.deviceId;
        opt.textContent = dev.label || `카메라 ${idx + 1} (전자칠판/웹캠)`;
        cameraSelect.appendChild(opt);
      });
    } catch (err) {
      console.warn("카메라 장치 목록 초기화 실패:", err);
    }
  }

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
          playMode: playMode,
          onSelectionProgress: (optIdx, progress) => {
            if (playMode === "INDIVIDUAL") {
              updateOptionProgressUI(optIdx, progress);
            }
          },
          onSelectionConfirm: (optIdx) => {
            if (playMode === "INDIVIDUAL" && !isAnswerLocked) {
              handleOptionSelected(optIdx);
            }
          },
          onGroupVoteUpdate: (voteData) => {
            if (playMode === "GROUP") {
              updateGroupVoteUI(voteData);
            }
          },
          onStatusChange: (statusMsg, isReady) => {
            if (motionGuideText) motionGuideText.textContent = statusMsg;
          }
        });
      } else {
        motionDetector.setPlayMode(playMode);
      }

      const [gameData, detectorReady] = await Promise.all([
        gameDataPromise,
        motionDetector.init(selectedDeviceId)
      ]);

      // 카메라 목록 재갱신 (권한 획득 후 레이블이 보이므로)
      initCameraSelect();

      gameSettings = gameData.settings || {};
      questions = gameData.questions || [];
      timeLimit = parseInt(gameSettings.TIME_LIMIT_PER_Q, 10) || 15;

      if (!questions || questions.length === 0) {
        alert("출제할 문제가 없습니다. 관리자 페이지에서 문제를 등록해주세요.");
        location.reload();
        return;
      }

      // 모드별 상단 헤더 UI 세팅
      if (playMode === "GROUP") {
        gameModeBadgeEl.textContent = "👥 단체 모드";
        groupHudStats.classList.remove("hidden");
        individualScoreDisplay.classList.add("hidden");
        groupVotePanel.classList.remove("hidden");
        comboBadgeEl.classList.add("hidden");
      } else {
        gameModeBadgeEl.textContent = "👤 1인 대표";
        groupHudStats.classList.add("hidden");
        individualScoreDisplay.classList.remove("hidden");
        groupVotePanel.classList.add("hidden");
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
      groupStatsHistory = [];
      maxDetectedInGroup = 0;
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
    currentChosenOption = null;
    chosenTimeLeft = 0;
    currentQuestion = questions[currentIndex];
    currentQNumEl.textContent = currentIndex + 1;

    // 모션 모드 전환
    if (currentQuestion.type === "4지선다" && playMode === "INDIVIDUAL") {
      motionDetector.setMode("FINGER_COUNT");
      motionGuideText.textContent = "💡 손가락 개수(1~4개)를 펴서 번호를 선택하세요! (제한시간 종료 시 최종 판정)";
    } else {
      motionDetector.setMode("HEAD_TILT");
      if (playMode === "GROUP") {
        motionGuideText.textContent = "💡 학생 전원: 고개를 왼쪽(1번) 또는 오른쪽(2번)으로 기울여 투표하세요! (Enter: 조기마감)";
      } else {
        motionGuideText.textContent = "💡 도전자: 고개를 왼쪽(1번) 또는 오른쪽(2번)으로 기울여 선택하세요! (제한시간 종료 시 최종 판정)";
      }
    }

    motionDetector.resetSelection();
    motionDetector.setQuestionResultMode({ isRevealed: false, correctAnswer: null });

    // 칠판 UI 렌더링
    questionCategoryEl.textContent = currentQuestion.category || "국어";
    questionTextEl.textContent = currentQuestion.question;

    // 선택지 생성
    renderOptionsUI(currentQuestion);

    // 카드 회전 애니메이션
    questionCard.classList.remove("card-enter");
    void questionCard.offsetWidth; // 트리거 리플로우
    questionCard.classList.add("card-enter");

    // 투표 바 리셋
    if (playMode === "GROUP") {
      resetGroupVoteBar();
    }

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

      // 클릭 시 대체 선택 가능 (개인 모드 시)
      btn.addEventListener("click", () => {
        if (!isAnswerLocked && playMode === "INDIVIDUAL") {
          handleOptionSelected(optIndex);
        }
      });

      optionsContainer.appendChild(btn);
    });
  }

  /**
   * 단체 모드 실시간 투표 UI 업데이트 (상단 바 및 인원 표시)
   */
  function updateGroupVoteUI(voteData) {
    lastGroupVoteData = voteData;
    if (voteData.totalCount > maxDetectedInGroup) {
      maxDetectedInGroup = voteData.totalCount;
    }

    detectedStudentsCountEl.textContent = voteData.totalCount;
    groupOpt1CountEl.textContent = voteData.option1Count;
    groupOpt2CountEl.textContent = voteData.option2Count;
    groupNeutralCountEl.textContent = voteData.neutralCount;

    // 투표 비율 바 계산
    const activeTotal = voteData.option1Count + voteData.option2Count;
    if (activeTotal > 0) {
      const p1 = Math.round((voteData.option1Count / activeTotal) * 100);
      const p2 = 100 - p1;
      voteBar1.style.width = `${p1}%`;
      voteBar2.style.width = `${p2}%`;
    } else {
      voteBar1.style.width = `50%`;
      voteBar2.style.width = `50%`;
    }

    // 선택지 버블 하이라이트 가이드
    const bubble1 = document.getElementById("option-bubble-1");
    const bubble2 = document.getElementById("option-bubble-2");
    if (bubble1 && bubble2) {
      if (voteData.option1Count > voteData.option2Count) {
        bubble1.classList.add("highlighted");
        bubble2.classList.remove("highlighted");
      } else if (voteData.option2Count > voteData.option1Count) {
        bubble2.classList.add("highlighted");
        bubble1.classList.remove("highlighted");
      } else {
        bubble1.classList.remove("highlighted");
        bubble2.classList.remove("highlighted");
      }
    }
  }

  function resetGroupVoteBar() {
    voteBar1.style.width = "50%";
    voteBar2.style.width = "50%";
    groupOpt1CountEl.textContent = "0";
    groupOpt2CountEl.textContent = "0";
    groupNeutralCountEl.textContent = "0";
    document.querySelectorAll(".option-bubble").forEach(b => b.classList.remove("highlighted"));
  }

  /**
   * 개인 모드 유지 진행도 UI 업데이트
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
   * 정답 선택 처리 (개인 모드: 실시간 선택 및 변경, 타이머는 계속 진행)
   */
  function handleOptionSelected(chosenIndex) {
    if (isAnswerLocked) return;

    currentChosenOption = chosenIndex;
    chosenTimeLeft = timeLeft;

    // 선택지 UI 상태 업데이트
    document.querySelectorAll(".option-bubble").forEach(b => b.classList.remove("is-selected"));
    const selectedBubble = document.getElementById(`option-bubble-${chosenIndex}`);
    if (selectedBubble) {
      selectedBubble.classList.add("is-selected");
    }

    AudioPlayer.playSelect();
    motionGuideText.textContent = `✔️ [${chosenIndex}번] 선택됨! (남은 시간 ${timeLeft}초 동안 자유롭게 변경 가능)`;
  }

  /**
   * 제한시간 종료 시점의 최종 판정 처리
   */
  function handleTimeOut() {
    if (isAnswerLocked) return;
    isAnswerLocked = true;

    if (playMode === "GROUP") {
      handleGroupQuestionEnd();
    } else {
      finalizeIndividualAnswer();
    }
  }

  /**
   * 개인 모드 제한시간 종료 시 최종 정오답 판정
   */
  function finalizeIndividualAnswer() {
    if (currentChosenOption === null) {
      // 아무것도 선택하지 않은 채 제한시간 종료
      showIndividualAnswerFeedback(false, null, true);
    } else {
      const isCorrect = currentChosenOption === currentQuestion.answer;
      showIndividualAnswerFeedback(isCorrect, currentChosenOption, false);
    }
  }

  /**
   * 단체 모드 문제 종료 및 맞은 사람 / 틀린 사람 수 집계 발표
   */
  function handleGroupQuestionEnd() {
    if (isAnswerLocked && groupResultOverlay.classList.contains("hidden") === false) return;
    isAnswerLocked = true;
    clearInterval(timerInterval);

    const answer = currentQuestion.answer;
    const correctVoters = answer === 1 ? lastGroupVoteData.option1Count : lastGroupVoteData.option2Count;
    const wrongVoters = answer === 1 ? lastGroupVoteData.option2Count : lastGroupVoteData.option1Count;
    const totalActive = correctVoters + wrongVoters;
    const correctRate = totalActive > 0 ? Math.round((correctVoters / totalActive) * 100) : 0;

    // 기록 누적
    groupStatsHistory.push({
      questionIndex: currentIndex + 1,
      correctCount: correctVoters,
      wrongCount: wrongVoters,
      rate: correctRate,
      totalDetected: lastGroupVoteData.totalCount
    });

    // 1. 캔버스에 학생별 ⭕/❌ 뱃지 즉시 공개!
    motionDetector.setQuestionResultMode({
      isRevealed: true,
      correctAnswer: answer
    });

    // 2. 선택지 버튼 색상 표시
    const correctBubble = document.getElementById(`option-bubble-${answer}`);
    if (correctBubble) correctBubble.classList.add("correct-choice");

    // 3. 단체 모드 결과 배너 표시
    groupResultTitle.textContent = `🎉 정답은 [${answer}번] 입니다!`;
    groupCorrectCountEl.textContent = `${correctVoters}명`;
    groupWrongCountEl.textContent = `${wrongVoters}명`;
    groupCorrectRateEl.textContent = `${correctRate}%`;

    if (correctRate >= 50 && correctVoters > 0) {
      groupResultDesc.textContent = `👏 훌륭합니다! 우리 반 과반수가 정답을 맞혔습니다!`;
      AudioPlayer.playCorrect();
      triggerConfetti();
    } else if (correctVoters > 0) {
      groupResultDesc.textContent = `💪 아쉽네요! 다음 문제에서는 더 많은 학생이 도전해보세요!`;
      AudioPlayer.playWrong();
    } else {
      groupResultDesc.textContent = `🔔 정답자가 없습니다. 다음 문제에 집중해주세요!`;
      AudioPlayer.playWrong();
    }

    groupResultOverlay.classList.remove("hidden");

    // 4. 2.8초 후 다음 문제로 진행
    setTimeout(() => {
      groupResultOverlay.classList.add("hidden");
      motionDetector.setQuestionResultMode({ isRevealed: false, correctAnswer: null });
      currentIndex++;
      loadNextQuestion();
    }, 2800);
  }

  /**
   * 개인 모드 정오답 피드백 및 점수 계산
   */
  function showIndividualAnswerFeedback(isCorrect, chosenIndex, isTimeout = false) {
    const targetBubble = chosenIndex ? document.getElementById(`option-bubble-${chosenIndex}`) : null;
    const correctBubble = document.getElementById(`option-bubble-${currentQuestion.answer}`);

    if (isCorrect) {
      correctCount++;
      currentCombo++;
      if (currentCombo > maxCombo) maxCombo = currentCombo;

      // 점수 공식: 기본 100점 + (선택 시점 남은 시간 x 10) + (콤보 보너스 10%씩)
      const baseScore = 100;
      const speedBonus = chosenTimeLeft * 10;
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
      showFeedbackOverlay(false, isTimeout ? "시간 초과 (미선택)!" : "오답!", 0);
    }

    updateScoreUI();

    setTimeout(() => {
      questionCard.classList.remove("shake-card");
      hideFeedbackOverlay();
      currentIndex++;
      loadNextQuestion();
    }, 1800);
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
   * 폭죽 컨페티 효과
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
   * 게임 종료 (개인 vs 단체 분기)
   */
  function endGame() {
    clearInterval(timerInterval);
    gameScreen.classList.add("hidden");
    AudioPlayer.playFanfare();

    if (playMode === "GROUP") {
      // 단체 모드 종료 화면 세팅
      resultMainTitle.textContent = "🎉 우리 반 단체 퀴즈 완료!";
      finalScoreLabel.textContent = "학급 평균 정답률";

      let totalRates = 0;
      let totalCorrect = 0;
      let totalWrong = 0;
      groupStatsHistory.forEach(s => {
        totalRates += s.rate;
        totalCorrect += s.correctCount;
        totalWrong += s.wrongCount;
      });
      const avgRate = groupStatsHistory.length > 0 ? Math.round(totalRates / groupStatsHistory.length) : 0;

      finalScoreVal.textContent = `${avgRate}%`;
      statTitle1.textContent = "총 정답 누적";
      correctStatEl.textContent = `${totalCorrect}명`;
      statTitle2.textContent = "최대 참여 학생";
      maxComboStatEl.textContent = `${maxDetectedInGroup}명`;
      statTitle3.textContent = "총 문제 수";
      accuracyStatEl.textContent = `${questions.length}문제`;

      individualRankingSection.classList.add("hidden");

      const resultScreen = document.getElementById("result-screen");
      resultScreen.classList.remove("hidden");

      const restartBtn = document.getElementById("restart-game-btn");
      restartBtn.onclick = () => {
        resultScreen.classList.add("hidden");
        initAndStartGame();
      };
    } else {
      // 개인 모드 종료 화면 세팅
      resultMainTitle.textContent = "🎉 퀴즈 종료!";
      finalScoreLabel.textContent = "최종 획득 점수";
      statTitle1.textContent = "맞힌 문제";
      statTitle2.textContent = "최대 콤보";
      statTitle3.textContent = "정답률";
      individualRankingSection.classList.remove("hidden");

      RankingManager.showResult({
        totalScore: currentScore,
        correctCount: correctCount,
        totalCount: questions.length,
        maxCombo: maxCombo
      }, () => {
        initAndStartGame();
      });
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
});
