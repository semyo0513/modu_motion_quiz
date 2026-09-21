/**
 * API 통신 전담 모듈 (api.js)
 * GAS 웹앱과의 통신 및 오프라인/로컬 테스트용 Mock 데이터를 지원합니다.
 */

// ★ 배포 후 발급받은 Google Apps Script 웹앱 Exec URL을 여기에 입력하세요.
// 비어있거나 통신 실패 시 자동으로 로컬 Mock 데이터로 원활하게 동작합니다.
const GAS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxEK_uhLWyTrJT6RW4cNBoOQkKKUFw8Szbs66YVdq6vSpSE62tYknb26RDAYihiUm5r/exec"; 

// 로컬 Mock 데이터 (국어 수업용 샘플 10문항)
const MOCK_DATA = {
  settings: {
    TOTAL_QUESTIONS: 5,
    TIME_LIMIT_PER_Q: 15,
    MOTION_MODE: "HEAD_TILT", // "HEAD_TILT" | "FINGER_COUNT" | "AUTO"
    ANIMATION_ON: true,
    SOUND_ON: true
  },
  questions: [
    {
      id: "Q1",
      type: "2지선다",
      question: "다음 중 맞춤법이 올바른 것은?",
      options: ["어따 대고", "얻다 대고"],
      answer: 2,
      category: "맞춤법",
      difficulty: "중"
    },
    {
      id: "Q2",
      type: "2지선다",
      question: "'희한하다'의 올바른 표기는?",
      options: ["희한하다", "희안하다"],
      answer: 1,
      category: "맞춤법",
      difficulty: "하"
    },
    {
      id: "Q3",
      type: "2지선다",
      question: "다음 중 띄어쓰기가 바른 것은?",
      options: ["밥을 먹은 지 세 시간", "밥을 먹은지 세 시간"],
      answer: 1,
      category: "문법",
      difficulty: "상"
    },
    {
      id: "Q4",
      type: "2지선다",
      question: "'왠지'와 '웬일' 중 맞는 표현은?",
      options: ["왠일인지 궁금하다", "웬일인지 궁금하다"],
      answer: 2,
      category: "맞춤법",
      difficulty: "하"
    },
    {
      id: "Q5",
      type: "2지선다",
      question: "어떤 일에 익숙하지 않아 서툰 상태를 뜻하는 말은?",
      options: ["어설프다", "어수룩하다"],
      answer: 1,
      category: "어휘",
      difficulty: "중"
    },
    {
      id: "Q6",
      type: "4지선다",
      question: "다음 중 표준어가 아닌 것은?",
      options: ["안절부절못하다", "우레", "설레임", "끄나풀"],
      answer: 3,
      category: "어휘",
      difficulty: "상"
    },
    {
      id: "Q7",
      type: "4지선다",
      question: "다음 중 외래어 표기법이 맞는 것은?",
      options: ["바베큐", "플래카드", "스노우보드", "케잌"],
      answer: 2,
      category: "맞춤법",
      difficulty: "상"
    },
    {
      id: "Q8",
      type: "4지선다",
      question: "시조의 형식적 특징으로 바르지 않은 것은?",
      options: ["3장 6구 45자 내외", "4음보 율격", "종장의 첫 3음절 고정", "글자 수의 무제한 자유"],
      answer: 4,
      category: "문학",
      difficulty: "중"
    },
    {
      id: "Q9",
      type: "2지선다",
      question: "'금세'의 바른 표기는?",
      options: ["금새", "금세"],
      answer: 2,
      category: "맞춤법",
      difficulty: "하"
    },
    {
      id: "Q10",
      type: "4지선다",
      question: "다음 중 사자성어와 그 뜻이 바르게 짝지어진 것은?",
      options: ["주마간산 - 몹시 바쁘게 뛰어다님", "고진감래 - 고생 끝에 낙이 옴", "동문서답 - 아주 깊이 생각함", "구우일모 - 매우 중요한 존재"],
      answer: 2,
      category: "한자성어",
      difficulty: "중"
    }
  ]
};

