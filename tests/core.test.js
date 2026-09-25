/* node tests/core.test.js — 스케줄러·발화 비교·인터리빙 단위 테스트 (TZ=Asia/Seoul 권장) */
const assert = require('assert');
const { Scheduler: S, Text: T, Mix: M } = require('../core.js');
const MIN = S.MIN, DAY = S.DAY;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

// 기준 시각: 2026-09-25 13:00 local
const now = new Date(2026, 8, 25, 13, 0, 0).getTime();
const day4am = (y, m, d) => new Date(y, m, d, 4, 0, 0).getTime();

console.log('Scheduler');
test('studyDayStart: 13:00 → 같은 날 04:00, 02:00 → 전날 04:00', () => {
  assert.strictEqual(S.studyDayStart(now), day4am(2026, 8, 25));
  assert.strictEqual(S.studyDayStart(new Date(2026, 8, 26, 2, 0).getTime()), day4am(2026, 8, 25));
  assert.strictEqual(S.dayKey(new Date(2026, 8, 26, 2, 0).getTime()), '2026-09-25');
});
test('새 카드: 다시 → 1분 / 어려움 → 5.5분 / 좋음 → 10분 / 쉬움 → 4일', () => {
  const n = S.newSrs();
  let s = S.schedule(n, 1, now); assert.strictEqual(s.state, 'learning'); assert.strictEqual(s.due - now, 1 * MIN);
  s = S.schedule(n, 2, now); assert.strictEqual(s.due - now, 5.5 * MIN);
  s = S.schedule(n, 3, now); assert.strictEqual(s.state, 'learning'); assert.strictEqual(s.step, 1); assert.strictEqual(s.due - now, 10 * MIN);
  s = S.schedule(n, 4, now); assert.strictEqual(s.state, 'review'); assert.strictEqual(s.interval, 4); assert.strictEqual(s.due, day4am(2026, 8, 29));
  assert.deepStrictEqual(n, S.newSrs(), '원본 불변');
});
test('학습 단계 2회 좋음 → 졸업(1일, 다음날 04:00 복습)', () => {
  let s = S.schedule(S.newSrs(), 3, now);
  s = S.schedule(s, 3, now + 10 * MIN);
  assert.strictEqual(s.state, 'review'); assert.strictEqual(s.interval, 1);
  assert.strictEqual(s.due, day4am(2026, 8, 26));
  assert.strictEqual(S.isDue(s, day4am(2026, 8, 26) - 1), false);
  assert.strictEqual(S.isDue(s, day4am(2026, 8, 26) + 1), true);
});
test('학습 중 다시 → 1단계로 리셋', () => {
  let s = S.schedule(S.newSrs(), 3, now);
  s = S.schedule(s, 1, now + 10 * MIN);
  assert.strictEqual(s.state, 'learning'); assert.strictEqual(s.step, 0); assert.strictEqual(s.due, now + 11 * MIN);
});
test('복습: 간격 계산 (ivl=10, ease=2.5, 제때 복습)', () => {
  const base = { state: 'review', step: 0, interval: 10, ease: 2.5, reps: 5, lapses: 0, lastReview: now - 10 * DAY, due: now };
  const h = S.schedule(base, 2, now), g = S.schedule(base, 3, now), e = S.schedule(base, 4, now);
  assert.strictEqual(h.interval, 12); assert.strictEqual(h.ease, 2.35);
  assert.strictEqual(g.interval, 25); assert.strictEqual(g.ease, 2.5);
  assert.strictEqual(e.interval, 33); assert.ok(Math.abs(e.ease - 2.65) < 1e-9);
  assert.ok(h.interval < g.interval && g.interval < e.interval);
});
test('복습: 늦게 복습하면 보너스 (좋음: (ivl + late/2) × ease)', () => {
  const base = { state: 'review', interval: 10, ease: 2.5, reps: 5, lapses: 0, lastReview: now - 14 * DAY, due: now - 4 * DAY };
  assert.strictEqual(S.schedule(base, 3, now).interval, 30); // (10+2)*2.5
});
test('복습: 작은 간격에서도 어려움<좋음<쉬움 보장 (ivl=1)', () => {
  const base = { state: 'review', interval: 1, ease: 1.3, reps: 2, lapses: 3, lastReview: now - DAY };
  const [h, g, e] = [2, 3, 4].map(x => S.schedule(base, x, now).interval);
  assert.deepStrictEqual([h, g, e], [2, 3, 4]);
});
test('복습 잊음(다시) → 재학습 10분, ease −0.2, 간격 절반 → 좋음 시 복귀', () => {
  const base = { state: 'review', interval: 20, ease: 2.5, reps: 6, lapses: 0, lastReview: now - 20 * DAY };
  let s = S.schedule(base, 1, now);
  assert.strictEqual(s.state, 'relearning'); assert.strictEqual(s.lapses, 1); assert.strictEqual(s.ease, 2.3);
  assert.strictEqual(s.interval, 10); assert.strictEqual(s.due, now + 10 * MIN);
  s = S.schedule(s, 3, now + 10 * MIN);
  assert.strictEqual(s.state, 'review'); assert.strictEqual(s.interval, 10); assert.strictEqual(s.due, day4am(2026, 9, 5));
});
test('ease 하한 1.3, 최대 간격 365일', () => {
  let s = { state: 'review', interval: 3, ease: 1.35, reps: 9, lapses: 5, lastReview: now - 3 * DAY };
  s = S.schedule(s, 1, now); assert.strictEqual(s.ease, 1.3);
  const big = { state: 'review', interval: 300, ease: 2.8, reps: 20, lapses: 0, lastReview: now - 300 * DAY };
  assert.strictEqual(S.schedule(big, 4, now).interval, 365);
});
test('preview 라벨', () => {
  assert.deepStrictEqual(S.preview(S.newSrs(), now), { 1: '1분', 2: '6분', 3: '10분', 4: '4일' });
  const base = { state: 'review', interval: 10, ease: 2.5, lastReview: now - 10 * DAY };
  assert.deepStrictEqual(S.preview(base, now), { 1: '10분', 2: '12일', 3: '25일', 4: '1.1개월' });
});
test('잘못된 등급은 예외', () => { assert.throws(() => S.schedule(S.newSrs(), 5, now)); });
test('시뮬레이션: 매번 좋음 → 간격이 단조 증가', () => {
  let s = S.newSrs(), t = now, ivls = [];
  s = S.schedule(s, 3, t); t += 10 * MIN; s = S.schedule(s, 3, t);
  for (let i = 0; i < 6; i++) { t = s.due + 3600e3; s = S.schedule(s, 3, t); ivls.push(s.interval); }
  for (let i = 1; i < ivls.length; i++) assert.ok(ivls[i] > ivls[i - 1]);
  console.log('     intervals:', ivls.join(' → '));
});

