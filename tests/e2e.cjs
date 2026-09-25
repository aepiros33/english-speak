/* E2E: NODE_PATH=/tmp/pwtest/node_modules node tests/e2e.cjs  (서버: python3 -m http.server 8765) */
const { chromium } = require('playwright-core');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const SHOTS = path.join(__dirname, '..', 'screens');
const results = [];
function ok(name) { results.push('✓ ' + name); console.log('  ✓ ' + name); }

async function newPage(browser, initScript) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', acceptDownloads: true });
  if (initScript) await ctx.addInitScript(initScript);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  return { ctx, page, errors };
}
async function seedReviewCard(page, id) {
  await page.evaluate((id) => {
    const c = SpeakApp.db.cards.find(x => x.id === id);
    const now = Date.now();
    c.srs = { state: 'review', step: 0, due: now - 60000, interval: 3, ease: 2.5, reps: 3, lapses: 0, lastReview: now - 3 * 86400000 };
    SpeakApp.save();
  }, id);
  await page.reload();
  await page.waitForSelector('#dueCount');
}
const txt = (page, sel) => page.locator(sel).first().innerText();

async function scenarioFallback(browser) {
  console.log('\n[A] 음성 인식 미지원(폴백) 경로');
  const { ctx, page, errors } = await newPage(browser, () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; });
  await page.goto(BASE);
  await page.waitForSelector('#dueCount');
  assert.strictEqual(await txt(page, '#newCount'), '5'); assert.strictEqual(await txt(page, '#dueCount'), '0');
  ok('홈 로드: 새 표현 5 / 복습 0');
  await seedReviewCard(page, 'dl05');
  assert.strictEqual(await txt(page, '#dueCount'), '1');
  ok('복습 카드 1개 준비 후 홈에 반영');

  await page.click('[data-act=start]');
  await page.waitForSelector('.ko-cue');
  assert.strictEqual(await page.evaluate(() => SpeakApp.currentId), 'dl05', '복습이 먼저');
  const body1 = await page.innerText('body');
  assert.ok(!body1.includes('How do you say that in English?'), '복습에서 영어가 먼저 보이면 안 됨');
  assert.ok(await page.isVisible('.notice'), '폴백 안내 표시');
  ok('복습 먼저, 한국어 단서만 표시 (영어 숨김) + 폴백 안내');
  await page.click('[data-act=fb-start]');
  await page.waitForTimeout(300);
  await page.click('[data-act=fb-done]');
  await page.waitForSelector('.grades');
  assert.strictEqual((await txt(page, '.en-big')).trim(), 'How do you say that in English?');
  assert.ok(/반응 시간/.test(await txt(page, '.latency')));
  assert.strictEqual(await page.locator('.grade').count(), 4);
  assert.strictEqual(await page.locator('.grade.suggested').count(), 1);
  ok('정답 공개: 영어 + 반응시간 + 4개 채점 버튼(추천 1개)');
  await page.click('.grade.g3');

  await page.waitForSelector('.step-badge:has-text("1/4")');
  const newId = await page.evaluate(() => SpeakApp.currentId);
  assert.strictEqual(newId, 'mt01');
  await page.click('[data-act=to-shadow]');
  for (let i = 0; i < 3; i++) await page.click('[data-act=shadow-count]');
  assert.strictEqual(await page.locator('.dot.on').count(), 3);
  await page.click('[data-act=to-recall]');
  await page.waitForSelector('.timer');
  assert.ok(!(await page.innerText('main')).includes('Let me make sure I understand this correctly.'));
  ok('새 카드: 듣기 → 섀도잉 3회 → 한국어 단서로 인출 (영어 숨김)');
  await page.waitForTimeout(400);
  await page.click('[data-act=fb-start]');
  await page.click('[data-act=fb-done]');
  await page.waitForSelector('.grades');
  await page.click('.grade.g3');
  await page.waitForSelector('#mineText');
  await page.fill('#mineText', 'Let me make sure I understand the new budget correctly.');
  await page.click('[data-act=mine-save]');
  ok('나만의 문장 저장');
  await page.waitForSelector('.step-badge');
  await page.click('[data-act=quit]');
  await page.waitForSelector('#sumTotal');
  assert.strictEqual(await txt(page, '#sumTotal'), '2');
  assert.ok(/초/.test(await txt(page, '#sumLat')));
  ok('세션 종료 → 요약 (채점 2개, 평균 반응시간 표시)');

  await page.click('[data-act=home]');
  await page.waitForSelector('#dueCount');
  const state = await page.evaluate(() => ({
    mt01: SpeakApp.db.cards.find(c => c.id === 'mt01'), dl05: SpeakApp.db.cards.find(c => c.id === 'dl05'),
    log: SpeakApp.db.log
  }));
  assert.strictEqual(state.mt01.srs.state, 'learning'); assert.strictEqual(state.mt01.srs.step, 1);
  assert.strictEqual(state.dl05.srs.state, 'review'); assert.ok(state.dl05.srs.interval >= 7, 'ivl ' + state.dl05.srs.interval);
  assert.ok(state.mt01.lat.length === 1 && state.dl05.lat.length === 1, '카드별 반응시간 기록');
  ok(`스케줄 반영: 새 카드 → learning(10분 단계), 복습 3일 → ${state.dl05.srs.interval}일; 반응시간 기록`);

  // 카드 관리
  await page.click('#tabbar a[data-tab=cards]');
  await page.waitForSelector('.card-item');
  assert.strictEqual(await page.locator('.card-item').count(), 40);
  await page.fill('#cardQ', 'circle back');
  assert.strictEqual(await page.locator('.card-item').count(), 1);
  await page.click('.card-item');
  await page.waitForSelector('#editForm');
  await page.fill('textarea[name=example]', "Let's circle back to that once we have the numbers.");
  await page.click('#editForm button[type=submit]');
  await page.waitForSelector('.card-item');
  await page.click('[data-act=card-new]');
  await page.waitForSelector('#editForm');
  await page.fill('textarea[name=en]', "I'll keep you posted.");
  await page.fill('textarea[name=ko]', '(진행 상황을 알려주겠다고 할 때) 진행되는 대로 계속 알려드릴게요');
  await page.fill('input[name=slot]', "I'll keep you posted on ___.");
  await page.click('#editForm button[type=submit]');
  await page.waitForSelector('.card-item');
  await page.fill('#cardQ', '');
  assert.strictEqual(await page.locator('.card-item').count(), 41);
  // 삭제
  await page.fill('#cardQ', 'keep you posted');
  await page.click('.card-item');
  await page.waitForSelector('[data-act=card-del]');
  await page.click('[data-act=card-del]');
  await page.waitForSelector('#cardList');
  await page.fill('#cardQ', '');
  assert.strictEqual(await page.locator('.card-item').count(), 40);
  await page.click('[data-act=card-new]');
  await page.fill('textarea[name=en]', "I'll keep you posted.");
  await page.fill('textarea[name=ko]', '(진행 상황 공유) 진행되는 대로 알려드릴게요');
  await page.click('#editForm button[type=submit]');
  await page.waitForSelector('.card-item');
  ok('카드 관리: 검색·수정·추가·삭제 (40 → 41 → 40 → 41)');

  // 설정
  await page.click('#tabbar a[data-tab=settings]');
  await page.waitForSelector('#setNew');
  await page.selectOption('#setNew', '3');
  await page.selectOption('select[data-set=ttsRate]', '0.8');
  await page.reload();
  await page.waitForSelector('#setNew');
  assert.strictEqual(await page.inputValue('#setNew'), '3');
  assert.strictEqual(await page.inputValue('select[data-set=ttsRate]'), '0.8');
  const persisted = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('speakapp.v1'));
    return { n: d.cards.length, mine: d.cards.find(c => c.id === 'mt01').mine, ex: d.cards.find(c => c.id === 'mt04').example, st: d.cards.find(c => c.id === 'mt01').srs.state };
  });
  assert.strictEqual(persisted.n, 41); assert.strictEqual(persisted.mine[0].text, 'Let me make sure I understand the new budget correctly.');
  assert.ok(persisted.ex.includes('once we have the numbers')); assert.strictEqual(persisted.st, 'learning');
  ok('새로고침 후 localStorage 유지: 설정·새 카드·수정·나의 문장·학습 상태');

  // 백업/복원
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=export]')]);
  const file = path.join('/tmp', await dl.suggestedFilename());
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(backup.cards.length, 41);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForSelector('#setNew');
  assert.strictEqual(await page.inputValue('#setNew'), '5', '지운 뒤 기본값');
  await page.setInputFiles('#importFile', file);
  await page.waitForSelector('#dueCount');
  const restored = await page.evaluate(() => ({ n: SpeakApp.db.cards.length, np: SpeakApp.db.settings.newPerDay }));
  assert.deepStrictEqual(restored, { n: 41, np: 3 });
  ok('JSON 내보내기 → 초기화 → 가져오기로 복원 (' + path.basename(file) + ')');

  // 홈 스크린샷 (진행 후)
  assert.strictEqual(await txt(page, '#newCount'), '2', '새 카드 3/일 - 오늘 1개 = 2');
  assert.ok((await txt(page, '.streak')).includes('1'));
  await page.waitForTimeout(2900); // 토스트 사라질 때까지
  await page.screenshot({ path: path.join(SHOTS, '01-home.png') });
  ok('홈: 스트릭 1일, 오늘 진행률, 새 표현 2 (설정 3 − 완료 1)');

  // 스피드 토크
  await page.click('[data-act=speed]');
  await page.waitForSelector('.topic-ko');
  assert.ok((await page.locator('.chunk').count()) >= 2, '오늘의 표현 칩');
  for (let r = 0; r < 3; r++) {
    await page.click('[data-act=speed-go]');
    await page.waitForSelector('#ringT');
    await page.waitForTimeout(1200);
    const t = await txt(page, '#ringT');
    assert.ok(['0:59', '0:58', '0:44', '0:43', '0:29', '0:28'].includes(t), 'countdown ' + t);
    await page.click('[data-act=speed-stop]');
  }
  await page.waitForSelector('text=수고했어요');
  ok('스피드 토크 60/45/30초 3라운드 + 완료 요약');

  // 왜 페이지
  await page.goto(BASE + '#/why');
  await page.waitForSelector('.why');
  assert.strictEqual(await page.locator('.why').count(), 9);
  await page.screenshot({ path: path.join(SHOTS, '04-why.png') });
  await page.screenshot({ path: path.join(SHOTS, '04-why-full.png'), fullPage: true });
  ok('‘왜 이렇게 하나요?’ 9개 원리');

  // 서비스 워커
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; });
  assert.ok(sw); ok('서비스 워커 등록');
  assert.deepStrictEqual(errors, [], errors.join('\n'));
  ok('JS 오류 0건 (폴백 경로)');
  await ctx.close();
}

