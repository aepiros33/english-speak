/* node tests/v2.test.js — v2 로직: 스케줄러(v2 옵션), v1 마이그레이션, 피드백 JSON 검증, 루틴 상태 기계, 10/20/30 스케일, 오류 노트, 스트릭, 음성 레벨 분석, 콘텐츠 무결성 */
const assert = require('assert');
const Core = require('../core.js');
const { Scheduler: S, Routine: R, Feedback: F, Errors: E, Days: D, Audio: A, Migrate, Text: T } = Core;
const DAY = S.DAY, MIN = S.MIN;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
const now = new Date(2026, 8, 25, 13, 0, 0).getTime();
const day4am = (y, m, d) => new Date(y, m, d, 4, 0, 0).getTime();
const V2 = { learningSteps: [], relearningSteps: [], graduatingInterval: 2 };

console.log('Scheduler (v2: 성공 → 간격↑, 실패 → 다음 날)');
test('새 청크: 다시/어려움 → 내일, 좋음 → 2일, 쉬움 → 4일', () => {
  assert.strictEqual(S.schedule(S.newSrs(), 1, now, V2).due, day4am(2026, 8, 26));
  assert.strictEqual(S.schedule(S.newSrs(), 2, now, V2).due, day4am(2026, 8, 26));
  assert.strictEqual(S.schedule(S.newSrs(), 3, now, V2).interval, 2);
  assert.strictEqual(S.schedule(S.newSrs(), 4, now, V2).interval, 4);
});
test('복습 실패 → 재학습 단계 없이 내일 04:00, 잊음+1, ease 감소', () => {
  const srs = { state: 'review', step: 0, due: now, interval: 10, ease: 2.5, reps: 4, lapses: 0, lastReview: now - 10 * DAY };
  const s = S.schedule(srs, 1, now, V2);
  assert.strictEqual(s.state, 'review'); assert.strictEqual(s.interval, 1); assert.strictEqual(s.due, day4am(2026, 8, 26));
  assert.strictEqual(s.lapses, 1); assert.ok(s.ease < 2.5);
});
test('복습 성공 → 간격 증가 (좋음 > 어려움 > 기존)', () => {
  const srs = { state: 'review', step: 0, due: now, interval: 3, ease: 2.5, reps: 3, lapses: 0, lastReview: now - 3 * DAY };
  const h = S.schedule(srs, 2, now, V2).interval, g = S.schedule(srs, 3, now, V2).interval;
  assert.ok(h > 3 && g > h);
});
test('v1에서 넘어온 learning/relearning 카드도 v2 옵션에서 안전하게 처리', () => {
  const l = S.schedule({ state: 'learning', step: 1, due: now, interval: 0, ease: 2.5, reps: 1, lapses: 0, lastReview: now - MIN }, 3, now, V2);
  assert.strictEqual(l.state, 'review'); assert.ok(l.due > now && !isNaN(l.due));
  const r = S.schedule({ state: 'relearning', step: 0, due: now, interval: 3, ease: 2.3, reps: 5, lapses: 1, lastReview: now - MIN }, 1, now, V2);
  assert.strictEqual(r.due, day4am(2026, 8, 26));
});

