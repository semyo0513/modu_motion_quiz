/**
 * 관리자 페이지 로직 모듈 (admin.js)
 * 문제 등록, 수정, 삭제, 게임 환경설정 및 GAS 연동 설정을 관리합니다.
 */

document.addEventListener("DOMContentLoaded", () => {
  let adminPassword = "";
  let questionsCache = [];
  let currentEditingId = null;

  // UI 요소 캐시
  const authModal = document.getElementById("auth-modal");
  const authInput = document.getElementById("auth-password");
  const authBtn = document.getElementById("auth-btn");
  const authError = document.getElementById("auth-error");

  const adminContent = document.getElementById("admin-content");
  const questionTableBody = document.getElementById("question-table-body");
  const addQBtn = document.getElementById("add-question-btn");
  const qModal = document.getElementById("question-modal");
  const qForm = document.getElementById("question-form");
  const qModalTitle = document.getElementById("modal-title");
  const cancelQBtn = document.getElementById("cancel-q-btn");

  const qTypeSelect = document.getElementById("q-type");
  const opt3Group = document.getElementById("opt3-group");
  const opt4Group = document.getElementById("opt4-group");

  const settingsForm = document.getElementById("settings-form");
  const gasUrlInput = document.getElementById("gas-url-input");
  const saveGasUrlBtn = document.getElementById("save-gas-url-btn");
  const gasStatusEl = document.getElementById("gas-status");

  // 1. 초기 인증 처리
  gasUrlInput.value = ApiService.getBaseUrl();

  authBtn.addEventListener("click", async () => {
    const pw = authInput.value.trim();
    if (!pw) {
      authError.textContent = "비밀번호를 입력해주세요.";
      return;
    }

    authBtn.disabled = true;
    authBtn.textContent = "인증 중...";
    authError.textContent = "";

    const isValid = await ApiService.verifyAdmin(pw);
    if (isValid) {
      adminPassword = pw;
      authModal.classList.add("hidden");
      adminContent.classList.remove("hidden");
      loadAdminData();
    } else {
      authError.textContent = "비밀번호가 올바르지 않습니다. (기본값: 1234)";
    }
    authBtn.disabled = false;
    authBtn.textContent = "로그인";
  });

  // Enter 키 로그인
  authInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") authBtn.click();
  });

  // 2. GAS URL 설정 저장
  saveGasUrlBtn.addEventListener("click", async () => {
    const url = gasUrlInput.value.trim();
    ApiService.setBaseUrl(url);
    gasStatusEl.textContent = "GAS URL이 저장되었습니다. 데이터를 새로고침합니다.";
    loadAdminData();
  });

  // 3. 문제 유형 변경 시 3, 4번 선택지 토글
  qTypeSelect.addEventListener("change", () => {
    const is4Options = qTypeSelect.value === "4지선다";
    opt3Group.style.display = is4Options ? "block" : "none";
    opt4Group.style.display = is4Options ? "block" : "none";
  });

  // 4. 문제 등록/수정 모달 열기
  addQBtn.addEventListener("click", () => {
    currentEditingId = null;
    qModalTitle.textContent = "새 문제 등록";
    qForm.reset();
    qTypeSelect.value = "2지선다";
    qTypeSelect.dispatchEvent(new Event("change"));
    qModal.classList.remove("hidden");
  });

  cancelQBtn.addEventListener("click", () => {
    qModal.classList.add("hidden");
  });

  // 5. 문제 폼 제출 (추가 / 수정)
  qForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const is4 = qTypeSelect.value === "4지선다";
    const options = [
      document.getElementById("opt-1").value.trim(),
      document.getElementById("opt-2").value.trim()
    ];

    if (is4) {
      options.push(document.getElementById("opt-3").value.trim());
      options.push(document.getElementById("opt-4").value.trim());
    }

    const questionData = {
      type: qTypeSelect.value,
      question: document.getElementById("q-text").value.trim(),
      options: options,
      answer: parseInt(document.getElementById("q-answer").value, 10) || 1,
      category: document.getElementById("q-category").value.trim() || "국어",
      difficulty: document.getElementById("q-difficulty").value || "중"
    };

    const submitBtn = document.getElementById("save-q-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "저장 중...";

    try {
      if (currentEditingId) {
        await ApiService.updateQuestion(currentEditingId, questionData, adminPassword);
        alert("문제가 수정되었습니다.");
      } else {
        await ApiService.addQuestion(questionData, adminPassword);
        alert("문제가 등록되었습니다.");
      }
      qModal.classList.add("hidden");
      loadAdminData();
    } catch (err) {
      alert("저장 실패: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "저장하기";
    }
  });

  // 6. 환경설정 저장
  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("save-settings-btn");
    saveBtn.disabled = true;
    saveBtn.textContent = "설정 저장 중...";

    const settingsData = {
      TOTAL_QUESTIONS: parseInt(document.getElementById("setting-total-q").value, 10) || 5,
      TIME_LIMIT_PER_Q: parseInt(document.getElementById("setting-time-limit").value, 10) || 15,
      MOTION_MODE: document.getElementById("setting-motion-mode").value,
      ANIMATION_ON: document.getElementById("setting-animation").checked
    };

    try {
      await ApiService.updateSettings(settingsData, adminPassword);
      alert("게임 설정이 성공적으로 저장되었습니다.");
    } catch (err) {
      alert("설정 저장 실패: " + err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "설정 저장";
    }
  });

  // ===== 데이터 로드 및 렌더링 =====
  async function loadAdminData() {
    // 1. 설정 불러오기
    try {
      const settings = await ApiService.getSettings();
      if (settings) {
        if (settings.TOTAL_QUESTIONS) document.getElementById("setting-total-q").value = settings.TOTAL_QUESTIONS;
        if (settings.TIME_LIMIT_PER_Q) document.getElementById("setting-time-limit").value = settings.TIME_LIMIT_PER_Q;
        if (settings.MOTION_MODE) document.getElementById("setting-motion-mode").value = settings.MOTION_MODE;
        if (typeof settings.ANIMATION_ON !== "undefined") {
          document.getElementById("setting-animation").checked = settings.ANIMATION_ON;
        }
      }
    } catch (e) {
      console.warn("설정 로드 실패:", e);
    }

    // 2. 문제 목록 불러오기
    questionTableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4">문제 목록을 불러오는 중...</td></tr>';
    try {
      questionsCache = await ApiService.getQuestions();
      renderQuestionsTable(questionsCache);
    } catch (err) {
      questionTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-red-500 py-4">문제 로드 실패: ${err.message}</td></tr>`;
    }
  }

  function renderQuestionsTable(questions) {
    if (!questions || questions.length === 0) {
      questionTableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4">등록된 문제가 없습니다.</td></tr>';
      return;
    }

    questionTableBody.innerHTML = "";
    questions.forEach((q, idx) => {
      const tr = document.createElement("tr");
      const optStr = q.options ? q.options.map((opt, i) => `${i + 1}. ${opt}`).join("<br>") : "-";
      
      tr.innerHTML = `
        <td class="text-center">${idx + 1}</td>
        <td><span class="badge ${q.type === '4지선다' ? 'badge-blue' : 'badge-green'}">${q.type || '2지선다'}</span></td>
        <td class="font-medium">${escapeHtml(q.question)}</td>
        <td class="text-sm text-gray-300">${optStr}</td>
        <td class="text-center font-bold text-yellow-400">${q.answer}번</td>
        <td class="text-center"><span class="badge-gray">${q.category || '국어'} (${q.difficulty || '중'})</span></td>
        <td class="text-center">
          <button class="btn-action btn-edit" data-id="${q.id}">수정</button>
          <button class="btn-action btn-delete" data-id="${q.id}">삭제</button>
        </td>
      `;

      // 수정 버튼 핸들러
      tr.querySelector(".btn-edit").addEventListener("click", () => {
        openEditModal(q);
      });

      // 삭제 버튼 핸들러
      tr.querySelector(".btn-delete").addEventListener("click", async () => {
        if (confirm(`'${q.question}' 문제를 정말 삭제하시겠습니까?`)) {
          try {
            await ApiService.deleteQuestion(q.id, adminPassword);
            alert("삭제되었습니다.");
            loadAdminData();
          } catch (e) {
            alert("삭제 실패: " + e.message);
          }
        }
      });

      questionTableBody.appendChild(tr);
    });
  }

  function openEditModal(q) {
    currentEditingId = q.id;
    qModalTitle.textContent = "문제 수정";

    qTypeSelect.value = q.type || (q.options && q.options.length > 2 ? "4지선다" : "2지선다");
    qTypeSelect.dispatchEvent(new Event("change"));

    document.getElementById("q-text").value = q.question || "";
    document.getElementById("opt-1").value = (q.options && q.options[0]) || "";
    document.getElementById("opt-2").value = (q.options && q.options[1]) || "";
    document.getElementById("opt-3").value = (q.options && q.options[2]) || "";
    document.getElementById("opt-4").value = (q.options && q.options[3]) || "";
    document.getElementById("q-answer").value = q.answer || 1;
    document.getElementById("q-category").value = q.category || "국어";
    document.getElementById("q-difficulty").value = q.difficulty || "중";

    qModal.classList.remove("hidden");
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
});
