# 말하기 루틴 (Speak Routine) v2

개인용 영어 말하기 루틴 PWA. **입을 열고 → 교정받고 → 다시 말하고 → 그 청크가 내일 다시 나오는** 흐름을 매일 10/20/30분 돌린다.
기준 문서: [`docs/PRD.md`](docs/PRD.md) (v1.1, 맨 아래 '개인용 적용 메모'에 PRD와 다른 점 정리).

라이브: https://aepiros33.github.io/english-speak/

## 화면 (4개 탭)
- **오늘**: 연속일, 오늘 목표 시간, 이번 주 말한 시간, 큰 '말하기 시작' 버튼, 4칸 체크리스트(쉐도잉 · 말하기 · 피드백 · 청크 3개)
- 루틴(몰입 화면): 쉐도잉 → 롤플레이 또는 4-3-2 → 피드백(최대 3개, 각각 다시 말하기) → 청크 3개 저장. 중간에 나가도 이어서 하기
- **청크**: 말하며 복습(듣기 → 따라 말하기 → 빈칸 말하기 → 상황 한 줄), 오늘 쓴 / 못 쓴 / 추천, 오류 노트, 전체 관리
- **진행**: 이번 주 말한 분 · 세션 수 · 연속일 + 비교 플레이어(주간 같은 질문, 첫 자기소개 vs 최근)
- **설정**: 목표·시간·주제·수준, 억양 US/UK, 속도, 스크립트/한국어 힌트, AI 제공자 + 키 + 모델, 음성·텍스트 삭제, 백업, '왜 이렇게?'

## AI 키 (선택)
설정 → AI에서 제공자(기본 Google Gemini)를 고르고 본인 API 키를 붙여 넣은 뒤 '키 저장' → '연결 테스트'.
키는 그 기기 브라우저의 localStorage에만 저장되고, 저장소·백업 파일에는 들어가지 않는다. 키가 없으면 쉐도잉·4-3-2·청크 복습·셀프 교정만 동작하고 롤플레이는 잠금 상태.

| 제공자 | 대화·피드백 기본 모델 | 받아쓰기 |
|---|---|---|
| Google Gemini (기본, 무료 등급 있음) | `gemini-3.5-flash-lite` | 같은 모델에 오디오 첨부 |
| OpenAI | `gpt-6-luna` | `gpt-transcribe` |
| xAI | `grok-4.20-0309-non-reasoning` | xAI STT (`/v1/stt`) |

## 파일
- `index.html` · `style.css` · `app.js` — 화면과 흐름
- `core.js` — 순수 로직(스케줄러, 루틴 상태 기계, 피드백 JSON 검증, 오류 노트, 스트릭, 음량 분석, v1 마이그레이션). Node에서 테스트
- `media.js` — 녹음(MediaRecorder), 음량 분석, IndexedDB 저장·재생
- `ai.js` — Gemini / OpenAI / xAI 호출, 프롬프트
- `data.js` — 시드 청크 100개 (일상·업무·여행·면접 태그)
- `content.js` — 쉐도잉 클립 60개, 롤플레이 12개, 4-3-2 주제 20개, 발음 힌트 20개, 관심 주제 12개
- `manifest.json` · `sw.js` · `icons/` — PWA (파일 수정 후 배포할 때 `sw.js`의 `CACHE` 버전을 올릴 것)
- `docs/PRD.md` — 제품 요구사항 v1.1

## 테스트
```
TZ=Asia/Seoul node tests/core.test.js     # 스케줄러·텍스트·인터리빙 (20)
TZ=Asia/Seoul node tests/v2.test.js       # 마이그레이션·피드백 JSON·루틴 상태 기계·스케일 등 (38)
python3 -m http.server 8765 &             # 앱 서버
NODE_PATH=<playwright-core>/node_modules node tests/e2e-v2.cjs   # 헤드리스 Chrome 390x844, 가짜 마이크, AI 목(mock)
```
e2e는 `tests/make-fake-speech.py`로 만든 말소리 비슷한 WAV를 가짜 마이크 입력으로 쓰고, AI 네트워크는 Playwright route로 가로채 가짜 응답을 준다(실제 키 사용 안 함).

## 데이터
- `localStorage['speakapp.v2']` — 프로필·설정·청크(SRS)·학습 로그·루틴 진행·대화 기록·오류 노트
- `localStorage['speakapp.v1']` — 예전 v1 데이터(첫 실행 때 v2로 옮긴 뒤 백업으로 그대로 둠)
- `localStorage['speakapp.key.*']` — AI 키 (백업에 포함 안 됨)
- IndexedDB `speakapp-media` — 녹음 파일과 받아쓰기