console.log('v1 → v2 마이그레이션');
const v1 = {
  app: 'speak-practice', version: 1, createdAt: now - 30 * DAY,
  settings: { newPerDay: 7, maxReviews: 80, ttsRate: 1.2, slowRate: 0.6, voiceURI: 'x', latencyThreshold: 3, autoPlay: false, useRecognition: false },
  cards: [{ id: 'mt01', en: "Let's get started.", ko: '시작하죠', example: '', slot: '', category: 'meeting', custom: false, order: 1, mine: [{ text: 'hi', at: 1 }], lat: [1500], hist: [{ at: 1, g: 3 }], srs: { state: 'review', step: 0, due: now + DAY, interval: 5, ease: 2.7, reps: 6, lapses: 2, lastReview: now - 4 * DAY }, createdAt: 1 }],
  deletedIds: ['op01'], log: { '2026-09-01': { newCount: 2, reviewCount: 9, ms: 1000, lat: [], cardIds: [], speed: 0 } }
};
const fresh = () => ({ app: 'speak-practice', version: 2, profile: { onboarded: false }, settings: { rate: 1, voiceURI: '', useWebSpeech: true, newPerDay: 5, maxReviews: 100, latencyThreshold: 3.5, autoPlay: true }, cards: [], deletedIds: [], log: {}, errors: [], sessions: [] });
test('카드·SRS·나의 문장·반응시간·이력 그대로, 원본 불변', () => {
  const copy = JSON.stringify(v1);
  const d = Migrate.v1(v1, fresh());
  assert.deepStrictEqual(d.cards[0], v1.cards[0]);
  assert.notStrictEqual(d.cards[0], v1.cards[0], '깊은 복사');
  assert.strictEqual(JSON.stringify(v1), copy, 'v1 원본 불변');
});
test('로그·삭제 목록 유지, 설정 매핑(속도 0.8~1.1로 보정, slowRate 제거, useRecognition→useWebSpeech)', () => {
  const d = Migrate.v1(v1, fresh());
  assert.deepStrictEqual(d.log, v1.log); assert.deepStrictEqual(d.deletedIds, ['op01']);
  assert.strictEqual(d.settings.rate, 1.1); assert.strictEqual(d.settings.slowRate, undefined);
  assert.strictEqual(d.settings.useWebSpeech, false); assert.strictEqual(d.settings.newPerDay, 7); assert.strictEqual(d.settings.voiceURI, 'x');
  assert.strictEqual(d.profile.onboarded, false, '온보딩은 새로 (목표/시간 설정)'); assert.strictEqual(d.migratedFrom, 1);
});
test('잘못된 v1 데이터면 새 데이터 그대로', () => {
  const f = fresh();
  assert.strictEqual(Migrate.v1(null, f), f); assert.strictEqual(Migrate.v1({ cards: 'x' }, f), f);
});

