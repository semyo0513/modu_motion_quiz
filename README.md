# 🎓 모두의 모션인식 퀴즈 (Motion Quiz)

> **국어 수업 및 교실 참여형 실시간 모션인식 퀴즈 웹앱**  
> 손을 쓰지 않고 **고개 기울임(2지선다)** 또는 **손가락 개수(4지선다)** 동작만으로 정답을 맞히는 AR 필터형 인터랙티브 퀴즈 게임입니다.

---

## 🌟 주요 특징

1. **전자칠판(스마트보드) 카메라 완벽 지원 & AI 모션 인식**
   - 전자칠판 광각 웹캠 및 특수 해상도 다단계 폴백(1080p -> 720p -> 기본) 지원 및 웹캠 선택기 내장.
   - GPU WebGL 가속 오류 시 CPU 모드 자동 폴백으로 어떤 전자칠판 브라우저 환경에서도 100% 인식 보장.
   - 원거리 교실 환경에 최적화된 저신뢰도(0.25) 강제 인식 및 최대 15명 이상 다중 얼굴 동시 감지.

2. **[1] 1인 대표 모드 (중앙 최우선 도전자 타겟팅)**
   - 교실에 여러 학생이나 선생님이 화면에 잡히더라도 **화면 중앙에 가장 가깝고 크게 위치한 대표 학생(도전자)**을 자동 인식하여 골든 타겟 링 표시.
   - 주변 학생들의 움직임에 방해받지 않고 대표 학생 1명의 고개 기울임만 정확하게 퀴즈 답안으로 채택.

3. **[2] 우리 반 단체 모드 (다인원 동시 투표 & 맞은/틀린 사람 수 집계)**
   - 화면에 나온 학생 전원(최대 15명 이상)의 고개 기울임을 실시간 동시 추적.
   - 학생별 얼굴 위에 실시간 [1번 선택 👈] / [👉 2번 선택] / [대기] 뱃지 오버레이.
   - 화면 상단에 실시간 학급 투표 게이지 바(1번 vs 2번 대결) 표시.
   - 타이머 종료 시 학생들 얼굴 위에 **[⭕ 정답!]** / **[❌ 오답]** 마커가 즉시 떠서 각자 자신의 정오답 확인 가능.
   - 화면 중앙에 **"맞은 사람: X명, 틀린 사람: Y명 (정답률 Z%)"** 결과 배너 및 축하 효과.
   - 마우스/터치 클릭 및 키보드(1~4번, 좌/우 방향키, 단체모드 즉시마감 Enter/Space) 대체 조작을 완벽 지원합니다.

4. **초고속 프리로드 & Google Sheets 백엔드 연동**
   - 게임 시작 시 1회의 API 호출(`getGameData`)로 설정과 문제를 클라이언트에 일괄 적재하여 문제 전환 시 지연(Lag)이 없습니다.
   - Google Apps Script(`CacheService`)를 적용하여 시트 반복 접근 병목을 제거하였습니다.
   - GAS URL이 없어도 즉시 동작하는 **풍부한 국어 문제 Mock 데이터셋**이 내장되어 있습니다.

3. **교실 칠판 테마 & 실시간 오디오 피드백**
   - 회전형 칠판 문제 카드, 원형 SVG 프로그레스 타이머, 정답 폭죽(컨페티) 및 오답 쉐이크 효과.
   - 외부 음원 로딩 지연 없는 브라우저 `Web Audio API` 기반 경쾌한 효과음(카운트다운 틱, 딩동댕, 오답 버저, 콤보, 팡파르).

4. **선생님 전용 관리자 대시보드 (`admin.html`)**
   - 2지선다/4지선다 퀴즈 문제 등록, 수정, 삭제(CRUD).
   - 문항당 제한시간, 출제 문항 수, 모션 인식 모드 설정 및 Google Apps Script 웹앱 URL 간편 변경.

---

## 📁 디렉터리 구조

