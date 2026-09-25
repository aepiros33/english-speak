/* E2E v2 — 헤드리스 Chromium 390x844, 가짜 마이크, AI(Gemini) 네트워크는 Playwright route로 목(mock).
   실행: NODE_PATH=/tmp/pwtest/node_modules node tests/e2e-v2.cjs  (python3 -m http.server 8765 로 앱을 띄운 상태) */
const { chromium } = require('playwright-core');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/index.html';
const SHOTS = path.join(__dirname, '..', 'screens');
const FAKE_KEY = 'test-key-not-real';
const DAY = 24 * 3600 * 1000;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

const INIT = () => {
  // 시계 조작 (다음 날 테스트)
  const off = Number(localStorage.getItem('__e2e_offset') || 0);
  if (off) {
    const RealDate = Date, realNow = Date.now.bind(Date);
    class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(realNow() + off); else super(...a); } static now() { return realNow() + off; } }
    window.Date = FakeDate;
  }
  // TTS 목: 헤드리스에는 음성이 없으므로 60ms 뒤 끝난 것으로
  try {
    window.__spoken = [];
    speechSynthesis.speak = function (u) { window.__spoken.push({ text: u.text, rate: u.rate }); setTimeout(() => { u.onend && u.onend(); }, 60); };
    speechSynthesis.cancel = function () {};
  } catch (e) {}
  // 헤드리스에서는 Web Speech 인식이 동작하지 않으므로 제거 (자가 채점 경로 사용)
  try { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; window.webkitSpeechRecognition = undefined; window.SpeechRecognition = undefined; } catch (e) {}
  // 녹음 재생 횟수 기록
  window.__plays = 0;
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays++; return op.apply(this, arguments); };
  // v2.1: 녹음 재생은 Web Audio(게인+리미터) — 재생 횟수와 게인값 기록
  window.__gains = [];
  try {
    const ost = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () { window.__plays++; return ost.apply(this, arguments); };
    const ocg = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function () { const g = ocg.apply(this, arguments); window.__gains.push(g); return g; };
  } catch (e) {}
  // 마이크 스트림 추적 (녹음 후 모든 트랙이 꺼지는지)
  window.__streams = [];
  try {
    const ogum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (c) { return ogum(c).then(function (s) { window.__streams.push(s); return s; }); };
  } catch (e) {}
};

function makeMock() {
  const m = { transcripts: [], roleplay: [], calls: { TRANSCRIBE: 0, ROLEPLAY: 0, FEEDBACK: 0, PING: 0, TTS: 0 }, keysSeen: new Set(), fbDelay: 900, fail: null };
  m.handler = async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    m.keysSeen.add(req.headers()['x-goog-api-key']);
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    // 오류 시뮬레이션: 429(분당 한도, 28초 대기) / 네트워크 끊김 / 잘못된 키
    if (m.fail === '429') return route.fulfill({ status: 429, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota. Please retry in 28.6s.', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '28s' }] } }) });
    if (m.fail === 'abort') return route.abort('internetdisconnected');
    if (m.fail === 'stall') { m.fail = null; m.stalled = (m.stalled || 0) + 1; await new Promise(r => setTimeout(r, 1500)); return route.abort('timedout').catch(() => {}); } // 첫 요청만 멈춤
    if (m.fail === 'badkey') return route.fulfill({ status: 400, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }) });
    if (((body.generationConfig || {}).responseModalities || []).includes('AUDIO')) {
      m.calls.TTS++;
      const n = 7200, buf = Buffer.alloc(44 + n * 2); // 0.3초 440Hz, 24kHz 16bit WAV
      buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(24000, 24); buf.writeUInt32LE(48000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
      for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 24000 * 2 * Math.PI * 440) * 12000), 44 + i * 2);
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: buf.toString('base64') } }] } }] }) });
    }
    const sys = (((body.systemInstruction || {}).parts || [])[0] || {}).text || '';
    let out;
    if (sys.includes('TASK: TRANSCRIBE')) { m.calls.TRANSCRIBE++; out = { text: m.transcripts.length ? m.transcripts.shift() : 'I think this is a good idea because it saves time.' }; }
    else if (sys.includes('TASK: ROLEPLAY')) {
      m.calls.ROLEPLAY++;
      if (m.rpHang) { m.rpHang = false; await new Promise(r => setTimeout(r, 4000)); return route.abort('failed').catch(() => {}); } // 응답 전에 앱이 닫힌 상황
      out = m.roleplay.shift() || { reply: 'Okay, sounds good.', understood: true, on_topic: true, is_repair: false, end: true }; }
    else if (sys.includes('TASK: FEEDBACK')) {
      m.calls.FEEDBACK++;
      await new Promise(r => setTimeout(r, m.fbDelay));
      // 일부러 코드펜스 + 4개 항목 + 칭찬만 있는 항목을 섞어 보냄 → 앱이 최대 3개, 칭찬 제거해야 함
      const txt = '```json\n' + JSON.stringify({
        comprehensible: true, on_topic: true, repair_question: null,
        items: [
          { original: 'I go left at the bread shop', issue_ko: '빵집은 bakery라고 하면 바로 통합니다.', improved: 'I turn left at the bakery.', layer: 'meaning', severity: 'high' },
          { original: 'then bridge', issue_ko: '동사를 넣으면 더 잘 통합니다.', improved: 'Then I cross the bridge.', layer: 'naturalness', severity: 'medium' },
          { original: 'Great', issue_ko: 'Great job!', improved: 'Great', layer: 'delivery', severity: 'low' },
          { original: 'Thank you very much for your kind', issue_ko: '짧게 끝내면 더 자연스럽습니다.', improved: 'Thanks so much!', layer: 'naturalness', severity: 'low' },
          { original: 'extra', issue_ko: '네 번째 항목', improved: 'This should be dropped.', layer: 'naturalness', severity: 'low' }
        ]
      }) + '\n```';
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }] }) });
    }
    else { m.calls.PING++; out = { ok: true }; }
    return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) });
  };
  return m;
}