console.log('Text');
test('정규화: 축약형·구두점·대소문자', () => {
  assert.deepStrictEqual(T.tokens("I'm not sure that'll work."), ['i', 'am', 'not', 'sure', 'that', 'will', 'work']);
  assert.deepStrictEqual(T.tokens("I can't — won't!"), ['i', 'can', 'not', 'will', 'not']);
  assert.deepStrictEqual(T.tokens('It’s OK, three'), ['it', 'is', 'okay', '3']);
});
test('compare: I am ↔ I\'m 동일 취급, 100%', () => {
  const r = T.compare("I'm with you on that.", 'I am with you on that');
  assert.strictEqual(r.score, 1); assert.ok(r.words.every(w => w.ok));
});
test('compare: 일부 누락 → 초록/회색 표시와 비율', () => {
  const r = T.compare('Could you walk me through it?', 'could you walk through');
  assert.strictEqual(Math.round(r.score * 100), 67);
  assert.deepStrictEqual(r.words.map(w => w.ok), [true, true, true, false, true, false]);
});
test('compare: 빈 발화 → 0', () => { assert.strictEqual(T.compare('That makes sense.', '').score, 0); });
test('containsChunk: 긴 발화 속 표현 탐지', () => {
  assert.ok(T.containsChunk('yeah so I have been swamped with work lately because of the launch', "I've been swamped with work lately."));
  assert.ok(!T.containsChunk('I went hiking with my family on Saturday', "I've been swamped with work lately."));
});
test('suggestGrade: 느리면 맞아도 어려움, 빠르고 정확하면 좋음/쉬움', () => {
  assert.strictEqual(T.suggestGrade({ sim: 1, latencyMs: 5000, thresholdSec: 3.5 }), 2);
  assert.strictEqual(T.suggestGrade({ sim: 1, latencyMs: 2000, thresholdSec: 3.5 }), 3);
  assert.strictEqual(T.suggestGrade({ sim: 1, latencyMs: 900, thresholdSec: 3.5 }), 4);
  assert.strictEqual(T.suggestGrade({ sim: 0.6, latencyMs: 900 }), 2);
  assert.strictEqual(T.suggestGrade({ sim: 0.3, latencyMs: 900 }), 1);
  assert.strictEqual(T.suggestGrade({ gaveUp: true }), 1);
  assert.strictEqual(T.suggestGrade({ sim: null, latencyMs: 4200, thresholdSec: 3.5 }), 2);
  assert.strictEqual(T.suggestGrade({ sim: null, latencyMs: 1200, thresholdSec: 3.5 }), 3);
});

console.log('Mix');
test('interleave: 가능한 경우 같은 카테고리 연속 없음', () => {
  const items = [];
  ['a', 'b', 'c'].forEach(k => { for (let i = 0; i < 4; i++) items.push({ k, i }); });
  for (let trial = 0; trial < 50; trial++) {
    const out = M.interleave(items, x => x.k);
    assert.strictEqual(out.length, 12);
    for (let i = 1; i < out.length; i++) assert.notStrictEqual(out[i].k, out[i - 1].k);
  }
});
test('roundRobin: 시드 도입 순서가 카테고리를 돌아가며', () => {
  global.window = {}; require('../data.js');
  const out = M.roundRobin(window.SPEAK_SEED, c => c.category, ['meeting', 'smalltalk', 'request', 'opinion', 'schedule', 'reaction', 'followup', 'daily', 'travel', 'interview']);
  assert.strictEqual(out.length, 100);
  assert.deepStrictEqual(out.slice(0, 5).map(c => c.category), ['meeting', 'smalltalk', 'request', 'opinion', 'schedule']);
  const ids = new Set(window.SPEAK_SEED.map(c => c.id)); assert.strictEqual(ids.size, 100, 'id 중복 없음');
  window.SPEAK_SEED.forEach(c => ['id', 'en', 'ko', 'example', 'slot', 'category'].forEach(f => assert.ok(c[f], c.id + ' missing ' + f)));
});
console.log(`\n${passed} tests passed`);