```
/
├── index.html            # 메인 퀴즈 게임 및 웹캠 비전 화면
├── admin.html            # 관리자 문제 등록/수정/환경설정 대시보드
├── css/
│   └── style.css         # 칠판 테마, HUD, 반응형 레이아웃, 애니메이션
├── js/
│   ├── api.js            # GAS 통신 및 로컬 Mock 데이터셋 Fallback
│   ├── audio.js          # Web Audio API 기반 무지연 효과음 합성 모듈
│   ├── motionDetector.js # MediaPipe FaceLandmarker / HandLandmarker 엔진
│   ├── ranking.js        # 랭킹보드 집계 및 PlayLog 연동 모듈
│   └── main.js           # 게임 메인 루프, 타이머, 점수/콤보 로직
├── gas/
│   └── Code.gs           # Google Apps Script 웹앱 백엔드 소스코드
├── 모션인식_퀴즈_웹앱_제작계획.md # 초기 기획서
└── README.md             # 사용 및 배포 안내서
```

---

## 🚀 배포 및 연동 가이드

### 1단계: Google Sheets 스프레드시트 생성
1. [Google Sheets](https://sheets.new)에서 새 스프레드시트를 생성합니다.
2. 아래 3개 시트를 생성하고 헤더를 입력합니다 (또는 Apps Script를 실행하면 자동 생성됩니다).
   - **`Settings` 시트**: `key`, `value`, `description`
   - **`Questions` 시트**: `id`, `type`, `question`, `option1`, `option2`, `option3`, `option4`, `answer`, `category`, `difficulty`, `createdAt`
   - **`PlayLog` 시트**: `playerName`, `score`, `correctCount`, `totalCount`, `playedAt`

### 2단계: Google Apps Script (`Code.gs`) 배포
1. 스프레드시트 상단 메뉴의 **확장 프로그램 > Apps Script**를 클릭합니다.
2. `gas/Code.gs`의 전체 소스코드를 복사하여 Apps Script 에디터에 붙여넣고 저장합니다.
3. 상단 **배포 > 새 배포**를 클릭합니다.
4. 톱니바퀴 아이콘 > **웹 앱**을 선택합니다:
   - **설명**: 모션 퀴즈 API v1
   - **다음 사용자로 실행**: `나(내 계정)`
   - **액세스 권한이 있는 사용자**: `모든 사용자(Anyone)` ★ (중요)
5. **배포**를 누르고 발급되는 **웹 앱 URL (`https://script.google.com/macros/s/.../exec`)**을 복사합니다.

### 3단계: 프론트엔드 연동
1. `js/api.js` 파일의 상단 `GAS_WEBAPP_URL` 상수에 복사한 웹 앱 URL을 붙여넣습니다.
   ```javascript
   const GAS_WEBAPP_URL = "https://script.google.com/macros/s/.../exec";
   ```
   *(또는 배포 후 `admin.html` 관리자 페이지에 접속하여 입력하셔도 바로 저장됩니다.)*

### 4단계: GitHub Pages 무료 배포
1. 본 프로젝트 폴더 전체를 GitHub 저장소(Repository)에 커밋 & 푸시합니다.
2. GitHub 저장소의 **Settings > Pages** 메뉴로 이동합니다.
3. **Branch**를 `main` (또는 `master`), 폴더를 `/ (root)`로 지정하고 **Save**를 누릅니다.
4. 잠시 후 발급되는 `https://<username>.github.io/<repo-name>/` 주소로 접속하면 즉시 웹캠을 이용해 게임을 플레이할 수 있습니다.

---

## 💻 로컬에서 바로 테스트하기

별도의 빌드 과정 없이 정적 웹 서버로 바로 실행 가능합니다.

```bash
# Python 내장 웹서버 실행 예시 (PowerShell / 터미널)
python -m http.server 8000
```
브라우저에서 `http://localhost:8000` (게임 메인) 또는 `http://localhost:8000/admin.html` (관리자)로 접속합니다.
- 기본 관리자 비밀번호: `1234`
- 웹캠 권한 팝업이 뜨면 **[허용]**을 눌러주세요.