async function newCtx(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.grantPermissions(['microphone'], { origin: new URL(BASE).origin });
  await ctx.addInitScript(INIT);
  return ctx;
}
function watch(page, errs) {
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url()) && !(global.__expectApiErrors && /generativelanguage/.test(r.url()))) errs.push('HTTP ' + r.status() + ' ' + r.url()); });
  page.on('dialog', d => d.accept());
}
const act = (p, a, extra) => p.click('[data-act="' + a + '"]' + (extra || ''));
async function record(p, a, ms) {
  await act(p, a);
  await p.waitForSelector('.mic.listening', { timeout: 8000 });
  await p.waitForTimeout(ms || 1800);
  await act(p, a);
}
async function xshot(p, name) { if (!process.env.EXTRA_SHOTS) return; await p.evaluate(() => document.querySelector('#toast').classList.remove('show')); await p.screenshot({ path: '/tmp/extra-' + name + '.png' }); }
async function shot(p, name) { await p.evaluate(() => document.querySelector('#toast').classList.remove('show')); await p.waitForTimeout(300); await p.screenshot({ path: path.join(SHOTS, 'v2-' + name + '.png') }); console.log('  📸 v2-' + name + '.png'); }
const S = (p) => p.evaluate(() => JSON.parse(JSON.stringify({ routine: window.SpeakApp.routine, profile: window.SpeakApp.db.profile })));

async function onboarding(p, opts) {
  await p.goto(BASE);
  await p.waitForSelector('[data-act="ob-next"]');
  await act(p, 'ob-next');
  await act(p, 'ob-goal', '[data-v="work"]'); await act(p, 'ob-next');
  await act(p, 'ob-min', '[data-v="10"]'); await act(p, 'ob-next');
  await act(p, 'ob-topic', '[data-v="meetings"]'); await act(p, 'ob-topic', '[data-v="smalltalk"]'); await act(p, 'ob-topic', '[data-v="travel"]');
  await act(p, 'ob-topic', '[data-v="tech"]'); // 4번째는 거절되어야 함
  const nTopics = await p.$$eval('.pick.sel', els => els.length);
  ok(nTopics === 3, '관심 주제는 최대 3개 (4번째 선택 거절)');
  await act(p, 'ob-next');
  await act(p, 'ob-level', '[data-v="intermediate"]'); await act(p, 'ob-next');
  if (opts.shot) await shot(p, 'onboarding');
  if (opts.record) {
    await record(p, 'ob-rec', 2200);
    await p.waitForSelector('[data-act="ob-finish"]', { timeout: 8000 });
    ok(await p.isVisible('text=말한 길이'), '온보딩 자기소개 녹음 후 길이/멈춤 표시');
    await act(p, 'ob-finish');
  } else {
    await act(p, 'ob-skip');
  }
  await p.waitForSelector('text=준비 끝!');
}

