# 말하기 연습 (Speak Practice) v1

한국어 단서를 보고 영어 표현을 **소리 내어 떠올리는** 개인용 말하기 연습 앱. 정적 사이트(빌드 없음), 모든 데이터는 브라우저 localStorage에 저장.

## 파일
- `index.html` · `style.css` · `app.js` — 화면/흐름
- `core.js` — 순수 로직(스케줄러, 발화 비교, 인터리빙). Node에서도 테스트 가능
- `data.js` — 시드 표현 40개
- `manifest.json` · `sw.js` · `icons/` — PWA(홈 화면 추가, 오프라인 캐시)
- `tests/core.test.js` — 단위 테스트: `TZ=Asia/Seoul node tests/core.test.js`
- `tests/e2e.cjs` — 헤드리스 브라우저 테스트(Playwright): `python3 -m http.server 8765` 실행 후 `NODE_PATH=<playwright-core 설치 경로>/node_modules node tests/e2e.cjs`

## 로컬 실행
```
cd speak-app && python3 -m http.server 8765
# http://localhost:8765 (localhost는 마이크/음성인식 허용되는 보안 컨텍스트)
```
휴대폰에서 음성 인식을 쓰려면 HTTPS가 필요(예: 나중에 GitHub Pages). `sw.js`의 `CACHE` 버전을 파일 수정 시 올려주세요.
