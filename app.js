/* app.js — 말하기 연습 앱 (vanilla JS, 백엔드 없음, localStorage 저장) */
(function () {
  'use strict';
  var Core = window.SpeakCore;
  var S = Core.Scheduler, T = Core.Text, M = Core.Mix;
  var CATS = window.SPEAK_CATEGORIES;
  var CAT_ORDER = ['meeting', 'smalltalk', 'request', 'opinion', 'schedule', 'reaction', 'followup', 'daily'];
  var KEY = 'speakapp.v1';
  var APP_VERSION = '1.0.0';
  var LEARN_AHEAD_MS = 20 * S.MIN;
  var SESSION_TARGET_MS = 10 * S.MIN;
  var GRADE_LABEL = { 1: '다시', 2: '어려움', 3: '좋음', 4: '쉬움' };

  /* ======================= 저장소 ======================= */
  function defaultSettings() {
    return { newPerDay: 5, maxReviews: 100, ttsRate: 1.0, slowRate: 0.8, voiceURI: '', latencyThreshold: 3.5, autoPlay: true, useRecognition: true };
  }
  function freshDb() {
    return { app: 'speak-practice', version: 1, createdAt: Date.now(), settings: defaultSettings(), cards: [], deletedIds: [], log: {} };
  }
  function makeCard(src, order, custom) {
    return {
      id: src.id, en: src.en, ko: src.ko, example: src.example || '', slot: src.slot || '',
      category: src.category || 'custom', custom: !!custom, order: order,
      mine: [], lat: [], hist: [], srs: S.newSrs(), createdAt: Date.now()
    };
  }
  function migrate(d) {
    var ds = defaultSettings();
    d.settings = Object.assign(ds, d.settings || {});
    d.deletedIds = d.deletedIds || [];
    d.log = d.log || {};
    d.cards = d.cards || [];
    var have = {};
    var maxOrder = 0;
    d.cards.forEach(function (c) { have[c.id] = 1; maxOrder = Math.max(maxOrder, c.order || 0); });
    var seeds = M.roundRobin(window.SPEAK_SEED || [], function (c) { return c.category; }, CAT_ORDER);
    seeds.forEach(function (s) {
      if (!have[s.id] && d.deletedIds.indexOf(s.id) < 0) d.cards.push(makeCard(s, ++maxOrder, false));
    });
    d.cards.forEach(function (c) {
      c.srs = Object.assign(S.newSrs(), c.srs || {});
      c.mine = c.mine || []; c.lat = c.lat || []; c.hist = c.hist || [];
    });
    d.seedVersion = window.SPEAK_SEED_VERSION || 1;
    return d;
  }
  function load() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
    if (!d || !Array.isArray(d.cards)) d = freshDb();
    return migrate(d);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('저장에 실패했어요. 설정에서 백업을 먼저 받아두세요.'); }
  }
  var db = load();
  save();

  function card(id) { for (var i = 0; i < db.cards.length; i++) if (db.cards[i].id === id) return db.cards[i]; return null; }
  function todayKey() { return S.dayKey(Date.now()); }
  function todayLog() {
    var k = todayKey();
    if (!db.log[k]) db.log[k] = { newCount: 0, reviewCount: 0, ms: 0, lat: [], cardIds: [], speed: 0 };
    return db.log[k];
  }
  function isActive(k) { var l = db.log[k]; return !!l && (l.newCount + l.reviewCount + (l.speed || 0)) > 0; }
  function streak() {
    var t = S.studyDayStart(Date.now()), n = 0;
    if (!isActive(S.dayKey(t))) t = S.addDays(t, -1);
    while (isActive(S.dayKey(t))) { n++; t = S.addDays(t, -1); }
    return n;
  }
  function counts() {
    var now = Date.now(), lg = todayLog(), st = db.settings;
    var dueAll = 0, newAvail = 0, later = 0;
    var eod = S.addDays(S.studyDayStart(now), 1);
    db.cards.forEach(function (c) {
      if (c.srs.state === 'new') newAvail++;
      else if (c.srs.due <= now) dueAll++;
      else if (c.srs.due < eod) later++;
    });
    return {
      due: Math.min(dueAll, Math.max(0, st.maxReviews - lg.reviewCount)),
      dueAll: dueAll,
      newLeft: Math.min(newAvail, Math.max(0, st.newPerDay - lg.newCount)),
      later: later,
      done: lg.newCount + lg.reviewCount
    };
  }
  function schedOpts() { return { dayStartHour: 4 }; }

  /* ======================= 유틸 ======================= */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function sec(ms) { return (ms / 1000).toFixed(1); }
  function mmss(ms) { var s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* noop */ } }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function dueLabel(c) {
    if (c.srs.state === 'new') return '새 카드';
    var d = c.srs.due - Date.now();
    if (d <= 0) return '지금 복습';
    if (c.srs.state !== 'review') return S.formatInterval(d) + ' 후';
    var days = Math.round((S.studyDayStart(c.srs.due) - S.studyDayStart(Date.now())) / S.DAY);
    return days <= 0 ? '오늘' : days === 1 ? '내일' : days + '일 후';
  }
  var STATE_LABEL = { 'new': '새 카드', learning: '학습 중', relearning: '재학습', review: '복습' };

  /* ======================= 음성 합성 (TTS) ======================= */
  var hasTTS = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  var voices = [];
  function loadVoices() {
    if (!hasTTS) return;
    try { voices = window.speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); }); } catch (e) { voices = []; }
  }
  if (hasTTS) {
    loadVoices();
    try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { window.speechSynthesis.onvoiceschanged = loadVoices; }
  }
  function pickVoice() {
    if (!voices.length) loadVoices();
    if (db.settings.voiceURI) {
      var chosen = voices.filter(function (v) { return v.voiceURI === db.settings.voiceURI; })[0];
      if (chosen) return chosen;
    }
    var us = voices.filter(function (v) { return /en[-_]US/i.test(v.lang); });
    var prefs = ['Google US English', 'Samantha', 'Aria', 'Jenny', 'Ava', 'Allison', 'Alex'];
    for (var i = 0; i < prefs.length; i++) {
      var m = us.filter(function (v) { return v.name.indexOf(prefs[i]) >= 0; })[0];
      if (m) return m;
    }
    return us[0] || voices[0] || null;
  }
  function speak(text, rate) {
    if (!hasTTS) { toast('이 브라우저는 음성 재생을 지원하지 않아요'); return Promise.resolve(); }
    return new Promise(function (resolve) {
      var done = false;
      function fin() { if (!done) { done = true; resolve(); } }
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        var v = pickVoice();
        if (v) u.voice = v;
        u.rate = rate || db.settings.ttsRate;
        u.onend = fin; u.onerror = fin;
        window.speechSynthesis.speak(u);
        setTimeout(fin, 4000 + text.length * 150);
      } catch (e) { fin(); }
    });
  }
  function stopSpeaking() { if (hasTTS) try { window.speechSynthesis.cancel(); } catch (e) { /* noop */ } }

  /* ======================= 음성 인식 ======================= */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recogBroken = false;
  var recogBrokenReason = '';
  var activeRec = null;
  function recogAvailable() { return !!SR && db.settings.useRecognition && !recogBroken; }
  function recogStatusText() {
    if (!SR) return '이 브라우저는 음성 인식을 지원하지 않아요. 소리 내어 말한 뒤 스스로 채점하세요. (Android Chrome · iPhone Safari 권장)';
    if (!db.settings.useRecognition) return '음성 인식이 꺼져 있어요(설정). 소리 내어 말한 뒤 스스로 채점하세요.';
    if (recogBroken) return '음성 인식을 쓸 수 없어요' + (recogBrokenReason ? ' (' + recogBrokenReason + ')' : '') + '. 소리 내어 말한 뒤 스스로 채점하세요.';
    return '';
  }
  function markBroken(reason) {
    recogBroken = true;
    recogBrokenReason = reason;
  }
  /**
   * 음성 인식 시작. h: {onSpeechStart, onResult(final, interim), onEnd(final, alts), onError(code)}
   */
  function listen(h, continuous) {
    abortListening();
    stopSpeaking();
    var r;
    try { r = new SR(); } catch (e) { markBroken('초기화 실패'); h.onError && h.onError('init'); h.onEnd && h.onEnd('', []); return null; }
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = !!continuous;
    r.maxAlternatives = 3;
    var finalText = '', alts = [], started = false, ended = false;
    var watchdog = setTimeout(function () {
      if (!started && !ended) {
        markBroken('마이크가 시작되지 않음');
        try { r.abort(); } catch (e) { /* noop */ }
        finish(false);
        h.onError && h.onError('timeout');
      }
    }, 4000);
    function finish(silent) {
      if (ended) return;
      ended = true;
      clearTimeout(watchdog);
      if (activeRec === r) activeRec = null;
      if (!silent) h.onEnd && h.onEnd(finalText.trim(), alts);
    }
    r._kill = function () { finish(true); };
    r.onstart = r.onaudiostart = function () { started = true; };
    r.onspeechstart = function () { started = true; h.onSpeechStart && h.onSpeechStart(); };
    r.onresult = function (e) {
      started = true;
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i];
        if (res.isFinal) {
          finalText += ' ' + res[0].transcript;
          alts = [];
          for (var a = 0; a < res.length; a++) alts.push(res[a].transcript);
        } else interim += res[0].transcript;
      }
      h.onResult && h.onResult(finalText.trim(), interim.trim());
    };
    r.onerror = function (e) {
      var code = e && e.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') markBroken('마이크 권한 없음');
      else if (code === 'audio-capture') markBroken('마이크를 찾을 수 없음');
      else if (code === 'network') markBroken('네트워크 필요');
      else if (code === 'language-not-supported') markBroken('영어 인식 미지원');
      h.onError && h.onError(code);
    };
    r.onend = function () { finish(false); };
    try { r.start(); activeRec = r; }
    catch (e) { markBroken('시작 실패'); finish(false); h.onError && h.onError('start'); }
    return r;
  }
  function stopListening() {
    if (activeRec) { try { activeRec.stop(); } catch (e) { /* noop */ } }
  }
  function abortListening() {
    if (activeRec) {
      var r = activeRec; activeRec = null;
      try { if (r._kill) r._kill(); r.onend = null; r.onresult = null; r.onerror = null; r.abort(); } catch (e) { /* noop */ }
    }
  }

  /* ======================= 라우팅 ======================= */
  var screenTimers = [];
  function every(fn, ms) { screenTimers.push(setInterval(fn, ms)); }
  function clearTimers() {
    screenTimers.forEach(clearInterval);
    screenTimers = [];
  }
  function cleanupScreen() {
    clearTimers();
    abortListening();
    stopSpeaking();
  }
  var app = null;
  function go(name, param) {
    var h = '#/' + name + (param ? '/' + encodeURIComponent(param) : '');
    if (location.hash === h) route(); else location.hash = h;
  }
  function route() {
    cleanupScreen();
    var parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/');
    var name = parts[0] || 'home', param = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (name === 'session' && !session) name = 'home';
    if (name === 'summary' && !lastSummary) name = 'home';
    if (name !== 'session' && session) { finishSession(true); }
    if (name !== 'speed') speed = null;
    var fn = ROUTES[name] || renderHome;
    document.body.dataset.screen = name;
    var immersive = name === 'session' || name === 'speed';
    $('#tabbar').hidden = immersive;
    document.querySelectorAll('#tabbar a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === (name === 'edit' ? 'cards' : name));
    });
    fn(param);
    window.scrollTo(0, 0);
  }
  function render(html) { app.innerHTML = html; }

  /* ======================= 홈 ======================= */
  function renderHome() {
    var c = counts(), lg = todayLog(), st = streak();
    var planned = c.done + c.due + c.newLeft;
    var pct = planned ? Math.round(c.done / planned * 100) : 100;
    var nothing = c.due === 0 && c.newLeft === 0;
    var d = new Date();
    var dateStr = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + '일월화수목금토'[d.getDay()] + '요일';
    var tip;
    if (nothing && c.done > 0) tip = '💤 오늘 몫은 끝! 자는 동안 기억이 단단해져요. 더 몰아서 하기보다 내일 복습으로 이어가세요.';
    else if (nothing) tip = '오늘은 복습할 카드가 없어요. 스피드 토크로 입을 풀어보세요.';
    else tip = '💡 영어를 보기 전에 한국어만 보고 먼저 소리 내어 말해보세요. 떠올리는 노력이 기억을 만들어요.';
    render(
      '<header class="top"><div><div class="muted small">' + esc(dateStr) + '</div><h1>오늘의 말하기</h1></div>' +
      '<div class="streak" title="연속 학습일">🔥 <b>' + st + '</b>일</div></header>' +
      '<section class="card today">' +
        '<div class="stat-row">' +
          '<div class="stat"><div class="num" id="dueCount">' + c.due + '</div><div class="lbl">복습</div></div>' +
          '<div class="stat"><div class="num" id="newCount">' + c.newLeft + '</div><div class="lbl">새 표현</div></div>' +
          '<div class="stat"><div class="num">' + c.done + '</div><div class="lbl">오늘 완료</div></div>' +
        '</div>' +
        '<div class="progress" aria-label="오늘 진행률"><span style="width:' + pct + '%"></span></div>' +
        '<div class="muted small center">' + (planned ? '오늘 목표의 ' + pct + '% · 약 10분 코스' : '카드를 추가해보세요') +
        (c.later ? ' · 오늘 중 다시 볼 카드 ' + c.later + '개' : '') + '</div>' +
        '<button class="btn primary big" data-act="start" ' + (nothing ? 'disabled' : '') + '>' + (nothing ? '오늘 할 카드 없음' : (c.done ? '이어서 하기' : '시작하기')) + '</button>' +
      '</section>' +
      '<button class="btn secondary big" data-act="speed">⏱️ 스피드 토크 (60·45·30초)</button>' +
      '<p class="tip">' + tip + '</p>' +
      (lg.lat.length ? '<p class="muted small center">오늘 평균 반응시간 ' + sec(avg(lg.lat)) + '초</p>' : '')
    );
  }

  /* ======================= 세션 ======================= */
  var session = null, lastSummary = null;
  function startSession() {
    var now = Date.now(), lg = todayLog(), st = db.settings;
    var reviewCap = Math.max(0, st.maxReviews - lg.reviewCount);
    var due = db.cards.filter(function (c) { return c.srs.state !== 'new' && c.srs.due <= now; })
      .sort(function (a, b) { return a.srs.due - b.srs.due; }).slice(0, reviewCap);
    var newCap = Math.max(0, st.newPerDay - lg.newCount);
    var news = db.cards.filter(function (c) { return c.srs.state === 'new'; })
      .sort(function (a, b) { return a.order - b.order; }).slice(0, newCap);
    var key = function (c) { return c.category; };
    var queue = M.interleave(due, key).concat(avoidAdjacent(news, key)).map(function (c) { return c.id; });
    if (!queue.length) { toast('지금 할 카드가 없어요'); return; }
    session = { startedAt: now, queue: queue, total: queue.length, pending: [], results: [], cur: null, warned10: false };
    nextCard();
    if (location.hash !== '#/session') history.pushState(null, '', '#/session');
    route();
    onCardEnter();
  }
  function avoidAdjacent(list, key) {
    var out = list.slice();
    for (var i = 1; i < out.length; i++) {
      if (key(out[i]) === key(out[i - 1])) {
        for (var j = i + 1; j < out.length; j++) {
          if (key(out[j]) !== key(out[i - 1])) { var t = out[i]; out[i] = out[j]; out[j] = t; break; }
        }
      }
    }
    return out;
  }
  function nextCard() {
    var now = Date.now();
    session.pending.sort(function (a, b) { return a.due - b.due; });
    var prevId = session.cur && session.cur.id;
    var pick = null, early = false, fromQueue = false;
    if (session.pending.length && session.pending[0].due <= now && !(session.pending[0].id === prevId && session.queue.length)) {
      pick = session.pending.shift().id;
    } else if (session.queue.length) {
      pick = session.queue.shift(); fromQueue = true;
    } else if (session.pending.length && session.pending[0].due - now <= LEARN_AHEAD_MS) {
      pick = session.pending.shift().id; early = true;
    }
    if (!pick) { session.cur = null; return false; }
    var c = card(pick);
    if (!c) return nextCard();
    var isNew = c.srs.state === 'new';
    session.cur = {
      id: pick, kind: isNew ? 'new' : 'review', fromQueue: fromQueue, early: early,
      phase: isNew ? 'listen' : 'recall', shadowCount: 0,
      cueAt: 0, latency: null, transcript: '', interim: '', sim: null, gaveUp: false, listening: false,
      fallbackSpeaking: false, msg: ''
    };
    return true;
  }
  function remainingCount() { return session.queue.length + session.pending.length + (session.cur ? 1 : 0); }

  function sessionHeader(badge) {
    var done = session.results.length, left = remainingCount();
    var pct = Math.round(done / Math.max(1, done + left) * 100);
    return '<header class="sess-top">' +
      '<button class="icon-btn" data-act="quit" aria-label="세션 종료">✕</button>' +
      '<div class="sess-prog"><div class="progress thin"><span style="width:' + pct + '%"></span></div>' +
      '<div class="muted small">' + badge + ' · 남은 카드 ' + left + '</div></div>' +
      '<div class="sess-time muted small" id="sessTime">' + mmss(Date.now() - session.startedAt) + '</div>' +
      '</header>';
  }
  function catChip(c) { return '<span class="chip">' + esc(CATS[c.category] || c.category) + '</span>'; }
  function ttsButtons(extra) {
    return '<div class="row gap">' +
      '<button class="btn ghost" data-act="tts">🔊 듣기</button>' +
      '<button class="btn ghost" data-act="tts-slow">🐢 천천히</button>' + (extra || '') + '</div>';
  }

  function renderSession() {
    if (!session) return go('home');
    if (!session.cur) return finishSession();
    var cur = session.cur, c = card(cur.id);
    var html = '';
    if (cur.phase === 'listen') html = phaseListen(c);
    else if (cur.phase === 'shadow') html = phaseShadow(c, cur);
    else if (cur.phase === 'recall') html = phaseRecall(c, cur);
    else if (cur.phase === 'reveal') html = phaseReveal(c, cur);
    else if (cur.phase === 'mine') html = phaseMine(c, cur);
    clearTimers();
    render(html);
    every(function () {
      var el = $('#sessTime');
      if (el && session) {
        var el2 = Date.now() - session.startedAt;
        el.textContent = mmss(el2);
        if (el2 > SESSION_TARGET_MS && !session.warned10) {
          session.warned10 = true;
          toast('10분이 지났어요. 여기서 멈춰도 충분해요 (✕로 종료)');
        }
      }
    }, 1000);
    if (cur.phase === 'recall') startRecallTimer();
  }

  /* --- 새 카드 1단계: 듣기 --- */
  function phaseListen(c) {
    return sessionHeader('새 표현') +
      '<main class="stage">' +
        '<div class="step-badge">새 표현 · 1/4 듣기 ' + catChip(c) + '</div>' +
        '<div class="ko-cue small-cue">' + esc(c.ko) + '</div>' +
        '<div class="en-big" id="enText">' + esc(c.en) + '</div>' +
        '<div class="example">예) ' + esc(c.example) + '</div>' +
        ttsButtons() +
        '<p class="muted small">의미를 떠올리며 2~3번 들어보세요. 덩어리째(청크) 소리로 기억하는 게 목표예요.</p>' +
      '</main>' +
      '<footer class="actions"><button class="btn primary big" data-act="to-shadow">따라 말하기 →</button></footer>';
  }
  /* --- 새 카드 2단계: 섀도잉 3회 --- */
  function phaseShadow(c, cur) {
    var dots = '';
    for (var i = 0; i < 3; i++) dots += '<span class="dot' + (i < cur.shadowCount ? ' on' : '') + '"></span>';
    var doneAll = cur.shadowCount >= 3;
    var mic = recogAvailable()
      ? '<button class="btn ghost" data-act="shadow-mic">' + (cur.listening ? '⏹ 듣는 중…' : '🎤 마이크로 확인(선택)') + '</button>' : '';
    var fb = cur.transcript ? renderMatch(c.en, cur.transcript) : '';
    return sessionHeader('새 표현') +
      '<main class="stage">' +
        '<div class="step-badge">새 표현 · 2/4 섀도잉 ' + catChip(c) + '</div>' +
        '<div class="en-big">' + esc(c.en) + '</div>' +
        '<p class="muted">듣자마자 그림자처럼 바로 따라 말하세요. 억양·리듬·연음까지 흉내 내기.</p>' +
        '<div class="dots" aria-label="섀도잉 횟수">' + dots + '</div>' +
        ttsButtons(mic) +
        '<div id="shadowFb">' + fb + '</div>' +
      '</main>' +
      '<footer class="actions">' +
        (doneAll
          ? '<button class="btn primary big" data-act="to-recall">기억해서 말하기 →</button>'
          : '<button class="btn primary big" data-act="shadow-count" id="shadowBtn">🗣️ 따라 말했어요 (' + (cur.shadowCount + 1) + '/3)</button>') +
      '</footer>';
  }
  /* --- 인출: 한국어 단서 → 영어로 말하기 --- */
  function phaseRecall(c, cur) {
    var badge = cur.kind === 'new' ? '새 표현 · 3/4 기억해서 말하기' : (c.srs.state === 'review' ? '복습' : '다시 확인');
    var notice = recogAvailable() ? '' : '<div class="notice">🔇 ' + esc(recogStatusText()) + '</div>';
    var mainBtn;
    if (recogAvailable()) {
      mainBtn = '<button class="mic' + (cur.listening ? ' listening' : '') + '" data-act="mic" id="micBtn" aria-label="말하기">' +
        '<span class="mic-ico">' + (cur.listening ? '⏹' : '🎤') + '</span></button>' +
        '<div class="mic-lbl">' + (cur.listening ? '듣는 중… 다 말하면 탭' : '탭하고 영어로 말하기') + '</div>';
    } else if (!cur.fallbackSpeaking) {
      mainBtn = '<button class="mic" data-act="fb-start" id="micBtn" aria-label="말하기 시작"><span class="mic-ico">🗣️</span></button>' +
        '<div class="mic-lbl">말하기 시작할 때 탭</div>';
    } else {
      mainBtn = '<button class="btn primary big" data-act="fb-done" id="fbDone">✓ 다 말했어요 · 정답 보기</button>';
    }
    return sessionHeader(cur.kind === 'new' ? '새 표현' : '복습') +
      '<main class="stage recall">' +
        '<div class="step-badge">' + badge + ' ' + catChip(c) + (cur.early ? ' <span class="chip soft">조금 일찍</span>' : '') + '</div>' +
        '<div class="ko-cue">' + esc(c.ko) + '</div>' +
        '<div class="timer" id="timer">' + (cur.latency != null ? sec(cur.latency) : '0.0') + '<small>초</small></div>' +
        '<div class="muted small center">생각나는 순간 바로 소리 내어 말하세요</div>' +
        '<div class="mic-wrap">' + mainBtn + '</div>' +
        '<div class="interim" id="interim">' + esc(cur.interim || cur.transcript || '') + '</div>' +
        (cur.msg ? '<div class="notice warn">' + esc(cur.msg) + '</div>' : '') +
        notice +
      '</main>' +
      '<footer class="actions"><button class="btn link" data-act="giveup">모르겠어요 · 정답 보기</button></footer>';
  }
  function startRecallTimer() {
    var cur = session.cur;
    if (!cur.cueAt) cur.cueAt = Date.now();
    every(function () {
      var el = $('#timer');
      if (!el || !session || !session.cur || session.cur !== cur) return;
      var ms = cur.latency != null ? cur.latency : Date.now() - cur.cueAt;
      el.innerHTML = sec(ms) + '<small>초</small>';
      el.classList.toggle('slow', ms > db.settings.latencyThreshold * 1000);
    }, 100);
  }
  function renderMatch(target, transcript) {
    var r = T.compare(target, transcript);
    var words = r.words.map(function (w) {
      return '<span class="w ' + (w.ok ? 'ok' : (w.partial ? 'part' : 'miss')) + '">' + esc(w.raw) + '</span>';
    }).join(' ');
    return '<div class="match"><div class="match-words">' + words + '</div>' +
      '<div class="muted small">내가 말한 것: “' + esc(transcript) + '” · 일치 <b>' + Math.round(r.score * 100) + '%</b></div></div>';
  }
  /* --- 정답 공개 + 채점 --- */
  function phaseReveal(c, cur) {
    var thr = db.settings.latencyThreshold;
    var sug = T.suggestGrade({ sim: cur.sim, latencyMs: cur.latency, gaveUp: cur.gaveUp, thresholdSec: thr });
    cur.suggested = sug;
    var enHtml;
    if (cur.transcript) {
      var r = T.compare(c.en, cur.transcript);
      enHtml = '<div class="en-big">' + r.words.map(function (w) {
        return '<span class="w ' + (w.ok ? 'ok' : (w.partial ? 'part' : 'miss')) + '">' + esc(w.raw) + '</span>';
      }).join(' ') + '</div>' +
        '<div class="said">내가 말한 것: “' + esc(cur.transcript) + '”<span class="sim">일치 ' + Math.round(cur.sim * 100) + '%</span></div>';
    } else {
      enHtml = '<div class="en-big" id="enText">' + esc(c.en) + '</div>' +
        (cur.gaveUp ? '' : '<div class="said muted">내가 말한 것과 비교해 스스로 채점하세요.</div>');
    }
    var latHtml = '';
    if (cur.latency != null) {
      var slow = cur.latency > thr * 1000;
      latHtml = '<div class="latency ' + (slow ? 'slow' : 'fast') + '">반응 시간 <b>' + sec(cur.latency) + '초</b> ' +
        (slow ? '— 목표는 “결국 떠올리기”가 아니라 “바로 튀어나오기”. 맞았어도 <b>어려움</b>을 권해요.' : '✓ 빠르게 떠올렸어요') + '</div>';
    } else if (cur.gaveUp) {
      latHtml = '<div class="latency slow">괜찮아요. 모르는 걸 확인하는 것도 학습이에요. 정답을 소리 내어 한 번 말해보세요.</div>';
    }
    var pv = S.preview(c.srs, Date.now(), schedOpts());
    var grades = [1, 2, 3, 4].map(function (g) {
      return '<button class="grade g' + g + (g === sug ? ' suggested' : '') + '" data-act="grade" data-g="' + g + '">' +
        (g === sug ? '<span class="rec">추천</span>' : '') +
        '<span class="gl">' + GRADE_LABEL[g] + '</span><span class="gi">' + pv[g] + '</span></button>';
    }).join('');
    var mine = c.mine.length ? '<div class="mine-list"><div class="muted small">나의 문장</div>' +
      c.mine.slice(-2).map(function (m) { return '<div class="mine-item">“' + esc(m.text) + '”</div>'; }).join('') + '</div>' : '';
    return sessionHeader(cur.kind === 'new' ? '새 표현' : '복습') +
      '<main class="stage reveal">' +
        '<div class="step-badge">정답 확인 ' + catChip(c) + '</div>' +
        '<div class="ko-cue small-cue">' + esc(c.ko) + '</div>' +
        enHtml + ttsButtons() + latHtml +
        '<div class="example">예) ' + esc(c.example) + '</div>' + mine +
      '</main>' +
      '<footer class="actions"><div class="muted small center">얼마나 바로 나왔나요? 최종 판단은 내가 해요</div>' +
      '<div class="grades">' + grades + '</div></footer>';
  }
  /* --- 새 카드 4단계: 나만의 문장 --- */
  function phaseMine(c, cur) {
    var mic = recogAvailable()
      ? '<button class="btn secondary" data-act="mine-mic">' + (cur.listening ? '⏹ 듣는 중… (탭하면 끝)' : '🎤 말해서 받아쓰기') + '</button>' : '';
    return sessionHeader('새 표현') +
      '<main class="stage">' +
        '<div class="step-badge">새 표현 · 4/4 나만의 문장 만들기 ' + catChip(c) + '</div>' +
        '<div class="en-mid">' + esc(c.en) + '</div>' +
        '<div class="slot">' + esc(c.slot || c.en) + '</div>' +
        '<p>빈칸을 <b>내 일·내 생활</b>로 바꿔서 소리 내어 한 문장 말해보세요.<br><span class="muted small">예: 우리 팀, 이번 주 프로젝트, 팀장님, 출퇴근, 주말 계획…</span></p>' +
        mic +
        '<textarea id="mineText" rows="3" placeholder="말한 문장을 적어두면 이 카드에 ‘나의 문장’으로 저장돼요 (선택)">' + esc(cur.mineDraft || '') + '</textarea>' +
      '</main>' +
      '<footer class="actions row2">' +
        '<button class="btn ghost big" data-act="mine-skip">건너뛰기</button>' +
        '<button class="btn primary big" data-act="mine-save">저장하고 다음</button>' +
      '</footer>';
  }

  /* --- 세션 액션 --- */
  function markLatencyNow() {
    var cur = session.cur;
    if (cur.latency == null && cur.cueAt) cur.latency = Date.now() - cur.cueAt;
  }
  function recallMic() {
    var cur = session.cur, c = card(cur.id);
    if (cur.listening) { stopListening(); return; }
    cur.listening = true; cur.interim = ''; cur.msg = '';
    var tapAt = Date.now(), spoke = false;
    renderSession();
    listen({
      onSpeechStart: function () {
        if (!spoke) { spoke = true; if (cur.latency == null) cur.latency = Date.now() - cur.cueAt; }
      },
      onResult: function (fin, interim) {
        if (cur.latency == null) cur.latency = tapAt - cur.cueAt;
        cur.interim = (fin + ' ' + interim).trim();
        var el = $('#interim'); if (el) el.textContent = cur.interim;
      },
      onError: function (code) {
        if (code === 'no-speech') cur.msg = '소리가 안 들렸어요. 다시 탭해서 말하거나, 정답을 확인하세요.';
      },
      onEnd: function (fin, alts) {
        if (session && session.cur !== cur) return;
        cur.listening = false;
        var cands = [fin].concat(alts || []).filter(Boolean);
        if (cands.length) {
          var best = cands[0], bestScore = -1;
          cands.forEach(function (t) { var s = T.compare(c.en, t).score; if (s > bestScore) { bestScore = s; best = t; } });
          cur.transcript = best; cur.sim = bestScore;
          if (cur.latency == null) cur.latency = tapAt - cur.cueAt;
          toReveal();
        } else {
          if (recogBroken) cur.msg = '음성 인식을 쓸 수 없어 스스로 채점 모드로 바꿨어요.';
          renderSession();
        }
      }
    }, false);
  }
  function toReveal() {
    var cur = session.cur;
    cur.phase = 'reveal';
    cur.listening = false;
    abortListening();
    renderSession();
    if (db.settings.autoPlay) speak(card(cur.id).en);
  }
  function applyGrade(g) {
    var cur = session.cur, c = card(cur.id), now = Date.now(), lg = todayLog();
    var wasNew = c.srs.state === 'new', prevState = c.srs.state;
    c.srs = S.schedule(c.srs, g, now, schedOpts());
    if (cur.latency != null) {
      c.lat.push(cur.latency); if (c.lat.length > 20) c.lat.shift();
      lg.lat.push(cur.latency);
    }
    c.hist.push({ t: now, g: g, lat: cur.latency, sim: cur.sim == null ? null : Math.round(cur.sim * 100) / 100, from: prevState });
    if (c.hist.length > 40) c.hist.shift();
    if (wasNew) lg.newCount++;
    else if (cur.fromQueue) lg.reviewCount++;
    if (lg.cardIds.indexOf(c.id) < 0) lg.cardIds.push(c.id);
    session.results.push({ id: c.id, g: g, latency: cur.latency, sim: cur.sim, wasNew: wasNew, suggested: cur.suggested });
    session.pending = session.pending.filter(function (p) { return p.id !== c.id; });
    if (c.srs.state === 'learning' || c.srs.state === 'relearning') session.pending.push({ id: c.id, due: c.srs.due });
    save();
    if (wasNew && cur.kind === 'new') { cur.phase = 'mine'; renderSession(); }
    else advance();
  }
  function advance() {
    cleanupScreen();
    if (nextCard()) { renderSession(); onCardEnter(); }
    else finishSession();
  }
  function onCardEnter() {
    var cur = session && session.cur;
    if (cur && cur.phase === 'listen') speak(card(cur.id).en);
  }
  function finishSession(silent) {
    if (!session) return;
    var s = session;
    session = null;
    cleanupScreen();
    var lg = todayLog();
    var dur = Date.now() - s.startedAt;
    lg.ms += dur;
    save();
    var lats = s.results.filter(function (r) { return r.latency != null; }).map(function (r) { return r.latency; });
    var thr = db.settings.latencyThreshold * 1000;
    var dist = { 1: 0, 2: 0, 3: 0, 4: 0 };
    s.results.forEach(function (r) { dist[r.g]++; });
    lastSummary = {
      total: s.results.length,
      newCount: s.results.filter(function (r) { return r.wasNew; }).length,
      reviewCount: s.results.filter(function (r) { return !r.wasNew; }).length,
      avgLatency: avg(lats),
      fastRate: lats.length ? lats.filter(function (x) { return x <= thr; }).length / lats.length : null,
      dur: dur, dist: dist,
      pendingLeft: s.pending.length + s.queue.length + (s.cur ? 1 : 0)
    };
    if (!silent) go('summary');
  }
  function renderSummary() {
    var s = lastSummary;
    var bar = [1, 2, 3, 4].map(function (g) {
      return '<div class="dist-item g' + g + '"><b>' + s.dist[g] + '</b><span>' + GRADE_LABEL[g] + '</span></div>';
    }).join('');
    render(
      '<header class="top"><h1>세션 완료 🎉</h1></header>' +
      '<section class="card">' +
        '<div class="stat-row">' +
          '<div class="stat"><div class="num" id="sumTotal">' + s.total + '</div><div class="lbl">채점한 카드</div></div>' +
          '<div class="stat"><div class="num">' + s.reviewCount + '</div><div class="lbl">복습</div></div>' +
          '<div class="stat"><div class="num">' + s.newCount + '</div><div class="lbl">새 표현</div></div>' +
        '</div>' +
        '<div class="kv"><span>평균 반응시간</span><b id="sumLat">' + (s.avgLatency != null ? sec(s.avgLatency) + '초' : '–') + '</b></div>' +
        '<div class="kv"><span>' + db.settings.latencyThreshold + '초 안에 떠올린 비율</span><b>' + (s.fastRate != null ? Math.round(s.fastRate * 100) + '%' : '–') + '</b></div>' +
        '<div class="kv"><span>걸린 시간</span><b>' + mmss(s.dur) + '</b></div>' +
        '<div class="dist">' + bar + '</div>' +
      '</section>' +
      (s.pendingLeft ? '<p class="tip">⏳ 곧 다시 볼 카드가 ' + s.pendingLeft + '개 있어요. 10분쯤 뒤 홈에서 ‘이어서 하기’를 누르면 돼요.</p>' : '') +
      '<p class="tip">💤 자는 동안 뇌가 오늘 연습한 표현을 굳혀요. 더 몰아서 하기보다, 내일 복습으로 이어가는 게 효과적이에요.</p>' +
      '<button class="btn secondary big" data-act="speed">⏱️ 오늘 표현으로 스피드 토크</button>' +
      '<button class="btn primary big" data-act="home">홈으로</button>'
    );
  }

  /* ======================= 스피드 토크 (4/3/2 변형) ======================= */
  var TOPICS = [
    { ko: '내 업무 소개', en: 'What do you do at work? Describe a typical day.' },
    { ko: '지난 주말에 한 일', en: 'What did you do last weekend?' },
    { ko: '요즘 진행 중인 프로젝트', en: "Talk about a project you're working on right now." },
    { ko: '최근 회의에서 있었던 일', en: 'Describe a recent meeting. What was discussed and decided?' },
    { ko: '동료에게 부탁하기', en: 'Ask a coworker for help with something and explain why.' },
    { ko: '일정 다시 잡기', en: 'You need to reschedule a meeting. Explain why and suggest a new time.' },
    { ko: '추천하고 싶은 식당·음식', en: 'Recommend a restaurant or a dish you like.' },
    { ko: '스트레스 푸는 법', en: 'How do you deal with stress?' },
    { ko: '우리 팀 소개', en: 'Introduce your team to a new colleague.' },
    { ko: '업무 중 생긴 문제와 해결', en: 'Talk about a problem at work and how you solved it.' },
    { ko: '올해 목표', en: 'What are your goals for this year?' },
    { ko: '출퇴근길', en: 'Describe your commute.' }
  ];
  var ROUND_SECS = [60, 45, 30];
  var speed = null;
  function speedChunks() {
    var ids = todayLog().cardIds.slice(-6);
    var list = ids.map(card).filter(Boolean);
    if (list.length < 3) {
      var extra = db.cards.filter(function (c) { return c.srs.state !== 'new' && list.indexOf(c) < 0; })
        .sort(function (a, b) { return (b.srs.lastReview || 0) - (a.srs.lastReview || 0); });
      list = list.concat(extra.slice(0, 6 - list.length));
    }
    return list;
  }
  function renderSpeed() {
    if (!speed) speed = { topic: Math.floor(Math.random() * TOPICS.length), round: 0, phase: 'pick', endAt: 0, texts: ['', '', ''], used: {}, chunks: speedChunks() };
    var sp = speed, tp = TOPICS[sp.topic];
    var chips = sp.chunks.length ? sp.chunks.map(function (c) {
      return '<span class="chunk' + (sp.used[c.id] ? ' used' : '') + '" data-id="' + esc(c.id) + '">' + esc(c.en) + '</span>';
    }).join('') : '<span class="muted small">아직 학습한 표현이 없어요. 자유롭게 말해보세요.</span>';
    var head = '<header class="sess-top"><button class="icon-btn" data-act="home" aria-label="닫기">✕</button>' +
      '<div class="sess-prog"><b>스피드 토크</b><div class="muted small">같은 내용을 60 → 45 → 30초</div></div><div></div></header>';
    var topic = '<div class="topic"><div class="muted small">주제</div><div class="topic-ko">' + esc(tp.ko) + '</div><div class="topic-en">' + esc(tp.en) + '</div></div>';
    var chunkBox = '<div class="chunks"><div class="muted small">써보기 좋은 오늘의 표현</div>' + chips + '</div>';
    var notice = recogAvailable() ? '' : '<div class="notice">🔇 ' + esc(recogStatusText()) + ' (타이머만 사용)</div>';
    var body = '', foot = '';
    if (sp.phase === 'pick') {
      body = topic + '<button class="btn ghost" data-act="speed-topic">🔀 다른 주제</button>' + chunkBox +
        '<p class="muted small">1라운드 60초 동안 주제에 대해 말하고, 같은 내용을 45초, 30초로 점점 빠르고 매끄럽게 반복해요. 오늘의 표현을 끼워 넣어보세요.</p>' + notice;
      foot = '<button class="btn primary big" data-act="speed-go">1라운드 시작 (60초)</button>';
    } else if (sp.phase === 'running') {
      body = topic + '<div class="ring" id="ring"><div class="ring-in"><div class="ring-t" id="ringT">' + mmss(sp.endAt - Date.now()) + '</div>' +
        '<div class="muted small">라운드 ' + (sp.round + 1) + '/3</div></div></div>' + chunkBox +
        '<div class="interim long" id="speedText">' + esc(sp.texts[sp.round]) + '</div>' + notice;
      foot = '<button class="btn ghost big" data-act="speed-stop">이번 라운드 끝내기</button>';
    } else if (sp.phase === 'between') {
      body = topic + '<div class="card center"><div class="big-emoji">👏</div><b>라운드 ' + sp.round + ' 끝!</b>' +
        '<p>같은 내용을 이번엔 <b>' + ROUND_SECS[sp.round] + '초</b>에 말해보세요.<br>더 빠르게, 덜 멈추고, 표현은 그대로.</p></div>' + chunkBox;
      foot = '<button class="btn primary big" data-act="speed-go">' + (sp.round + 1) + '라운드 시작 (' + ROUND_SECS[sp.round] + '초)</button>';
    } else {
      var rows = ROUND_SECS.map(function (s, i) {
        var words = T.tokens(sp.texts[i]).length;
        return '<div class="kv"><span>' + (i + 1) + '라운드 (' + s + '초)</span><b>' + (sp.texts[i] ? words + '단어 · ' + Math.round(words / s * 60) + ' wpm' : '완료') + '</b></div>';
      }).join('');
      var usedN = Object.keys(sp.used).length;
      body = topic + '<section class="card"><b>수고했어요! 🎉</b>' + rows +
        (sp.chunks.length ? '<div class="kv"><span>사용한 오늘의 표현</span><b>' + usedN + '/' + sp.chunks.length + '</b></div>' : '') +
        '</section>' + chunkBox +
        '<p class="tip">시간이 줄어도 같은 내용을 말하려면 머릿속 ‘검색’ 없이 덩어리째 꺼내 써야 해요. 이게 유창성을 만드는 연습이에요.</p>';
      foot = '<button class="btn secondary big" data-act="speed-again">다른 주제로 한 번 더</button><button class="btn primary big" data-act="home">홈으로</button>';
    }
    clearTimers();
    render(head + '<main class="stage">' + body + '</main><footer class="actions">' + foot + '</footer>');
    if (sp.phase === 'running') every(speedTick, 200);
  }
  function speedTick() {
    var sp = speed;
    if (!sp || sp.phase !== 'running') return;
    var left = sp.endAt - Date.now();
    var total = ROUND_SECS[sp.round] * 1000;
    var t = $('#ringT'); if (t) t.textContent = mmss(left);
    var ring = $('#ring'); if (ring) ring.style.setProperty('--p', Math.max(0, Math.min(1, 1 - left / total)));
    if (left <= 0) endSpeedRound();
  }
  function startSpeedRound() {
    var sp = speed;
    sp.phase = 'running';
    sp.endAt = Date.now() + ROUND_SECS[sp.round] * 1000;
    sp.texts[sp.round] = '';
    renderSpeed();
    vibrate(80);
    if (recogAvailable()) speedListen(sp.round);
  }
  function speedListen(roundIdx) {
    var base = '';
    var runOnce = function () {
      listen({
        onResult: function (fin, interim) {
          if (!speed || speed.round !== roundIdx || speed.phase !== 'running') return;
          var full = (base + ' ' + fin).trim();
          speed.texts[roundIdx] = full;
          var el = $('#speedText'); if (el) el.textContent = (full + ' ' + interim).trim();
          speed.chunks.forEach(function (c) {
            if (!speed.used[c.id] && T.containsChunk(full + ' ' + interim, c.en)) {
              speed.used[c.id] = true;
              var chip = document.querySelector('.chunk[data-id="' + c.id + '"]');
              if (chip) chip.classList.add('used');
            }
          });
        },
        onEnd: function (fin) {
          base = (base + ' ' + fin).trim();
          if (speed && speed.round === roundIdx && speed.phase === 'running' && !recogBroken && Date.now() < speed.endAt - 500) {
            setTimeout(function () { if (speed && speed.phase === 'running' && speed.round === roundIdx) runOnce(); }, 150);
          }
        }
      }, true);
    };
    runOnce();
  }
  function endSpeedRound() {
    var sp = speed;
    if (!sp || sp.phase !== 'running') return;
    stopListening();
    vibrate([100, 60, 100]);
    sp.round++;
    if (sp.round >= 3) {
      sp.phase = 'done';
      todayLog().speed = (todayLog().speed || 0) + 1;
      save();
    } else sp.phase = 'between';
    cleanupScreen();
    renderSpeed();
  }

  /* ======================= 카드 관리 ======================= */
  var cardFilter = { q: '', cat: '' };
  function renderCards() {
    var list = db.cards.slice().sort(function (a, b) { return a.order - b.order; });
    var n = { 'new': 0, learning: 0, relearning: 0, review: 0 };
    db.cards.forEach(function (c) { n[c.srs.state]++; });
    var catOpts = '<option value="">전체 카테고리</option>' + Object.keys(CATS).map(function (k) {
      return '<option value="' + k + '"' + (cardFilter.cat === k ? ' selected' : '') + '>' + esc(CATS[k]) + '</option>';
    }).join('');
    render(
      '<header class="top"><h1>카드 관리</h1><button class="btn primary small-btn" data-act="card-new">＋ 새 카드</button></header>' +
      '<div class="muted small">전체 ' + db.cards.length + ' · 새 ' + n['new'] + ' · 학습 중 ' + (n.learning + n.relearning) + ' · 복습 ' + n.review + '</div>' +
      '<div class="filters"><input id="cardQ" type="search" placeholder="검색 (영어/한국어)" value="' + esc(cardFilter.q) + '">' +
      '<select id="cardCat">' + catOpts + '</select></div>' +
      '<ul class="card-list" id="cardList"></ul>'
    );
    var draw = function () {
      var q = cardFilter.q.trim().toLowerCase();
      var items = list.filter(function (c) {
        if (cardFilter.cat && c.category !== cardFilter.cat) return false;
        if (q && (c.en + ' ' + c.ko + ' ' + c.example).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      $('#cardList').innerHTML = items.length ? items.map(function (c) {
        var al = avg(c.lat.slice(-5));
        return '<li><button class="card-item" data-act="card-edit" data-id="' + esc(c.id) + '">' +
          '<div class="ci-en">' + esc(c.en) + '</div><div class="ci-ko">' + esc(c.ko) + '</div>' +
          '<div class="ci-meta"><span class="chip">' + esc(CATS[c.category] || c.category) + '</span>' +
          '<span class="st st-' + c.srs.state + '">' + STATE_LABEL[c.srs.state] + '</span>' +
          '<span>' + dueLabel(c) + '</span>' + (al != null ? '<span>⚡ ' + sec(al) + '초</span>' : '') +
          (c.mine.length ? '<span>✍️ ' + c.mine.length + '</span>' : '') + '</div></button></li>';
      }).join('') : '<li class="muted center">해당하는 카드가 없어요</li>';
    };
    draw();
    $('#cardQ').addEventListener('input', function (e) { cardFilter.q = e.target.value; draw(); });
    $('#cardCat').addEventListener('change', function (e) { cardFilter.cat = e.target.value; draw(); });
  }
  function renderEdit(id) {
    var isNew = !id || id === 'new';
    var c = isNew ? { id: '', en: '', ko: '', example: '', slot: '', category: 'custom', mine: [], srs: S.newSrs(), lat: [] } : card(id);
    if (!c) return go('cards');
    var catOpts = Object.keys(CATS).map(function (k) {
      return '<option value="' + k + '"' + (c.category === k ? ' selected' : '') + '>' + esc(CATS[k]) + '</option>';
    }).join('');
    var mine = (c.mine || []).map(function (m, i) {
      return '<li><span>“' + esc(m.text) + '”</span><button class="icon-btn sm" data-act="mine-del" data-i="' + i + '" aria-label="삭제">🗑</button></li>';
    }).join('');
    var info = isNew ? '' : '<div class="muted small">상태: ' + STATE_LABEL[c.srs.state] + ' · 다음: ' + dueLabel(c) +
      (c.srs.state === 'review' ? ' · 간격 ' + S.formatDays(c.srs.interval) : '') + ' · 복습 ' + c.srs.reps + '회 · 잊음 ' + c.srs.lapses + '회' +
      (c.lat.length ? ' · 평균 반응 ' + sec(avg(c.lat)) + '초' : '') + '</div>';
    render(
      '<header class="top"><button class="icon-btn" data-act="back-cards" aria-label="뒤로">←</button><h1>' + (isNew ? '새 카드' : '카드 수정') + '</h1><span></span></header>' +
      '<form id="editForm" class="form" data-id="' + esc(c.id) + '">' +
        '<label>영어 표현 (말할 문장) *<textarea name="en" rows="2" required placeholder="I was wondering if you could help me.">' + esc(c.en) + '</textarea></label>' +
        '<label>한국어 뜻 + 상황 단서 *<textarea name="ko" rows="2" required placeholder="(정중하게 부탁할 때) 혹시 도와주실 수 있을까 해서요">' + esc(c.ko) + '</textarea></label>' +
        '<label>예문<textarea name="example" rows="2">' + esc(c.example) + '</textarea></label>' +
        '<label>바꿔 말하기 힌트 (빈칸 ___)<input name="slot" value="' + esc(c.slot) + '" placeholder="I was wondering if you could ___."></label>' +
        '<label>카테고리<select name="category">' + catOpts + '</select></label>' +
        '<button type="button" class="btn ghost" data-act="edit-tts">🔊 영어 들어보기</button>' +
        (mine ? '<div class="muted small">나의 문장</div><ul class="mine-edit">' + mine + '</ul>' : '') +
        info +
        '<button type="submit" class="btn primary big">저장</button>' +
        (isNew ? '' : '<div class="row2"><button type="button" class="btn ghost" data-act="card-reset">학습 기록 초기화</button>' +
          '<button type="button" class="btn danger" data-act="card-del">삭제</button></div>') +
      '</form>'
    );
    $('#editForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, v = function (n) { return f.elements[n].value.trim(); };
      if (!v('en') || !v('ko')) { toast('영어 표현과 한국어 뜻은 꼭 필요해요'); return; }
      var target;
      if (isNew) {
        var maxOrder = db.cards.reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0);
        target = makeCard({ id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), en: v('en'), ko: v('ko') }, maxOrder + 1, true);
        db.cards.push(target);
      } else target = card(c.id);
      target.en = v('en'); target.ko = v('ko'); target.example = v('example'); target.slot = v('slot'); target.category = f.elements.category.value;
      save();
      toast('저장했어요');
      go('cards');
    });
  }

  /* ======================= 설정 ======================= */
  function renderSettings() {
    var st = db.settings;
    var opt = function (vals, cur, fmt) {
      return vals.map(function (x) { return '<option value="' + x + '"' + (Number(cur) === x ? ' selected' : '') + '>' + (fmt ? fmt(x) : x) + '</option>'; }).join('');
    };
    loadVoices();
    var voiceOpts = '<option value="">자동 (en-US 우선)</option>' + voices.map(function (v) {
      return '<option value="' + esc(v.voiceURI) + '"' + (st.voiceURI === v.voiceURI ? ' selected' : '') + '>' + esc(v.name + ' (' + v.lang + ')') + '</option>';
    }).join('');
    var recStatus = SR ? (recogBroken ? '⚠️ ' + recogBrokenReason : '✓ 지원됨') : '✕ 이 브라우저는 미지원';
    render(
      '<header class="top"><h1>설정</h1></header>' +
      '<section class="card form" id="settingsForm">' +
        '<h2>학습량</h2>' +
        '<label class="inline">하루 새 카드 수<select data-set="newPerDay" id="setNew">' + opt([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20], st.newPerDay) + '</select></label>' +
        '<label class="inline">하루 최대 복습 수<select data-set="maxReviews">' + opt([20, 30, 50, 75, 100, 150, 200, 300], st.maxReviews) + '</select></label>' +
        '<label class="inline">반응시간 기준 (초)<select data-set="latencyThreshold">' + opt([2, 2.5, 3, 3.5, 4, 5, 6], st.latencyThreshold, function (x) { return x + '초'; }) + '</select></label>' +
        '<p class="muted small">기준보다 늦게 말하기 시작하면 맞아도 ‘어려움’을 추천해요.</p>' +
      '</section>' +
      '<section class="card form">' +
        '<h2>소리</h2>' +
        '<label class="inline">기본 읽기 속도<select data-set="ttsRate">' + opt([0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2], st.ttsRate, function (x) { return x + '×'; }) + '</select></label>' +
        '<label class="inline">🐢 천천히 속도<select data-set="slowRate">' + opt([0.5, 0.6, 0.7, 0.8, 0.9], st.slowRate, function (x) { return x + '×'; }) + '</select></label>' +
        '<label>목소리<select data-set="voiceURI" data-str="1">' + voiceOpts + '</select></label>' +
        '<button class="btn ghost" data-act="tts-test">🔊 테스트: “Let me check my schedule and get back to you.”</button>' +
        '<label class="switch"><input type="checkbox" data-set="autoPlay"' + (st.autoPlay ? ' checked' : '') + '> 정답 공개 시 자동 재생</label>' +
        '<label class="switch"><input type="checkbox" data-set="useRecognition"' + (st.useRecognition ? ' checked' : '') + '> 음성 인식으로 확인 <span class="muted small">(' + recStatus + ')</span></label>' +
        (hasTTS ? '' : '<div class="notice">이 브라우저는 음성 재생(TTS)을 지원하지 않아요.</div>') +
      '</section>' +
      '<section class="card form">' +
        '<h2>백업 · 복원</h2>' +
        '<p class="muted small">모든 기록은 이 기기의 브라우저에만 저장돼요. 가끔 백업 파일을 받아두세요.</p>' +
        '<button class="btn secondary" data-act="export">⬇️ JSON 내보내기</button>' +
        '<button class="btn secondary" data-act="import">⬆️ JSON 가져오기</button>' +
        '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
        '<button class="btn danger" data-act="reset-all">모든 기록 지우기</button>' +
      '</section>' +
      '<p class="muted small center">말하기 연습 v' + APP_VERSION + ' · 데이터는 서버로 전송되지 않아요' +
      (SR ? ' (단, 음성 인식은 브라우저 제공 서비스가 처리할 수 있어요)' : '') + '</p>'
    );
    app.querySelectorAll('[data-set]').forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.getAttribute('data-set');
        var val = el.type === 'checkbox' ? el.checked : (el.hasAttribute('data-str') ? el.value : Number(el.value));
        db.settings[k] = val;
        if (k === 'useRecognition' && val) { recogBroken = false; recogBrokenReason = ''; }
        save();
        toast('저장했어요');
      });
    });
    $('#importFile').addEventListener('change', importFile);
  }
  function exportJson() {
    var data = JSON.stringify(db, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'speak-backup-' + todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('백업 파일을 내려받았어요');
  }
  function importFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d || !Array.isArray(d.cards) || !d.cards.every(function (c) { return c && c.id && typeof c.en === 'string'; })) throw new Error('형식 오류');
        if (!confirm('현재 기록을 백업 파일(카드 ' + d.cards.length + '개)로 바꿀까요?')) return;
        db = migrate(d);
        save();
        toast('복원했어요');
        go('home');
      } catch (err) { toast('가져오기 실패: 올바른 백업 파일이 아니에요'); }
      e.target.value = '';
    };
    rd.readAsText(f);
  }

  /* ======================= 왜 이렇게 하나요? ======================= */
  var WHY = [
    ['🧠 먼저 떠올리기 (인출 연습)', '다시 읽는 것보다 기억에서 꺼내보는 시험이 장기 기억을 훨씬 더 강하게 만들어요.', '앱에서는: 복습 때 항상 한국어 단서만 먼저 보여주고, 영어는 말한 뒤에 공개해요.', 'Roediger & Karpicke (2006), Psychological Science'],
    ['🗣️ 소리 내어 말하기 (산출 효과)', '조용히 읽은 것보다 소리 내어 말한 것이 더 잘 기억나요. 말하기 실력은 입으로 만들어져요.', '앱에서는: 마이크 버튼이 주 동작이고, 타이핑 대신 모든 단계를 소리 내어 해요.', 'MacLeod et al. (2010), J. Exp. Psych: Learning, Memory, and Cognition'],
    ['📅 간격 반복', '잊어갈 즈음 다시 떠올리면 기억이 오래가요. 한 번에 몰아서 하는 것보다 나눠서 할 때 효과가 커요.', '앱에서는: 다시/어려움/좋음/쉬움 채점으로 다음 복습일을 계산해요(SM-2 방식, 새 카드는 1분·10분 뒤 재확인).', 'Cepeda et al. (2006), Psychological Bulletin; Wozniak의 SM-2 알고리즘'],
    ['⚡ 자동화 (반응 속도)', '실제 대화에서는 ‘결국 떠오르는 것’으론 부족하고 ‘바로 튀어나와야’ 해요. 반복된 인출로 지식이 자동화돼요.', '앱에서는: 한국어가 뜨는 순간 타이머가 돌고, 기준(기본 3.5초)보다 늦으면 맞아도 ‘어려움’을 권해요. 카드별 반응시간을 기록해요.', 'DeKeyser (2007) 기술 습득 이론; Segalowitz (2010) Cognitive Bases of L2 Fluency'],
    ['🎧 섀도잉 + 덩어리 표현', '원어민의 유창함은 단어 조립이 아니라 통째로 저장된 표현 덩어리(청크)에서 나와요. 듣고 바로 따라 하면 소리와 리듬째 익혀져요.', '앱에서는: 새 표현은 듣기 → 3번 따라 말하기 → 바로 한국어 단서로 떠올리기 순서로 배워요.', 'Pawley & Syder (1983); Wray (2002) Formulaic Language; Kadota (2019) Shadowing'],
    ['✍️ 나만의 문장 (생성 효과 · 자기 참조)', '스스로 만들어낸 문장, 그리고 나와 관련된 내용은 훨씬 잘 기억돼요.', '앱에서는: 새 표현을 배운 뒤 빈칸 힌트로 내 일·생활에 맞게 바꿔 말하고, 원하면 카드에 저장해요.', 'Slamecka & Graf (1978); Rogers, Kuiper & Kirker (1977)'],
    ['🔀 섞어서 복습 (인터리빙)', '주제별로 몰아서 하는 것보다 섞어서 하면 당장은 어렵지만, 실제 상황에서 알맞은 표현을 고르는 힘이 커져요.', '앱에서는: 복습 카드를 카테고리가 연속되지 않도록 섞어서 보여줘요.', 'Rohrer & Taylor (2007); Kornell & Bjork (2008)'],
    ['🌱 조금씩, 매일 + 잠', '하루 10분이라도 매일 하는 게 몰아서 하는 것보다 나아요. 자는 동안 뇌가 낮에 배운 것을 굳혀요.', '앱에서는: 하루 새 표현 5개(설정 가능), 복습 상한, 스트릭 표시, 그리고 “내일 복습하세요” 안내.', 'Cepeda et al. (2006); Diekelmann & Born (2010), Nature Reviews Neuroscience'],
    ['⏱️ 스피드 토크 (4/3/2 기법)', '같은 내용을 점점 짧은 시간에 반복해 말하면, 내용 부담 없이 말하는 속도와 매끄러움이 좋아져요.', '앱에서는: 한 주제를 60초 → 45초 → 30초로 말하며 오늘의 표현을 써봐요.', 'Maurice (1983); Nation (1989), System 17(3)']
  ];
  function renderWhy() {
    render(
      '<header class="top"><h1>왜 이렇게 하나요?</h1></header>' +
      '<p class="muted">이 앱의 모든 단계는 기억·학습 연구에 근거해요.</p>' +
      WHY.map(function (w) {
        return '<section class="card why"><h2>' + esc(w[0]) + '</h2><p>' + esc(w[1]) + '</p><p class="how">' + esc(w[2]) + '</p><p class="ref">' + esc(w[3]) + '</p></section>';
      }).join('')
    );
  }

  /* ======================= 이벤트 ======================= */
  var ACTIONS = {
    start: startSession,
    speed: function () { speed = null; go('speed'); },
    home: function () { go('home'); },
    quit: function () {
      if (confirm('세션을 끝낼까요? 지금까지 채점한 카드는 저장돼요.')) finishSession();
    },
    tts: function () { var c = currentCard(); if (c) speak(c.en); },
    'tts-slow': function () { var c = currentCard(); if (c) speak(c.en, db.settings.slowRate); },
    'to-shadow': function () { session.cur.phase = 'shadow'; renderSession(); speak(currentCard().en); },
    'shadow-count': function () {
      var cur = session.cur;
      cur.shadowCount = Math.min(3, cur.shadowCount + 1);
      abortListening(); cur.listening = false;
      renderSession();
      if (cur.shadowCount < 3) speak(currentCard().en);
    },
    'shadow-mic': function () {
      var cur = session.cur, c = currentCard();
      if (cur.listening) { stopListening(); return; }
      cur.listening = true; renderSession();
      listen({
        onResult: function (fin, interim) { var el = $('#shadowFb'); if (el) el.textContent = (fin + ' ' + interim).trim(); },
        onEnd: function (fin) {
          if (!session || session.cur !== cur) return;
          cur.listening = false;
          if (fin) { cur.transcript = fin; cur.shadowCount = Math.min(3, cur.shadowCount + 1); }
          renderSession();
          if (cur.shadowCount < 3 && fin) speak(c.en);
        }
      }, false);
    },
    'to-recall': function () {
      var cur = session.cur;
      cur.phase = 'recall'; cur.transcript = ''; cur.sim = null; cur.cueAt = 0; cur.latency = null;
      stopSpeaking(); cleanupScreen(); renderSession();
    },
    mic: recallMic,
    'fb-start': function () { markLatencyNow(); session.cur.fallbackSpeaking = true; renderSession(); },
    'fb-done': function () { toReveal(); },
    giveup: function () {
      var cur = session.cur;
      if (!cur.transcript && cur.latency == null) cur.gaveUp = true;
      if (!cur.fallbackSpeaking && cur.latency == null) cur.gaveUp = true;
      toReveal();
    },
    grade: function (el) { applyGrade(Number(el.getAttribute('data-g'))); },
    'mine-mic': function () {
      var cur = session.cur;
      if (cur.listening) { stopListening(); return; }
      cur.mineDraft = ($('#mineText') || {}).value || '';
      cur.listening = true; renderSession();
      listen({
        onResult: function (fin, interim) { var t = $('#mineText'); if (t) t.value = (fin + ' ' + interim).trim(); },
        onEnd: function (fin) {
          if (!session || session.cur !== cur) return;
          cur.listening = false;
          if (fin) cur.mineDraft = fin;
          renderSession();
        }
      }, false);
    },
    'mine-save': function () {
      var t = ($('#mineText') || {}).value;
      t = (t || '').trim();
      if (t) { currentCard().mine.push({ text: t, at: Date.now() }); save(); toast('나의 문장을 저장했어요'); }
      advance();
    },
    'mine-skip': function () { advance(); },
    'speed-topic': function () { speed.topic = (speed.topic + 1 + Math.floor(Math.random() * (TOPICS.length - 1))) % TOPICS.length; renderSpeed(); },
    'speed-go': startSpeedRound,
    'speed-stop': endSpeedRound,
    'speed-again': function () { speed = null; renderSpeed(); },
    'card-new': function () { go('edit', 'new'); },
    'card-edit': function (el) { go('edit', el.getAttribute('data-id')); },
    'back-cards': function () { go('cards'); },
    'edit-tts': function () { var f = $('#editForm'); if (f && f.elements.en.value.trim()) speak(f.elements.en.value.trim()); },
    'card-del': function () {
      var id = $('#editForm').getAttribute('data-id');
      if (!confirm('이 카드를 삭제할까요? 학습 기록도 함께 지워져요.')) return;
      db.cards = db.cards.filter(function (c) { return c.id !== id; });
      if (db.deletedIds.indexOf(id) < 0) db.deletedIds.push(id);
      save(); toast('삭제했어요'); go('cards');
    },
    'card-reset': function () {
      var c = card($('#editForm').getAttribute('data-id'));
      if (!c || !confirm('이 카드의 학습 기록을 초기화할까요? (새 카드로 돌아가요)')) return;
      c.srs = S.newSrs(); c.lat = []; c.hist = [];
      save(); toast('초기화했어요'); renderEdit(c.id);
    },
    'mine-del': function (el) {
      var c = card($('#editForm').getAttribute('data-id'));
      if (!c) return;
      c.mine.splice(Number(el.getAttribute('data-i')), 1);
      save(); renderEdit(c.id);
    },
    'tts-test': function () { speak('Let me check my schedule and get back to you.'); },
    'export': exportJson,
    'import': function () { $('#importFile').click(); },
    'reset-all': function () {
      if (!confirm('모든 카드와 학습 기록을 지울까요? 되돌릴 수 없어요.')) return;
      if (!confirm('정말 지울까요? 먼저 백업을 받아두는 걸 권해요.')) return;
      db = migrate(freshDb()); save(); toast('초기화했어요'); go('home');
    }
  };
  function currentCard() {
    if (session && session.cur) return card(session.cur.id);
    return null;
  }

  function init() {
    app = $('#app');
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      var fn = ACTIONS[el.getAttribute('data-act')];
      if (fn) { e.preventDefault(); fn(el); }
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('storage', function (e) { if (e.key === KEY && !session) { db = load(); route(); } });
    route();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 캐시 없이도 동작 */ });
    }
  }
  var ROUTES = { home: renderHome, session: renderSession, summary: renderSummary, cards: renderCards, edit: renderEdit, settings: renderSettings, why: renderWhy, speed: renderSpeed };

  // 테스트/디버그용 최소 노출
  window.SpeakApp = { get db() { return db; }, save: save, counts: counts, version: APP_VERSION, get currentId() { return session && session.cur ? session.cur.id : null; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