async function shadowClips(p, doShot) {
  let first = true;
  for (let guard = 0; guard < 40; guard++) {
    const st = await S(p);
    if (st.routine.step !== 'shadow') break;
    const mode = st.routine.shadow.mode;
    if (mode === 'listen' || mode === 'shadow') { await act(p, 'sh-play'); await p.waitForTimeout(150); await act(p, 'sh-next-mode'); continue; }
    if (mode === 'repeat') {
      const reps = st.routine.plan.reps;
      for (let i = 0; i < reps; i++) { await p.waitForSelector('[data-act="sh-rep"]:not([disabled])'); await act(p, 'sh-rep'); await p.waitForTimeout(250); }
      await p.waitForSelector('[data-act="sh-next-mode"]:not([disabled])'); await act(p, 'sh-next-mode'); continue;
    }
    if (mode === 'solo') {
      const script = await p.evaluate(() => { const r = window.SpeakApp.routine; const ids = (r.plan.warmup ? ['warmup'] : []).concat(r.plan.clipIds); const id = ids[r.shadow.idx]; return id === 'warmup' ? r.plan.warmup.script : window.SPEAK_CONTENT.CLIPS.find(c => c.id === id).script; });
      if (p.__mock) p.__mock.transcripts.unshift(script.replace(/\b(the|a)\b /i, '').replace(/,/g, ''));
      ok(await p.isVisible('.script-box.hidden-script'), '혼자 말하기: 음원 끄고 스크립트 숨김');
      await record(p, 'sh-rec', 1800);
      await p.waitForSelector('[data-act="sh-mine"]:not([disabled])', { timeout: 8000 });
      continue;
    }
    if (mode === 'compare') {
      const before = await p.evaluate(() => window.__plays);
      const spokenBefore = await p.evaluate(() => window.__spoken.length);
      await act(p, 'sh-play'); await act(p, 'sh-mine'); await p.waitForTimeout(400);
      const after = await p.evaluate(() => window.__plays), spokenAfter = await p.evaluate(() => window.__spoken.length);
      if (first) {
        ok(after > before && spokenAfter > spokenBefore, '비교: 원문(TTS)과 내 녹음 모두 재생');
        const g = await p.evaluate(() => window.__gains.map(x => x.gain.value));
        ok(g.length > 0 && Math.max.apply(null, g) >= 2, '녹음 재생 볼륨 부스트: Web Audio 게인 ≥ 2× (기본 설정) → ' + g.slice(-1)[0]);
        const mic = await p.evaluate(() => ({ n: window.__streams.length, live: window.__streams.reduce((a, s) => a + s.getTracks().filter(t => t.readyState === 'live').length, 0) }));
        ok(mic.n > 0 && mic.live === 0, '녹음이 끝나면 마이크 트랙 모두 해제 (iOS 수화부/작은 소리 방지) — 스트림 ' + mic.n + '개, 살아 있는 트랙 ' + mic.live);
        await p.waitForSelector('#shCmp:not([hidden])', { timeout: 8000 }).catch(() => {});
        if (doShot) await shot(p, 'shadowing');
        first = false;
      }
      await act(p, 'sh-next-clip'); await p.waitForTimeout(150);
      continue;
    }
  }
}

