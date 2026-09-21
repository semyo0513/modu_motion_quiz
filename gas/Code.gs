/**
 * 모션 인식 퀴즈 - Google Apps Script 백엔드 (Code.gs)
 * 
 * 시트 구성:
 * 1. Settings: 관리자 설정 (key, value, description)
 * 2. Questions: 문제 데이터 (id, type, question, option1, option2, option3, option4, answer, category, difficulty, createdAt)
 * 3. PlayLog: (선택) 플레이 기록 (playerName, score, correctCount, totalCount, playedAt)
 */

const CACHE_TTL_SEC = 300; // 캐시 유효기간 5분
const DEFAULT_ADMIN_PW = "1234"; // 기본 관리자 비밀번호

/**
 * GET 요청 라우터 (조회 전용 - CORS 사전요청 없음)
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || "getGameData";
    let result;

    switch (action) {
      case "getGameData":
        result = getGameData_();
        break;
      case "getQuestions":
        result = getQuestions_();
        break;
      case "getSettings":
        result = getSettings_();
        break;
      case "getLeaderboard":
        result = getLeaderboard_();
        break;
      default:
        return createJsonResponse_({ success: false, error: "알 수 없는 액션: " + action });
    }

    return createJsonResponse_({ success: true, data: result });
  } catch (err) {
    return createJsonResponse_({ success: false, error: err.toString() });
  }
}

/**
 * POST 요청 라우터 (등록/수정/삭제/설정저장)
 * 브라우저 CORS 회피를 위해 Content-Type: text/plain으로 수신 후 JSON 파싱
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse_({ success: false, error: "요청 본문(Body)이 비어있습니다." });
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    let result;

    // 관리자 전용 액션 목록
    const adminActions = ["addQuestion", "updateQuestion", "deleteQuestion", "updateSettings"];

    if (adminActions.indexOf(action) !== -1) {
      if (!verifyAdmin_(payload.password)) {
        return createJsonResponse_({ success: false, error: "관리자 비밀번호가 일치하지 않습니다." });
      }
    }

    switch (action) {
      case "verifyAdmin":
        result = { verified: verifyAdmin_(payload.password) };
        break;
      case "addQuestion":
        result = addQuestion_(payload.data);
        clearCache_();
        break;
      case "updateQuestion":
        result = updateQuestion_(payload.id, payload.data);
        clearCache_();
        break;
      case "deleteQuestion":
        result = deleteQuestion_(payload.id);
        clearCache_();
        break;
      case "updateSettings":
        result = updateSettings_(payload.data);
        clearCache_();
        break;
      case "logPlayResult":
        result = logPlayResult_(payload.data);
        break;
      default:
        return createJsonResponse_({ success: false, error: "알 수 없는 액션: " + action });
    }

    return createJsonResponse_({ success: true, data: result });
  } catch (err) {
    return createJsonResponse_({ success: false, error: err.toString() });
  }
}

/**
 * JSON 응답 객체 생성
 */
function createJsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 캐시 초기화
 */
function clearCache_() {
  const cache = CacheService.getScriptCache();
  cache.remove("game_data");
  cache.remove("questions_data");
  cache.remove("settings_data");
}

/**
 * 관리자 비밀번호 검증
 */
function verifyAdmin_(password) {
  if (!password) return false;
  const settings = getSettings_();
  const correctPw = settings["ADMIN_PASSWORD"] || DEFAULT_ADMIN_PW;
  return String(password).trim() === String(correctPw).trim();
}

/**
 * 설정 전체 조회 (배치 조회 + 캐싱)
 */
function getSettings_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("settings_data");
  if (cached) {
    return JSON.parse(cached);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Settings");
  if (!sheet) {
    sheet = initializeSettingsSheet_(ss);
  }

  const values = sheet.getDataRange().getValues();
  const settings = {};

  // 헤더 제외 (row 1부터)
  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][0]).trim();
    const val = values[i][1];
    if (key) {
      settings[key] = val;
    }
  }

  // 기본값 보장
  if (!settings["TOTAL_QUESTIONS"]) settings["TOTAL_QUESTIONS"] = 5;
  if (!settings["TIME_LIMIT_PER_Q"]) settings["TIME_LIMIT_PER_Q"] = 15;
  if (!settings["MOTION_MODE"]) settings["MOTION_MODE"] = "HEAD_TILT"; // HEAD_TILT, FINGER_COUNT, AUTO
  if (!settings["ADMIN_PASSWORD"]) settings["ADMIN_PASSWORD"] = DEFAULT_ADMIN_PW;

  cache.put("settings_data", JSON.stringify(settings), CACHE_TTL_SEC);
  return settings;
}