async function scenarioMock(browser) {
  console.log('\n[B] 음성 인식 모의(Mock) 경로 — 발화 비교/추천 등급');
  const { ctx, page, errors } = await newPage(browser, () => {
    delete window.webkitSpeechRecognition;
    window.__say = null;
    window.SpeechRecognition = class {
      constructor() { this.lang = ''; this.continuous = false; }
      start() {
        const say = typeof window.__say === 'function' ? window.__say() : (window.__say || '');
        setTimeout(() => { this.onstart && this.onstart(); }, 30);
        setTimeout(() => { this.onspeechstart && this.onspeechstart(); }, 500);
        setTimeout(() => {
          if (say) {
            const alt = { transcript: say, confidence: 0.9 };
            const res = [alt]; res.isFinal = true;
            this.onresult && this.onresult({ resultIndex: 0, results: [res] });
          } else this.onerror && this.onerror({ error: 'no-speech' });
          this.onend && this.onend();
        }, 900);
      }
      stop() {} abort() {}
    };
  });
  await page.goto(BASE);
  await page.waitForSelector('#dueCount');
  await seedReviewCard(page, 'mt03');
  await page.click('[data-act=start]');
  await page.waitForSelector('[data-act=mic]');
  assert.strictEqual(await page.locator('.notice').count(), 0, '인식 가능 시 폴백 안내 없음');
  await page.evaluate(() => { window.__say = 'could you walk through'; });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, '05-review-recall.png') });
  await page.click('[data-act=mic]');
  await page.waitForSelector('.grades');
  const okW = await page.locator('.en-big .w.ok').count(), missW = await page.locator('.en-big .w.miss').count();
  assert.ok(okW === 4 && missW === 2, `ok ${okW} miss ${missW}`);
  assert.ok((await txt(page, '.sim')).includes('67%'));
  assert.ok((await txt(page, '.grade.suggested')).includes('어려움'));
  await page.screenshot({ path: path.join(SHOTS, '02-review-reveal.png') });
  ok('발화 비교: 맞은 단어 초록/빠진 단어 회색, 67%, 추천=어려움');
  await page.click('.grade.g2');

  await page.waitForSelector('[data-act=to-shadow]');
  await page.click('[data-act=to-shadow]');
  await page.click('[data-act=shadow-count]');
  await page.waitForSelector('.dot.on');
  await page.screenshot({ path: path.join(SHOTS, '03-new-shadowing.png') });
  await page.evaluate(() => { window.__say = 'let me make sure I understand this correctly'; });
  await page.click('[data-act=shadow-mic]');
  await page.waitForFunction(() => document.querySelectorAll('.dot.on').length === 2);
  await page.click('[data-act=shadow-count]');
  await page.click('[data-act=to-recall]');
  await page.waitForSelector('[data-act=mic]');
  await page.evaluate(() => { window.__say = "let me make sure i understand this correctly"; });
  await page.click('[data-act=mic]');
  await page.waitForSelector('.grades');
  assert.ok((await txt(page, '.sim')).includes('100%'));
  const sug = await txt(page, '.grade.suggested');
  assert.ok(/좋음|쉬움/.test(sug), sug);
  ok('섀도잉 마이크(선택) 카운트 + 인출 100% 일치 → 추천 ' + sug.split('\n').find(s => /좋음|쉬움/.test(s)));
  await page.click('.grade.g3');
  await page.waitForSelector('[data-act=mine-mic]');
  await page.evaluate(() => { window.__say = 'let me make sure I understand our Q4 plan correctly'; });
  await page.click('[data-act=mine-mic]');
  await page.waitForFunction(() => document.querySelector('#mineText') && document.querySelector('#mineText').value.includes('Q4'));
  await page.click('[data-act=mine-save]');
  const mine = await page.evaluate(() => SpeakApp.db.cards.find(c => c.id === 'mt01').mine.map(m => m.text));
  assert.deepStrictEqual(mine, ['let me make sure I understand our Q4 plan correctly']);
  ok('나만의 문장: 음성 받아쓰기 → 저장');
  // 느린 반응 → 어려움 추천 (정확해도)
  await page.waitForSelector('[data-act=to-shadow]');
  const id3 = await page.evaluate(() => SpeakApp.currentId);
  const en3 = await page.evaluate((id) => SpeakApp.db.cards.find(c => c.id === id).en, id3);
  await page.click('[data-act=to-shadow]');
  for (let i = 0; i < 3; i++) await page.click('[data-act=shadow-count]');
  await page.click('[data-act=to-recall]');
  await page.waitForSelector('[data-act=mic]');
  await page.evaluate((en) => { window.__say = en; }, en3);
  await page.waitForTimeout(3600);
  await page.click('[data-act=mic]');
  await page.waitForSelector('.grades');
  assert.ok((await txt(page, '.sim')).includes('100%'));
  assert.ok((await txt(page, '.latency')).includes('어려움'));
  assert.ok((await txt(page, '.grade.suggested')).includes('어려움'));
  ok('정확(100%)해도 반응 >3.5초 → 어려움 추천');
  assert.deepStrictEqual(errors, [], errors.join('\n'));
  ok('JS 오류 0건 (인식 경로)');
  await ctx.close();
}