console.log('피드백 JSON 파싱·검증');
const good = { comprehensible: true, on_topic: true, items: [{ original: 'I very like it', issue_ko: '이렇게 말하면 더 잘 통합니다.', improved: 'I really like it.', layer: 'naturalness', severity: 'medium' }], repair_question: null };
test('정상 JSON → PRD 스키마 그대로', () => {
  const v = F.validate(JSON.stringify(good));
  assert.ok(v.ok); assert.deepStrictEqual(v.data, good);
});
test('코드펜스/앞뒤 잡음 섞인 응답도 파싱', () => {
  assert.ok(F.validate('```json\n' + JSON.stringify(good) + '\n```').ok);
  assert.ok(F.validate('Sure! Here is the JSON: ' + JSON.stringify(good) + ' Hope this helps.').ok);
});
test('망가진 응답 → ok:false (앱이 오류 화면/셀프 교정으로)', () => {
  ['', 'not json', '{"items": [', '[1,2,3]', null, 42].forEach(x => assert.strictEqual(F.validate(x).ok, false, String(x)));
});
test('최대 3개, 심각도 순, 칭찬만 있는 항목·중복·필수값 없는 항목 제거', () => {
  const items = [
    { original: 'a', issue_ko: 'Great job!', improved: 'a', layer: 'delivery', severity: 'low' },
    { original: 'x1', issue_ko: '낮음', improved: 'Low one.', layer: 'naturalness', severity: 'low' },
    { original: 'x2', issue_ko: '높음', improved: 'High one.', layer: 'meaning', severity: 'high' },
    { original: 'x3', issue_ko: '중간', improved: 'Mid one.', layer: 'naturalness', severity: 'medium' },
    { original: 'x4', issue_ko: '중복', improved: 'mid one', layer: 'naturalness', severity: 'medium' },
    { original: '', issue_ko: '원문 없음', improved: 'No original.' },
    { original: 'x5', issue_ko: '추가', improved: 'Extra one.', layer: 'naturalness', severity: 'low' }
  ];
  const v = F.validate({ comprehensible: true, on_topic: true, items, repair_question: null });
  assert.strictEqual(v.data.items.length, 3);
  assert.deepStrictEqual(v.data.items.map(i => i.severity), ['high', 'medium', 'low']);
  assert.ok(!v.data.items.some(i => /great job/i.test(i.issue_ko)));
});
test('잘못된 layer/severity → 기본값, 타입 강제 (boolean/null)', () => {
  const v = F.validate({ comprehensible: 'yes', items: [{ original: 'o', issue_ko: 'i', improved: 'Better.', layer: 'grammar', severity: 'critical' }] });
  assert.strictEqual(v.data.items[0].layer, 'naturalness'); assert.strictEqual(v.data.items[0].severity, 'medium');
  assert.strictEqual(v.data.comprehensible, true); assert.strictEqual(v.data.on_topic, true); assert.strictEqual(v.data.repair_question, null);
});
test('주제에서 벗어남 → 확인 질문(repair_question) 보장', () => {
  const v = F.validate({ comprehensible: true, on_topic: false, items: [], repair_question: '' });
  assert.ok(v.data.repair_question && /\?$/.test(v.data.repair_question));
  const v2 = F.validate({ on_topic: false, items: [], repair_question: 'Do you mean the budget meeting?' });
  assert.strictEqual(v2.data.repair_question, 'Do you mean the budget meeting?');
});
test('뜻이 안 통함(comprehensible=false) → 주제가 맞아도 확인 질문 먼저 (실제 Gemini 응답 패턴)', () => {
  const real = { comprehensible: false, on_topic: true, items: [], repair_question: 'Do you mean you are free next week?' };
  const v = F.validate(real);
  assert.strictEqual(v.data.repair_question, 'Do you mean you are free next week?');
  assert.ok(F.needsRepair(v.data));
  const v2 = F.validate({ comprehensible: false, on_topic: true, items: [], repair_question: null });
  assert.ok(v2.data.repair_question && F.needsRepair(v2.data));
  assert.ok(!F.needsRepair({ comprehensible: true, on_topic: true, repair_question: null }));
  assert.ok(F.needsRepair({ comprehensible: true, on_topic: false, repair_question: 'Do you mean ...?' }));
});
test('교정 0개면 대체 항목(다시 말하기) — 칭찬만 하는 카드 금지', () => {
  const it = F.fallbackItem(['short', 'This is the longest sentence here']);
  assert.strictEqual(it.improved, 'This is the longest sentence here'); assert.ok(!/great|잘했/i.test(it.issue_ko));
  assert.strictEqual(F.fallbackItem([]), null);
});
test('롤플레이 응답 검증: reply 필수, "Do you mean"은 수리로 인식', () => {
  assert.strictEqual(F.validateRoleplay('{}').ok, false);
  assert.strictEqual(F.validateRoleplay('garbage').ok, false);
  const v = F.validateRoleplay({ reply: 'Do you mean the station?' });
  assert.ok(v.ok && v.data.is_repair && v.data.understood && !v.data.end);
});