/**
 * 문제 전체 조회 (배치 조회 + 캐싱)
 */
function getQuestions_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("questions_data");
  if (cached) {
    return JSON.parse(cached);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Questions");
  if (!sheet) {
    sheet = initializeQuestionsSheet_(ss);
  }

  const values = sheet.getDataRange().getValues();
  const questions = [];

  // 헤더: id, type, question, option1, option2, option3, option4, answer, category, difficulty, createdAt
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] && !row[2]) continue; // ID 및 문제가 없으면 스킵

    questions.push({
      id: String(row[0] || (i)),
      type: row[1] || "2지선다",
      question: row[2] || "",
      options: [
        String(row[3] || ""),
        String(row[4] || ""),
        String(row[5] || ""),
        String(row[6] || "")
      ].filter((opt, idx) => (row[1] === "2지선다" ? idx < 2 : true && opt.trim() !== "")),
      answer: parseInt(row[7], 10) || 1,
      category: row[8] || "일반",
      difficulty: row[9] || "중",
      createdAt: row[10] ? new Date(row[10]).toISOString() : ""
    });
  }

  cache.put("questions_data", JSON.stringify(questions), CACHE_TTL_SEC);
  return questions;
}

/**
 * 게임 시작 시 1회 호출되는 프리로드 함수
 * 설정 + 출제 문항 수만큼의 랜덤 문제 목록을 일괄 반환
 */
function getGameData_() {
  const settings = getSettings_();
  // 응답 시 관리자 비밀번호 제외
  const publicSettings = Object.assign({}, settings);
  delete publicSettings["ADMIN_PASSWORD"];

  const allQuestions = getQuestions_();
  const totalQ = parseInt(publicSettings["TOTAL_QUESTIONS"], 10) || 5;

  // 피셔-예이츠 셔플로 랜덤 추출
  const shuffled = allQuestions.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = temp;
  }

  const selectedQuestions = shuffled.slice(0, Math.min(totalQ, shuffled.length));

  return {
    settings: publicSettings,
    questions: selectedQuestions,
    totalAvailable: allQuestions.length
  };
}

/**
 * 문제 등록
 */
function addQuestion_(data) {
  if (!data || !data.question || !data.answer) {
    throw new Error("문제 지문과 정답은 필수 항목입니다.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Questions") || initializeQuestionsSheet_(ss);

  const id = "Q" + Utilities.formatDate(new Date(), "GMT+9", "yyyyMMddHHmmss") + "_" + Math.floor(Math.random() * 1000);
  const type = data.type || (data.options && data.options.length > 2 ? "4지선다" : "2지선다");
  const options = data.options || ["", "", "", ""];
  const opt1 = options[0] || "";
  const opt2 = options[1] || "";
  const opt3 = options[2] || "";
  const opt4 = options[3] || "";
  const answer = parseInt(data.answer, 10) || 1;
  const category = data.category || "국어";
  const difficulty = data.difficulty || "중";
  const createdAt = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([id, type, data.question, opt1, opt2, opt3, opt4, answer, category, difficulty, createdAt]);

  return { id: id, message: "문제가 성공적으로 등록되었습니다." };
}

/**
 * 문제 수정
 */
function updateQuestion_(id, data) {
  if (!id || !data) throw new Error("ID와 수정 데이터가 필요합니다.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Questions");
  if (!sheet) throw new Error("Questions 시트가 없습니다.");

  const values = sheet.getDataRange().getValues();
  let rowIndex = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      rowIndex = i + 1; // 1-indexed row
      break;
    }
  }

  if (rowIndex === -1) throw new Error("수정할 문제(ID: " + id + ")를 찾을 수 없습니다.");

  const options = data.options || ["", "", "", ""];
  const type = data.type || "2지선다";
  const answer = parseInt(data.answer, 10) || 1;

  sheet.getRange(rowIndex, 2, 1, 9).setValues([[
    type,
    data.question,
    options[0] || "",
    options[1] || "",
    options[2] || "",
    options[3] || "",
    answer,
    data.category || "국어",
    data.difficulty || "중"
  ]]);

  return { id: id, message: "문제가 수정되었습니다." };
}

/**
 * 문제 삭제
 */
function deleteQuestion_(id) {
  if (!id) throw new Error("삭제할 ID가 필요합니다.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Questions");
  if (!sheet) throw new Error("Questions 시트가 없습니다.");

  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { id: id, message: "문제가 삭제되었습니다." };
    }
  }

  throw new Error("삭제할 문제(ID: " + id + ")를 찾을 수 없습니다.");
}