async function scenarioNative(browser) {
  console.log('\n[C] 헤드리스 Chrome의 실제 webkitSpeechRecognition (마이크 없음) → 자동 폴백');
  const { ctx, page, errors } = await newPage(browser, null);
  await page.goto(BASE);
  await page.waitForSelector('#dueCount');
  const has = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  await page.click('[data-act=start]');
  await page.waitForSelector('[data-act=to-shadow]');
  await page.click('[data-act=to-shadow]');
  for (let i = 0; i < 3; i++) await page.click('[data-act=shadow-count]');
  await page.click('[data-act=to-recall]');
  if (has) {
    await page.waitForSelector('[data-act=mic]');
    await page.click('[data-act=mic]');
    await page.waitForSelector('[data-act=fb-start], .grades', { timeout: 8000 });
    const notice = await page.locator('.notice').allInnerTexts();
    ok('API 존재=' + has + ' → 시작 실패 감지 후 스스로 채점 모드 전환: ' + notice.join(' | ').slice(0, 120));
  } else {
    await page.waitForSelector('[data-act=fb-start]');
    ok('API 없음 → 폴백 버튼');
  }
  await page.click('[data-act=fb-start]');
  await page.click('[data-act=fb-done]');
  await page.waitForSelector('.grades');
  await page.click('.grade.g1');
  await page.waitForSelector('#mineText');
  await page.click('[data-act=mine-skip]');
  await page.waitForSelector('.step-badge');
  assert.deepStrictEqual(errors, [], errors.join('\n'));
  ok('JS 오류 0건 (실제 API 경로)');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    await scenarioFallback(browser);
    await scenarioMock(browser);
    await scenarioNative(browser);
    console.log(`\nE2E: ${results.length} checks passed`);
  } catch (e) {
    console.error('\nE2E FAILED:', e);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
