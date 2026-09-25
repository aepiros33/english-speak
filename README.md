# 말하기 루틴 (Speak Routine) v2.1

개인용 영어 말하기 루틴 PWA. **입을 열고 → 교정받고 → 다시 말하고 → 그 청크가 내일 다시 나오는** 흐름을 매일 10/20/30분 돌린다.
기준 문서: [`docs/PRD.md`](docs/PRD.md) (v1.1, 맨 아래 '개인용 적용 메모'에 PRD와 다른 점 정리).

라이브: https://aepiros33.github.io/english-speak/

## 화면 (4개 탭)
- **오늘**: 연속일, 오늘 목표 시간, 이번 주 말한 시간, 큰 '말하기 시작' 버튼, 4칸 체크리스트(쉐도잉 · 말하기 · 피드백 · 청크 3개)
- 루틴(몰입 화면): 쉐도잉 → 롤플레이 또는 4-3-2 → 피드백(최대 3개, 각각 다시 말하기) → 청크 3개 저장. 중간에 나가도 이어서 하기
- **청크**: 말하며 복습(듣기 → 따라 말하기 → 빈칸 말하기 → 상황 한 줄), 오늘 쓴 / 못 쓴 / 추천, 오류 노트, 전체 관리
- **진행**: 이번 주 말한 분 · 세션 수 · 연속일 + 비교 플레이어(주간 같은 질문, 첫 자기소개 vs 최근)
- **설정**: 목표·시간·주제·수준, 억양 US/UK, 속도, 녹음 재생 볼륨 부스트(1/1.5/2/3×, 기본 2×), 쉐도잉 AI 음성(선택), 스크립트/한국어 힌트, AI 제공자 + 키 + 모델, 음성·텍스트 삭제, 백업, '왜 이렇게?'

## AI 키 (선택)
설정 → AI에서 제공자(기본 Google Gemini)를 고르고 본인 API 키를 붙여 넣은 뒤 '키 저장' → '연결 테스트'.
키는 그 기기 브라우저의 localStorage에만 저장되고, 저장소·백업 파일에는 들어가지 않는다. 키가 없으면 쉐도잉·4-3-2·청크 복습·셀프 교정만 동작하고 롤플레이는 잠금 상태.

| 제공자 | 대화·피드백 기본 모델 | 받아쓰기 |
|---|---|---|
| Google Gemini (기본, 무료 등급 있음) | `gemini-3.5-flash-lite` | 같은 모델에 오디오 첨부 |
| OpenAI | `gpt-6-luna` | `gpt-transcribe` |
| xAI | `grok-4.20-0309-non-reasoning` | xAI STT (`/v1/stt`) |

실제 Gemini 키로 확인한 것(2026-09-25, 무료 등급):
- 응답 시간: 롤플레이 턴 0.5~1.0초, 피드백 0.7~1.7초, 받아쓰기 0.9~1.5초. 가끔 8~40초씩 멈추는 요청이 있어 **첫 시도는 짧게 끊고 최대 2번 재시도**한다(텍스트 8→12→15초, 받아쓰기 약 9초~, 재시도 중엔 '다시 요청하고 있어요' 안내). 녹음 끝 → 상대 답 표시까지 체감 약 2초.
- 한도: 무료 등급은 모델당 **1분에 15회**. 한도(429)에 걸리면 서버가 알려 준 대기 시간이 20초 이하일 때 기다렸다가 1번 다시 보내고, 아니면 '요청 한도를 넘었어요(…) N초쯤 뒤에…'라고 안내.
- JSON: `responseMimeType: application/json` + 앱 쪽 검증으로 23/23 정상. `responseSchema`는 형식 이점 없이 지연 꼬리가 커져(24~43초) 쓰지 않음.
- 오디오: Chrome은 webm/opus, iPhone Safari는 mp4(AAC) → Gemini에는 `audio/m4a`로 보냄(`audio/mp4` 그대로 보내면 23초 걸림).
- AI 음성(`gemini-3.8-flash-lite-tts`): 문장당 1.7~5초, 무료 등급 **1분에 3문장** → 쉐도잉 음원에만 쓰고(오늘 클립 미리 생성·IndexedDB 캐시), 롤플레이·복습은 기기 음성.

## 소리가 작을 때 (v2.1)
- 녹음이 끝나면 마이크 트랙을 모두 멈추고 레벨 측정용 AudioContext를 닫는다(iOS에서 마이크가 켜져 있으면 play-and-record 모드가 되어 소리가 수화부로 작게 나옴). Safari 16.4+는 `navigator.audioSession.type`을 녹음 중 `play-and-record`, 그 외 `playback`으로 둔다.
- 내 녹음·비교 플레이어·온보딩 소개는 Web Audio로 재생: 최고점 정규화 × 부스트(기본 2×) → 리미터. 기기 음성(speechSynthesis)은 항상 volume 1.
- 그래도 작으면 재생 중에 폰 볼륨 버튼을 올리고, 아이폰은 무음 스위치도 확인.

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
TZ=Asia/Seoul node tests/v2.test.js       # 마이그레이션·피드백 JSON·루틴 상태 기계·스케일·볼륨 부스트 등 (40)
python3 -m http.server 8765 &             # 앱 서버
NODE_PATH=<playwright-core>/node_modules node tests/e2e-v2.cjs   # 헤드리스 Chrome 390x844, 가짜 마이크, AI 목(mock)
```
e2e는 `tests/make-fake-speech.py`로 만든 말소리 비슷한 WAV를 가짜 마이크 입력으로 쓰고, AI 네트워크는 Playwright route로 가로채 가짜 응답을 준다(실제 키 사용 안 함). 429·네트워크 끊김·잘못된 키 안내, 볼륨 부스트, 마이크 해제, AI 음성 캐시, AI 답 대기 중 앱 재실행도 확인한다.

### 선택: 실제 제공자 스모크 테스트
실제 Gemini 키로 연결·롤플레이·주제 이탈 확인 질문·피드백 3건(·받아쓰기·AI 음성)을 한 번씩 호출해 본다. **키는 환경 변수로만** 넘기고, 스크립트가 브라우저에 런타임으로 주입한다(파일·저장소·출력에 남지 않음). 무료 등급 한도 때문에 요청 사이에 쉬어서 약 1분 걸린다.
```
GEMINI_API_KEY=발급받은키 NODE_PATH=<playwright-core>/node_modules node tests/real-smoke.cjs
# 옵션: BASE=https://aepiros33.github.io/english-speak/  SMOKE_AUDIO=/tmp/fake-speech.wav  SMOKE_TTS=1
```
셸 기록에 키가 남지 않게 하려면 `read -s GEMINI_API_KEY && export GEMINI_API_KEY`로 입력한 뒤 실행하고, 끝나면 `unset GEMINI_API_KEY`.

## 데이터
- `localStorage['speakapp.v2']` — 프로필·설정·청크(SRS)·학습 로그·루틴 진행·대화 기록·오류 노트
- `localStorage['speakapp.v1']` — 예전 v1 데이터(첫 실행 때 v2로 옮긴 뒤 백업으로 그대로 둠)
- `localStorage['speakapp.key.*']` — AI 키 (백업에 포함 안 됨)
- IndexedDB `speakapp-media` — 녹음 파일과 받아쓰기, AI 음성 캐시(`tts`, 최대 300문장)