/**
 * 설정 업데이트
 */
function updateSettings_(data) {
  if (!data || typeof data !== "object") throw new Error("유효한 설정 데이터가 아닙니다.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Settings") || initializeSettingsSheet_(ss);
  const values = sheet.getDataRange().getValues();
  const map = {};

  for (let i = 1; i < values.length; i++) {
    map[values[i][0]] = i + 1; // row number
  }

  for (const key in data) {
    if (map[key]) {
      sheet.getRange(map[key], 2).setValue(data[key]);
    } else {
      sheet.appendRow([key, data[key], "사용자 설정 항목"]);
    }
  }

  return { message: "설정이 저장되었습니다." };
}

/**
 * 플레이 기록 저장 (선택 기능)
 */
function logPlayResult_(data) {
  if (!data) return { logged: false };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("PlayLog");
  if (!sheet) {
    sheet = initializePlayLogSheet_(ss);
  }

  const playedAt = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm:ss");
  sheet.appendRow([
    data.playerName || "익명",
    data.score || 0,
    data.correctCount || 0,
    data.totalCount || 0,
    playedAt
  ]);

  return { logged: true };
}

/**
 * 상위 랭킹 조회
 */
function getLeaderboard_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("PlayLog");
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const records = [];

  for (let i = 1; i < values.length; i++) {
    records.push({
      playerName: values[i][0],
      score: parseInt(values[i][1], 10) || 0,
      correctCount: parseInt(values[i][2], 10) || 0,
      totalCount: parseInt(values[i][3], 10) || 0,
      playedAt: values[i][4]
    });
  }

  // 점수 내림차순 정렬 후 Top 10 반환
  records.sort((a, b) => b.score - a.score);
  return records.slice(0, 10);
}

/**
 * 시트 자동 초기화 헬퍼 함수들
 */
function initializeSettingsSheet_(ss) {
  let sheet = ss.getSheetByName("Settings");
  if (!sheet) sheet = ss.insertSheet("Settings");
  sheet.clear();
  sheet.appendRow(["key", "value", "description"]);
  sheet.appendRow(["TOTAL_QUESTIONS", 5, "출제 문항 수"]);
  sheet.appendRow(["TIME_LIMIT_PER_Q", 15, "문항당 제한시간(초)"]);
  sheet.appendRow(["MOTION_MODE", "HEAD_TILT", "모션 인식 모드 (HEAD_TILT / FINGER_COUNT / AUTO)"]);
  sheet.appendRow(["ANIMATION_ON", true, "애니메이션 효과 사용 여부"]);
  sheet.appendRow(["ADMIN_PASSWORD", DEFAULT_ADMIN_PW, "관리자 페이지 비밀번호"]);
  return sheet;
}

function initializeQuestionsSheet_(ss) {
  let sheet = ss.getSheetByName("Questions");
  if (!sheet) sheet = ss.insertSheet("Questions");
  sheet.clear();
  sheet.appendRow(["id", "type", "question", "option1", "option2", "option3", "option4", "answer", "category", "difficulty", "createdAt"]);
  
  // 기본 샘플 국어 문제 등록
  const samples = [
    ["Q1", "2지선다", "다음 중 맞춤법이 올바른 것은?", "어따 대고", "얻다 대고", "", "", 2, "맞춤법", "중", "2026-09-21 00:00:00"],
    ["Q2", "2지선다", "'희한하다'의 올바른 표기는?", "희한하다", "희안하다", "", "", 1, "맞춤법", "중", "2026-09-21 00:00:00"],
    ["Q3", "2지선다", "다음 중 띄어쓰기가 바른 것은?", "밥을 먹은 지 세 시간", "밥을 먹은지 세 시간", "", "", 1, "문법", "상", "2026-09-21 00:00:00"],
    ["Q4", "2지선다", "'왠지'와 '웬일' 중 맞는 표현은?", "왠일인지 궁금하다", "웬일인지 궁금하다", "", "", 2, "맞춤법", "하", "2026-09-21 00:00:00"],
    ["Q5", "4지선다", "다음 중 표준어가 아닌 것은?", "안절부절못하다", "우레", "설레임", "끄나풀", 3, "어휘", "상", "2026-09-21 00:00:00"]
  ];

  for (let s of samples) {
    sheet.appendRow(s);
  }
  return sheet;
}

function initializePlayLogSheet_(ss) {
  let sheet = ss.getSheetByName("PlayLog");
  if (!sheet) sheet = ss.insertSheet("PlayLog");
  sheet.clear();
  sheet.appendRow(["playerName", "score", "correctCount", "totalCount", "playedAt"]);
  return sheet;
}