(async () => {
  const fs = require('fs');
  const wav = '/tmp/fake-speech.wav';
  if (!fs.existsSync(wav)) require('child_process').execSync('python3 ' + JSON.stringify(path.join(__dirname, 'make-fake-speech.py')) + ' ' + wav);
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-file-for-fake-audio-capture=' + wav, '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];

  /* ===== 1. 메인 흐름: 온보딩 → 설정(키) → 전체 루틴 → 다음 날 복습 ===== */
  console.log('\n[1] 온보딩 + AI 루틴 전체');
  const ctx = await newCtx(browser);
  const mock = makeMock();
  await ctx.route(/generativelanguage\.googleapis\.com/, mock.handler);
  const p = await ctx.newPage(); watch(p, errs);
  await onboarding(p, { record: true, shot: true });
  let st = await S(p);
  ok(st.profile.onboarded && st.profile.introRecId, '온보딩 완료 + 자기소개 녹음이 첫 비교 녹음으로 저장');
  ok(st.profile.minutes === 10 && st.profile.goal === 'work' && st.profile.topics.length === 3, '목표/시간/주제 저장');
  await act(p, 'home');
  await p.waitForSelector('text=AI 키가 없으면');
  // 설정에서 키 입력
  await p.goto(BASE + '#/settings/ai');
  await p.waitForSelector('#aiKey');
  await p.fill('#aiKey', FAKE_KEY);
  await act(p, 'key-save');
  await p.waitForSelector('[data-act="key-test"]:not([disabled])');
  await act(p, 'key-test');
  await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('연결됐어요'), null, { timeout: 8000 });
  ok(true, '연결 테스트 (목) 성공 토스트');
  ok(await p.evaluate(() => !JSON.stringify(window.SpeakApp.db).includes('test-key-not-real')), '키는 앱 데이터(백업 대상)에 들어가지 않음');
  // 오류 메시지 (한국어) — 429 / 네트워크 / 잘못된 키
  const toastAfter = async (fail) => {
    mock.fail = fail; global.__expectApiErrors = true;
    await p.evaluate(() => { document.querySelector('#toast').textContent = ''; });
    await act(p, 'key-test');
    await p.waitForFunction(() => /[가-힣]/.test(document.querySelector('#toast').textContent), null, { timeout: 12000 }).catch(() => {});
    mock.fail = null; global.__expectApiErrors = false;
    return p.evaluate(() => document.querySelector('#toast').textContent);
  };
  let tm = await toastAfter('429');
  ok(/요청 한도를 넘었어요/.test(tm) && /\d+초/.test(tm), '429(분당 한도) → 한국어 안내 + 대기 시간: ' + tm);
  tm = await toastAfter('abort');
  ok(/인터넷 연결을 확인/.test(tm), '네트워크 끊김 → (1회 재시도 후) 한국어 안내: ' + tm);
  // 응답 멈춤 → 짧은 제한 시간 뒤 자동 재시도로 성공 (+ '다시 요청하고 있어요' 안내)
  mock.fail = 'stall'; global.__expectApiErrors = true;
  const stall = await p.evaluate(async () => { const t = performance.now(); try { const o = await window.SpeakAI.json('TASK: PING. Return JSON {"ok": true}.', 'ping', { timeouts: [800, 3000] }); return { ok: !!o, ms: Math.round(performance.now() - t), toast: document.querySelector('#toast').textContent }; } catch (e) { return { err: e.kind }; } });
  global.__expectApiErrors = false;
  ok(stall.ok && mock.stalled === 1 && /다시 요청하고 있어요/.test(stall.toast), '응답 멈춤 → 자동 재시도로 성공 + 안내 (' + JSON.stringify(stall) + ')');
  tm = await toastAfter('badkey');
  ok(/AI 키가 맞지 않는/.test(tm), '잘못된 키 → 한국어 안내: ' + tm);
  // 소리 설정: 재생 볼륨 부스트(기본 2×) · 볼륨 팁 · AI 음성(Gemini TTS) + 캐시
  ok(await p.evaluate(() => document.querySelector('select[data-set="playBoost"]').value === '2' && document.body.textContent.includes('무음 스위치')), '설정: 재생 볼륨 부스트 기본 2× + 볼륨 팁 표시');
  await p.check('input[data-set="aiVoice"]');
  const plays0 = await p.evaluate(() => window.__plays);
  await act(p, 'tts-test');
  await p.waitForFunction((n) => window.__plays > n, plays0, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(600);
  await act(p, 'tts-test');
  await p.waitForTimeout(800);
  const plays1 = await p.evaluate(() => window.__plays);
  ok(mock.calls.TTS === 1 && plays1 >= plays0 + 2, 'AI 음성: Gemini TTS 1번 생성 → 두 번째는 기기 캐시에서 재생 (TTS 호출 ' + mock.calls.TTS + ', 재생 ' + (plays1 - plays0) + ')');
  await p.uncheck('input[data-set="aiVoice"]');
  await p.evaluate(() => document.querySelector('#ai').scrollIntoView());
  await shot(p, 'settings-ai');
  // 홈
  await p.goto(BASE + '#/home');
  await p.waitForSelector('.huge-start');
  await shot(p, 'home');
  await act(p, 'start');
  await p.waitForSelector('.modes');
  st = await S(p);
  ok(st.routine.plan.clipIds.length === 2 && st.routine.plan.reps === 3 && st.routine.plan.turns === 3, '10분 루틴: 클립 2개 · 반복 3회 · 롤플레이 3턴');
  p.__mock = mock;
  await shadowClips(p, true);
  st = await S(p);
  ok(st.routine.step === 'output' && st.routine.shadow.recIds.filter(Boolean).length === 2, '쉐도잉 완료: 혼자 말하기 녹음 2개 저장');
  // 출력: 롤플레이 (빠른 말 → 되묻기 전략 + AI 수리)
  await act(p, 'pick-rp');
  await act(p, 'rp-start', '[data-id="rp_002"]');
  await p.waitForSelector('.bubble.ai .blurred');
  ok(await p.evaluate(() => window.__spoken.slice(-1)[0].rate >= 1.25), '빠른 안내 시나리오: AI가 일부러 빠르게 말함(1.3×)');
  await p.waitForTimeout(3400);
  ok(await p.isVisible('#nudge'), '3초 침묵 → “한번 말해 보세요”');
  await act(p, 'rp-hint');
  ok((await p.$$('.hint-chunk')).length === 1 && (await p.textContent('.hint-chunk')).includes('Sorry, could you say that again?'), '막히면 힌트 = 청크 정확히 1개');
  mock.transcripts.push('Sorry, could you say that again?');
  mock.roleplay.push({ reply: 'Sure. Go straight two blocks, then turn left at the bakery.', understood: true, on_topic: true, is_repair: false, end: false });
  await record(p, 'rp-rec', 1500);
  await p.waitForFunction(() => document.querySelectorAll('.bubble.ai:not(.pending)').length >= 2, null, { timeout: 10000 });
  mock.transcripts.push('I go left at the bread shop, then bridge');
  mock.roleplay.push({ reply: 'Do you mean you turn left at the bakery and then cross the bridge?', understood: false, on_topic: true, is_repair: true, end: false });
  mock.rpHang = true;
  await record(p, 'rp-rec', 1500);
  await p.waitForSelector('.bubble.ai.pending', { timeout: 10000 });
  await p.reload(); // AI 답을 기다리는 중에 앱이 닫힘
  await p.waitForSelector('.huge-start, #chat');
  if (await p.isVisible('.huge-start')) await act(p, 'start');
  await p.waitForSelector('.bubble.ai.repair', { timeout: 10000 });
  ok(true, 'AI 답 대기 중 앱을 닫았다 열어도 → 상대 답을 자동으로 다시 받아 대화 이어짐');
  ok(true, 'AI 수리 질문 “Do you mean …?” 표시');
  mock.transcripts.push('Yes, left at the bakery, then I cross the bridge. Thank you very much for your kind help!');
  mock.roleplay.push({ reply: "Exactly. You'll see the station on your right. Have a good day!", understood: true, on_topic: true, is_repair: false, end: true });
  await record(p, 'rp-rec', 1500);
  await p.waitForFunction(() => document.querySelectorAll('.bubble.ai:not(.pending)').length >= 4, null, { timeout: 10000 });
  await p.waitForTimeout(200);
  await shot(p, 'roleplay');
  let sess = await p.evaluate(() => { const r = window.SpeakApp.routine; return window.SpeakApp.db.sessions.find(s => s.id === r.output.sessionId); });
  ok(sess.turns.filter(t => t.who === 'me').length === 3 && sess.repairs === 1, '롤플레이 3턴 + 수리 1회, 발화 텍스트 기록');
  ok(sess.turns.filter(t => t.who === 'me').every(t => t.text && t.recId), '각 턴의 텍스트와 녹음 ID 저장');
  await act(p, 'rp-finish');
  // 피드백
  await p.waitForSelector('.skeleton', { timeout: 5000 });
  ok(true, '피드백 대기 중 스켈레톤 표시');
  await p.waitForSelector('.fb-card', { timeout: 10000 });
  st = await S(p);
  ok(st.routine.feedback.items.length === 3, '피드백 최대 3개 (5개 중 칭찬 제거 + 3개 제한)');
  ok(!st.routine.feedback.items.some(i => /great job/i.test(i.issue_ko)), '칭찬만 있는 카드 없음');
  ok(await p.isVisible('text=내가 말한 것') && await p.isVisible('text=문제 한 줄') && await p.isVisible('text=더 자연스러운 예문'), '카드 구성: 내가 말한 것 / 문제 한 줄 / 예문 / 따라 말하기 / 다시 말하기');
  const sizes = await p.evaluate(() => { const m = document.querySelector('.mic').getBoundingClientRect().width; const others = [...document.querySelectorAll('.stage .btn')].map(b => b.getBoundingClientRect().height); return { m, max: Math.max(...others) }; });
  ok(sizes.m > sizes.max, '녹음 버튼이 가장 큼');
  await shot(p, 'feedback');
  await act(p, 'fb-shadow');
  await record(p, 'fb-rec', 1500);
  await p.waitForSelector('[data-act="fb-next"]');
  // 중간에 앱 닫기(새로고침) → 재개, 재발화 없이 완료 불가
  await p.reload();
  await p.waitForSelector('[data-act="fb-next"]');
  ok(true, '새로고침(앱 재실행) → 피드백 카드 1 완료 상태로 바로 재개');
  await p.goto(BASE + '#/home');
  await p.waitForSelector('.huge-start');
  ok((await p.textContent('.huge-start')).includes('이어서 하기 · 피드백'), '홈: “이어서 하기 · 피드백”');
  st = await S(p);
  ok(st.routine.step === 'feedback' && !!st.routine.feedback.reutter[0] && !st.routine.feedback.reutter[1], '재발화 1/3 상태 유지, 루틴 미완료');
  const forced = await p.evaluate(() => window.SpeakCore.Routine.completeStep(window.SpeakApp.routine, 'feedback', Date.now()));
  ok(!forced.ok && forced.reason === 'reutter-missing', '재발화 없이 피드백 단계 완료 불가');
  await act(p, 'start');
  await p.waitForSelector('[data-act="fb-next"]');
  await act(p, 'fb-next');
  for (let i = 1; i < 3; i++) {
    await p.waitForSelector('[data-act="fb-rec"]');
    await act(p, 'fb-shadow');
    await record(p, 'fb-rec', 1500);
    await p.waitForSelector(i < 2 ? '[data-act="fb-next"]' : '[data-act="fb-complete"]');
    if (i < 2) await act(p, 'fb-next');
  }
  await act(p, 'fb-complete');
  // 청크 3개 저장
  await p.waitForSelector('#chunkForm');
  const vals = await p.$$eval('#chunkForm input[name^="en"]', els => els.map(e => e.value));
  ok(vals.length === 3 && vals.every(Boolean), '청크 3개 자동 제안 (피드백 기반): ' + vals.join(' | '));
  await p.fill('#chunkForm [name=en2]', 'Could you say that again?');
  await act(p, 'chunks-save');
  await p.waitForSelector('text=오늘 루틴 완료');
  await xshot(p, 'done');
  st = await S(p);
  const complete = await p.evaluate(() => window.SpeakCore.Routine.isComplete(window.SpeakApp.routine));
  ok(st.routine.step === 'done' && complete, '루틴 완료로 기록');
  const savedIds = st.routine.chunks.savedIds;
  ok(savedIds.length === 3, '청크 3개 저장');
  const tl = await p.evaluate(() => { const k = window.SpeakCore.Scheduler.dayKey(Date.now()); return window.SpeakApp.db.log[k]; });
  ok(tl.routineDone && tl.spokenSec > 0, '오늘 기록: 완료 + 실제 녹음 발화 시간 ' + tl.spokenSec + '초');
  const errN = await p.evaluate(() => window.SpeakApp.db.errors.length);
  ok(errN >= 2, '오류 노트에 교정 누적 (' + errN + '개)');
  // 주간 녹음 1회 (1일차)
  await p.goto(BASE + '#/rec/weekly');
  mock.transcripts.push('Last weekend I just stayed home and watched a movie.');
  await record(p, 'rec-go', 2000);
  await p.waitForSelector('text=진행에서 비교하기');
  await p.goto(BASE + '#/home');
  await p.waitForSelector('text=오늘 루틴 완료');
  ok(true, '홈: 오늘 루틴 완료 표시');

  // 다음 날
  console.log('\n[2] 다음 날: 저장한 청크 3개가 복습에 나옴 + 워밍업');
  await p.evaluate((d) => localStorage.setItem('__e2e_offset', String(d)), DAY);
  await p.reload();
  await p.waitForSelector('.huge-start');
  ok((await p.textContent('.huge-start')).includes('말하기 시작'), '다음 날 새 루틴');
  ok(await p.isVisible('text=오늘 워밍업'), '오늘 워밍업에 어제 오류/청크 표시');
  await p.goto(BASE + '#/chunks');
  await p.waitForSelector('.seg-tabs');
  await xshot(p, 'chunks');
  await p.goto(BASE + '#/errors'); await p.waitForSelector('.err'); await xshot(p, 'errors');
  await p.goto(BASE + '#/chunks'); await p.waitForSelector('.seg-tabs');
  await act(p, 'review');
  await p.waitForSelector('.en-big');
  const q = await p.evaluate(() => window.SpeakApp.reviewQueue);
  ok(savedIds.every(id => q.includes(id)), '저장한 청크 3개가 오늘 복습 큐에 있음');
  // 복습 1장: 듣기 → 따라 말하기 → 빈칸 말하기 → 상황 한 줄 → 채점(다시)
  const firstId = q[0];
  await act(p, 'rv-next'); await act(p, 'rv-next');
  await p.waitForSelector('.cloze');
  await xshot(p, 'cloze');
  await act(p, 'rv-said');
  await act(p, 'rv-to-use');
  await act(p, 'rv-to-grade');
  await xshot(p, 'grade');
  await act(p, 'rv-grade', '[data-g="1"]');
  const c1 = await p.evaluate((id) => { const c = window.SpeakApp.db.cards.find(x => x.id === id); const S = window.SpeakCore.Scheduler; return { days: Math.round((S.studyDayStart(c.srs.due) - S.studyDayStart(Date.now())) / S.DAY), missed: window.SpeakApp.db.log[S.dayKey(Date.now())].missedCardIds.includes(id) }; }, firstId);
  ok(c1.days === 1 && c1.missed, '복습 순서 4단계 후 “다시” → 다음 날 재등장 + 못 쓴 목록');
  await act(p, 'rv-quit');
  // 루틴 시작 후 중간에 나가기 → 재개
  console.log('\n[3] 루틴 중간에 나갔다가 이어서 하기');
  await p.goto(BASE + '#/home');
  await act(p, 'start');
  await p.waitForSelector('.modes');
  st = await S(p);
  ok(!!st.routine.plan.warmup && st.routine.plan.warmup.kind === 'error', '오늘 루틴 첫 클립 = 어제 교정 워밍업');
  ok(await p.isVisible('.chip.soft'), '워밍업 배지 표시');
  await act(p, 'sh-play'); await act(p, 'sh-next-mode');
  await act(p, 'sh-rep'); await p.waitForTimeout(250);
  await act(p, 'leave-routine');
  await p.waitForSelector('.huge-start');
  ok((await p.textContent('.huge-start')).includes('이어서 하기 · 쉐도잉'), '홈: 이어서 하기 · 쉐도잉');
  ok(await p.isVisible('.box.cur'), '체크리스트 현재 단계 표시');
  await act(p, 'start');
  await p.waitForSelector('.modes');
  st = await S(p);
  ok(st.routine.shadow.mode === 'repeat' && st.routine.shadow.reps === 1, '같은 클립 · 같은 단계(반복 1/3)에서 재개');
  await act(p, 'leave-routine');
  // 2일차 주간 녹음 + 자기소개 재녹음 → 진행 비교
  console.log('\n[4] 진행: 비교 플레이어');
  await p.evaluate((d) => localStorage.setItem('__e2e_offset', String(d)), 7 * DAY);
  await p.goto(BASE + '#/rec/weekly'); await p.reload();
  mock.transcripts.push('Last weekend I went hiking with my family and we had dinner near the river.');
  await record(p, 'rec-go', 2500);
  await p.waitForSelector('text=진행에서 비교하기');
  await p.goto(BASE + '#/rec/intro');
  mock.transcripts.push("Hi, I'm Youngtak. I work at a tech company as a planner, and these days I'm practicing English every day.");
  await record(p, 'rec-go', 2500);
  await p.waitForSelector('text=진행에서 비교하기');
  await act(p, 'progress');
  await p.waitForSelector('.cmp-grid');
  await p.waitForTimeout(300);
  const cols = await p.$$eval('#cmpWeekly .cmp-col:not(.empty)', e => e.length);
  const icols = await p.$$eval('#cmpIntro .cmp-col:not(.empty)', e => e.length);
  ok(cols === 2 && icols === 2, '주간 같은 질문 처음 vs 최근, 첫 자기소개 vs 최근 나란히');
  ok(await p.isVisible('text=이번 주에 사람과 10분만 말해 보세요.'), '가이드 한 줄 표시');
  const nums = await p.$$eval('.stat .num', e => e.map(x => x.textContent));
  ok(nums.length === 3, '진행 숫자 3개만: ' + nums.join(' / '));
  await shot(p, 'progress');
  // 전부 삭제
  console.log('\n[5] 음성·텍스트 모두 삭제');
  await p.goto(BASE + '#/settings');
  await p.waitForSelector('[data-act="delete-voice"]');
  await xshot(p, 'settings-top');
  await p.goto(BASE + '#/why'); await p.waitForSelector('.why'); await xshot(p, 'why');
  await p.goto(BASE + '#/settings'); await p.waitForSelector('[data-act="delete-voice"]');
  await act(p, 'delete-voice');
  await p.waitForFunction(() => document.querySelector('#recCount') && document.querySelector('#recCount').textContent.includes('녹음 0개'), null, { timeout: 8000 });
  const after = await p.evaluate(() => ({ s: window.SpeakApp.db.sessions.length, e: window.SpeakApp.db.errors.length, intro: window.SpeakApp.db.profile.introRecId, cards: window.SpeakApp.db.cards.length, mine: window.SpeakApp.db.cards.reduce((n, c) => n + c.mine.length, 0) }));
  ok(after.s === 0 && after.e === 0 && !after.intro && after.mine === 0 && after.cards > 100, '녹음 0개 · 대화/오류/내 문장 삭제 · 청크는 유지');
  ok(mock.keysSeen.size === 1 && mock.keysSeen.has(FAKE_KEY), 'AI 요청은 사용자가 넣은 키로만 (헤더)');
  ok(mock.calls.TRANSCRIBE >= 8 && mock.calls.ROLEPLAY === 4 && mock.calls.FEEDBACK === 1, 'AI 호출(롤플레이는 중단 후 재요청 1회 포함): 받아쓰기 ' + mock.calls.TRANSCRIBE + ' · 롤플레이 ' + mock.calls.ROLEPLAY + ' · 피드백 ' + mock.calls.FEEDBACK);
  await ctx.close();

  /* ===== 6. 키 없이: 쉐도잉 → 4-3-2(녹음) → 셀프 교정 → 청크 ===== */
  console.log('\n[6] AI 키 없이 루틴');
  const ctx2 = await newCtx(browser);
  let blocked = 0;
  await ctx2.route(/googleapis|openai\.com|x\.ai/, r => { blocked++; r.abort(); });
  const p2 = await ctx2.newPage(); watch(p2, errs);
  await onboarding(p2, { record: false });
  await act(p2, 'start');
  await p2.waitForSelector('.modes');
  await shadowClips(p2, false);
  await p2.waitForSelector('.locked');
  await xshot(p2, 'picker-nokey');
  ok((await p2.textContent('.locked')).includes('설정에서 AI 키를 넣으면 열려요'), '롤플레이 잠김 상태 문구');
  ok(await p2.$eval('.pick-card.disabled', e => e.getAttribute('data-act')) === 'noop', '잠긴 롤플레이는 가짜 버튼이 아님(동작 없음)');
  await act(p2, 'pick-432');
  await act(p2, 't432', '[data-i="0"]');
  await p2.waitForSelector('text=내용은 같고, 더 빨리, 덜 멈추세요.');
  const secs = await p2.evaluate(() => { const r = window.SpeakApp.routine; return window.SpeakApp.db.sessions.find(s => s.id === r.output.sessionId).roundSecs; });
  ok(JSON.stringify(secs) === JSON.stringify([120, 90, 60]), '4-3-2 라운드(중급·10분): ' + secs.join('/') + '초');
  for (let i = 0; i < 3; i++) {
    await act(p2, 'r432-go'); await p2.waitForSelector('#ring'); await p2.waitForTimeout(1600); await act(p2, 'r432-stop');
    await p2.waitForFunction((n) => document.querySelectorAll('.round.done').length === n, i + 1, { timeout: 8000 });
  }
  ok(await p2.isVisible('.cmp-table'), '라운드별 말한 길이/멈춤 비교표');
  await shot(p2, '432');
  await act(p2, 'r432-finish');
  await p2.waitForSelector('.fb-card');
  ok(await p2.isVisible('text=셀프 교정 모드'), '키 없음 → 셀프 교정 안내');
  await xshot(p2, 'self-fb');
  for (let i = 0; i < 3; i++) {
    await record(p2, 'fb-rec', 1200);
    await p2.waitForSelector(i < 2 ? '[data-act="fb-next"]' : '[data-act="fb-complete"]');
    await act(p2, i < 2 ? 'fb-next' : 'fb-complete');
  }
  await p2.waitForSelector('#chunkForm');
  await act(p2, 'chunks-save');
  await p2.waitForSelector('text=오늘 루틴 완료');
  ok(await p2.evaluate(() => window.SpeakCore.Routine.isComplete(window.SpeakApp.routine)), '키 없이도 루틴 완료');
  ok(blocked === 0, 'AI 키가 없으면 외부 AI 요청 0건');
  await ctx2.close();

  /* ===== 7. v1 데이터 마이그레이션 ===== */
  console.log('\n[7] v1 → v2 마이그레이션');
  const ctx3 = await newCtx(browser);
  const p3 = await ctx3.newPage(); watch(p3, errs);
  const t0 = Date.now();
  const v1 = {
    app: 'speak-practice', version: 1, createdAt: t0 - 10 * DAY, seedVersion: 1,
    settings: { newPerDay: 7, maxReviews: 80, ttsRate: 0.7, slowRate: 0.6, voiceURI: '', latencyThreshold: 3, autoPlay: false, useRecognition: true },
    cards: [
      { id: 'mt01', en: "Let's get started.", ko: '(회의 시작) 시작하죠.', example: '', slot: '', category: 'meeting', custom: false, order: 1, mine: [{ text: "Let's get started with the budget.", at: t0 - DAY }], lat: [1800, 2200], hist: [{ at: t0 - DAY, g: 3 }], srs: { state: 'review', step: 0, due: t0 + 3 * DAY, interval: 6, ease: 2.6, reps: 5, lapses: 1, lastReview: t0 - DAY }, createdAt: t0 - 10 * DAY },
      { id: 'u123', en: 'That rings a bell.', ko: '들어본 것 같아요', example: '', slot: '', category: 'custom', custom: true, order: 2, mine: [], lat: [], hist: [], srs: { state: 'learning', step: 1, due: t0 - 1000, interval: 0, ease: 2.5, reps: 1, lapses: 0, lastReview: t0 - 3600e3 }, createdAt: t0 - 2 * DAY }
    ],
    deletedIds: ['op03'],
    log: { '2026-09-20': { newCount: 3, reviewCount: 10, ms: 600000, lat: [2000], cardIds: ['mt01'], speed: 1 } }
  };
  // 앱을 열기 전에 v1 데이터만 있는 상태를 만든다 (같은 origin의 정적 파일에서 설정)
  await p3.goto(new URL('manifest.json', BASE).href);
  await p3.evaluate((d) => { localStorage.clear(); localStorage.setItem('speakapp.v1', JSON.stringify(d)); }, v1);
  await p3.goto(BASE);
  await p3.waitForSelector('[data-act="ob-next"]');
  const m = await p3.evaluate(() => { const d = window.SpeakApp.db; return { mt01: d.cards.find(c => c.id === 'mt01'), u123: d.cards.find(c => c.id === 'u123'), op03: d.cards.find(c => c.id === 'op03'), n: d.cards.length, log: d.log['2026-09-20'], st: d.settings, v1: localStorage.getItem('speakapp.v1'), from: d.migratedFrom }; });
  ok(m.from === 1, 'v1 데이터 감지 후 마이그레이션');
  ok(m.mt01 && m.mt01.srs.interval === 6 && m.mt01.srs.ease === 2.6 && m.mt01.srs.reps === 5 && m.mt01.srs.lapses === 1 && m.mt01.srs.due === v1.cards[0].srs.due, '기존 SRS 진행(간격·ease·횟수·due) 그대로');
  ok(m.mt01.mine.length === 1 && m.mt01.lat.length === 2 && m.mt01.hist.length === 1, '나의 문장·반응시간·이력 유지');
  ok(m.u123 && m.u123.custom && m.u123.srs.state === 'learning', '사용자 카드 유지');
  ok(!m.op03, '삭제했던 시드 카드는 다시 추가되지 않음');
  ok(m.n === 1 + 1 + 98, '새 시드 추가 후 총 ' + m.n + '개 (기존 2 + 새 시드 98)');
  ok(m.log && m.log.reviewCount === 10, '학습 로그 유지');
  ok(m.st.rate === 0.8 && m.st.newPerDay === 7 && m.st.autoPlay === false, '설정 이전 (속도 0.7→0.8로 보정)');
  ok(m.v1 === JSON.stringify(v1), 'v1 원본은 백업으로 그대로 남김');
  await ctx3.close();

  /* ===== 8. 저장소에 키 흔적 없음 ===== */
  console.log('\n[8] 저장소 키 검사');
  const { execSync } = require('child_process');
  const root = path.join(__dirname, '..');
  const hits = execSync("grep -rInE 'AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|xai-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}' --exclude-dir=node_modules --exclude-dir=screens --exclude-dir=.git " + JSON.stringify(root) + " || true").toString().trim();
  ok(hits === '', '키처럼 보이는 문자열 없음' + (hits ? '\n' + hits : ''));

  console.log('\n[JS 오류] ' + (errs.length ? errs.join('\n') : '없음'));
  ok(errs.length === 0, 'JS 오류 0건');
  await browser.close();
  console.log('\n결과: ' + pass + ' 통과 / ' + fail + ' 실패');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
