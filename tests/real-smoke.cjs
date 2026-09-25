/* 선택: 실제 AI 제공자(Gemini) 스모크 테스트 — 키는 환경 변수로만 받습니다(파일·저장소에 절대 쓰지 않음).
   실행:  GEMINI_API_KEY=발급받은키 NODE_PATH=/tmp/pwtest/node_modules node tests/real-smoke.cjs
   옵션:  BASE=https://aepiros33.github.io/english-speak/  (기본: http://127.0.0.1:8765/index.html)
          SMOKE_AUDIO=/path/to/speech.wav  (있으면 받아쓰기도 확인, 예: python3 tests/make-fake-speech.py 로 만든 /tmp/fake-speech.wav)
          SMOKE_TTS=1  (AI 음성 1문장 생성 확인 — 무료 등급 TTS는 분당 3회 한도)
   무료 등급은 분당 15회 한도라 요청 사이에 쉬면서 약 8회만 호출합니다. */
const { chromium } = require('playwright-core');
const fs = require('fs');
const KEY = process.env.GEMINI_API_KEY || process.env.GEMINI_TEST_KEY;
if (!KEY) { console.error('GEMINI_API_KEY 환경 변수가 필요해요 (키는 출력·저장하지 않음).'); process.exit(2); }
const BASE = process.env.BASE || 'http://127.0.0.1:8765/index.html';
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript(k => { localStorage.setItem('speakapp.key.gemini', k); }, KEY); // 런타임 주입(이 브라우저 컨텍스트에만 존재, 종료 시 폐기)
  const p = await ctx.newPage();
  await p.goto(BASE); await p.waitForFunction(() => window.SpeakAI && window.SpeakCore);
  const audio = process.env.SMOKE_AUDIO && fs.existsSync(process.env.SMOKE_AUDIO) ? fs.readFileSync(process.env.SMOKE_AUDIO).toString('base64') : null;
  const r = await p.evaluate(async ({ audio, tts }) => {
    const AI = window.SpeakAI, F = window.SpeakCore.Feedback, out = {};
    const time = async (fn) => { const t = performance.now(); try { const v = await fn(); return { ms: Math.round(performance.now() - t), v }; } catch (e) { return { ms: Math.round(performance.now() - t), err: (e.kind || '') + ' ' + AI.friendly(e) }; } };
    const rest = () => new Promise(r => setTimeout(r, 4500));
    out.ping = await time(() => AI.testConnection()); await rest();
    const sc = window.SPEAK_CONTENT.SCENARIOS.find(s => s.id === 'rp_009');
    out.rp = await time(() => AI.roleplayTurn(sc, [{ who: 'ai', text: sc.opener }, { who: 'me', text: 'How about Thursday at three?' }], { level: 'intermediate', turn: 1, maxTurns: 3 })); await rest();
    out.rpOff = await time(() => AI.roleplayTurn(sc, [{ who: 'ai', text: sc.opener }, { who: 'me', text: 'My dog is very cute and I ate pizza.' }], { level: 'intermediate', turn: 1, maxTurns: 3 })); await rest();
    out.fb = [];
    for (const [task, utt] of [['Suggest a time for the client meeting.', ['Yesterday I go to meeting and I very agree the idea, but my boss he don\'t like it because is expensive.']], ['Talk about your weekend.', ['I went eye shopping and my condition was not good.']], ['Ask the hotel for a late checkout.', ['My favorite food is kimchi stew.']]]) {
      const x = await time(() => AI.feedback({ task, utterances: utt, level: 'intermediate' })); if (x.v) x.needsRepair = F.needsRepair(x.v); out.fb.push(x); await rest();
    }
    if (audio) { const bin = atob(audio), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); out.stt = await time(() => AI.transcribe(new Blob([a], { type: 'audio/wav' }), 'audio/wav')); }
    if (tts) out.tts = await time(() => AI.tts('Let me check my schedule and get back to you.', { rate: 1, accent: 'us' }).then(b => b.size));
    return out;
  }, { audio, tts: !!process.env.SMOKE_TTS });
  console.log('실제 제공자 스모크 테스트 — ' + BASE);
  ok(r.ping.v === true, '연결 테스트 ' + r.ping.ms + 'ms ' + (r.ping.err || ''));
  ok(r.rp.v && r.rp.v.reply, '롤플레이 턴 ' + r.rp.ms + 'ms: ' + (r.rp.v ? r.rp.v.reply : r.rp.err));
  ok(r.rpOff.v && (r.rpOff.v.is_repair || !r.rpOff.v.on_topic), '주제 이탈 → 확인 질문 ' + r.rpOff.ms + 'ms: ' + (r.rpOff.v ? r.rpOff.v.reply : r.rpOff.err));
  r.fb.forEach((x, i) => ok(x.v && x.v.items.length <= 3 && x.v.items.every(it => /[가-힣]/.test(it.issue_ko)), '피드백 ' + (i + 1) + ' ' + x.ms + 'ms: ' + (x.v ? x.v.items.length + '개 · ' + x.v.items.map(it => it.improved).join(' / ') + (x.needsRepair ? ' · 확인 질문: ' + x.v.repair_question : '') : x.err)));
  ok(r.fb[2].needsRepair, '주제와 다른 답 → on_topic=false + 확인 질문');
  if (r.stt) ok(r.stt.v && r.stt.v.length > 3, '받아쓰기 ' + r.stt.ms + 'ms: ' + (r.stt.v || r.stt.err));
  if (r.tts) ok(r.tts.v > 10000, 'AI 음성(TTS) ' + r.tts.ms + 'ms, ' + (r.tts.v || r.tts.err) + ' bytes');
  console.log(fail ? '\n실패 ' + fail + '건' : '\n모두 통과');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