console.log('루틴 상태 기계');
const plan = (m, level) => R.plan({ minutes: m, level: level || 'intermediate', goal: 'work', topics: ['meetings'], clips: [{ id: 'c1', level: 'b1', topic: 'work', tag: 'meetings' }, { id: 'c2', level: 'a2', topic: 'daily', tag: 'cafe_food' }, { id: 'c3', level: 'b1', topic: 'work', tag: 'email_phone' }, { id: 'c4', level: 'b2', topic: 'travel', tag: 'travel' }, { id: 'c5', level: 'a2', topic: 'work', tag: 'meetings' }, { id: 'c6', level: 'b1', topic: 'daily', tag: 'hobbies' }], rng: () => 0 });
test('10/20/30분 스케일: 단계 시간·클립 수·반복·턴', () => {
  assert.deepStrictEqual(R.durations(20), { shadow: 8, output: 8, feedback: 3, chunks: 1 });
  assert.deepStrictEqual(R.durations(10), { shadow: 4, output: 4, feedback: 1.5, chunks: 0.5 });
  assert.deepStrictEqual(R.durations(30), { shadow: 12, output: 12, feedback: 4.5, chunks: 1.5 });
  const p10 = plan(10), p20 = plan(20), p30 = plan(30);
  assert.deepStrictEqual([p10.clipIds.length, p20.clipIds.length, p30.clipIds.length], [2, 3, 5]);
  assert.deepStrictEqual([p10.reps, p20.reps, p30.reps], [3, 4, 5]);
  assert.deepStrictEqual([p10.turns, p20.turns, p30.turns], [3, 4, 6]);
  assert.ok(p30.turns <= 6 && p10.turns >= 2, 'PRD 2~6턴');
});
test('4-3-2: 초급 2→1.5→1분, 중급+ 4→3→2분 (10분 루틴은 절반)', () => {
  assert.deepStrictEqual(R.fourThreeTwo('beginner', 20), [120, 90, 60]);
  assert.deepStrictEqual(R.fourThreeTwo('intermediate', 20), [240, 180, 120]);
  assert.deepStrictEqual(R.fourThreeTwo('upper', 30), [240, 180, 120]);
  assert.deepStrictEqual(R.fourThreeTwo('intermediate', 10), [120, 90, 60]);
});
test('클립 선택: 관심 주제·수준 우선', () => {
  assert.ok(['c1', 'c5'].includes(plan(10).clipIds[0]));
});
function runTo(r, step) {
  const t = now;
  if (step === 'output' || step === 'feedback' || step === 'chunks') r = R.completeStep(r, 'shadow', t).routine;
  if (step === 'feedback' || step === 'chunks') { r.output.sessionId = 's1'; r.output.utterances = 3; r = R.completeStep(r, 'output', t).routine; }
  if (step === 'chunks') { r.feedback.items = [{}, {}]; r.feedback.reutter = ['a', 'b']; r = R.completeStep(r, 'feedback', t).routine; }
  return r;
}
test('순서 강제: 현재 단계가 아니면 완료 불가', () => {
  const r = R.create('2026-09-25', plan(20));
  assert.strictEqual(r.step, 'shadow');
  assert.strictEqual(R.completeStep(r, 'output', now).reason, 'not-current');
});
test('출력(발화) 없이는 다음 단계 불가', () => {
  let r = runTo(R.create('2026-09-25', plan(20)), 'output');
  assert.strictEqual(R.completeStep(r, 'output', now).reason, 'no-output');
  r.output.sessionId = 's1'; r.output.utterances = 0;
  assert.strictEqual(R.completeStep(r, 'output', now).ok, false);
});
test('재발화 없이는 피드백 완료 불가 (1개라도 빠지면 불가)', () => {
  const r = runTo(R.create('2026-09-25', plan(20)), 'feedback');
  assert.strictEqual(R.completeStep(r, 'feedback', now).reason, 'no-items');
  r.feedback.items = [{}, {}, {}]; r.feedback.reutter = ['a', null, 'c'];
  assert.strictEqual(R.completeStep(r, 'feedback', now).reason, 'reutter-missing');
  r.feedback.reutter[1] = 'b';
  assert.ok(R.completeStep(r, 'feedback', now).ok);
});
test('확인 질문이 있으면 답해야 피드백 완료', () => {
  const r = runTo(R.create('2026-09-25', plan(20)), 'feedback');
  r.feedback.items = [{}]; r.feedback.reutter = ['a']; r.feedback.repairAsked = true;
  assert.strictEqual(R.completeStep(r, 'feedback', now).reason, 'repair-missing');
  r.feedback.repairDone = true; assert.ok(R.completeStep(r, 'feedback', now).ok);
});
test('청크 3개 저장해야 완료 → isComplete, 체크리스트 4칸', () => {
  let r = runTo(R.create('2026-09-25', plan(20)), 'chunks');
  r.chunks.savedIds = ['a', 'b'];
  assert.strictEqual(R.completeStep(r, 'chunks', now).reason, 'need-3-chunks');
  r.chunks.savedIds = ['a', 'b', 'c'];
  const res = R.completeStep(r, 'chunks', now + 5);
  assert.ok(res.ok && res.routine.step === 'done' && res.routine.completedAt === now + 5);
  assert.ok(R.isComplete(res.routine));
  assert.deepStrictEqual(R.checklist(res.routine), { shadow: true, output: true, feedback: true, chunks: true });
});
test('재개: JSON 저장/복원 후 같은 단계·내부 상태 그대로, 원본 불변', () => {
  let r = runTo(R.create('2026-09-25', plan(20)), 'feedback');
  r.feedback.items = [{}, {}, {}]; r.feedback.reutter = ['a']; r.feedback.idx = 1;
  const restored = JSON.parse(JSON.stringify(r));
  assert.strictEqual(restored.step, 'feedback'); assert.strictEqual(restored.feedback.idx, 1);
  assert.strictEqual(R.isComplete(restored), false);
  const before = JSON.stringify(restored);
  R.completeStep(restored, 'feedback', now);
  assert.strictEqual(JSON.stringify(restored), before, 'completeStep은 원본을 바꾸지 않음');
});
test('isComplete는 우회 조작도 막음 (step=done이어도 재발화 없으면 미완료)', () => {
  const r = R.create('2026-09-25', plan(20));
  r.step = 'done'; r.output.done = r.feedback.done = true; r.feedback.items = [{}]; r.feedback.reutter = []; r.chunks.savedIds = ['a', 'b', 'c'];
  assert.strictEqual(R.isComplete(r), false);
});