const ApiService = {
  /**
   * 커스텀 GAS URL 설정 또는 조회
   */
  getBaseUrl() {
    return localStorage.getItem("MOTION_QUIZ_GAS_URL") || GAS_WEBAPP_URL;
  },

  setBaseUrl(url) {
    if (url) {
      localStorage.setItem("MOTION_QUIZ_GAS_URL", url.trim());
    } else {
      localStorage.removeItem("MOTION_QUIZ_GAS_URL");
    }
  },

  /**
   * 게임 시작 시 1회 호출: 설정 + 랜덤 문제 일괄 프리로드
   */
  async getGameData() {
    const url = this.getBaseUrl();
    if (!url) {
      console.info("[ApiService] GAS URL 미설정 -> 로컬 Mock 데이터 로드");
      return this._getMockGameData();
    }

    try {
      const response = await fetch(`${url}?action=getGameData`, { method: "GET" });
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const result = await response.json();
      if (result.success && result.data) {
        return result.data;
      }
      throw new Error(result.error || "데이터 형식 오류");
    } catch (err) {
      console.warn("[ApiService] GAS 호출 실패, Mock 데이터로 대체:", err);
      return this._getMockGameData();
    }
  },

  /**
   * 관리자: 전체 문제 목록 조회
   */
  async getQuestions() {
    const url = this.getBaseUrl();
    if (!url) return this._getLocalQuestions();

    try {
      const response = await fetch(`${url}?action=getQuestions`, { method: "GET" });
      const result = await response.json();
      return result.success ? result.data : this._getLocalQuestions();
    } catch (err) {
      console.warn("문제 목록 조회 실패:", err);
      return this._getLocalQuestions();
    }
  },

  /**
   * 관리자: 전체 설정 조회
   */
  async getSettings() {
    const url = this.getBaseUrl();
    if (!url) return this._getLocalSettings();

    try {
      const response = await fetch(`${url}?action=getSettings`, { method: "GET" });
      const result = await response.json();
      return result.success ? result.data : this._getLocalSettings();
    } catch (err) {
      console.warn("설정 조회 실패:", err);
      return this._getLocalSettings();
    }
  },

  /**
   * 관리자: 비밀번호 검증
   */
  async verifyAdmin(password) {
    const url = this.getBaseUrl();
    if (!url) {
      const storedPw = localStorage.getItem("MOCK_ADMIN_PW") || "1234";
      return String(password).trim() === storedPw;
    }

    try {
      const result = await this._post({ action: "verifyAdmin", password });
      return result.success && result.data && result.data.verified;
    } catch (err) {
      return false;
    }
  },

  /**
   * 관리자: 문제 추가
   */
  async addQuestion(data, password) {
    const url = this.getBaseUrl();
    if (!url) return this._addLocalQuestion(data);

    return await this._post({ action: "addQuestion", data, password });
  },

  /**
   * 관리자: 문제 수정
   */
  async updateQuestion(id, data, password) {
    const url = this.getBaseUrl();
    if (!url) return this._updateLocalQuestion(id, data);

    return await this._post({ action: "updateQuestion", id, data, password });
  },

  /**
   * 관리자: 문제 삭제
   */
  async deleteQuestion(id, password) {
    const url = this.getBaseUrl();
    if (!url) return this._deleteLocalQuestion(id);

    return await this._post({ action: "deleteQuestion", id, password });
  },

  /**
   * 관리자: 설정 저장
   */
  async updateSettings(data, password) {
    const url = this.getBaseUrl();
    if (!url) return this._saveLocalSettings(data);

    return await this._post({ action: "updateSettings", data, password });
  },

  /**
   * 플레이 결과 전송 (랭킹용)
   */
  async logPlayResult(data) {
    const url = this.getBaseUrl();
    this._saveLocalRanking(data);

    if (url) {
      try {
        await this._post({ action: "logPlayResult", data });
      } catch (err) {
        console.warn("랭킹 기록 서버 전송 실패 (로컬엔 저장됨):", err);
      }
    }
    return { success: true };
  },

  /**
   * 랭킹 목록 조회
   */
  async getLeaderboard() {
    const url = this.getBaseUrl();
    if (url) {
      try {
        const res = await fetch(`${url}?action=getLeaderboard`);
        const result = await res.json();
        if (result.success && Array.isArray(result.data)) {
          return result.data;
        }
      } catch (e) {
        console.warn("서버 랭킹 조회 실패, 로컬 랭킹 로드");
      }
    }
    return this._getLocalRanking();
  },

  /**
   * POST 헬퍼 (CORS 우회를 위해 text/plain 전송)
   */
  async _post(bodyObj) {
    const url = this.getBaseUrl();
    if (!url) throw new Error("GAS URL이 설정되지 않았습니다.");

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(bodyObj)
    });

    const text = await response.text();
    try {
      const json = JSON.parse(text);
      if (!json.success) throw new Error(json.error || "서버 작업 실패");
      return json;
    } catch (e) {
      if (text.includes("error") || text.includes("Exception")) {
        throw new Error(text);
      }
      return { success: true, data: text };
    }
  },

  // ===== 로컬 Mock 헬퍼 메서드들 =====
  _getMockGameData() {
    const settings = this._getLocalSettings();
    const questions = this._getLocalQuestions();
    const totalQ = parseInt(settings.TOTAL_QUESTIONS, 10) || 5;

    const shuffled = [...questions].sort(() => 0.5 - Math.random());
    return {
      settings,
      questions: shuffled.slice(0, Math.min(totalQ, shuffled.length)),
      totalAvailable: questions.length
    };
  },

  _getLocalQuestions() {
    const stored = localStorage.getItem("MOTION_QUIZ_QUESTIONS");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {}
    }
    return [...MOCK_DATA.questions];
  },

  _addLocalQuestion(data) {
    const questions = this._getLocalQuestions();
    const newQ = {
      id: "Q" + Date.now(),
      type: data.type || "2지선다",
      question: data.question,
      options: data.options || ["", ""],
      answer: parseInt(data.answer, 10) || 1,
      category: data.category || "국어",
      difficulty: data.difficulty || "중",
      createdAt: new Date().toISOString()
    };
    questions.push(newQ);
    localStorage.setItem("MOTION_QUIZ_QUESTIONS", JSON.stringify(questions));
    return { success: true, data: { id: newQ.id } };
  },

  _updateLocalQuestion(id, data) {
    const questions = this._getLocalQuestions();
    const idx = questions.findIndex(q => q.id === id);
    if (idx !== -1) {
      questions[idx] = { ...questions[idx], ...data };
      localStorage.setItem("MOTION_QUIZ_QUESTIONS", JSON.stringify(questions));
      return { success: true };
    }
    throw new Error("문제를 찾을 수 없습니다.");
  },

  _deleteLocalQuestion(id) {
    let questions = this._getLocalQuestions();
    questions = questions.filter(q => q.id !== id);
    localStorage.setItem("MOTION_QUIZ_QUESTIONS", JSON.stringify(questions));
    return { success: true };
  },

  _getLocalSettings() {
    const stored = localStorage.getItem("MOTION_QUIZ_SETTINGS");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {}
    }
    return { ...MOCK_DATA.settings };
  },

  _saveLocalSettings(data) {
    const settings = { ...this._getLocalSettings(), ...data };
    localStorage.setItem("MOTION_QUIZ_SETTINGS", JSON.stringify(settings));
    return { success: true };
  },

  _saveLocalRanking(record) {
    const ranking = this._getLocalRanking();
    ranking.push({
      playerName: record.playerName || "익명",
      score: record.score || 0,
      correctCount: record.correctCount || 0,
      totalCount: record.totalCount || 0,
      playedAt: new Date().toLocaleString()
    });
    ranking.sort((a, b) => b.score - a.score);
    localStorage.setItem("MOTION_QUIZ_RANKING", JSON.stringify(ranking.slice(0, 20)));
  },

  _getLocalRanking() {
    const stored = localStorage.getItem("MOTION_QUIZ_RANKING");
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {}
    }
    return [
      { playerName: "국어왕김국어", score: 950, correctCount: 5, totalCount: 5, playedAt: "방금 전" },
      { playerName: "모션달인", score: 820, correctCount: 4, totalCount: 5, playedAt: "오늘" },
      { playerName: "세종대왕", score: 750, correctCount: 4, totalCount: 5, playedAt: "어제" }
    ];
  }
};
