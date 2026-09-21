# 🎓 모두의 모션인식 퀴즈 (Motion Quiz)

> **국어 수업 및 교실 참여형 실시간 모션인식 퀴즈 웹앱**  
> 손을 쓰지 않고 **고개 기울임(2지선다)** 또는 **손가락 개수(4지선다)** 동작만으로 정답을 맞히는 AR 필터형 인터랙티브 퀴즈 게임입니다.

---

## 🌟 주요 특징

1. **브라우저 실시간 AI 모션 인식 (MediaPipe Tasks Vision)**
   - 서버에 영상 스트림을 보내지 않고 브라우저(WASM/GPU)에서 즉시 얼굴 기울기(Roll Angle) 및 손가락 개수를 추론합니다.
   - 2지선다: 왼쪽/오른쪽으로 고개를 0.5초 기울이면 해당 선택지 자동 선택.
   - 4지선다: 손가락 1~4개를 펼치면 해당 번호 선택지 선택.
   - 마우스/터치 클릭 및 키보드(1~4번, 좌/우 방향키) 대체 조작을 완벽 지원합니다.

2. **초고속 프리로드 & Google Sheets 백엔드 연동**
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