console.log('오류 노트 · 워밍업');
test('같은 오류 누적(count), 최근 2주만, 반복 많은 순', () => {
  let list = [];
  const it = { original: 'I very like', issue_ko: 'x', improved: 'I really like it.' };
  list = E.add(list, it, now - 20 * DAY);
  list = E.add(list, { original: 'He go', issue_ko: 'y', improved: 'He goes.' }, now - 2 * DAY);
  list = E.add(list, { original: 'He go', issue_ko: 'y', improved: 'He goes.' }, now - DAY);
  assert.strictEqual(list.length, 2);
  const rec = E.recent(list, now, 14);
  assert.strictEqual(rec.length, 1); assert.strictEqual(rec[0].count, 2);
});
test('워밍업: 어제까지의 반복 오류 우선 → 없으면 어제 못 쓴 청크 → 없으면 null', () => {
  let list = E.add([], { original: 'He go', issue_ko: 'y', improved: 'He goes.' }, now - DAY);
  const w = E.pickWarmup(list, [{ id: 'c1', en: 'Chunk', example: 'Chunk ex.' }], now);
  assert.strictEqual(w.kind, 'error'); assert.strictEqual(w.script, 'He goes.');
  const w2 = E.pickWarmup([], [{ id: 'c1', en: 'Chunk', example: 'Chunk ex.' }], now);
  assert.strictEqual(w2.kind, 'chunk'); assert.strictEqual(w2.cardId, 'c1');
  assert.strictEqual(E.pickWarmup([], [], now), null);
  const todayOnly = E.add([], { original: 'a', issue_ko: 'b', improved: 'C.' }, now);
  assert.strictEqual(E.pickWarmup(todayOnly, [], now), null, '오늘 생긴 오류는 내일 워밍업');
});

console.log('스트릭 · 주간 통계');
const k = (d) => S.dayKey(now - d * DAY);
test('부드러운 스트릭: 빠진 날을 3분 워밍업(bridged)으로 메우면 이어짐', () => {
  const log = {}; log[k(0)] = { spokenSec: 30 }; log[k(2)] = { spokenSec: 60 }; log[k(3)] = { reviewCount: 3 };
  assert.strictEqual(D.streak(log, now), 1);
  log[k(1)] = { bridged: true };
  assert.strictEqual(D.streak(log, now), 4);
});
test('오늘 아직 안 했으면 어제까지 스트릭 유지', () => {
  const log = {}; log[k(1)] = { spokenSec: 10 }; log[k(2)] = { spokenSec: 10 };
  assert.strictEqual(D.streak(log, now), 2);
});
test('이번 주(월~일) 말한 시간·세션 합계', () => {
  const keys = D.weekKeys(now);
  assert.strictEqual(keys.length, 7);
  assert.strictEqual(new Date(D.weekStart(now)).getDay(), 1, '월요일 시작');
  const log = {}; log[keys[0]] = { spokenSec: 120, sessions: 1 }; log[keys[4]] = { spokenSec: 60, sessions: 2 }; log['2020-01-01'] = { spokenSec: 999 };
  const w = D.weekStats(log, now);
  assert.strictEqual(w.spokenSec, 180); assert.strictEqual(w.spokenMin, 3); assert.strictEqual(w.sessions, 3);
});

