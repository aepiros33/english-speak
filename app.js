/* app.js v2 — 개인용 영어 말하기 루틴 (PRD v1.1). 정적 PWA, 백엔드 없음.
   저장: localStorage(speakapp.v2: 설정·카드·기록), IndexedDB(녹음). AI 키는 localStorage(speakapp.key.*)에만. */
(function () {
  'use strict';
  var Core = window.SpeakCore, S = Core.Scheduler, T = Core.Text, M = Core.Mix, R = Core.Routine, F = Core.Feedback, E = Core.Errors;
  var Media = window.SpeakMedia, AI = window.SpeakAI, C = window.SPEAK_CONTENT;
  var CATS = window.SPEAK_CATEGORIES, GOALS = window.SPEAK_GOALS, CAT_TAGS = window.SPEAK_CATEGORY_TAGS;
  var CAT_ORDER = ['meeting', 'smalltalk', 'request', 'opinion', 'schedule', 'reaction', 'followup', 'daily', 'travel', 'interview'];
  var KEY = 'speakapp.v2', V1_KEY = 'speakapp.v1';
  var APP_VERSION = '2.0.0';
  var SCHED = { learningSteps: [], relearningSteps: [], graduatingInterval: 2, dayStartHour: 4 };
  var GRADE_LABEL = { 1: '다시', 2: '어려움', 3: '좋음', 4: '쉬움' };
  var LEVELS = { beginner: '초급', intermediate: '중급', upper: '중상급' };
  var STEP_LABEL = { shadow: '쉐도잉', output: '말하기', feedback: '피드백', chunks: '청크 저장' };
  var RATES = [0.8, 0.9, 1.0, 1.1];
  var isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ======================= 저장소 ======================= */
  function defaultSettings() {
    return { rate: 1.0, accent: 'us', voiceURI: '', koHints: true, scriptDefault: true, useWebSpeech: true, provider: 'gemini', models: {},
      newPerDay: 5, maxReviews: 100, latencyThreshold: 3.5, autoPlay: true };
  }
  function freshDb() {
    return {
      app: 'speak-practice', version: 2, createdAt: Date.now(),
      profile: { onboarded: false, goal: 'work', minutes: 20, topics: [], level: 'intermediate', introRecId: null, micExplained: false },
      settings: defaultSettings(), cards: [], deletedIds: [], log: {}, routine: null, errors: [], sessions: [], seenClipIds: []
    };
  }
  function makeCard(src, order, custom) {
    return {
      id: src.id, en: src.en, ko: src.ko || '', example: src.example || '', slot: src.slot || '',
      category: src.category || 'custom', custom: !!custom, source: src.source || (custom ? 'custom' : 'seed'), order: order,
      mine: [], lat: [], hist: [], srs: S.newSrs(), createdAt: Date.now()
    };
  }
  function normalize(d) {
    var f = freshDb();
    d.version = 2;
    d.profile = Object.assign(f.profile, d.profile || {});
    d.settings = Object.assign(defaultSettings(), d.settings || {});
    d.settings.rate = Math.min(1.1, Math.max(0.8, Number(d.settings.rate) || 1));
    ['cards', 'deletedIds', 'errors', 'sessions', 'seenClipIds'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = []; });
    d.log = d.log || {};
    var have = {}, maxOrder = 0;
    d.cards.forEach(function (c) { have[c.id] = 1; maxOrder = Math.max(maxOrder, c.order || 0); });
    var seeds = M.roundRobin(window.SPEAK_SEED || [], function (c) { return c.category; }, CAT_ORDER);
    seeds.forEach(function (s) { if (!have[s.id] && d.deletedIds.indexOf(s.id) < 0) d.cards.push(makeCard(s, ++maxOrder, false)); });
    d.cards.forEach(function (c) {
      c.srs = Object.assign(S.newSrs(), c.srs || {});
      c.mine = c.mine || []; c.lat = c.lat || []; c.hist = c.hist || [];
    });
    d.seedVersion = window.SPEAK_SEED_VERSION || 2;
    if (d.routine && (!d.routine.plan || !d.routine.step)) d.routine = null;
    return d;
  }
  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function load() {
    var d = readJSON(KEY);
    if (d && Array.isArray(d.cards)) return normalize(d);
    var v1 = readJSON(V1_KEY);
    if (v1 && Array.isArray(v1.cards)) return normalize(Core.Migrate.v1(v1, freshDb())); // v1 키는 백업으로 그대로 둠
    return normalize(freshDb());
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { toast('저장에 실패했어요. 설정에서 백업을 먼저 받아두세요.'); }
  }
  var db = load();
  save();
  function applyAIConfig() { AI.configure({ provider: db.settings.provider, models: db.settings.models || {} }); }
  applyAIConfig();

  function card(id) { for (var i = 0; i < db.cards.length; i++) if (db.cards[i].id === id) return db.cards[i]; return null; }
  function now() { return Date.now(); }
  function todayKey() { return S.dayKey(now()); }
  function yesterdayKey() { return S.dayKey(S.addDays(S.studyDayStart(now()), -1) + 1000); }
  function logOf(k) {
    if (!db.log[k]) db.log[k] = {};
    var l = db.log[k];
    ['newCount', 'reviewCount', 'ms', 'speed', 'spokenSec', 'sessions'].forEach(function (x) { if (typeof l[x] !== 'number') l[x] = 0; });
    ['lat', 'cardIds', 'usedCardIds', 'missedCardIds'].forEach(function (x) { if (!Array.isArray(l[x])) l[x] = []; });
    return l;
  }
  function todayLog() { return logOf(todayKey()); }
  function addSpoken(sec) { var l = todayLog(); l.spokenSec = Math.round((l.spokenSec + (sec || 0)) * 10) / 10; save(); }
  function markUsed(id) { var l = todayLog(); if (l.usedCardIds.indexOf(id) < 0) l.usedCardIds.push(id); l.missedCardIds = l.missedCardIds.filter(function (x) { return x !== id; }); }
  function markMissed(id) { var l = todayLog(); if (l.missedCardIds.indexOf(id) < 0 && l.usedCardIds.indexOf(id) < 0) l.missedCardIds.push(id); }
  function streak() { return Core.Days.streak(db.log, now()); }
  function reviewCounts() {
    var t = now(), lg = todayLog(), st = db.settings, due = 0, newAvail = 0;
    db.cards.forEach(function (c) { if (c.srs.state === 'new') newAvail++; else if (c.srs.due <= t) due++; });
    return { due: Math.min(due, Math.max(0, st.maxReviews - lg.reviewCount)), dueAll: due, newLeft: Math.min(newAvail, Math.max(0, st.newPerDay - lg.newCount)) };
  }
  function cardTags(c) { return CAT_TAGS[c.category] || ['daily']; }

  /* ======================= 유틸 ======================= */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function mmss(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function secTxt(s) { s = Math.round(s || 0); return s < 60 ? s + '초' : Math.floor(s / 60) + '분 ' + (s % 60 ? (s % 60) + '초' : ''); }
  function minTxt(sec) { var m = (sec || 0) / 60; return m < 10 ? (Math.round(m * 10) / 10) : Math.round(m); }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* noop */ } }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clip(id) { for (var i = 0; i < C.CLIPS.length; i++) if (C.CLIPS[i].id === id) return C.CLIPS[i]; return null; }
  function scenario(id) { for (var i = 0; i < C.SCENARIOS.length; i++) if (C.SCENARIOS[i].id === id) return C.SCENARIOS[i]; return null; }
  function session(id) { for (var i = db.sessions.length - 1; i >= 0; i--) if (db.sessions[i].id === id) return db.sessions[i]; return null; }
  function dueLabel(c) {
    if (c.srs.state === 'new') return '새 청크';
    var d = c.srs.due - now();
    if (d <= 0) return '지금 복습';
    if (c.srs.state !== 'review') return S.formatInterval(d) + ' 후';
    var days = Math.round((S.studyDayStart(c.srs.due) - S.studyDayStart(now())) / S.DAY);
    return days <= 0 ? '오늘' : days === 1 ? '내일' : days + '일 후';
  }

  /* ======================= 음성 합성 (TTS) ======================= */
  var hasTTS = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
  var voices = [];
  function loadVoices() {
    if (!hasTTS) return;
    try { voices = window.speechSynthesis.getVoices().filter(function (v) { return /^en/i.test(v.lang); }); } catch (e) { voices = []; }
  }
  if (hasTTS) { loadVoices(); try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { window.speechSynthesis.onvoiceschanged = loadVoices; } }
  function accentRe() { return db.settings.accent === 'uk' ? /en[-_]GB/i : /en[-_]US/i; }
  function pickVoice() {
    if (!voices.length) loadVoices();
    if (db.settings.voiceURI) { var ch = voices.filter(function (v) { return v.voiceURI === db.settings.voiceURI; })[0]; if (ch) return ch; }
    var loc = voices.filter(function (v) { return accentRe().test(v.lang); });
    var prefs = db.settings.accent === 'uk' ? ['Google UK English Female', 'Serena', 'Daniel', 'Kate', 'Sonia', 'Libby'] : ['Google US English', 'Samantha', 'Aria', 'Jenny', 'Ava', 'Allison', 'Alex'];
    for (var i = 0; i < prefs.length; i++) { var m = loc.filter(function (v) { return v.name.indexOf(prefs[i]) >= 0; })[0]; if (m) return m; }
    return loc[0] || voices[0] || null;
  }
  var speakToken = 0;
  function speak(text, rate) {
    if (!hasTTS) { toast('이 브라우저는 음성 재생을 지원하지 않아요'); return Promise.resolve(); }
    var my = ++speakToken;
    return new Promise(function (resolve) {
      var done = false;
      function fin() { if (!done) { done = true; resolve(my === speakToken); } }
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = db.settings.accent === 'uk' ? 'en-GB' : 'en-US';
        var v = pickVoice(); if (v) u.voice = v;
        u.rate = rate || db.settings.rate;
        u.onend = fin; u.onerror = fin;
        window.speechSynthesis.speak(u);
        setTimeout(fin, 3000 + text.length * 110 / (u.rate || 1));
      } catch (e) { fin(); }
    });
  }
  function stopSpeaking() { speakToken++; if (hasTTS) try { window.speechSynthesis.cancel(); } catch (e) { /* noop */ } }

  /* ======================= 브라우저 음성 인식 (대체 수단) ======================= */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recogBroken = false, recogBrokenReason = '', activeRec = null;
  function recogAvailable() { return !!SR && db.settings.useWebSpeech && !recogBroken; }
  function markBroken(reason) { recogBroken = true; recogBrokenReason = reason; }
  function listen(h, continuous) {
    abortListening();
    var r;
    try { r = new SR(); } catch (e) { markBroken('초기화 실패'); if (h.onEnd) h.onEnd('', []); return null; }
    r.lang = 'en-US'; r.interimResults = true; r.continuous = !!continuous; r.maxAlternatives = 3;
    var finalText = '', alts = [], started = false, ended = false;
    var watchdog = setTimeout(function () {
      if (!started && !ended) { markBroken('마이크가 시작되지 않음'); try { r.abort(); } catch (e) { /* noop */ } finish(false); if (h.onError) h.onError('timeout'); }
    }, 4000);
    function finish(silent) { if (ended) return; ended = true; clearTimeout(watchdog); if (activeRec === r) activeRec = null; if (!silent && h.onEnd) h.onEnd(finalText.trim(), alts); }
    r._kill = function () { finish(true); };
    r.onstart = r.onaudiostart = function () { started = true; };
    r.onspeechstart = function () { started = true; if (h.onSpeechStart) h.onSpeechStart(); };
    r.onresult = function (e) {
      started = true;
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var res = e.results[i];
        if (res.isFinal) { finalText += ' ' + res[0].transcript; alts = []; for (var a = 0; a < res.length; a++) alts.push(res[a].transcript); }
        else interim += res[0].transcript;
      }
      if (h.onResult) h.onResult(finalText.trim(), interim.trim());
    };
    r.onerror = function (e) {
      var code = e && e.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') markBroken('마이크 권한 없음');
      else if (code === 'audio-capture') markBroken('마이크를 찾을 수 없음');
      else if (code === 'network') markBroken('네트워크 필요');
      else if (code === 'language-not-supported') markBroken('영어 인식 미지원');
      if (h.onError) h.onError(code);
    };
    r.onend = function () { finish(false); };
    try { r.start(); activeRec = r; } catch (e) { markBroken('시작 실패'); finish(false); }
    return r;
  }
  function stopListening() { if (activeRec) { try { activeRec.stop(); } catch (e) { /* noop */ } } }
  function abortListening() {
    if (activeRec) { var r = activeRec; activeRec = null; try { if (r._kill) r._kill(); r.onend = null; r.onresult = null; r.onerror = null; r.abort(); } catch (e) { /* noop */ } }
  }

  /* ======================= 마이크 안내 (첫 사용 전) ======================= */
  var MIC_TEXT = '말하기 연습을 위해 마이크를 씁니다. 녹음은 이 기기(브라우저)에만 저장돼요. AI 키를 넣은 경우에만, 받아쓰기·피드백을 위해 그 녹음/텍스트가 내가 고른 AI 제공자에게 전송됩니다. 이 앱은 목소리를 학습(모델 훈련)에 쓰지 않아요.';
  function ensureMic() {
    if (db.profile.micExplained) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'overlay';
      ov.innerHTML = '<div class="sheet"><h2>🎙️ 마이크를 사용할게요</h2><p>' + esc(MIC_TEXT) + '</p>' +
        '<button class="btn primary big" id="micOk">마이크 허용하기</button><button class="btn link" id="micNo">나중에</button></div>';
      document.body.appendChild(ov);
      $('#micOk', ov).onclick = function () {
        db.profile.micExplained = true; save(); ov.remove();
        if (Media.supported()) Media.getStream().then(function () { resolve(true); }, function () { toast('마이크 권한이 없어요. 브라우저 설정에서 허용해 주세요.'); resolve(false); });
        else resolve(true);
      };
      $('#micNo', ov).onclick = function () { ov.remove(); resolve(false); };
    });
  }

  /* ======================= 녹음 + 받아쓰기 ======================= */
  var activeCap = null;
  /**
   * 녹음 시작. o: {kind, promptId, maxSec, onTick(sec), onLevel(rms), onInterim(text)}
   * 반환 Promise<cap>. cap.stop() → Promise<{id, meta, transcript: Promise<string>}>
   */
  function capture(o) {
    o = o || {};
    Media.unlock();
    cancelCapture();
    stopSpeaking();
    Media.stop();
    return ensureMic().then(function (ok) {
      if (!ok) throw new Error('mic-denied');
      if (!Media.supported()) throw new Error('unsupported');
      var wsText = '', wsInterim = '';
      var useWS = !AI.hasKey() && recogAvailable() && !isIOS;
      return Media.record({ maxSec: o.maxSec, onTick: o.onTick, onLevel: o.onLevel }).then(function (ctl) {
        if (useWS) {
          listen({ onResult: function (f, i) { wsText = f; wsInterim = i; if (o.onInterim) o.onInterim((f + ' ' + i).trim()); }, onEnd: function (f) { if (f) wsText = f; } }, true);
        }
        var cap = {
          startedAt: ctl.startedAt,
          stop: function () { ctl.stop(); return cap.done; },
          cancel: function () { ctl.cancel(); abortListening(); if (activeCap === cap) activeCap = null; }
        };
        cap.done = ctl.done.then(function (res) {
              if (activeCap === cap) activeCap = null;
              var wsP = new Promise(function (r) { if (!useWS) return r(''); stopListening(); setTimeout(function () { abortListening(); r((wsText || wsInterim || '').trim()); }, 700); });
              var meta = {
                id: uid('rec'), kind: o.kind || 'misc', promptId: o.promptId || null, createdAt: now(), date: todayKey(), mime: res.mime,
                durationSec: res.durationSec, voicedSec: res.voicedSec, pauses: res.pauses, longestPauseSec: res.longestPauseSec, transcript: '', transcriptBy: ''
              };
              addSpoken(res.voicedSec);
              var saved = Media.Store.put(meta, res.blob).catch(function () { toast('녹음 저장에 실패했어요(저장 공간 확인)'); });
              var tr = saved.then(function () {
                if (AI.hasKey()) {
                  return AI.transcribe(res.blob, res.mime).then(function (t) { return { t: t, by: 'ai' }; }, function (err) {
                    return wsP.then(function (w) { if (!w) toast(AI.friendly(err)); return { t: w, by: w ? 'webspeech' : '' }; });
                  });
                }
                return wsP.then(function (w) { return { t: w, by: w ? 'webspeech' : '' }; });
              }).then(function (x) {
                meta.transcript = x.t || ''; meta.transcriptBy = x.by;
                return Media.Store.updateMeta(meta.id, { transcript: meta.transcript, transcriptBy: x.by }).then(function () { return meta.transcript; }, function () { return meta.transcript; });
              });
              return { id: meta.id, meta: meta, transcript: tr };
        });
        activeCap = cap;
        return cap;
      });
    });
  }
  function cancelCapture() { if (activeCap) { try { activeCap.cancel(); } catch (e) { /* noop */ } activeCap = null; } }
  function captureError(err) {
    var m = err && err.message;
    if (m === 'mic-denied') toast('마이크를 켜야 말하기 연습을 할 수 있어요');
    else if (m === 'unsupported') toast('이 브라우저는 녹음을 지원하지 않아요 (최신 Chrome·Safari 권장)');
    else toast('마이크를 시작하지 못했어요. 권한을 확인해 주세요.');
  }
  function playRec(id) { stopSpeaking(); return Media.playId(id); }

  /* ======================= 라우팅 ======================= */
  var screenTimers = [];
  function every(fn, ms) { screenTimers.push(setInterval(fn, ms)); }
  function later(fn, ms) { var t = setTimeout(fn, ms); screenTimers.push(t); return t; }
  function clearTimers() { screenTimers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); screenTimers = []; }
  function cleanupScreen() { clearTimers(); abortListening(); stopSpeaking(); cancelCapture(); Media.stop(); ui = {}; }
  var app = null, ui = {};
  var IMMERSIVE = { routine: 1, review: 1, rec: 1, bridge: 1, onboarding: 1 };
  var TAB_OF = { home: 'home', chunks: 'chunks', manage: 'chunks', edit: 'chunks', errors: 'chunks', progress: 'progress', settings: 'settings', why: 'settings' };
  function go(name, param) {
    var h = '#/' + name + (param ? '/' + encodeURIComponent(param) : '');
    if (location.hash === h) route(); else location.hash = h;
  }
  function route() {
    cleanupScreen();
    var parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/');
    var name = parts[0] || 'home', param = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (!db.profile.onboarded && name !== 'onboarding' && name !== 'settings' && name !== 'why') name = 'onboarding';
    if (name === 'review' && !review) name = 'chunks';
    if (name !== 'review' && review) finishReview(true);
    var fn = ROUTES[name] || renderHome;
    document.body.dataset.screen = name;
    $('#tabbar').hidden = !!IMMERSIVE[name];
    document.querySelectorAll('#tabbar a').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-tab') === TAB_OF[name]); });
    fn(param);
    window.scrollTo(0, 0);
  }
  function render(html) { app.innerHTML = html; }

  /* ======================= 공통 조각 ======================= */
  function recBtn(act, recording, label, extraCls) {
    return '<div class="mic-wrap"><button class="mic ' + (extraCls || '') + (recording ? ' listening' : '') + '" data-act="' + act + '" aria-label="' + esc(label) + '">' + (recording ? '■' : '🎙️') + '</button>' +
      '<div class="mic-lbl">' + esc(recording ? '말하는 중… 누르면 멈춰요' : label) + '</div></div>';
  }
  function statLine(m) {
    if (!m) return '';
    return '<div class="rec-stats"><span>⏱ ' + secTxt(m.durationSec) + '</span><span>🗣 말한 길이 ' + secTxt(m.voicedSec) + '</span><span>⏸ 멈춤 ' + (m.pauses || 0) + '회</span></div>';
  }
  function levelMeter() { return '<div class="meter"><span id="meterBar"></span></div>'; }
  function onLevel(rms) { var b = $('#meterBar'); if (b) b.style.width = Math.min(100, Math.round(rms * 900)) + '%'; }
  function hintLine(c) {
    if (!db.settings.koHints || !c.hint || !C.HINTS[c.hint]) return '';
    return '<p class="ko-hint">🇰🇷 발음 힌트 · ' + esc(C.HINTS[c.hint]) + '</p>';
  }
  function noKeyBox(what) {
    return '<div class="locked"><div class="lock-ico">🔒</div><p><b>' + esc(what) + '</b>는 AI가 필요해요.</p><p class="muted small">설정에서 AI 키를 넣으면 열려요.</p>' +
      '<button class="btn secondary" data-act="goto-ai">설정에서 AI 키 넣기</button></div>';
  }

  /* ======================= 1. 온보딩 ======================= */
  var ob = null;
  function renderOnboarding() {
    if (!ob && db.profile.onboarded) { go('home'); return; }
    if (!ob) ob = { step: db.profile.onboarded ? 5 : 0, goal: db.profile.goal, minutes: db.profile.minutes, topics: db.profile.topics.slice(), level: db.profile.level, rec: null, recording: false };
    var s = ob.step, body = '', total = 6;
    var dots = '<div class="ob-dots">' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<span class="' + (i <= s ? 'on' : '') + '"></span>'; }).join('') + '</div>';
    if (s === 0) {
      body = '<div class="ob-hero"><div class="big-emoji">🗣️</div><h1>매일 말하는 영어 루틴</h1>' +
        '<p class="motto">“완벽해지면 말하는 게 아닙니다.<br>말하면서 늘립니다.”</p>' +
        '<p class="muted">듣고 따라 말하기 → 직접 말하기 → 교정 받고 다시 말하기 → 청크 저장.<br>하루 10~30분, 매일 입으로 말하는 시간을 만듭니다.</p></div>' +
        '<div class="actions"><button class="btn primary big" data-act="ob-next">시작하기</button></div>';
    } else if (s === 1) {
      body = '<h1>영어를 어디에 쓰고 싶나요?</h1><div class="opt-grid">' + Object.keys(GOALS).map(function (g) {
        var ico = { daily: '☕', work: '💼', travel: '✈️', interview: '🎤' }[g];
        return '<button class="opt' + (ob.goal === g ? ' sel' : '') + '" data-act="ob-goal" data-v="' + g + '"><span>' + ico + '</span>' + GOALS[g] + '</button>';
      }).join('') + '</div><div class="actions"><button class="btn primary big" data-act="ob-next">다음</button></div>';
    } else if (s === 2) {
      body = '<h1>하루에 얼마나 할까요?</h1><div class="opt-col">' + [10, 20, 30].map(function (m) {
        var d = R.durations(m);
        return '<button class="opt wide' + (ob.minutes === m ? ' sel' : '') + '" data-act="ob-min" data-v="' + m + '"><b>' + m + '분</b><span class="muted small">쉐도잉 ' + d.shadow + ' · 말하기 ' + d.output + ' · 피드백 ' + d.feedback + ' · 청크 ' + d.chunks + '분</span></button>';
      }).join('') + '</div><p class="muted small">나중에 설정에서 바꿀 수 있어요.</p><div class="actions"><button class="btn primary big" data-act="ob-next">다음</button></div>';
    } else if (s === 3) {
      body = '<h1>관심 주제를 골라 주세요</h1><p class="muted">최대 3개 · <b id="topicCount">' + ob.topics.length + '</b>/3</p><div class="chip-grid">' + Object.keys(C.INTERESTS).map(function (k) {
        return '<button class="pick' + (ob.topics.indexOf(k) >= 0 ? ' sel' : '') + '" data-act="ob-topic" data-v="' + k + '">' + esc(C.INTERESTS[k]) + '</button>';
      }).join('') + '</div><div class="actions"><button class="btn primary big" data-act="ob-next"' + (ob.topics.length ? '' : ' disabled') + '>다음</button></div>';
    } else if (s === 4) {
      var desc = { beginner: '짧은 문장은 되지만 대화가 자주 끊겨요', intermediate: '일상 대화는 되는데 말이 느리고 막혀요', upper: '대부분 말할 수 있고, 더 자연스럽고 빠르게 하고 싶어요' };
      body = '<h1>지금 말하기 수준은?</h1><div class="opt-col">' + Object.keys(LEVELS).map(function (l) {
        return '<button class="opt wide' + (ob.level === l ? ' sel' : '') + '" data-act="ob-level" data-v="' + l + '"><b>' + LEVELS[l] + '</b><span class="muted small">' + desc[l] + '</span></button>';
      }).join('') + '</div><div class="actions"><button class="btn primary big" data-act="ob-next">다음</button></div>';
    } else if (s === 5) {
      var r = ob.rec;
      body = '<h1>첫 한마디: 30초 자기소개</h1>' +
        '<div class="notice">🎙️ ' + esc(MIC_TEXT) + '</div>' +
        '<div class="prompt-card"><p class="en-mid">Tell me about yourself in 30 seconds.</p><p class="muted small">예) Hi, I\'m ___. I work at ___ as a ___. These days I\'m trying to ___.</p></div>' +
        '<p class="muted small center">이 녹음은 나중에 ‘진행’ 탭에서 최근 녹음과 비교돼요.</p>' +
        (ob.recording ? '<div class="timer" id="obTimer">0:30</div>' + levelMeter() : '') +
        (r ? '<div class="card">' + statLine(r.meta) + '<p class="transcript" id="obTr">' + esc(r.meta.transcript || (AI.hasKey() ? '받아쓰는 중…' : '')) + '</p>' +
          '<div class="row gap"><button class="btn secondary" data-act="ob-play">▶ 들어보기</button><button class="btn ghost" data-act="ob-rerec">다시 녹음</button></div></div>' : '') +
        (r ? '' : recBtn('ob-rec', ob.recording, '눌러서 녹음 시작 (최대 30초)', 'huge')) +
        '<div class="actions">' + (r ? '<button class="btn primary big" data-act="ob-finish">완료</button>' : '<button class="btn link" data-act="ob-skip">건너뛰기 (나중에 진행 탭에서 녹음)</button>') + '</div>';
    } else {
      var d2 = R.durations(db.profile.minutes);
      body = '<div class="ob-hero"><div class="big-emoji">🎉</div><h1>준비 끝!</h1><p>목표 <b>' + GOALS[db.profile.goal] + '</b> · 하루 <b>' + db.profile.minutes + '분</b> · ' + LEVELS[db.profile.level] + '</p>' +
        '<p class="muted small">오늘 루틴: 쉐도잉 ' + d2.shadow + '분 → 말하기 ' + d2.output + '분 → 피드백 ' + d2.feedback + '분 → 청크 저장</p></div>' +
        '<div class="actions"><button class="btn primary big" data-act="start">말하기 시작</button><button class="btn link" data-act="home">홈으로</button></div>';
    }
    render('<div class="ob">' + (s > 0 && s < 6 ? '<div class="ob-top"><button class="icon-btn sm" data-act="ob-back" aria-label="뒤로">←</button>' + dots + '<span></span></div>' : '') + body + '</div>');
    void total;
  }
  function obRec() {
    if (ob.recording) { if (ui.cap) ui.cap.stop(); return; }
    db.profile.micExplained = true; save();
    capture({ kind: 'intro', promptId: 'intro', maxSec: 30, onLevel: onLevel, onTick: function (t) { var el = $('#obTimer'); if (el) el.textContent = mmss(30 - t); } }).then(function (cap) {
      ui.cap = cap; ob.recording = true; renderOnboarding();
      cap.done.then(function (res) {
        ob.recording = false; ob.rec = res; ui.cap = null; renderOnboarding();
        res.transcript.then(function (t) { var el = $('#obTr'); if (el) el.textContent = t || '(받아쓰기 없음 — AI 키를 넣으면 텍스트로도 볼 수 있어요)'; });
      });
    }, captureError);
  }
  function obFinish(skip) {
    db.profile.goal = ob.goal; db.profile.minutes = ob.minutes; db.profile.topics = ob.topics.slice(0, 3); db.profile.level = ob.level;
    if (!skip && ob.rec) db.profile.introRecId = ob.rec.id;
    db.profile.onboarded = true; db.profile.onboardedAt = db.profile.onboardedAt || now();
    save();
    ob.step = 6; renderOnboarding();
  }

  /* ======================= 2. 홈 (오늘) ======================= */
  function softStreakOffer() {
    var t = S.studyDayStart(now());
    var y = S.dayKey(S.addDays(t, -1) + 1000), yy = S.dayKey(S.addDays(t, -2) + 1000);
    var act = Core.Days.isActiveDay;
    return !act(db.log[todayKey()]) && !act(db.log[y]) && act(db.log[yy]) && !(db.log[y] && db.log[y].bridged);
  }
  function currentRoutine() { return db.routine && db.routine.date === todayKey() ? db.routine : null; }
  function renderHome() {
    var r = currentRoutine(), cl = R.checklist(r), wk = Core.Days.weekStats(db.log, now()), st = streak(), rc = reviewCounts();
    var complete = r && R.isComplete(r);
    var startLbl = !r ? '말하기 시작' : complete ? '오늘 루틴 완료 ✓' : '이어서 하기 · ' + STEP_LABEL[r.step];
    var warm = r ? r.plan.warmup : previewWarmup();
    var boxes = R.STEPS.map(function (k, i) {
      return '<div class="box' + (cl[k] ? ' done' : '') + (r && r.step === k ? ' cur' : '') + '"><span class="bx">' + (cl[k] ? '✓' : (i + 1)) + '</span>' + STEP_LABEL[k] + (k === 'chunks' ? ' 3개' : '') + '</div>';
    }).join('');
    render(
      '<header class="top"><h1>오늘</h1><div class="streak" title="연속일">🔥 ' + st + '일</div></header>' +
      (softStreakOffer() ? '<section class="card soft"><p>어제는 쉬었네요. 괜찮아요, 3분이면 이어 갈 수 있어요.</p><button class="btn secondary" data-act="bridge">어제 못 한 3분 워밍업</button></section>' : '') +
      '<section class="card">' +
        '<div class="goal-row"><div><div class="lbl">오늘 목표</div><div class="num">' + db.profile.minutes + '<small>분</small></div></div>' +
        '<div><div class="lbl">이번 주 말한 시간</div><div class="num">' + minTxt(wk.spokenSec) + '<small>분</small></div></div></div>' +
        '<button class="btn primary huge-start" data-act="' + (complete ? 'noop' : 'start') + '"' + (complete ? ' disabled' : '') + '>' + (complete ? '' : '🎙️ ') + esc(startLbl) + '</button>' +
        '<div class="boxes">' + boxes + '</div>' +
        (warm && !complete ? '<p class="muted small">오늘 워밍업: ' + esc(warm.kind === 'error' ? '지난번 교정 “' + warm.script + '”' : '어제 못 쓴 청크 “' + (card(warm.cardId) || {}).en + '”') + '</p>' : '') +
      '</section>' +
      (complete ? '<section class="card"><p>오늘 저장한 청크 3개는 내일 복습에 나와요. 더 하고 싶다면:</p><button class="btn secondary" data-act="review">청크 복습 ' + (rc.due + rc.newLeft) + '장</button></section>' :
        (rc.due ? '<button class="btn ghost" data-act="review">🗂️ 복습할 청크 ' + rc.due + '장</button>' : '')) +
      (AI.hasKey() ? '' : '<div class="notice">AI 키가 없으면 롤플레이·AI 피드백 대신 4-3-2 말하기와 셀프 교정으로 진행돼요. <a href="#/settings/ai">설정에서 AI 키를 넣으면 열려요.</a></div>')
    );
  }
  function missedCardsForWarmup() {
    var y = db.log[yesterdayKey()];
    var ids = (y && y.missedCardIds) || [];
    return ids.map(card).filter(Boolean);
  }
  function previewWarmup() { return E.pickWarmup(db.errors, missedCardsForWarmup(), now()); }

  /* ======================= 루틴 엔진 ======================= */
  function startRoutine() {
    var r = currentRoutine();
    if (!r) {
      var plan = R.plan({ minutes: db.profile.minutes, level: db.profile.level, goal: db.profile.goal, topics: db.profile.topics, clips: C.CLIPS, seenClipIds: db.seenClipIds.slice(-40), warmup: previewWarmup() });
      r = R.create(todayKey(), plan);
      r.startedAt = now();
      db.routine = r; save();
    }
    go('routine');
  }
  function saveRoutine() { save(); }
  function routineClips(r) {
    var list = [];
    if (r.plan.warmup) list.push({ id: 'warmup', warm: true, script: r.plan.warmup.script, focus: r.plan.warmup.focus, ko: r.plan.warmup.kind === 'error' ? '워밍업 · 지난번 교정 다시 말하기' : '워밍업 · 어제 못 쓴 청크', level: '', hint: null, duration_sec: 4 });
    r.plan.clipIds.forEach(function (id) { var c = clip(id); if (c) list.push(c); });
    return list;
  }
  function routineHeader(r) {
    var i = R.STEPS.indexOf(r.step);
    return '<div class="sess-top"><button class="icon-btn" data-act="leave-routine" aria-label="나가기">✕</button>' +
      '<div class="sess-prog"><div class="small"><b>' + (i + 1) + '/4 ' + STEP_LABEL[r.step] + '</b> · 목표 약 ' + r.plan.durations[r.step] + '분</div>' +
      '<div class="seg">' + R.STEPS.map(function (k, j) { return '<span class="' + (j < i ? 'done' : j === i ? 'cur' : '') + '"></span>'; }).join('') + '</div></div><span></span></div>';
  }
  function renderRoutine() {
    var r = currentRoutine();
    if (!r) { go('home'); return; }
    if (r.step === 'shadow') return renderShadowStep(r);
    if (r.step === 'output') return renderOutputStep(r);
    if (r.step === 'feedback') return renderFeedbackStep(r);
    if (r.step === 'chunks') return renderChunksStep(r);
    return renderRoutineDone(r);
  }
  function advanceRoutine(step) {
    var res = R.completeStep(db.routine, step, now());
    if (!res.ok) {
      var why = { 'no-output': '먼저 직접 말해야 다음으로 가요', 'reutter-missing': '모든 교정을 다시 말해야 완료돼요', 'repair-missing': '확인 질문에 먼저 답해 주세요', 'need-3-chunks': '청크 3개를 저장해 주세요', 'no-items': '피드백을 먼저 받아 주세요' }[res.reason] || '아직 끝나지 않았어요';
      toast(why); return false;
    }
    db.routine = res.routine;
    if (db.routine.step === 'done') {
      var l = todayLog(); l.routineDone = true; l.sessions += 1;
    }
    save(); renderRoutine(); window.scrollTo(0, 0);
    return true;
  }

  /* ======================= 3. 쉐도잉 (공용 컴포넌트) ======================= */
  var MODES = ['listen', 'shadow', 'repeat', 'solo', 'compare'];
  var MODE_LABEL = { listen: '듣기', shadow: '동시에', repeat: '반복', solo: '혼자', compare: '비교' };
  function modesFor(c) { return c.warm || c.mini ? ['listen', 'repeat', 'solo', 'compare'] : MODES; }
  function shadowView(ctx) {
    var st = ctx.state, clips = ctx.clips, c = clips[st.idx];
    if (!c) { ctx.onDone(); return; }
    var modes = modesFor(c);
    if (modes.indexOf(st.mode) < 0) st.mode = modes[0];
    if (ui.showScript == null) ui.showScript = db.settings.scriptDefault;
    var showScript = st.mode === 'solo' ? !!ui.peek : ui.showScript;
    var modeBar = '<div class="modes">' + modes.map(function (m) { return '<span class="' + (m === st.mode ? 'cur' : modes.indexOf(m) < modes.indexOf(st.mode) ? 'done' : '') + '">' + MODE_LABEL[m] + '</span>'; }).join('') + '</div>';
    var rateChips = '<div class="rates" role="group" aria-label="속도">' + RATES.map(function (x) { return '<button class="rate' + (Math.abs(db.settings.rate - x) < 0.01 ? ' sel' : '') + '" data-act="rate" data-v="' + x + '">' + x.toFixed(1) + '×</button>'; }).join('') + '</div>';
    var act = '';
    var recId = st.recIds[st.idx];
    if (st.mode === 'listen') {
      act = '<p class="guide">먼저 끝까지 들어 보세요.</p><button class="btn secondary big" data-act="sh-play">🔊 듣기</button>' +
        '<div class="actions"><button class="btn primary big" data-act="sh-next-mode">다음: ' + MODE_LABEL[modes[1]] + '</button></div>';
    } else if (st.mode === 'shadow') {
      act = '<p class="guide">원문과 <b>동시에</b> 소리 내어 따라 말하세요. 놓쳐도 멈추지 마세요.</p><button class="btn secondary big" data-act="sh-play">▶ 재생하며 따라 말하기</button>' +
        '<div class="actions"><button class="btn primary big" data-act="sh-next-mode">다음: 반복</button></div>';
    } else if (st.mode === 'repeat') {
      var n = ctx.reps;
      act = '<p class="guide">한 번 듣고 바로 따라 말하기를 ' + n + '번 반복해요.</p><div class="dots">' + Array.apply(null, Array(n)).map(function (_, i) { return '<span class="dot' + (i < st.reps ? ' on' : '') + '"></span>'; }).join('') + '</div>' +
        '<button class="btn secondary big" data-act="sh-rep"' + (st.reps >= n ? ' disabled' : '') + '>🔊 듣고 따라 말하기 (' + Math.min(st.reps + 1, n) + '/' + n + ')</button>' +
        '<div class="actions"><button class="btn primary big" data-act="sh-next-mode"' + (st.reps >= n ? '' : ' disabled') + '>다음: 혼자 말하기</button></div>';
    } else if (st.mode === 'solo') {
      act = '<p class="guide">이제 음원 없이 <b>혼자</b> 말해 보세요. 녹음돼요.</p>' + (ui.recording ? levelMeter() + '<div class="timer small-timer" id="shTimer">0:00</div>' : '') +
        recBtn('sh-rec', ui.recording, '눌러서 혼자 말하기', 'huge');
    } else {
      var meta = ui.recMeta;
      act = '<p class="guide">원문과 내 녹음을 번갈아 들어 보세요.</p><div class="row2"><button class="btn secondary" data-act="sh-play">▶ 원문</button><button class="btn secondary" data-act="sh-mine"' + (recId ? '' : ' disabled') + '>▶ 내 녹음</button></div>' +
        (meta ? statLine(meta) : '') + '<div id="shCmp" class="match"' + (meta && meta.transcript ? '' : ' hidden') + '>' + (meta && meta.transcript ? cmpHtml(c.script, meta.transcript) : '') + '</div>' +
        '<div class="actions"><button class="btn ghost" data-act="sh-rerec">다시 녹음</button><button class="btn primary big" data-act="sh-next-clip">' + (st.idx + 1 < clips.length ? '다음 클립' : ctx.lastLabel) + '</button></div>';
    }
    render(ctx.header +
      '<div class="stage">' +
      '<div class="step-badge">' + (c.warm ? '<span class="chip soft">워밍업</span>' : '<span class="chip">클립 ' + (st.idx + 1 - (clips[0].warm ? 1 : 0)) + '/' + clips.filter(function (x) { return !x.warm; }).length + '</span>') +
        (c.level ? '<span class="chip">' + c.level.toUpperCase() + '</span>' : '') + (c.duration_sec ? '<span class="muted">약 ' + c.duration_sec + '초</span>' : '') + '<span class="muted">' + esc(c.ko || '') + '</span></div>' +
      modeBar +
      '<div class="script-box' + (showScript ? '' : ' hidden-script') + '" id="script">' + (showScript ? esc(c.script) : '스크립트 숨김 · 소리에 집중하세요') + '</div>' +
      '<button class="btn link small" data-act="sh-toggle">' + (showScript ? '스크립트 숨기기' : '스크립트 보기') + '</button>' +
      '<p class="focus">🎯 ' + esc(c.focus) + '</p>' + hintLine(c) +
      (st.mode !== 'solo' ? rateChips : '') +
      act + '</div>');
  }
  function cmpHtml(target, said) {
    var cmp = T.compare(target, said);
    return '<div class="small muted">받아쓰기 기준 원문 일치 ' + Math.round(cmp.score * 100) + '%</div><div class="match-words">' +
      cmp.words.map(function (w) { return '<span class="w ' + (w.ok ? 'ok' : w.partial ? 'part' : 'miss') + '">' + esc(w.raw) + '</span>'; }).join(' ') + '</div><div class="said">내가 말한 것: ' + esc(said) + '</div>';
  }
  var shadowCtx = null;
  function renderShadowStep(r) {
    var clips = routineClips(r);
    shadowCtx = {
      state: r.shadow, clips: clips, reps: r.plan.reps, header: routineHeader(r), lastLabel: '쉐도잉 끝 → 말하기',
      onChange: saveRoutine,
      onClipDone: function (c) {
        if (c.warm && r.plan.warmup) {
          if (r.plan.warmup.kind === 'error') db.errors.forEach(function (e) { if (e.key === r.plan.warmup.key) e.warmups = (e.warmups || 0) + 1; });
          else if (r.plan.warmup.cardId) markUsed(r.plan.warmup.cardId);
          r.shadow.warmupDone = true;
        } else if (db.seenClipIds.indexOf(c.id) < 0) db.seenClipIds.push(c.id);
      },
      onDone: function () { advanceRoutine('shadow'); },
      rerender: function () { renderShadowStep(currentRoutine()); }
    };
    if (r.shadow.recIds[r.shadow.idx] && r.shadow.mode === 'compare' && !ui.recMeta) {
      Media.Store.meta(r.shadow.recIds[r.shadow.idx]).then(function (m) { if (m && shadowCtx && shadowCtx.state === r.shadow) { ui.recMeta = m; shadowCtx.rerender(); } });
    }
    shadowView(shadowCtx);
  }
  function shNextMode() {
    var st = shadowCtx.state, c = shadowCtx.clips[st.idx], modes = modesFor(c);
    var i = modes.indexOf(st.mode);
    st.mode = modes[Math.min(i + 1, modes.length - 1)];
    if (st.mode === 'repeat') st.reps = 0;
    stopSpeaking(); shadowCtx.onChange(); shadowCtx.rerender();
  }
  function shRec() {
    if (ui.recording) { if (ui.cap) ui.cap.stop(); return; }
    var st = shadowCtx.state, c = shadowCtx.clips[st.idx];
    capture({ kind: c.warm ? 'warmup' : 'shadow', promptId: c.id, maxSec: 40, onLevel: onLevel, onTick: function (t) { var el = $('#shTimer'); if (el) el.textContent = mmss(t); } }).then(function (cap) {
      ui.cap = cap; ui.recording = true; ui.peek = false; shadowCtx.rerender();
      cap.done.then(function (res) {
        ui.recording = false; ui.cap = null;
        st.recIds[st.idx] = res.id; st.mode = 'compare'; ui.recMeta = res.meta;
        shadowCtx.onChange(); shadowCtx.rerender();
        var myCtx = shadowCtx;
        res.transcript.then(function (t) {
          if (shadowCtx !== myCtx || !t) return;
          var box = $('#shCmp'); if (box) { box.hidden = false; box.innerHTML = cmpHtml(c.script, t); }
        });
      });
    }, captureError);
  }
  function shNextClip() {
    var st = shadowCtx.state, c = shadowCtx.clips[st.idx];
    if (!st.recIds[st.idx]) { toast('혼자 말하기를 먼저 녹음해 주세요'); return; }
    shadowCtx.onClipDone(c);
    ui.recMeta = null; ui.peek = false;
    if (st.idx + 1 < shadowCtx.clips.length) { st.idx += 1; st.mode = 'listen'; st.reps = 0; shadowCtx.onChange(); shadowCtx.rerender(); window.scrollTo(0, 0); }
    else { st.done = true; shadowCtx.onChange(); shadowCtx.onDone(); }
  }

  /* 어제 못 한 3분 워밍업 (부드러운 스트릭) */
  var bridge = null;
  function renderBridge() {
    if (!softStreakOffer() && !bridge) { go('home'); return; }
    if (!bridge) {
      var w = previewWarmup();
      var pool = C.CLIPS.filter(function (c) { return c.level === 'a2'; });
      var base = w ? { id: 'warmup', warm: true, script: w.script, focus: w.focus, ko: '3분 워밍업', hint: null } : Object.assign({ mini: true }, pool[Math.floor(Math.random() * pool.length)]);
      bridge = { state: { idx: 0, mode: 'listen', reps: 0, recIds: [] }, clips: [base] };
    }
    shadowCtx = {
      state: bridge.state, clips: bridge.clips, reps: 3, lastLabel: '워밍업 끝',
      header: '<div class="sess-top"><button class="icon-btn" data-act="home" aria-label="나가기">✕</button><div class="sess-prog"><b class="small">어제 못 한 3분 워밍업</b></div><span></span></div>',
      onChange: function () {}, onClipDone: function () {},
      onDone: function () {
        var y = yesterdayKey(); logOf(y).bridged = true; bridge = null; save();
        toast('이어졌어요! 스트릭 ' + streak() + '일'); go('home');
      },
      rerender: renderBridge
    };
    shadowView(shadowCtx);
  }

  /* ======================= 4. 출력 과제 ======================= */
  var pendingTr = {}; // recId → Promise<transcript>
  function renderOutputStep(r) {
    var s = r.output.sessionId ? session(r.output.sessionId) : null;
    if (s && s.kind === 'roleplay') return renderRoleplay(r, s);
    if (s && s.kind === '432') return render432(r, s);
    var hdr = routineHeader(r);
    if (ui.pick === 'roleplay') {
      var list = C.SCENARIOS.slice().sort(function (a, b) { return (b.goal === db.profile.goal) - (a.goal === db.profile.goal); });
      render(hdr + '<div class="stage"><button class="btn link small left" data-act="pick-back">← 다시 고르기</button><h2>어떤 상황으로 말해 볼까요?</h2><div class="sc-list">' + list.map(function (sc) {
        return '<button class="sc-item" data-act="rp-start" data-id="' + sc.id + '"><b>' + esc(sc.title) + '</b><span class="muted small">' + esc(sc.success) + '</span>' +
          '<span class="ci-meta"><span class="chip">' + esc(GOALS[sc.goal] || sc.goal) + '</span>' + (sc.strategy ? '<span class="chip soft">전략 · ' + esc(sc.strategy) + '</span>' : '') + (sc.goal === db.profile.goal ? '<span class="chip ok">추천</span>' : '') + '</span></button>';
      }).join('') + '</div></div>');
      return;
    }
    if (ui.pick === '432') {
      var tops = C.TOPICS.slice();
      render(hdr + '<div class="stage"><button class="btn link small left" data-act="pick-back">← 다시 고르기</button><h2>4-3-2 주제 고르기</h2>' +
        '<p class="muted small">같은 내용을 ' + r.plan.rounds.map(function (x) { return secTxt(x); }).join(' → ') + ' 동안 세 번 말해요.</p>' +
        '<div class="topic-list">' + tops.map(function (t, i) { return '<button class="topic-item" data-act="t432" data-i="' + i + '"><b>' + esc(t.ko) + '</b><span class="muted small">' + esc(t.en) + '</span></button>'; }).join('') + '</div>' +
        '<div class="card form"><label>직접 입력<input id="customTopic" maxlength="80" placeholder="예) 요즘 회사에서 맡은 프로젝트"></label><button class="btn secondary" data-act="t432-custom">이 주제로 말하기</button></div></div>');
      return;
    }
    var key = AI.hasKey();
    render(hdr + '<div class="stage"><h2>이제 직접 말할 차례예요</h2><p class="muted">둘 중 하나를 골라요. 목표 약 ' + r.plan.durations.output + '분.</p>' +
      '<button class="pick-card' + (key ? '' : ' disabled') + '" data-act="' + (key ? 'pick-rp' : 'noop') + '"><span class="pc-ico">🤝</span><b>AI와 롤플레이</b><span class="muted small">상황 속 대화 ' + r.plan.turns + '턴 · 막히면 힌트 1개</span></button>' +
      (key ? '' : noKeyBox('롤플레이')) +
      '<button class="pick-card" data-act="pick-432"><span class="pc-ico">⏱️</span><b>4-3-2 혼자 말하기</b><span class="muted small">같은 주제를 ' + r.plan.rounds.map(function (x) { return secTxt(x); }).join('→') + ' · 더 빨리, 덜 멈추기</span></button></div>');
  }
  function newSession(kind, extra) {
    var s = Object.assign({ id: uid('s'), kind: kind, date: todayKey(), createdAt: now() }, extra);
    db.sessions.push(s);
    if (db.sessions.length > 120) db.sessions = db.sessions.slice(-120);
    return s;
  }

  /* ---------- 롤플레이 ---------- */
  function userTurns(s) { return s.turns.filter(function (t) { return t.who === 'me'; }).length; }
  function renderRoleplay(r, s) {
    var sc = scenario(s.scenarioId), n = userTurns(s), max = s.maxTurns;
    if (!AI.hasKey()) { render(routineHeader(r) + '<div class="stage">' + noKeyBox('롤플레이') + '<button class="btn ghost" data-act="rp-abandon">4-3-2로 바꾸기</button></div>'); return; }
    var bubbles = s.turns.map(function (t, i) {
      if (t.who === 'ai') {
        var hide = t.fast && !t.revealed;
        return '<div class="bubble ai' + (t.repair ? ' repair' : '') + '"><div class="who">' + (t.repair ? '🔁 확인 질문' : '상대') + '</div><div class="' + (hide ? 'blurred' : '') + '">' + esc(t.text) + '</div>' +
          (hide ? '<div class="small">빠르게 말했어요. 못 알아들었다면 되물어 보세요 → “Sorry, could you say that again?”</div>' : '') +
          '<button class="icon-btn sm replay" data-act="rp-say" data-i="' + i + '" aria-label="다시 듣기">🔊</button></div>';
      }
      return '<div class="bubble me"><div class="who">나</div>' + esc(t.text) + (t.recId ? ' <button class="icon-btn sm" data-act="play-rec" data-id="' + t.recId + '" aria-label="내 녹음">▶</button>' : '') + '</div>';
    }).join('');
    if (ui.pendingMe) bubbles += '<div class="bubble me pending"><div class="who">나</div>받아쓰는 중…</div>';
    if (ui.thinking) bubbles += '<div class="bubble ai pending"><div class="who">상대</div><span class="typing"><i></i><i></i><i></i></span></div>';
    if (ui.aiErr) bubbles += '<div class="notice warn">' + esc(ui.aiErr) + ' <button class="btn small-btn" data-act="rp-retry">다시 시도</button></div>';
    var canFinish = n >= 2, full = n >= max;
    render(routineHeader(r) +
      '<div class="stage">' +
      '<div class="rp-head"><b>' + esc(sc.title) + '</b><div class="turn-dots">' + Array.apply(null, Array(max)).map(function (_, i) { return '<span class="' + (i < n ? 'on' : '') + '"></span>'; }).join('') + '<span class="small muted">' + n + '/' + max + '턴</span></div>' +
      '<p class="small muted">' + esc(sc.situation) + '</p><p class="small">🎯 ' + esc(sc.success) + '</p></div>' +
      '<div class="chat" id="chat">' + bubbles + '</div>' +
      '<div id="nudge" class="nudge" hidden>한번 말해 보세요 🙂 틀려도 괜찮아요</div>' +
      (ui.hint ? '<div class="hint-chunk">💡 <b>' + esc(ui.hint) + '</b> <button class="icon-btn sm" data-act="say" data-t="' + esc(ui.hint) + '">🔊</button></div>' : '') +
      '<div class="actions rp-actions">' +
        (full ? '' : '<div class="rp-ctrl"><button class="btn ghost small-btn" data-act="rp-hint"' + (ui.hint ? ' disabled' : '') + '>막히면 힌트</button>' +
          recBtn('rp-rec', ui.recording, ui.busy ? '잠시만요…' : '눌러서 말하기', 'huge') + '<span></span></div>') +
        (canFinish ? '<button class="btn ' + (full || s.ended ? 'primary' : 'ghost') + ' big" data-act="rp-finish">대화 마치고 피드백 받기</button>' : '') +
      '</div></div>');
    var chat = $('#chat'); if (chat) chat.scrollTop = chat.scrollHeight;
    if (ui.busy) { var mb = $('[data-act="rp-rec"]'); if (mb) mb.disabled = true; }
  }
  function rpSpeakLast(s) {
    var t = s.turns[s.turns.length - 1];
    if (!t || t.who !== 'ai') return;
    var myS = s.id;
    speak(t.text, t.fast ? 1.3 : db.settings.rate).then(function (fresh) {
      if (!fresh || !ui.rp || ui.rp !== myS || ui.recording) return;
      later(function () { var nd = $('#nudge'); if (nd && !ui.recording && !ui.busy) nd.hidden = false; }, 3000);
    });
  }
  function rpStart(id) {
    var r = currentRoutine(), sc = scenario(id);
    var s = newSession('roleplay', { scenarioId: id, maxTurns: Math.max(2, Math.min(6, r.plan.turns)), turns: [{ who: 'ai', text: sc.opener, fast: !!sc.fastTalk, at: now() }], repairs: 0, ended: false });
    r.output = { type: 'roleplay', sessionId: s.id, utterances: 0, done: false };
    save(); ui.rp = s.id; renderRoutine(); rpSpeakLast(s);
  }
  function rpRec() {
    var r = currentRoutine(), s = session(r.output.sessionId);
    if (ui.recording) { if (ui.cap) ui.cap.stop(); return; }
    if (ui.busy) return;
    var nd = $('#nudge'); if (nd) nd.hidden = true;
    capture({ kind: 'roleplay', promptId: s.scenarioId, maxSec: 60, onLevel: onLevel }).then(function (cap) {
      ui.cap = cap; ui.recording = true; ui.rp = s.id; renderRoutine();
      cap.done.then(function (res) {
        ui.recording = false; ui.cap = null; ui.busy = true; ui.pendingMe = true; renderRoutine();
        res.transcript.then(function (text) {
          ui.pendingMe = false;
          if (!text) { ui.busy = false; renderRoutine(); toast('잘 안 들렸어요. 한 번 더 말해 볼까요?'); return; }
          s.turns.forEach(function (t) { if (t.fast) t.revealed = true; });
          s.turns.push({ who: 'me', text: text, recId: res.id, at: now() });
          r.output.utterances = userTurns(s);
          save();
          rpAsk(s);
        });
      });
    }, captureError);
  }
  function rpAsk(s) {
    var r = currentRoutine(), sc = scenario(s.scenarioId), n = userTurns(s);
    ui.busy = true; ui.thinking = true; ui.aiErr = ''; renderRoutine();
    AI.roleplayTurn(sc, s.turns, { level: db.profile.level, turn: n, maxTurns: s.maxTurns }).then(function (d) {
      if (!ui.rp || ui.rp !== s.id) return;
      ui.thinking = false; ui.busy = false;
      s.turns.push({ who: 'ai', text: d.reply, repair: d.is_repair, offTopic: !d.on_topic, at: now() });
      if (d.is_repair) s.repairs = (s.repairs || 0) + 1;
      if ((d.end && n >= 2) || n >= s.maxTurns) s.ended = true;
      save(); renderRoutine(); rpSpeakLast(s);
    }, function (err) {
      if (!ui.rp || ui.rp !== s.id) return;
      ui.thinking = false; ui.busy = false; ui.aiErr = AI.friendly(err); renderRoutine();
    });
    void r;
  }
  function scanUsedChunks(texts) {
    var all = texts.join(' \n ');
    if (!all.trim()) return;
    db.cards.forEach(function (c) { if (T.containsChunk(all, c.en, 0.85)) markUsed(c.id); });
  }
  function cardByText(en) { var k = T.tokens(en).join(' '); return db.cards.filter(function (c) { return T.tokens(c.en).join(' ') === k; })[0] || null; }
  function rpFinish() {
    var r = currentRoutine(), s = session(r.output.sessionId), sc = scenario(s.scenarioId);
    var mine = s.turns.filter(function (t) { return t.who === 'me'; }).map(function (t) { return t.text; });
    if (mine.length < 2) { toast('최소 2턴은 말해 주세요'); return; }
    scanUsedChunks(mine);
    (sc.must_use_chunk || []).forEach(function (ch) {
      var c = cardByText(ch); if (!c) return;
      if (T.containsChunk(mine.join(' '), ch, 0.8)) markUsed(c.id); else markMissed(c.id);
    });
    s.ended = true; r.output.utterances = mine.length;
    advanceRoutine('output');
  }

  /* ---------- 4-3-2 ---------- */
  function start432(topic) {
    var r = currentRoutine();
    var s = newSession('432', { topic: topic, roundSecs: r.plan.rounds.slice(), rounds: [] });
    r.output = { type: '432', sessionId: s.id, utterances: 0, done: false };
    save(); renderRoutine();
  }
  function render432(r, s) {
    var i = s.rounds.length, secs = s.roundSecs, doneAll = i >= 3;
    var tabs = '<div class="rounds">' + secs.map(function (x, j) {
      var rd = s.rounds[j];
      return '<div class="round' + (j === i && !doneAll ? ' cur' : '') + (rd ? ' done' : '') + '"><b>R' + (j + 1) + ' · ' + mmss(x) + '</b>' +
        (rd ? '<span>말한 길이 ' + secTxt(rd.voicedSec) + '</span><span>멈춤 ' + rd.pauses + '회</span><button class="btn small-btn ghost" data-act="play-rec" data-id="' + rd.recId + '">▶</button>' : '<span class="muted">' + (j === i ? '이번 라운드' : '대기') + '</span>') + '</div>';
    }).join('') + '</div>';
    var main = '';
    if (ui.recording) {
      main = '<div class="ring" id="ring" style="--p:0"><div class="ring-in"><div class="ring-t" id="ringT">' + mmss(secs[i]) + '</div><div class="small muted">라운드 ' + (i + 1) + '</div></div></div>' + levelMeter() +
        '<div class="actions"><button class="btn primary big" data-act="r432-stop">다 말했어요</button></div>';
    } else if (!doneAll) {
      main = '<div class="actions"><button class="btn primary big" data-act="r432-go">🎙️ 라운드 ' + (i + 1) + ' 시작 (' + secTxt(secs[i]) + ')</button></div>';
    } else {
      var trend = s.rounds.map(function (x) { return x.durationSec ? Math.round(x.voicedSec / x.durationSec * 100) : 0; });
      main = '<div class="card"><h2>세 라운드 비교</h2><table class="cmp-table"><tr><th></th><th>말한 길이</th><th>멈춤</th><th>말한 비율</th></tr>' + s.rounds.map(function (x, j) {
        return '<tr><td>R' + (j + 1) + '</td><td>' + secTxt(x.voicedSec) + '</td><td>' + x.pauses + '회</td><td>' + trend[j] + '%</td></tr>';
      }).join('') + '</table><p class="small muted">시간은 줄어도 말한 비율이 오르고 멈춤이 줄면 잘하고 있는 거예요.</p></div>' +
        '<div class="actions"><button class="btn primary big" data-act="r432-finish">피드백 받기</button></div>';
    }
    render(routineHeader(r) + '<div class="stage">' +
      '<div class="topic"><div class="topic-ko">' + esc(s.topic.ko) + '</div><div class="topic-en">' + esc(s.topic.en || '') + '</div></div>' +
      '<p class="motto small">내용은 같고, 더 빨리, 덜 멈추세요.</p>' + tabs + main + '</div>');
  }
  function r432Go() {
    var r = currentRoutine(), s = session(r.output.sessionId), i = s.rounds.length, total = s.roundSecs[i];
    capture({ kind: '432', promptId: s.id + ':' + i, maxSec: total, onLevel: onLevel, onTick: function (t) {
      var el = $('#ringT'); if (el) el.textContent = mmss(total - t);
      var rg = $('#ring'); if (rg) rg.style.setProperty('--p', Math.min(1, t / total));
    } }).then(function (cap) {
      ui.cap = cap; ui.recording = true; renderRoutine();
      cap.done.then(function (res) {
        ui.recording = false; ui.cap = null;
        var rd = { sec: total, recId: res.id, durationSec: res.meta.durationSec, voicedSec: res.meta.voicedSec, pauses: res.meta.pauses, longestPauseSec: res.meta.longestPauseSec, transcript: '' };
        s.rounds.push(rd); r.output.utterances = s.rounds.length; save();
        vibrate(80);
        pendingTr[res.id] = res.transcript.then(function (t) { rd.transcript = t; save(); return t; });
        renderRoutine();
      });
    }, captureError);
  }
  function r432Finish() {
    var r = currentRoutine(), s = session(r.output.sessionId);
    if (s.rounds.length < 3) { toast('세 라운드를 모두 말해 주세요'); return; }
    advanceRoutine('output');
  }

  /* ======================= 5. 피드백 ======================= */
  function outputContext(r) {
    var s = session(r.output.sessionId);
    if (!s) return Promise.resolve({ task: 'Free talk', utterances: [], recIds: [] });
    if (s.kind === 'roleplay') {
      var sc = scenario(s.scenarioId);
      var mine = s.turns.filter(function (t) { return t.who === 'me'; });
      return Promise.resolve({ task: 'Roleplay. Situation: ' + sc.situation + ' Partner role: ' + sc.ai_role + '. Learner goal: ' + sc.goal + '. Dialogue for context:\n' + s.turns.map(function (t) { return (t.who === 'ai' ? 'PARTNER: ' : 'LEARNER: ') + t.text; }).join('\n'),
        utterances: mine.map(function (t) { return t.text; }), recIds: mine.map(function (t) { return t.recId; }), scenario: sc });
    }
    return Promise.all(s.rounds.map(function (rd) {
      if (rd.transcript) return rd.transcript;
      if (pendingTr[rd.recId]) return pendingTr[rd.recId];
      return Media.Store.meta(rd.recId).then(function (m) { return (m && m.transcript) || ''; }, function () { return ''; });
    })).then(function (trs) {
      trs.forEach(function (t, i) { if (t) s.rounds[i].transcript = t; });
      return { task: '4-3-2 fluency monologue, same topic three times with less time. Topic: ' + (s.topic.en || s.topic.ko), transcriptLabel: 'Learner said (round 1, 2, 3)', utterances: trs.filter(Boolean), recIds: s.rounds.map(function (x) { return x.recId; }) };
    });
  }
  function selfItems(r, ctx) {
    var out = [], seen = {};
    function add(en) { var k = T.tokens(en).join(' '); if (!k || seen[k] || out.length >= 3) return; seen[k] = 1; out.push({ original: '(방금 내 녹음 — 위의 ▶ 버튼으로 들어 보세요)', issue_ko: '이 표현을 넣어 말하면 더 잘 통합니다.', improved: en, layer: 'naturalness', severity: 'low', self: true }); }
    if (ctx.scenario) (ctx.scenario.must_use_chunk || []).concat([ctx.scenario.hint]).forEach(function (x) { if (x) add(x); });
    var pool = db.cards.filter(function (c) { return cardTags(c).indexOf(db.profile.goal) >= 0; });
    pool.sort(function (a, b) { return (b.srs.state !== 'new') - (a.srs.state !== 'new') || a.order - b.order; });
    pool.forEach(function (c) { add(c.example && T.tokens(c.example).length <= 14 ? c.example : c.en); });
    return out;
  }
  function loadFeedback(r) {
    var fb = r.feedback;
    fb.status = 'loading'; save(); renderRoutine();
    outputContext(r).then(function (ctx) {
      fb.utterances = ctx.utterances; fb.recIds = ctx.recIds;
      if (!AI.hasKey() || !ctx.utterances.length) {
        fb.self = true; fb.items = selfItems(r, ctx); fb.status = 'ready'; fb.selfReason = AI.hasKey() ? 'no-transcript' : 'no-key';
        save(); if (currentRoutine() === r && r.step === 'feedback') renderRoutine();
        return;
      }
      return AI.feedback({ task: ctx.task, utterances: ctx.utterances, level: db.profile.level, transcriptLabel: ctx.transcriptLabel }).then(function (d) {
        var items = d.items.length ? d.items : [F.fallbackItem(ctx.utterances)].filter(Boolean);
        fb.items = items; fb.comprehensible = d.comprehensible; fb.on_topic = d.on_topic;
        fb.repairAsked = !d.on_topic && !!d.repair_question; fb.repairQ = d.repair_question;
        items.forEach(function (it) { if (it.original !== it.improved) db.errors = E.add(db.errors, it, now()); });
        if (db.errors.length > 200) db.errors = db.errors.slice(-200);
        fb.status = 'ready'; fb.idx = 0; save();
        if (currentRoutine() === r && r.step === 'feedback') renderRoutine();
      });
    }).catch(function (err) {
      fb.status = 'error'; fb.error = AI.friendly(err); save();
      if (currentRoutine() === r && r.step === 'feedback') renderRoutine();
    });
  }
  function renderFeedbackStep(r) {
    var fb = r.feedback, hdr = routineHeader(r);
    if (fb.status === 'idle' || (fb.status === 'loading' && !ui.fbLoading)) { ui.fbLoading = true; loadFeedback(r); return; }
    if (fb.status === 'loading') {
      render(hdr + '<div class="stage"><h2>피드백을 만드는 중…</h2><p class="muted small">의미가 통했는지 먼저 보고, 꼭 필요한 것만 최대 3개 골라요.</p>' +
        [0, 1, 2].map(function () { return '<div class="skeleton"><i></i><i></i><i class="short"></i></div>'; }).join('') + '</div>');
      return;
    }
    if (fb.status === 'error') {
      render(hdr + '<div class="stage"><div class="notice warn">' + esc(fb.error) + '</div><button class="btn primary big" data-act="fb-retry">다시 시도</button><button class="btn ghost" data-act="fb-self">AI 없이 셀프 교정으로 진행</button></div>');
      return;
    }
    if (fb.repairAsked && !fb.repairDone) {
      render(hdr + '<div class="stage"><h2>먼저 확인할게요</h2><div class="bubble ai repair"><div class="who">🔁 확인 질문</div>' + esc(fb.repairQ) + ' <button class="icon-btn sm" data-act="say" data-t="' + esc(fb.repairQ) + '">🔊</button></div>' +
        '<p class="muted">말하려던 뜻을 한 문장으로 다시 말해 주세요. 교정은 그다음이에요.</p>' + (ui.recording ? levelMeter() : '') + recBtn('fb-repair-rec', ui.recording, '눌러서 답하기', 'huge') + '</div>');
      return;
    }
    var n = fb.items.length, i = Math.min(fb.idx, n - 1), it = fb.items[i], done = !!fb.reutter[i], blank = ui.blank && !done;
    var allDone = fb.items.every(function (_, j) { return !!fb.reutter[j]; });
    var head = '<div class="fb-head"><b>교정 ' + (i + 1) + '/' + n + '</b><div class="turn-dots">' + fb.items.map(function (_, j) { return '<span class="' + (fb.reutter[j] ? 'on' : j === i ? 'cur' : '') + '"></span>'; }).join('') + '</div></div>';
    var selfNote = fb.self ? '<div class="notice">' + (fb.selfReason === 'no-key' ? '셀프 교정 모드예요. 설정에서 AI 키를 넣으면 내 말에 맞춘 교정이 열려요.' : '받아쓰기가 없어 셀프 교정으로 진행해요.') + (fb.recIds && fb.recIds.length ? ' <button class="btn small-btn" data-act="play-rec" data-id="' + fb.recIds[fb.recIds.length - 1] + '">▶ 내 녹음 듣기</button>' : '') + '</div>' : '';
    var body;
    if (blank) {
      body = '<div class="fb-card blank"><p class="muted">빈 화면이에요. 방금 들은 더 자연스러운 문장을 떠올려서 말해 보세요.</p><p class="issue">' + esc(it.issue_ko) + '</p></div>';
    } else {
      body = '<div class="fb-card">' +
        '<div class="fb-sec"><div class="fb-lbl">내가 말한 것</div><div class="orig' + (it.self ? ' self' : '') + '">' + esc(it.original) + '</div></div>' +
        '<div class="fb-sec"><div class="fb-lbl">문제 한 줄</div><div class="issue">' + esc(it.issue_ko) + '</div></div>' +
        '<div class="fb-sec"><div class="fb-lbl">더 자연스러운 예문</div><div class="improved">' + esc(it.improved) + '</div></div>' +
        '<button class="btn secondary" data-act="fb-shadow">🔊 따라 말하기</button></div>';
    }
    var foot;
    if (done) {
      foot = '<div class="match">' + statLine(ui.lastMeta && ui.lastMeta.id === fb.reutter[i] ? ui.lastMeta : null) + '<div id="fbCmp">' + (ui.lastTr && ui.lastMetaIdx === i ? cmpHtml(it.improved, ui.lastTr) : '<span class="muted small">다시 말하기 완료 ✓</span>') + '</div></div>' +
        '<div class="actions">' + (i + 1 < n ? '<button class="btn primary big" data-act="fb-next">다음 교정</button>' : allDone ? '<button class="btn primary big" data-act="fb-complete">피드백 완료 → 청크 저장</button>' : '<button class="btn primary big" data-act="fb-first-missing">남은 교정 다시 말하기</button>') +
        '<button class="btn ghost" data-act="fb-redo">한 번 더 말하기</button></div>';
    } else {
      foot = (ui.recording ? levelMeter() : '') + '<div class="fb-rec">' + recBtn('fb-rec', ui.recording, blank ? '눌러서 말하기' : '빈 화면에서 다시 말하기', 'giant') + '</div>';
    }
    render(hdr + '<div class="stage">' + head + selfNote + body + foot + '</div>');
  }
  function fbRec(isRepair) {
    var r = currentRoutine(), fb = r.feedback, i = fb.idx;
    if (ui.recording) { if (ui.cap) ui.cap.stop(); return; }
    if (!isRepair) ui.blank = true;
    capture({ kind: isRepair ? 'repair' : 'reutter', promptId: isRepair ? 'repair' : String(i), maxSec: 40, onLevel: onLevel }).then(function (cap) {
      ui.cap = cap; ui.recording = true; renderRoutine();
      cap.done.then(function (res) {
        ui.recording = false; ui.cap = null; ui.blank = false;
        if (isRepair) { fb.repairDone = true; fb.repairRecId = res.id; save(); renderRoutine(); res.transcript.then(function (t) { fb.repairText = t; save(); }); return; }
        fb.reutter[i] = res.id; ui.lastMeta = res.meta; ui.lastMetaIdx = i; ui.lastTr = '';
        save(); renderRoutine();
        res.transcript.then(function (t) {
          if (!t) return;
          ui.lastTr = t;
          var box = $('#fbCmp'); if (box && currentRoutine() && currentRoutine().feedback.idx === i) box.innerHTML = cmpHtml(fb.items[i].improved, t);
        });
      });
    }, function (e) { ui.blank = false; captureError(e); renderRoutine(); });
  }

  /* ======================= 청크 3개 저장 ======================= */
  function suggestChunks(r) {
    var out = [], seen = {};
    function add(en, ko) { en = (en || '').trim(); var k = T.tokens(en).join(' '); if (!k || seen[k] || out.length >= 3) return; seen[k] = 1; out.push({ en: en, ko: ko || '' }); }
    (r.feedback.items || []).forEach(function (it) {
      if (!it.improved) return;
      var c0 = cardByText(it.improved);
      add(it.improved, c0 ? c0.ko : it.self ? '오늘 셀프 교정 문장' : '내가 했던 말 “' + it.original + '”를 자연스럽게');
    });
    var s = session(r.output.sessionId);
    if (s && s.kind === 'roleplay') { var sc = scenario(s.scenarioId); (sc.must_use_chunk || []).forEach(function (x) { var c = cardByText(x); add(x, c ? c.ko : '(' + sc.title + ') 상황에서'); }); add(sc.hint, '(' + sc.title + ') 상황에서'); }
    if (r.plan.warmup) add(r.plan.warmup.script, r.plan.warmup.kind === 'error' ? '지난번 교정: “' + r.plan.warmup.original + '”' : '');
    db.cards.filter(function (c) { return c.srs.state === 'new' && cardTags(c).indexOf(db.profile.goal) >= 0; }).slice(0, 5).forEach(function (c) { add(c.en, c.ko); });
    return out;
  }
  function renderChunksStep(r) {
    if (!r.chunks.suggested || !r.chunks.suggested.length) { r.chunks.suggested = suggestChunks(r); save(); }
    var sug = r.chunks.suggested;
    render(routineHeader(r) + '<div class="stage"><h2>오늘의 청크 3개 저장</h2><p class="muted small">피드백·대화에서 골랐어요. 고쳐도 돼요. 저장하면 <b>내일 복습</b>에 나와요.</p>' +
      '<div class="form" id="chunkForm">' + [0, 1, 2].map(function (i) {
        var x = sug[i] || { en: '', ko: '' };
        return '<div class="chunk-edit"><div class="ce-top"><span class="chip">' + (i + 1) + '</span><button class="icon-btn sm" data-act="ce-say" data-i="' + i + '" aria-label="듣기">🔊</button></div>' +
          '<input name="en' + i + '" value="' + esc(x.en) + '" placeholder="영어 청크 (말할 문장)" autocomplete="off" autocapitalize="off">' +
          '<input name="ko' + i + '" value="' + esc(x.ko) + '" placeholder="뜻·상황 메모 (선택)"></div>';
      }).join('') + '</div><div class="actions"><button class="btn primary big" data-act="chunks-save">3개 저장하고 루틴 완료</button></div></div>');
  }
  function saveChunks() {
    var r = currentRoutine(), f = $('#chunkForm'), ids = [], rows = [];
    for (var i = 0; i < 3; i++) {
      var en = f.querySelector('[name=en' + i + ']').value.trim(), ko = f.querySelector('[name=ko' + i + ']').value.trim();
      if (!en) { toast('청크 3개를 모두 채워 주세요'); return; }
      if (rows.some(function (x) { return T.tokens(x.en).join(' ') === T.tokens(en).join(' '); })) { toast('서로 다른 청크 3개를 넣어 주세요'); return; }
      rows.push({ en: en, ko: ko });
    }
    var due = S.addDays(S.studyDayStart(now()), 1), maxOrder = db.cards.reduce(function (m, c) { return Math.max(m, c.order || 0); }, 0);
    rows.forEach(function (x) {
      var c = cardByText(x.en);
      if (!c) {
        c = makeCard({ id: uid('u'), en: x.en, ko: x.ko || '(오늘 루틴에서 저장)', example: '', category: 'custom', source: 'routine' }, ++maxOrder, true);
        c.goal = db.profile.goal;
        db.cards.push(c);
      } else if (x.ko && !c.custom) { /* 시드 카드 뜻은 유지 */ } else if (x.ko) c.ko = x.ko;
      c.srs = Object.assign({}, c.srs, { state: 'review', step: 0, due: due, interval: 1, lastReview: now() });
      c.savedAt = now();
      if (ids.indexOf(c.id) < 0) ids.push(c.id);
      markUsed(c.id);
    });
    r.chunks.suggested = rows;
    r.chunks.savedIds = ids;
    advanceRoutine('chunks');
  }
  function renderRoutineDone(r) {
    var l = todayLog();
    render('<div class="stage done-screen"><div class="big-emoji">🎉</div><h1>오늘 루틴 완료</h1>' +
      '<p>오늘 입으로 말한 시간 <b>' + secTxt(l.spokenSec) + '</b></p>' +
      '<div class="boxes">' + R.STEPS.map(function (k) { return '<div class="box done"><span class="bx">✓</span>' + STEP_LABEL[k] + '</div>'; }).join('') + '</div>' +
      '<div class="card"><h2>내일 복습에 나올 청크</h2>' + (r.chunks.suggested || []).map(function (x) { return '<div class="kv"><span>' + esc(x.en) + '</span></div>'; }).join('') + '</div>' +
      '<p class="muted small">이번 주에 사람과 10분만 말해 보세요. 오늘 저장한 청크 하나를 꼭 써 보고요.</p>' +
      '<div class="actions"><button class="btn primary big" data-act="home">홈으로</button><button class="btn ghost" data-act="review">청크 복습 더 하기</button></div></div>');
  }

  /* ======================= 6. 청크 덱 ======================= */
  var STATE_LABEL = { 'new': '새 청크', learning: '학습 중', relearning: '재학습', review: '복습' };
  var chunkView = 'today';
  function renderChunks() {
    var l = todayLog(), rc = reviewCounts();
    var used = l.usedCardIds.map(card).filter(Boolean);
    var missed = l.missedCardIds.map(card).filter(Boolean);
    if (!missed.length) { var y = db.log[yesterdayKey()]; missed = ((y && y.missedCardIds) || []).map(card).filter(Boolean); }
    var rec = db.cards.filter(function (c) { return c.srs.state === 'new' && cardTags(c).indexOf(db.profile.goal) >= 0; }).sort(function (a, b) { return a.order - b.order; }).slice(0, 12);
    var lists = { today: used, missed: missed, rec: rec };
    var empty = { today: '오늘 말하면서 쓴 청크가 여기에 모여요.', missed: '놓친 청크가 없어요. 좋아요.', rec: '추천할 새 청크가 없어요.' };
    var items = lists[chunkView];
    var nErr = E.recent(db.errors, now(), 14).length;
    render('<header class="top"><h1>청크</h1><button class="btn ghost small-btn" data-act="manage">전체 관리</button></header>' +
      '<button class="btn primary big" data-act="review"' + (rc.due + rc.newLeft ? '' : ' disabled') + '>🗣️ 말하며 복습 ' + (rc.due + rc.newLeft) + '장 <span class="small">(복습 ' + rc.due + ' · 새 ' + rc.newLeft + ')</span></button>' +
      '<p class="muted small center">듣기 → 따라 말하기 → 빈칸 말하기 → 상황 한 줄 · 타이핑 없이 말로만</p>' +
      '<div class="seg-tabs" role="tablist">' + [['today', '오늘 쓴 ' + used.length], ['missed', '못 쓴 ' + missed.length], ['rec', '추천']].map(function (t) {
        return '<button role="tab" class="' + (chunkView === t[0] ? 'sel' : '') + '" data-act="chunk-view" data-v="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<ul class="card-list">' + (items.length ? items.map(chunkItem).join('') : '<li class="muted center small">' + empty[chunkView] + '</li>') + '</ul>' +
      '<button class="btn ghost" data-act="errors">📝 오류 노트 (최근 2주 ' + nErr + '개)</button>');
  }
  function chunkItem(c) {
    return '<li><button class="card-item" data-act="card-edit" data-id="' + esc(c.id) + '"><div class="ci-en">' + esc(c.en) + '</div><div class="ci-ko">' + esc(c.ko) + '</div>' +
      '<div class="ci-meta"><span class="chip">' + esc(cardTags(c).map(function (g) { return GOALS[g]; }).join('·')) + '</span><span class="st st-' + c.srs.state + '">' + STATE_LABEL[c.srs.state] + '</span><span>' + dueLabel(c) + '</span></div></button></li>';
  }
  function renderErrors() {
    var list = E.recent(db.errors, now(), 14);
    render('<header class="top"><button class="icon-btn" data-act="chunks" aria-label="뒤로">←</button><h1>오류 노트</h1><span></span></header>' +
      '<p class="muted small">최근 2주 동안 교정받은 말이에요. 자주 나온 것부터. 하나씩 다음 날 워밍업에 들어가요.</p>' +
      (list.length ? list.map(function (e) {
        return '<section class="card err"><div class="orig">' + esc(e.original) + '</div><div class="issue">' + esc(e.issue_ko) + '</div><div class="improved">→ ' + esc(e.improved) +
          ' <button class="icon-btn sm" data-act="say" data-t="' + esc(e.improved) + '">🔊</button></div><div class="ci-meta"><span>' + e.count + '회</span><span>워밍업 ' + (e.warmups || 0) + '회</span><span>' + e.dates.slice(-1)[0] + '</span></div></section>';
      }).join('') : '<p class="muted center">아직 없어요. 피드백을 받으면 여기에 쌓여요.</p>'));
  }

  /* 말하며 복습 */
  var review = null;
  var RV_PHASES = ['listen', 'shadow', 'cloze', 'use'];
  var RV_LABEL = { listen: '듣기', shadow: '따라 말하기', cloze: '빈칸 말하기', use: '상황 한 줄' };
  function startReview() {
    var t = now(), lg = todayLog(), st = db.settings;
    var due = db.cards.filter(function (c) { return c.srs.state !== 'new' && c.srs.due <= t; }).sort(function (a, b) { return a.srs.due - b.srs.due; }).slice(0, Math.max(0, st.maxReviews - lg.reviewCount));
    var news = db.cards.filter(function (c) { return c.srs.state === 'new'; }).sort(function (a, b) {
      return (cardTags(b).indexOf(db.profile.goal) >= 0) - (cardTags(a).indexOf(db.profile.goal) >= 0) || a.order - b.order;
    }).slice(0, Math.max(0, st.newPerDay - lg.newCount));
    var q = M.interleave(due, function (c) { return c.category; }).concat(news).map(function (c) { return c.id; });
    if (!q.length) { toast('지금 복습할 청크가 없어요'); return; }
    review = { queue: q, idx: 0, total: q.length, startedAt: t, results: [], cur: null };
    nextReviewCard();
    go('review');
  }
  function nextReviewCard() {
    var id = review.queue[review.idx];
    review.cur = id ? { id: id, phase: 'listen', sim: null, latency: null, cueAt: 0, transcript: '', use: '', listening: false, gaveUp: false } : null;
  }
  function renderReview() {
    if (!review) return go('chunks');
    if (!review.cur) return finishReview();
    var cur = review.cur, c = card(cur.id);
    if (!c) { review.idx++; nextReviewCard(); return renderReview(); }
    var pi = RV_PHASES.indexOf(cur.phase === 'reveal' ? 'cloze' : cur.phase);
    var hdr = '<div class="sess-top"><button class="icon-btn" data-act="rv-quit" aria-label="끝내기">✕</button><div class="sess-prog"><div class="progress thin"><span style="width:' + Math.round(review.idx / review.total * 100) + '%"></span></div>' +
      '<div class="muted small">' + (review.idx + 1) + '/' + review.total + ' · ' + (cur.phase === 'grade' ? '채점' : RV_LABEL[cur.phase]) + '</div></div><span></span></div>' +
      '<div class="modes">' + RV_PHASES.map(function (p, i) { return '<span class="' + (i === pi ? 'cur' : i < pi || cur.phase === 'grade' ? 'done' : '') + '">' + RV_LABEL[p] + '</span>'; }).join('') + '</div>';
    var ws = recogAvailable();
    var body = '';
    if (cur.phase === 'listen') {
      body = '<div class="ko-cue small-cue">' + esc(c.ko) + '</div><div class="en-big">' + esc(c.en) + '</div>' + (c.example ? '<p class="example">' + esc(c.example) + '</p>' : '') +
        '<button class="btn secondary" data-act="rv-say">🔊 다시 듣기</button><div class="actions"><button class="btn primary big" data-act="rv-next">다음: 따라 말하기</button></div>';
    } else if (cur.phase === 'shadow') {
      body = '<div class="en-big">' + esc(c.en) + '</div><p class="guide">소리 내어 2번 따라 말하세요.</p><button class="btn secondary" data-act="rv-say">🔊 듣고 따라 말하기</button>' +
        '<div class="actions"><button class="btn primary big" data-act="rv-next">따라 말했어요 → 빈칸 말하기</button></div>';
    } else if (cur.phase === 'cloze') {
      body = '<div class="ko-cue">' + esc(c.ko) + '</div><div class="cloze">' + esc(T.cloze(c.en)) + '</div>' +
        '<div class="timer" id="rvTimer">0.0<small>초</small></div>' +
        (cur.transcript ? '<div class="match">' + cmpHtml(c.en, cur.transcript) + '</div>' : '') +
        (ws ? recBtn('rv-mic', cur.listening, '빈칸을 채워 전체를 말하기') : '<div class="notice">' + (SR ? '브라우저 음성 인식을 쓸 수 없어요' : '이 브라우저는 음성 인식이 없어요') + '. 소리 내어 말한 뒤 눌러 주세요.</div>') +
        '<div class="actions">' + (ws ? '' : '<button class="btn primary big" data-act="rv-said">말했어요</button>') + (cur.transcript ? '<button class="btn primary big" data-act="rv-reveal">정답 보기</button>' : '') + '<button class="btn link" data-act="rv-giveup">생각이 안 나요</button></div>';
    } else if (cur.phase === 'reveal') {
      body = '<div class="en-big">' + esc(c.en) + '</div>' + (cur.transcript ? '<div class="match">' + cmpHtml(c.en, cur.transcript) + '</div>' : '') +
        (cur.latency != null ? '<div class="latency ' + (cur.latency / 1000 > db.settings.latencyThreshold ? 'slow' : 'fast') + '">말하기까지 ' + (cur.latency / 1000).toFixed(1) + '초</div>' : '') +
        '<button class="btn secondary" data-act="rv-say">🔊 듣기</button><div class="actions"><button class="btn primary big" data-act="rv-to-use">다음: 상황 한 줄</button></div>';
    } else if (cur.phase === 'use') {
      body = '<div class="en-mid">' + esc(c.en) + '</div><p class="guide">이 청크로 <b>내 상황</b>을 한 줄 말해 보세요.</p>' +
        (c.slot ? '<div class="slot">' + esc(c.slot) + '</div>' : '<div class="slot">' + esc(c.en.replace(/[.?!]$/, '')) + ' + 내 이야기</div>') +
        (cur.use ? '<div class="said">내가 말한 것: ' + esc(cur.use) + '</div>' : '') +
        (ws ? recBtn('rv-use-mic', cur.listening, '한 줄 말하기') : '') +
        '<div class="actions"><button class="btn primary big" data-act="rv-to-grade">' + (ws ? '다 말했어요 → 채점' : '말했어요 → 채점') + '</button></div>';
    } else {
      var sug = T.suggestGrade({ sim: cur.sim, latencyMs: cur.latency, thresholdSec: db.settings.latencyThreshold, gaveUp: cur.gaveUp });
      var pv = S.preview(c.srs, now(), SCHED);
      body = '<div class="en-mid">' + esc(c.en) + '</div><p class="muted small">빈칸 말하기가 얼마나 쉬웠나요? 실패하면 내일 다시 나와요.</p><div class="grades">' + [1, 2, 3, 4].map(function (g) {
        return '<button class="grade g' + g + (g === sug ? ' suggested' : '') + '" data-act="rv-grade" data-g="' + g + '">' + (g === sug ? '<span class="rec">추천</span>' : '') + '<span class="gl">' + GRADE_LABEL[g] + '</span><span class="gi">' + (pv[g] === '1일' ? '내일' : pv[g] + ' 뒤') + '</span></button>';
      }).join('') + '</div>';
    }
    render(hdr + '<div class="stage">' + body + '</div>');
    if (cur.phase === 'cloze' && !cur.transcript && !cur.gaveUp) {
      if (!cur.cueAt) cur.cueAt = now();
      every(function () { var el = $('#rvTimer'); if (el && review && review.cur === cur && cur.latency == null) el.innerHTML = ((now() - cur.cueAt) / 1000).toFixed(1) + '<small>초</small>'; }, 100);
    }
  }
  function rvListen(field) {
    var cur = review.cur, c = card(cur.id);
    if (cur.listening) { stopListening(); return; }
    ensureMic().then(function (ok) {
      if (!ok) return;
      cur.listening = true; renderReview();
      listen({
        onSpeechStart: function () { if (field === 'transcript' && cur.latency == null && cur.cueAt) cur.latency = now() - cur.cueAt; },
        onResult: function (f, i) { if (field === 'transcript' && cur.latency == null && cur.cueAt && (f || i)) cur.latency = now() - cur.cueAt; },
        onEnd: function (f) {
          if (!review || review.cur !== cur) return;
          cur.listening = false;
          if (f) {
            if (field === 'transcript') { cur.transcript = f; cur.sim = T.compare(c.en, f).score; }
            else { cur.use = f; c.mine.push({ text: f, at: now() }); if (T.containsChunk(f, c.en, 0.8)) markUsed(c.id); save(); }
          } else if (recogBroken) toast('음성 인식을 쓸 수 없어 자가 채점으로 바꿀게요');
          renderReview();
        }
      }, false);
    });
  }
  function rvGrade(g) {
    var cur = review.cur, c = card(cur.id), lg = todayLog();
    var wasNew = c.srs.state === 'new';
    c.srs = S.schedule(c.srs, g, now(), SCHED);
    c.hist.push({ at: now(), g: g, lat: cur.latency, sim: cur.sim });
    if (c.hist.length > 50) c.hist = c.hist.slice(-50);
    if (cur.latency != null) { c.lat.push(Math.round(cur.latency)); if (c.lat.length > 20) c.lat = c.lat.slice(-20); lg.lat.push(Math.round(cur.latency)); }
    if (wasNew) lg.newCount++; else lg.reviewCount++;
    if (lg.cardIds.indexOf(c.id) < 0) lg.cardIds.push(c.id);
    if (g === 1) { lg.usedCardIds = lg.usedCardIds.filter(function (x) { return x !== c.id; }); markMissed(c.id); } else markUsed(c.id);
    review.results.push({ id: c.id, g: g });
    save();
    review.idx++; nextReviewCard(); renderReview();
  }
  function finishReview(silent) {
    if (!review) return;
    var n = review.results.length, lg = todayLog();
    lg.ms += now() - review.startedAt;
    if (n) lg.sessions += 1;
    save();
    review = null;
    if (!silent) { toast(n ? '복습 ' + n + '장 끝! 내일 또 나와요' : '복습을 마쳤어요'); go('chunks'); }
  }

  /* 전체 관리 · 수정 */
  var cardFilter = { q: '', cat: '' };
  function renderManage() {
    var list = db.cards.slice().sort(function (a, b) { return a.order - b.order; });
    var n = { 'new': 0, learning: 0, relearning: 0, review: 0 };
    db.cards.forEach(function (c) { n[c.srs.state]++; });
    var catOpts = '<option value="">전체</option>' + Object.keys(CATS).map(function (k) { return '<option value="' + k + '"' + (cardFilter.cat === k ? ' selected' : '') + '>' + esc(CATS[k]) + '</option>'; }).join('');
    render('<header class="top"><button class="icon-btn" data-act="chunks" aria-label="뒤로">←</button><h1>청크 관리</h1><button class="btn primary small-btn" data-act="card-new">＋ 새 청크</button></header>' +
      '<div class="muted small">전체 ' + db.cards.length + ' · 새 ' + n['new'] + ' · 학습 중 ' + (n.learning + n.relearning) + ' · 복습 ' + n.review + '</div>' +
      '<div class="filters"><input id="cardQ" type="search" placeholder="검색" value="' + esc(cardFilter.q) + '"><select id="cardCat">' + catOpts + '</select></div><ul class="card-list" id="cardList"></ul>');
    var draw = function () {
      var q = cardFilter.q.trim().toLowerCase();
      var items = list.filter(function (c) { return (!cardFilter.cat || c.category === cardFilter.cat) && (!q || (c.en + ' ' + c.ko + ' ' + c.example).toLowerCase().indexOf(q) >= 0); });
      $('#cardList').innerHTML = items.length ? items.map(chunkItem).join('') : '<li class="muted center">해당하는 청크가 없어요</li>';
    };
    draw();
    $('#cardQ').addEventListener('input', function (e) { cardFilter.q = e.target.value; draw(); });
    $('#cardCat').addEventListener('change', function (e) { cardFilter.cat = e.target.value; draw(); });
  }
  function renderEdit(id) {
    var isNew = !id || id === 'new';
    var c = isNew ? { id: '', en: '', ko: '', example: '', slot: '', category: 'custom', mine: [], srs: S.newSrs(), lat: [] } : card(id);
    if (!c) return go('chunks');
    var catOpts = Object.keys(CATS).map(function (k) { return '<option value="' + k + '"' + (c.category === k ? ' selected' : '') + '>' + esc(CATS[k]) + '</option>'; }).join('');
    var mine = (c.mine || []).map(function (m, i) { return '<li><span>“' + esc(m.text) + '”</span><button class="icon-btn sm" data-act="mine-del" data-i="' + i + '" aria-label="삭제">🗑</button></li>'; }).join('');
    var info = isNew ? '' : '<div class="muted small">상태: ' + STATE_LABEL[c.srs.state] + ' · 다음: ' + dueLabel(c) + (c.srs.state === 'review' ? ' · 간격 ' + S.formatDays(c.srs.interval) : '') + ' · 복습 ' + c.srs.reps + '회 · 잊음 ' + c.srs.lapses + '회</div>';
    render('<header class="top"><button class="icon-btn" data-act="manage" aria-label="뒤로">←</button><h1>' + (isNew ? '새 청크' : '청크 수정') + '</h1><span></span></header>' +
      '<form id="editForm" class="form" data-id="' + esc(c.id) + '">' +
      '<label>영어 청크 (말할 문장) *<textarea name="en" rows="2" required>' + esc(c.en) + '</textarea></label>' +
      '<label>한국어 뜻 + 상황 *<textarea name="ko" rows="2" required>' + esc(c.ko) + '</textarea></label>' +
      '<label>예문<textarea name="example" rows="2">' + esc(c.example) + '</textarea></label>' +
      '<label>바꿔 말하기 틀 (빈칸 ___)<input name="slot" value="' + esc(c.slot) + '"></label>' +
      '<label>카테고리<select name="category">' + catOpts + '</select></label>' +
      '<button type="button" class="btn ghost" data-act="edit-tts">🔊 들어보기</button>' +
      (mine ? '<div class="muted small">내가 말한 문장</div><ul class="mine-edit">' + mine + '</ul>' : '') + info +
      '<button type="submit" class="btn primary big">저장</button>' +
      (isNew ? '' : '<div class="row2"><button type="button" class="btn ghost" data-act="card-reset">학습 기록 초기화</button><button type="button" class="btn danger" data-act="card-del">삭제</button></div>') + '</form>');
    $('#editForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, v = function (n) { return f.elements[n].value.trim(); };
      if (!v('en') || !v('ko')) { toast('영어 청크와 한국어 뜻은 꼭 필요해요'); return; }
      var target;
      if (isNew) { var mo = db.cards.reduce(function (m, x) { return Math.max(m, x.order || 0); }, 0); target = makeCard({ id: uid('u'), en: v('en'), ko: v('ko') }, mo + 1, true); db.cards.push(target); }
      else target = card(c.id);
      target.en = v('en'); target.ko = v('ko'); target.example = v('example'); target.slot = v('slot'); target.category = f.elements.category.value;
      save(); toast('저장했어요'); go('manage');
    });
  }

  /* ======================= 7. 진행 ======================= */
  function renderProgress() {
    var wk = Core.Days.weekStats(db.log, now());
    render('<header class="top"><h1>진행</h1></header>' +
      '<section class="card"><div class="stat-row">' +
        '<div class="stat"><div class="num">' + minTxt(wk.spokenSec) + '</div><div class="lbl">이번 주 말한 분</div></div>' +
        '<div class="stat"><div class="num">' + wk.sessions + '</div><div class="lbl">세션 수</div></div>' +
        '<div class="stat"><div class="num">' + streak() + '</div><div class="lbl">연속일</div></div></div>' +
        '<p class="muted small center">말한 분 = 녹음에서 실제로 소리 낸 시간 (화면 시간 아님)</p></section>' +
      '<div class="tip">이번 주에 사람과 10분만 말해 보세요.</div>' +
      '<section class="card" id="cmpWeekly"><h2>같은 질문, 다시 녹음</h2><p class="muted small">매주 “' + esc(C.WEEKLY_PROMPT.ko) + '”에 1분 답하고 처음과 비교해요.</p><div class="cmp-slot">불러오는 중…</div></section>' +
      '<section class="card" id="cmpIntro"><h2>첫 자기소개 vs 최근</h2><div class="cmp-slot">불러오는 중…</div></section>');
    Media.Store.list().then(function (all) {
      var weekly = all.filter(function (m) { return m.kind === 'weekly'; });
      var intros = all.filter(function (m) { return m.kind === 'intro'; });
      var first = intros.filter(function (m) { return m.id === db.profile.introRecId; })[0] || intros[0];
      var wkKeys = Core.Days.weekKeys(now());
      var thisWeek = weekly.some(function (m) { return wkKeys.indexOf(m.date) >= 0; });
      fillCmp('#cmpWeekly', weekly[0], weekly.length > 1 ? weekly[weekly.length - 1] : null, '<button class="btn ' + (thisWeek ? 'ghost' : 'primary') + '" data-act="rec-weekly">🎙️ ' + (thisWeek ? '이번 주 다시 녹음' : '이번 주 녹음하기 (1분)') + '</button>');
      var latest = intros.length > 1 ? intros[intros.length - 1] : null;
      fillCmp('#cmpIntro', first, latest && latest !== first ? latest : null, '<button class="btn ghost" data-act="rec-intro">🎙️ 자기소개 ' + (first ? '다시 ' : '') + '녹음 (30초)</button>');
    }, function () { document.querySelectorAll('.cmp-slot').forEach(function (e) { e.textContent = '녹음을 불러오지 못했어요'; }); });
  }
  function cmpPanel(m, label) {
    if (!m) return '<div class="cmp-col empty"><div class="cmp-lbl">' + label + '</div><p class="muted small">아직 없어요</p></div>';
    return '<div class="cmp-col"><div class="cmp-lbl">' + label + ' · ' + esc(m.date) + '</div><button class="btn secondary small-btn" data-act="play-rec" data-id="' + m.id + '">▶ 재생</button>' +
      '<div class="kv small"><span>길이</span><b>' + secTxt(m.durationSec) + '</b></div><div class="kv small"><span>말한 길이</span><b>' + secTxt(m.voicedSec) + '</b></div><div class="kv small"><span>멈춤</span><b>' + (m.pauses || 0) + '회</b></div>' +
      '<p class="transcript small">' + (m.transcript ? esc(m.transcript) : (AI.hasKey() ? '<button class="btn small-btn ghost" data-act="transcribe" data-id="' + m.id + '">받아쓰기</button>' : '<span class="muted">(받아쓰기 없음)</span>')) + '</p></div>';
  }
  function fillCmp(sel, a, b, btn) {
    var el = $(sel + ' .cmp-slot'); if (!el) return;
    el.innerHTML = '<div class="cmp-grid">' + cmpPanel(a, '처음') + cmpPanel(b, '최근') + '</div>' + btn;
  }
  var recPrompt = null;
  function renderRec(kind) {
    var P = kind === 'intro' ? { kind: 'intro', ko: '30초 자기소개', en: C.INTRO_PROMPT.en, max: 30 } : { kind: 'weekly', ko: C.WEEKLY_PROMPT.ko, en: C.WEEKLY_PROMPT.en, max: 60 };
    recPrompt = P;
    var res = ui.res;
    render('<div class="sess-top"><button class="icon-btn" data-act="progress" aria-label="닫기">✕</button><div class="sess-prog"><b class="small">' + (kind === 'intro' ? '자기소개 다시 녹음' : '주간 비교 녹음') + '</b></div><span></span></div>' +
      '<div class="stage"><div class="prompt-card"><p class="topic-ko">' + esc(P.ko) + '</p><p class="en-mid">' + esc(P.en) + '</p></div>' +
      (ui.recording ? '<div class="timer" id="recTimer">' + mmss(P.max) + '</div>' + levelMeter() : '') +
      (res ? '<div class="card">' + statLine(res.meta) + '<p class="transcript" id="recTr">' + esc(res.meta.transcript || (AI.hasKey() ? '받아쓰는 중…' : '')) + '</p><button class="btn secondary" data-act="play-rec" data-id="' + res.id + '">▶ 들어보기</button></div>' +
        '<div class="actions"><button class="btn primary big" data-act="progress">진행에서 비교하기</button></div>' : recBtn('rec-go', ui.recording, '눌러서 녹음 (최대 ' + P.max + '초)', 'huge')) + '</div>');
  }
  function recGo() {
    var P = recPrompt;
    if (ui.recording) { if (ui.cap) ui.cap.stop(); return; }
    capture({ kind: P.kind, promptId: P.kind === 'intro' ? 'intro' : C.WEEKLY_PROMPT.id, maxSec: P.max, onLevel: onLevel, onTick: function (t) { var el = $('#recTimer'); if (el) el.textContent = mmss(P.max - t); } }).then(function (cap) {
      ui.cap = cap; ui.recording = true; renderRec(P.kind);
      cap.done.then(function (res) {
        ui.recording = false; ui.cap = null; ui.res = res;
        if (P.kind === 'intro' && !db.profile.introRecId) { db.profile.introRecId = res.id; save(); }
        renderRec(P.kind);
        res.transcript.then(function (t) { var el = $('#recTr'); if (el) el.textContent = t || '(받아쓰기 없음)'; });
      });
    }, captureError);
  }

  /* ======================= 설정 ======================= */
  function renderSettings(param) {
    var st = db.settings, p = db.profile, prov = AI.provider(), P = AI.PROVIDERS[prov], key = AI.getKey(prov);
    loadVoices();
    var vlist = voices.filter(function (v) { return accentRe().test(v.lang); });
    if (!vlist.length) vlist = voices;
    var sel = function (name, vals, cur, labels) { return '<select data-set="' + name + '">' + vals.map(function (x, i) { return '<option value="' + x + '"' + (String(cur) === String(x) ? ' selected' : '') + '>' + (labels ? labels[i] : x) + '</option>'; }).join('') + '</select>'; };
    render('<header class="top"><h1>설정</h1></header>' +
      '<section class="card form"><h2>학습</h2>' +
        '<label class="inline">목표' + sel('p.goal', Object.keys(GOALS), p.goal, Object.keys(GOALS).map(function (g) { return GOALS[g]; })) + '</label>' +
        '<label class="inline">하루 시간' + sel('p.minutes', [10, 20, 30], p.minutes, ['10분', '20분', '30분']) + '</label>' +
        '<label class="inline">수준' + sel('p.level', Object.keys(LEVELS), p.level, Object.keys(LEVELS).map(function (l) { return LEVELS[l]; })) + '</label>' +
        '<div class="lbl-row">관심 주제 (최대 3개)</div><div class="chip-grid">' + Object.keys(C.INTERESTS).map(function (k) { return '<button class="pick' + (p.topics.indexOf(k) >= 0 ? ' sel' : '') + '" data-act="set-topic" data-v="' + k + '">' + esc(C.INTERESTS[k]) + '</button>'; }).join('') + '</div>' +
        '<label class="switch"><input type="checkbox" data-set="scriptDefault"' + (st.scriptDefault ? ' checked' : '') + '> 쉐도잉 스크립트 기본으로 보기</label>' +
        '<label class="switch"><input type="checkbox" data-set="koHints"' + (st.koHints ? ' checked' : '') + '> 한국어 발음 힌트 보기</label>' +
        '<label class="inline">하루 새 청크' + sel('newPerDay', [0, 3, 5, 8, 10, 15], st.newPerDay) + '</label>' +
      '</section>' +
      '<section class="card form"><h2>소리</h2>' +
        '<label class="inline">억양' + sel('accent', ['us', 'uk'], st.accent, ['미국 (US)', '영국 (UK)']) + '</label>' +
        '<label class="inline">기본 속도' + sel('rate', RATES, st.rate, RATES.map(function (x) { return x.toFixed(1) + '×'; })) + '</label>' +
        '<label>목소리<select data-set="voiceURI"><option value="">자동 (' + (st.accent === 'uk' ? 'en-GB' : 'en-US') + ' 우선)</option>' + vlist.map(function (v) { return '<option value="' + esc(v.voiceURI) + '"' + (st.voiceURI === v.voiceURI ? ' selected' : '') + '>' + esc(v.name + ' (' + v.lang + ')') + '</option>'; }).join('') + '</select></label>' +
        '<button class="btn ghost" data-act="tts-test">🔊 테스트</button>' +
        '<label class="switch"><input type="checkbox" data-set="useWebSpeech"' + (st.useWebSpeech ? ' checked' : '') + '> AI 키가 없을 때 브라우저 음성 인식 사용 <span class="muted small">(' + (SR ? (recogBroken ? '⚠️ ' + recogBrokenReason : '지원됨') : '미지원') + ')</span></label>' +
      '</section>' +
      '<section class="card form" id="ai"><h2>AI (롤플레이 · 피드백 · 받아쓰기)</h2>' +
        '<label class="inline">제공자' + sel('provider', Object.keys(AI.PROVIDERS), prov, Object.keys(AI.PROVIDERS).map(function (k) { return AI.PROVIDERS[k].name + (k === 'gemini' ? ' (기본·무료 등급)' : ''); })) + '</label>' +
        '<label>API 키 <input id="aiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(P.keyHint) + '" value="' + esc(key) + '"></label>' +
        '<div class="row gap"><button class="btn primary small-btn" data-act="key-save">키 저장</button><button class="btn ghost small-btn" data-act="key-test"' + (key ? '' : ' disabled') + '>연결 테스트</button><button class="btn ghost small-btn" data-act="key-del"' + (key ? '' : ' disabled') + '>키 삭제</button></div>' +
        '<div class="notice">🔐 키는 <b>이 기기의 브라우저에만</b> 저장돼요. 서버·저장소·백업 파일 어디에도 들어가지 않아요. 키 발급: <a href="' + P.keyUrl + '" target="_blank" rel="noopener">' + esc(P.keyUrl.replace('https://', '')) + '</a></div>' +
        '<label>모델 ID<input data-model="1" value="' + esc((st.models || {})[prov] || '') + '" placeholder="' + esc(P.model) + '" autocapitalize="off" spellcheck="false"></label>' +
        '<p class="muted small">비워 두면 기본값(' + esc(P.model) + ')을 써요. ' + esc(P.note) + '</p>' +
        '<p class="muted small">상태: ' + (key ? '✓ 키 있음 — 롤플레이·AI 피드백·받아쓰기 사용' : '키 없음 — 쉐도잉·4-3-2·청크 복습·셀프 교정만 사용') + '</p>' +
      '</section>' +
      '<section class="card form"><h2>내 목소리와 기록</h2>' +
        '<p class="small">녹음과 기록은 이 기기에만 저장돼요. 이 앱은 목소리를 학습(모델 훈련)에 쓰지 않아요. 단, AI 키를 넣으면 받아쓰기·롤플레이·피드백을 위해 녹음/텍스트가 고른 제공자(' + esc(P.name) + ')로 전송되고, 그 제공자의 정책을 따라요.</p>' +
        '<p class="muted small" id="recCount">녹음 개수 확인 중…</p>' +
        '<button class="btn danger" data-act="delete-voice">음성·텍스트 기록 모두 삭제</button>' +
      '</section>' +
      '<section class="card form"><h2>백업 · 복원</h2>' +
        '<label class="switch"><input type="checkbox" id="bkRec"> 녹음도 포함 (파일이 커져요)</label>' +
        '<button class="btn secondary" data-act="export">⬇️ JSON 내보내기</button><button class="btn secondary" data-act="import">⬆️ JSON 가져오기</button>' +
        '<input type="file" id="importFile" accept="application/json,.json" hidden>' +
        '<button class="btn ghost" data-act="reset-all">처음부터 다시 (모든 기록 초기화)</button>' +
      '</section>' +
      '<button class="btn ghost" data-act="why">❓ 왜 이렇게 하나요?</button>' +
      '<p class="muted small center">말하기 루틴 v' + APP_VERSION + ' · PRD v1.1</p>');
    app.querySelectorAll('[data-set]').forEach(function (el) {
      el.addEventListener('change', function () {
        var k = el.getAttribute('data-set');
        var val = el.type === 'checkbox' ? el.checked : el.value;
        if (/^p\./.test(k)) { k = k.slice(2); db.profile[k] = k === 'minutes' ? Number(val) : val; }
        else {
          if (['rate', 'newPerDay'].indexOf(k) >= 0) val = Number(val);
          db.settings[k] = val;
          if (k === 'useWebSpeech' && val) { recogBroken = false; recogBrokenReason = ''; }
          if (k === 'accent') db.settings.voiceURI = '';
          if (k === 'provider') applyAIConfig();
        }
        save(); toast('저장했어요');
        if (k === 'provider' || k === 'accent') renderSettings();
      });
    });
    var mi = app.querySelector('[data-model]');
    mi.addEventListener('change', function () { db.settings.models = db.settings.models || {}; db.settings.models[AI.provider()] = mi.value.trim(); applyAIConfig(); save(); toast('모델을 저장했어요'); });
    $('#importFile').addEventListener('change', importFile);
    Media.Store.count().then(function (n) { var el = $('#recCount'); if (el) el.textContent = '저장된 녹음 ' + n + '개 · 대화 기록 ' + db.sessions.length + '개 · 오류 노트 ' + db.errors.length + '개'; }, function () {});
    if (param === 'ai') { var a = $('#ai'); if (a) setTimeout(function () { a.scrollIntoView(); }, 30); }
  }
  function exportJson() {
    var withRec = $('#bkRec') && $('#bkRec').checked;
    var data = JSON.parse(JSON.stringify(db));
    data.exportedAt = now();
    var p = withRec ? Media.Store.list().then(function (metas) {
      return Promise.all(metas.map(function (m) { return Media.Store.blob(m.id).then(function (b) { return b ? Media.blobToBase64(b).then(function (b64) { return { meta: m, b64: b64 }; }) : { meta: m }; }); }));
    }) : Promise.resolve(null);
    p.then(function (recs) {
      if (recs) data.recordings = recs;
      var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'speak-backup-' + todayKey() + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('백업 파일을 내려받았어요' + (recs ? ' (녹음 ' + recs.length + '개 포함)' : ''));
    });
  }
  function importFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d || !Array.isArray(d.cards) || !d.cards.every(function (c) { return c && c.id && typeof c.en === 'string'; })) throw new Error('형식 오류');
        if (!confirm('현재 기록을 백업 파일(청크 ' + d.cards.length + '개)로 바꿀까요?')) return;
        var recs = d.recordings || [];
        delete d.recordings;
        db = (d.version === 2) ? normalize(d) : normalize(Core.Migrate.v1(d, freshDb()));
        if (d.version !== 2) db.profile.onboarded = true;
        save();
        Promise.all(recs.filter(function (r) { return r.meta && r.b64; }).map(function (r) { return Media.Store.put(r.meta, Media.base64ToBlob(r.b64, r.meta.mime)); })).then(function () {
          toast('복원했어요' + (recs.length ? ' (녹음 ' + recs.length + '개)' : '')); go('home');
        });
      } catch (err) { toast('가져오기 실패: 올바른 백업 파일이 아니에요'); }
      e.target.value = '';
    };
    rd.readAsText(f);
  }
  function deleteVoiceText() {
    if (!confirm('녹음, 받아쓰기, 대화 기록, 오류 노트, 내가 말한 문장을 모두 지울까요? 청크와 복습 일정은 남아요.')) return;
    return Media.Store.clear().catch(function () {}).then(function () {
      db.sessions = []; db.errors = []; db.profile.introRecId = null; db.routine = null;
      db.cards.forEach(function (c) { c.mine = []; });
      save(); toast('음성·텍스트 기록을 모두 지웠어요'); renderSettings();
    });
  }

  /* ======================= 왜 이렇게 하나요? ======================= */
  var WHY = [
    ['🗣️ 매일 반드시 말하기 (출력)', '듣고 읽기만으로는 말하기가 늘지 않아요. 직접 말해 보면 “아는 것”과 “말할 수 있는 것”의 차이를 스스로 알아차리게 됩니다.', '앱에서는: 루틴은 직접 말하기(롤플레이 또는 4-3-2)를 하지 않으면 완료되지 않아요.', 'Swain (1985) Output Hypothesis; MacLeod et al. (2010) 산출 효과'],
    ['🎧 쉐도잉', '원어민 음성을 듣고 바로 따라 말하면 소리·리듬·연결을 통째로 익히고, 듣기와 발음이 함께 좋아져요.', '앱에서는: 듣기 → 동시에 → 3~5회 반복 → 음원 없이 혼자(녹음) → 원문과 비교. 속도는 0.8~1.1배만(너무 느리면 리듬이 무너져요).', 'Kadota (2019) Shadowing as a Practice in Second Language Acquisition; Hamada (2016)'],
    ['🧱 청크(덩어리 표현)', '유창함은 단어 조립보다 통째로 저장된 표현에서 나와요.', '앱에서는: 학습 단위가 청크예요. 매 세션 끝에 3개를 저장하고 다음 날 복습해요.', 'Pawley & Syder (1983); Wray (2002); Boers et al. (2006)'],
    ['⏱️ 4-3-2', '같은 내용을 점점 짧은 시간에 반복하면, 내용 부담 없이 속도와 매끄러움이 좋아져요.', '앱에서는: 초급 2→1.5→1분, 중급 이상 4→3→2분. 라운드마다 말한 길이와 멈춤을 보여 줘요.', 'Maurice (1983); Nation (1989); de Jong & Perfetti (2011)'],
    ['🔁 교정 후 다시 말하기', '교정을 “읽기만” 하면 잘 남지 않아요. 고친 문장을 스스로 다시 말할 때(uptake) 가장 효과가 커요.', '앱에서는: 교정은 최대 3개, 각 교정을 빈 화면에서 다시 말해야 루틴이 완료돼요.', 'Lyster & Ranta (1997); Lyster (2004) prompts vs recasts'],
    ['🤝 되묻기·확인하기 (의미 협상)', '실제 대화에서는 못 알아듣는 게 당연해요. 되묻고 확인하는 전략이 대화를 이어 줍니다.', '앱에서는: 일부 롤플레이는 상대가 일부러 빨리 말해요. AI도 못 알아들으면 “Do you mean ___?”로 확인해요.', 'Long (1996) Interaction Hypothesis; Dörnyei (1995) communication strategies'],
    ['🎯 문법보다 “한 번에 통하기”', '모든 실수를 고치면 말하기가 두려워져요. 의미를 깨는 실수와 어색한 표현만 고쳐요.', '앱에서는: 교정 기준 = 이해를 막는가, 부자연스러운가. 칭찬만 있는 카드는 없어요.', 'Ellis (2009) corrective feedback; Krashen의 정서적 여과'],
    ['📅 간격 반복', '잊어갈 즈음 다시 떠올리면 오래가요. 실패한 청크는 다음 날 다시 나오고, 성공하면 간격이 늘어요.', '앱에서는: 청크 복습(듣기 → 따라 말하기 → 빈칸 말하기 → 상황 한 줄), 어제 놓친 청크와 반복 오류는 오늘 워밍업에 들어가요.', 'Cepeda et al. (2006); Roediger & Karpicke (2006)'],
    ['🌱 짧게, 매일, 부드럽게', '하루 10~30분을 매일 하는 게 몰아서 하는 것보다 나아요. 하루 빠져도 괜찮아요.', '앱에서는: 스트릭이 끊겨도 “어제 못 한 3분 워밍업”으로 이어 갈 수 있어요. 진행 탭은 숫자 3개만.', 'Cepeda et al. (2006); Diekelmann & Born (2010)']
  ];
  function renderWhy() {
    render('<header class="top"><button class="icon-btn" data-act="settings" aria-label="뒤로">←</button><h1>왜 이렇게 하나요?</h1><span></span></header>' +
      '<p class="muted">“완벽해지면 말하는 게 아닙니다. 말하면서 늘립니다.”</p>' +
      WHY.map(function (w) { return '<section class="card why"><h2>' + esc(w[0]) + '</h2><p>' + esc(w[1]) + '</p><p class="how">' + esc(w[2]) + '</p><p class="ref">' + esc(w[3]) + '</p></section>'; }).join('') +
      '<section class="card why"><h2>🇰🇷 한국어 화자 발음 힌트 20</h2><ul class="hint-list">' + Object.keys(C.HINTS).map(function (k) { return '<li>' + esc(C.HINTS[k]) + '</li>'; }).join('') + '</ul></section>');
  }

  /* ======================= 이벤트 ======================= */
  function leaveRoutine() {
    cancelCapture(); stopSpeaking(); save();
    toast('저장했어요. 홈에서 이어서 할 수 있어요'); go('home');
  }
  var ACTIONS = {
    noop: function () {},
    home: function () { go('home'); }, chunks: function () { go('chunks'); }, progress: function () { go('progress'); }, settings: function () { go('settings'); },
    manage: function () { go('manage'); }, errors: function () { go('errors'); }, why: function () { go('why'); },
    'goto-ai': function () { go('settings', 'ai'); },
    start: function () { if (!db.profile.onboarded) { db.profile.onboarded = true; save(); } ob = null; startRoutine(); },
    bridge: function () { bridge = null; go('bridge'); },
    review: startReview,
    say: function (el) { speak(el.getAttribute('data-t')); },
    'play-rec': function (el) { playRec(el.getAttribute('data-id')); },
    /* 온보딩 */
    'ob-next': function () { ob.step++; renderOnboarding(); },
    'ob-back': function () { if (ob.recording) return; ob.step = Math.max(0, ob.step - 1); renderOnboarding(); },
    'ob-goal': function (el) { ob.goal = el.getAttribute('data-v'); renderOnboarding(); },
    'ob-min': function (el) { ob.minutes = Number(el.getAttribute('data-v')); renderOnboarding(); },
    'ob-level': function (el) { ob.level = el.getAttribute('data-v'); renderOnboarding(); },
    'ob-topic': function (el) {
      var v = el.getAttribute('data-v'), i = ob.topics.indexOf(v);
      if (i >= 0) ob.topics.splice(i, 1); else if (ob.topics.length < 3) ob.topics.push(v); else toast('최대 3개까지 고를 수 있어요');
      renderOnboarding();
    },
    'ob-rec': obRec, 'ob-rerec': function () { ob.rec = null; renderOnboarding(); },
    'ob-play': function () { if (ob.rec) playRec(ob.rec.id); },
    'ob-skip': function () { db.profile.micExplained = true; obFinish(true); },
    'ob-finish': function () { obFinish(false); },
    /* 루틴 */
    'leave-routine': leaveRoutine,
    rate: function (el) { db.settings.rate = Number(el.getAttribute('data-v')); save(); if (shadowCtx) shadowCtx.rerender(); },
    'sh-play': function () { var c = shadowCtx.clips[shadowCtx.state.idx]; speak(c.script, db.settings.rate); },
    'sh-mine': function () { var id = shadowCtx.state.recIds[shadowCtx.state.idx]; if (id) playRec(id); },
    'sh-toggle': function () { if (shadowCtx.state.mode === 'solo') ui.peek = !ui.peek; else ui.showScript = !ui.showScript; shadowCtx.rerender(); },
    'sh-next-mode': shNextMode,
    'sh-rep': function () {
      var st = shadowCtx.state, c = shadowCtx.clips[st.idx];
      var btn = $('[data-act="sh-rep"]'); if (btn) btn.disabled = true;
      speak(c.script, db.settings.rate).then(function () { st.reps = Math.min(shadowCtx.reps, st.reps + 1); shadowCtx.onChange(); shadowCtx.rerender(); });
    },
    'sh-rec': shRec,
    'sh-rerec': function () { var st = shadowCtx.state; st.mode = 'solo'; ui.recMeta = null; shadowCtx.onChange(); shadowCtx.rerender(); },
    'sh-next-clip': shNextClip,
    'pick-rp': function () { ui.pick = 'roleplay'; renderRoutine(); },
    'pick-432': function () { ui.pick = '432'; renderRoutine(); },
    'pick-back': function () { ui.pick = null; renderRoutine(); },
    'rp-start': function (el) { rpStart(el.getAttribute('data-id')); },
    'rp-rec': rpRec,
    'rp-say': function (el) { var s = session(currentRoutine().output.sessionId), t = s.turns[Number(el.getAttribute('data-i'))]; if (t) speak(t.text, t.fast && !t.revealed ? 1.3 : db.settings.rate); },
    'rp-hint': function () { var s = session(currentRoutine().output.sessionId), sc = scenario(s.scenarioId); ui.hint = sc.hint || (sc.must_use_chunk || [])[0]; s.hintUsed = true; save(); renderRoutine(); speak(ui.hint); },
    'rp-retry': function () { var s = session(currentRoutine().output.sessionId); rpAsk(s); },
    'rp-finish': rpFinish,
    'rp-abandon': function () { var r = currentRoutine(); r.output = { type: null, sessionId: null, utterances: 0, done: false }; save(); ui.pick = '432'; renderRoutine(); },
    't432': function (el) { start432(C.TOPICS[Number(el.getAttribute('data-i'))]); },
    't432-custom': function () { var v = ($('#customTopic') || {}).value; v = (v || '').trim(); if (!v) { toast('주제를 입력해 주세요'); return; } start432({ ko: v, en: '' }); },
    'r432-go': r432Go,
    'r432-stop': function () { if (ui.cap) ui.cap.stop(); },
    'r432-finish': r432Finish,
    'fb-retry': function () { var r = currentRoutine(); r.feedback.status = 'idle'; ui.fbLoading = false; renderRoutine(); },
    'fb-self': function () {
      var r = currentRoutine(), fb = r.feedback;
      outputContext(r).then(function (ctx) { fb.self = true; fb.selfReason = 'error'; fb.items = selfItems(r, ctx); fb.status = 'ready'; fb.recIds = ctx.recIds; fb.utterances = ctx.utterances; save(); renderRoutine(); });
    },
    'fb-shadow': function () { var fb = currentRoutine().feedback; speak(fb.items[fb.idx].improved); },
    'fb-rec': function () { fbRec(false); },
    'fb-repair-rec': function () { fbRec(true); },
    'fb-next': function () { var fb = currentRoutine().feedback; fb.idx = Math.min(fb.items.length - 1, fb.idx + 1); ui.lastTr = ''; save(); renderRoutine(); window.scrollTo(0, 0); },
    'fb-first-missing': function () { var fb = currentRoutine().feedback; for (var i = 0; i < fb.items.length; i++) if (!fb.reutter[i]) { fb.idx = i; break; } save(); renderRoutine(); },
    'fb-redo': function () { var fb = currentRoutine().feedback; ui.blank = true; ui.lastTr = ''; fbRec(false); void fb; },
    'fb-complete': function () { advanceRoutine('feedback'); },
    'ce-say': function (el) { var i = el.getAttribute('data-i'), inp = $('#chunkForm [name=en' + i + ']'); if (inp && inp.value.trim()) speak(inp.value.trim()); },
    'chunks-save': saveChunks,
    /* 청크 */
    'chunk-view': function (el) { chunkView = el.getAttribute('data-v'); renderChunks(); },
    'rv-quit': function () { finishReview(); },
    'rv-say': function () { speak(card(review.cur.id).en); },
    'rv-next': function () { var cur = review.cur; cur.phase = cur.phase === 'listen' ? 'shadow' : 'cloze'; renderReview(); if (cur.phase === 'shadow') speak(card(cur.id).en); },
    'rv-mic': function () { rvListen('transcript'); },
    'rv-said': function () { var cur = review.cur; if (cur.latency == null && cur.cueAt) cur.latency = now() - cur.cueAt; cur.phase = 'reveal'; renderReview(); if (db.settings.autoPlay) speak(card(cur.id).en); },
    'rv-reveal': function () { review.cur.phase = 'reveal'; renderReview(); if (db.settings.autoPlay) speak(card(review.cur.id).en); },
    'rv-giveup': function () { var cur = review.cur; cur.gaveUp = true; abortListening(); cur.listening = false; cur.phase = 'reveal'; renderReview(); speak(card(cur.id).en); },
    'rv-to-use': function () { review.cur.phase = 'use'; renderReview(); },
    'rv-use-mic': function () { rvListen('use'); },
    'rv-to-grade': function () { abortListening(); review.cur.listening = false; review.cur.phase = 'grade'; renderReview(); },
    'rv-grade': function (el) { rvGrade(Number(el.getAttribute('data-g'))); },
    'card-new': function () { go('edit', 'new'); },
    'card-edit': function (el) { go('edit', el.getAttribute('data-id')); },
    'edit-tts': function () { var f = $('#editForm'); if (f && f.elements.en.value.trim()) speak(f.elements.en.value.trim()); },
    'card-del': function () {
      var id = $('#editForm').getAttribute('data-id');
      if (!confirm('이 청크를 삭제할까요? 학습 기록도 함께 지워져요.')) return;
      db.cards = db.cards.filter(function (c) { return c.id !== id; });
      if (db.deletedIds.indexOf(id) < 0) db.deletedIds.push(id);
      save(); toast('삭제했어요'); go('manage');
    },
    'card-reset': function () { var c = card($('#editForm').getAttribute('data-id')); if (!c || !confirm('이 청크의 학습 기록을 초기화할까요?')) return; c.srs = S.newSrs(); c.lat = []; c.hist = []; save(); toast('초기화했어요'); renderEdit(c.id); },
    'mine-del': function (el) { var c = card($('#editForm').getAttribute('data-id')); if (!c) return; c.mine.splice(Number(el.getAttribute('data-i')), 1); save(); renderEdit(c.id); },
    /* 진행 */
    'rec-weekly': function () { go('rec', 'weekly'); },
    'rec-intro': function () { go('rec', 'intro'); },
    'rec-go': recGo,
    transcribe: function (el) {
      var id = el.getAttribute('data-id'); el.disabled = true; el.textContent = '받아쓰는 중…';
      Promise.all([Media.Store.blob(id), Media.Store.meta(id)]).then(function (x) { return AI.transcribe(x[0], x[1] && x[1].mime); })
        .then(function (t) { return Media.Store.updateMeta(id, { transcript: t, transcriptBy: 'ai' }); }).then(function () { renderProgress(); }, function (e) { toast(AI.friendly(e)); renderProgress(); });
    },
    /* 설정 */
    'set-topic': function (el) {
      var v = el.getAttribute('data-v'), t = db.profile.topics, i = t.indexOf(v);
      if (i >= 0) t.splice(i, 1); else if (t.length < 3) t.push(v); else { toast('최대 3개까지 고를 수 있어요'); return; }
      save(); renderSettings();
    },
    'tts-test': function () { speak('Let me check my schedule and get back to you.'); },
    'key-save': function () { var v = ($('#aiKey') || {}).value || ''; AI.setKey(AI.provider(), v.trim()); toast(v.trim() ? '키를 이 기기에 저장했어요' : '키를 지웠어요'); renderSettings('ai'); },
    'key-del': function () { AI.setKey(AI.provider(), ''); toast('키를 지웠어요'); renderSettings('ai'); },
    'key-test': function (el) {
      el.disabled = true; el.textContent = '확인 중…';
      AI.testConnection().then(function () { toast('✓ 연결됐어요 (' + AI.PROVIDERS[AI.provider()].name + ' · ' + AI.model() + ')'); }, function (e) { toast(AI.friendly(e)); })
        .then(function () { el.disabled = false; el.textContent = '연결 테스트'; });
    },
    'delete-voice': deleteVoiceText,
    'export': exportJson,
    'import': function () { $('#importFile').click(); },
    'reset-all': function () {
      if (!confirm('모든 청크·기록·녹음을 지우고 처음부터 시작할까요? 되돌릴 수 없어요.')) return;
      if (!confirm('정말 지울까요? 먼저 백업을 받아두는 걸 권해요.')) return;
      Media.Store.clear().catch(function () {}).then(function () {
        try { localStorage.removeItem(V1_KEY); } catch (e) { /* noop */ }
        db = normalize(freshDb()); save(); ob = null; toast('초기화했어요'); go('onboarding');
      });
    }
  };

  function init() {
    app = $('#app');
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      var fn = ACTIONS[el.getAttribute('data-act')];
      if (fn) { e.preventDefault(); fn(el); }
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('pagehide', function () { cancelCapture(); save(); });
    window.addEventListener('storage', function (e) { if (e.key === KEY && !review && !activeCap) { db = load(); route(); } });
    route();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () { /* 오프라인 캐시 없이도 동작 */ });
  }
  var ROUTES = { onboarding: renderOnboarding, home: renderHome, routine: renderRoutine, bridge: renderBridge, chunks: renderChunks, review: renderReview, errors: renderErrors, manage: renderManage, edit: renderEdit, progress: renderProgress, rec: renderRec, settings: renderSettings, why: renderWhy };

  // 테스트/디버그용 최소 노출 (키는 노출하지 않음)
  window.SpeakApp = { get db() { return db; }, save: save, version: APP_VERSION, reviewCounts: reviewCounts, get routine() { return currentRoutine(); }, get reviewQueue() { return review ? review.queue.slice() : null; } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
