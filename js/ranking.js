/**
 * 랭킹보드 모듈 (ranking.js)
 * 게임 종료 후 점수 집계, 랭킹 리스트 렌더링, 시트 동기화를 담당합니다.
 */

const RankingManager = {
  /**
   * 결과 화면 표시 및 점수 카운트업
   */
  async showResult(gameSummary, onRestart) {
    const resultModal = document.getElementById("result-screen");
    const finalScoreEl = document.getElementById("final-score-val");
    const correctCountEl = document.getElementById("correct-stat");
    const comboStatEl = document.getElementById("max-combo-stat");
    const accuracyStatEl = document.getElementById("accuracy-stat");

    if (!resultModal) return;

    // 통계 채우기
    const accuracy = gameSummary.totalCount > 0 
      ? Math.round((gameSummary.correctCount / gameSummary.totalCount) * 100) 
      : 0;

    correctCountEl.textContent = `${gameSummary.correctCount} / ${gameSummary.totalCount}개`;
    comboStatEl.textContent = `${gameSummary.maxCombo} 연속 정답`;
    accuracyStatEl.textContent = `${accuracy}%`;

    // 점수 카운트업 애니메이션
    this._animateCountUp(finalScoreEl, gameSummary.totalScore);

    // 모달 표시
    resultModal.classList.remove("hidden");

    // 랭킹 목록 불러와 렌더링
    await this.renderLeaderboard();

    // 등록 버튼 이벤트
    const submitBtn = document.getElementById("submit-ranking-btn");
    const nameInput = document.getElementById("player-name-input");
    
    // 이전 이벤트 제거 후 재등록
    submitBtn.onclick = async () => {
      const name = nameInput.value.trim() || "익명 학생";
      submitBtn.disabled = true;
      submitBtn.textContent = "저장 중...";

      await ApiService.logPlayResult({
        playerName: name,
        score: gameSummary.totalScore,
        correctCount: gameSummary.correctCount,
        totalCount: gameSummary.totalCount
      });

      submitBtn.textContent = "기록 완료!";
      await this.renderLeaderboard();
    };

    // 다시 하기 버튼
    const restartBtn = document.getElementById("restart-game-btn");
    restartBtn.onclick = () => {
      resultModal.classList.add("hidden");
      if (onRestart) onRestart();
    };
  },

  /**
   * 랭킹보드 목록 렌더링
   */
  async renderLeaderboard() {
    const listEl = document.getElementById("leaderboard-list");
    if (!listEl) return;

    listEl.innerHTML = '<li class="loading-rank">랭킹 불러오는 중...</li>';

    const records = await ApiService.getLeaderboard();
    if (!records || records.length === 0) {
      listEl.innerHTML = '<li class="empty-rank">아직 등록된 랭킹 기록이 없습니다.</li>';
      return;
    }

    listEl.innerHTML = "";
    records.slice(0, 10).forEach((rec, idx) => {
      const rankNum = idx + 1;
      let badgeClass = "rank-other";
      let trophy = "";

      if (rankNum === 1) {
        badgeClass = "rank-1";
        trophy = "🥇 ";
      } else if (rankNum === 2) {
        badgeClass = "rank-2";
        trophy = "🥈 ";
      } else if (rankNum === 3) {
        badgeClass = "rank-3";
        trophy = "🥉 ";
      }

      const li = document.createElement("li");
      li.className = `rank-item ${badgeClass}`;
      li.innerHTML = `
        <span class="rank-badge">${trophy}${rankNum}위</span>
        <span class="rank-name">${this._escapeHtml(rec.playerName)}</span>
        <span class="rank-correct">${rec.correctCount}/${rec.totalCount}문항</span>
        <span class="rank-score">${rec.score.toLocaleString()}점</span>
      `;
      listEl.appendChild(li);
    });
  },

  _animateCountUp(element, targetValue) {
    let current = 0;
    const duration = 1200; // 1.2초
    const stepTime = 20;
    const steps = duration / stepTime;
    const increment = targetValue / steps;

    const timer = setInterval(() => {
      current += increment;
      if (current >= targetValue) {
        current = targetValue;
        clearInterval(timer);
      }
      element.textContent = Math.floor(current).toLocaleString();
    }, stepTime);
  },

  _escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
};