console.log('녹음 레벨 분석');
test('말한 길이와 1초 이상 멈춤 계산', () => {
  const lv = [].concat(Array(10).fill(0.001), Array(40).fill(0.1), Array(30).fill(0.002), Array(20).fill(0.1), Array(4).fill(0.002), Array(20).fill(0.1), Array(10).fill(0.001));
  const r = A.analyzeLevels(lv, 50);
  assert.strictEqual(r.voicedSec, 4); assert.strictEqual(r.pauses, 1); assert.strictEqual(r.longestPauseSec, 1.5); assert.strictEqual(r.durationSec, 6.7);
});
test('계속 말해도(바닥 소음이 높아도) 임계값 상한으로 말한 길이 인식', () => {
  const lv = Array(100).fill(0).map((_, i) => 0.06 + 0.04 * Math.sin(i));
  assert.ok(A.analyzeLevels(lv, 50).voicedSec > 3);
});
test('무음 → 0', () => { assert.strictEqual(A.analyzeLevels(Array(40).fill(0.001), 50).voicedSec, 0); assert.strictEqual(A.analyzeLevels([], 50).voicedSec, 0); });

console.log('텍스트 · 콘텐츠 무결성');
test('빈칸 말하기 힌트: 첫 글자만', () => { assert.strictEqual(T.cloze("Let's get started."), "L__'_ g__ s______."); });
global.window = {}; require('../data.js'); require('../content.js');
const C = window.SPEAK_CONTENT;
test('시드 청크 100개: 4개 목표 태그 모두 포함', () => {
  assert.strictEqual(window.SPEAK_SEED.length, 100);
  const tags = new Set(); window.SPEAK_SEED.forEach(c => (window.SPEAK_CATEGORY_TAGS[c.category] || []).forEach(t => tags.add(t)));
  ['daily', 'work', 'travel', 'interview'].forEach(t => assert.ok(tags.has(t), t));
});
test('쉐도잉 클립 60개: PRD 10장 메타데이터, 10~20초, 힌트 키 유효', () => {
  assert.strictEqual(C.CLIPS.length, 60);
  const ids = new Set();
  C.CLIPS.forEach(c => {
    ['id', 'level', 'topic', 'duration_sec', 'script', 'focus', 'accent'].forEach(f => assert.ok(c[f], c.id + ' ' + f));
    assert.ok(c.duration_sec >= 10 && c.duration_sec <= 20, c.id + ' ' + c.duration_sec);
    assert.ok(!c.hint || C.HINTS[c.hint], c.id + ' hint');
    ids.add(c.id);
  });
  assert.strictEqual(ids.size, 60);
});
test('롤플레이 12개: PRD 필드, 전략 강제(빠른 말) 2개 이상', () => {
  assert.strictEqual(C.SCENARIOS.length, 12);
  C.SCENARIOS.forEach(s => ['id', 'title', 'goal', 'turns', 'must_use_chunk', 'success', 'opener', 'hint'].forEach(f => assert.ok(s[f] !== undefined, s.id + ' ' + f)));
  assert.ok(C.SCENARIOS.filter(s => s.fastTalk).length >= 2);
  assert.ok(C.SCENARIOS.every(s => s.repair_enabled === true));
});
test('4-3-2 주제 20개, 발음 힌트 20개', () => { assert.strictEqual(C.TOPICS.length, 20); assert.strictEqual(Object.keys(C.HINTS).length, 20); });

test('재생 볼륨 부스트: 1×는 원음, 작은 녹음은 정규화 후 증폭(상한 12배), 큰 녹음은 부스트만', () => {
  assert.strictEqual(A.playbackGain(0.1, 1), 1);
  assert.strictEqual(A.playbackGain(0.9, 2), 2);
  assert.strictEqual(A.playbackGain(0.45, 2), 4);
  assert.strictEqual(A.playbackGain(0.05, 3), 12);
  assert.strictEqual(A.playbackGain(0, 2), 2);
  assert.strictEqual(A.playbackGain(1.2, 1.5), 1.5);
});
console.log(`\n${passed} tests passed`);
