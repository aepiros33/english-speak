/* core.js — 순수 로직(스케줄러, 발화 비교, 인터리빙). 브라우저와 Node 양쪽에서 사용 가능. */
(function (root) {
  'use strict';
  var MIN = 60 * 1000;
  var DAY = 24 * 60 * MIN;

  /* ---------------- Scheduler (SM-2 계열 + 학습 단계) ---------------- */
  var DEFAULTS = {
    learningSteps: [1, 10],   // 새 카드: 1분, 10분 뒤 → 졸업
    relearningSteps: [10],    // 잊은 카드: 10분 뒤 재확인
    graduatingInterval: 1,    // 좋음으로 졸업 시 1일
    easyInterval: 4,          // 쉬움으로 졸업 시 4일
    startEase: 2.5,
    minEase: 1.3,
    maxInterval: 365,
    hardFactor: 1.2,
    easyBonus: 1.3,
    lapseFactor: 0.5,         // 잊으면 간격 절반부터 다시
    dayStartHour: 4           // 새벽 4시에 '하루'가 바뀜
  };
  var GRADES = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

  function opts(o) {
    var r = {};
    for (var k in DEFAULTS) r[k] = DEFAULTS[k];
    if (o) for (var j in o) if (o[j] !== undefined) r[j] = o[j];
    return r;
  }
  function studyDayStart(now, hour) {
    if (hour === undefined) hour = DEFAULTS.dayStartHour;
    var d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    if (d.getTime() > now) d.setDate(d.getDate() - 1);
    return d.getTime();
  }
  function addDays(ts, n) {
    var d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(now, hour) {
    var d = new Date(studyDayStart(now, hour));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function newSrs(o) {
    return { state: 'new', step: 0, due: 0, interval: 0, ease: opts(o).startEase, reps: 0, lapses: 0, lastReview: null };
  }
  function graduate(s, days, now, o) {
    s.state = 'review';
    s.step = 0;
    s.interval = Math.min(o.maxInterval, Math.max(1, days));
    s.due = addDays(studyDayStart(now, o.dayStartHour), s.interval);
  }
  function round(x) { return Math.round(x); }

  /** srs 상태 + 등급(1~4) → 새 srs 상태 (원본 불변) */
  function schedule(srs, grade, now, o) {
    o = opts(o);
    if ([1, 2, 3, 4].indexOf(grade) < 0) throw new Error('bad grade ' + grade);
    var s = {};
    for (var k in srs) s[k] = srs[k];
    var prevLast = s.lastReview;
    s.reps = (s.reps || 0) + 1;
    s.lastReview = now;

    if (s.state === 'new' || s.state === 'learning') {
      var steps = o.learningSteps;
      if (!steps.length) { // v2: 단계 없이 바로 날짜 간격 (실패·어려움 → 다음 날)
        graduate(s, grade <= 2 ? 1 : grade === 3 ? o.graduatingInterval : o.easyInterval, now, o);
        return s;
      }
      if (s.state === 'new') { s.state = 'learning'; s.step = 0; }
      if (grade === 1) {
        s.step = 0;
        s.due = now + steps[0] * MIN;
      } else if (grade === 2) {
        var d = (s.step === 0 && steps.length > 1) ? (steps[0] + steps[1]) / 2 : steps[Math.min(s.step, steps.length - 1)];
        s.due = now + d * MIN;
      } else if (grade === 3) {
        s.step += 1;
        if (s.step >= steps.length) graduate(s, o.graduatingInterval, now, o);
        else s.due = now + steps[s.step] * MIN;
      } else {
        graduate(s, o.easyInterval, now, o);
      }
      return s;
    }

    if (s.state === 'relearning') {
      var rs = o.relearningSteps;
      if (!rs.length) { graduate(s, grade === 1 ? 1 : grade === 2 ? Math.max(1, s.interval || 1) : Math.max(1, s.interval || 1) + (grade === 4 ? 2 : 1), now, o); return s; }
      if (grade === 1) { s.step = 0; s.due = now + rs[0] * MIN; }
      else if (grade === 2) { s.due = now + rs[Math.min(s.step, rs.length - 1)] * MIN * 1.5; }
      else if (grade === 3) {
        s.step += 1;
        if (s.step >= rs.length) graduate(s, s.interval, now, o);
        else s.due = now + rs[s.step] * MIN;
      } else {
        graduate(s, s.interval + 1, now, o);
      }
      return s;
    }

    // review
    var ivl = Math.max(1, s.interval || 1);
    var elapsed = prevLast ? Math.max(0, (now - prevLast) / DAY) : ivl;
    var late = Math.max(0, elapsed - ivl);
    if (grade === 1) {
      s.lapses = (s.lapses || 0) + 1;
      s.ease = Math.max(o.minEase, s.ease - 0.2);
      s.interval = Math.max(1, round(ivl * o.lapseFactor));
      if (!o.relearningSteps.length) { graduate(s, 1, now, o); s.interval = 1; return s; }
      s.state = 'relearning';
      s.step = 0;
      s.due = now + o.relearningSteps[0] * MIN;
      return s;
    }
    var hard = Math.max(ivl + 1, round(ivl * o.hardFactor));
    var good = Math.max(hard + 1, round((ivl + late / 2) * s.ease));
    var easy = Math.max(good + 1, round((ivl + late) * s.ease * o.easyBonus));
    var next;
    if (grade === 2) { next = hard; s.ease = Math.max(o.minEase, s.ease - 0.15); }
    else if (grade === 3) { next = good; }
    else { next = easy; s.ease = s.ease + 0.15; }
    graduate(s, next, now, o);
    return s;
  }

  function formatInterval(ms) {
    var m = Math.max(1, Math.round(ms / MIN));
    if (m < 60) return m + '분';
    var h = Math.round(m / 60);
    if (h < 24) return h + '시간';
    return formatDays(Math.round(ms / DAY));
  }
  function formatDays(d) {
    if (d < 30) return d + '일';
    if (d < 365) return (Math.round(d / 3) / 10) + '개월';
    return (Math.round(d / 36.5) / 10) + '년';
  }
  /** 각 등급을 눌렀을 때의 다음 간격 미리보기 */
  function preview(srs, now, o) {
    var out = {};
    for (var g = 1; g <= 4; g++) {
      var s = schedule(srs, g, now, o);
      out[g] = (s.state === 'review') ? formatDays(s.interval) : formatInterval(s.due - now);
    }
    return out;
  }
  function isDue(srs, now) { return srs.state !== 'new' && srs.due <= now; }

  /* ---------------- 발화 비교 ---------------- */
  var CONTRACTIONS = {
    "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
    "he's": 'he is', "she's": 'she is', "it's": 'it is', "that's": 'that is', "there's": 'there is',
    "what's": 'what is', "where's": 'where is', "who's": 'who is', "how's": 'how is', "here's": 'here is',
    "let's": 'let us', "can't": 'can not', 'cannot': 'can not', "won't": 'will not', "shan't": 'shall not',
    "ain't": 'is not', 'gonna': 'going to', 'wanna': 'want to', 'gotta': 'got to', "y'all": 'you all',
    'ok': 'okay', 'alright': 'all right'
  };
  var NUMBERS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12' };

  function expandWord(w) {
    if (CONTRACTIONS[w]) return CONTRACTIONS[w].split(' ');
    if (NUMBERS[w]) return [NUMBERS[w]];
    var m;
    if ((m = w.match(/^(.+)n't$/))) return [m[1] === 'ca' ? 'can' : m[1], 'not'];
    if ((m = w.match(/^(.+)'re$/))) return [m[1], 'are'];
    if ((m = w.match(/^(.+)'ve$/))) return [m[1], 'have'];
    if ((m = w.match(/^(.+)'ll$/))) return [m[1], 'will'];
    if ((m = w.match(/^(.+)'d$/))) return [m[1], 'would'];
    if ((m = w.match(/^(\d+)(am|pm)$/))) return [m[1], m[2]];
    return [w];
  }
  function cleanWord(raw) {
    return raw.toLowerCase()
      .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
      .replace(/\./g, '')
      .replace(/[^a-z0-9']/g, '')
      .replace(/^'+|'+$/g, '');
  }
  function splitRaw(text) {
    return String(text || '').replace(/[\u2014\u2013]/g, ' \u2014 ').split(/\s+/).filter(Boolean);
  }
  /** 텍스트 → [{raw, tokens[]}] */
  function analyze(text) {
    var out = [];
    splitRaw(text).forEach(function (raw) {
      var parts = raw.split(/-/);
      var tokens = [];
      parts.forEach(function (p) {
        var w = cleanWord(p);
        if (w) tokens = tokens.concat(expandWord(w));
      });
      out.push({ raw: raw, tokens: tokens });
    });
    return out;
  }
  function tokens(text) {
    var t = [];
    analyze(text).forEach(function (w) { t = t.concat(w.tokens); });
    return t;
  }
  function lcsMatch(a, b) {
    var n = a.length, m = b.length, i, j;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var matched = new Array(n).fill(false);
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { matched[i] = true; i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return { length: dp[0][0], matched: matched };
  }
  /** 목표 표현 vs 인식된 발화 → {score 0~1, words:[{raw, ok}], matched, total} */
  function compare(target, spoken) {
    var words = analyze(target);
    var flat = [], owner = [];
    words.forEach(function (w, wi) { w.tokens.forEach(function (t) { flat.push(t); owner.push(wi); }); });
    var sp = tokens(spoken);
    var r = lcsMatch(flat, sp);
    var okCount = new Array(words.length).fill(0);
    r.matched.forEach(function (ok, k) { if (ok) okCount[owner[k]]++; });
    return {
      score: flat.length ? r.length / flat.length : 0,
      matched: r.length,
      total: flat.length,
      words: words.map(function (w, wi) {
        return { raw: w.raw, ok: w.tokens.length === 0 ? true : okCount[wi] === w.tokens.length, partial: okCount[wi] > 0 && okCount[wi] < w.tokens.length };
      })
    };
  }
  /** 긴 발화(스피드토크) 안에 표현이 쓰였는지: 창 단위 LCS ≥ 80% */
  function containsChunk(transcript, chunk, threshold) {
    threshold = threshold || 0.8;
    var c = tokens(chunk), t = tokens(transcript);
    if (!c.length || !t.length) return false;
    var win = c.length + 3;
    for (var s = 0; s <= Math.max(0, t.length - 1); s++) {
      var r = lcsMatch(c, t.slice(s, s + win));
      if (r.length / c.length >= threshold) return true;
    }
    return false;
  }
  /** 추천 등급: 유사도 + 반응시간. 최종 결정은 사용자. */
  function suggestGrade(p) {
    var thr = (p.thresholdSec || 3.5) * 1000;
    if (p.gaveUp) return 1;
    var lat = p.latencyMs;
    var slow = lat != null && lat > thr;
    if (p.sim != null) {
      if (p.sim < 0.5) return 1;
      if (p.sim < 0.8) return 2;
      if (slow) return 2;
      if (p.sim >= 0.95 && lat != null && lat < 1500) return 4;
      return 3;
    }
    if (slow) return 2;
    return 3;
  }

  /* ---------------- 인터리빙 ---------------- */
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  /** 같은 카테고리가 연속되지 않도록 섞기 (가능한 한) */
  function interleave(items, keyFn, rng) {
    var groups = {}, order = [];
    shuffle(items, rng).forEach(function (it) {
      var k = keyFn(it);
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(it);
    });
    var out = [], prev = null;
    while (out.length < items.length) {
      var best = null;
      order.forEach(function (k) {
        if (!groups[k].length || k === prev) return;
        if (best === null || groups[k].length > groups[best].length) best = k;
      });
      if (best === null) best = prev; // 남은 게 같은 카테고리뿐
      out.push(groups[best].shift());
      prev = best;
    }
    return out;
  }
  /** 고정 순서 라운드로빈 (시드 카드의 새 카드 도입 순서) */
  function roundRobin(items, keyFn, keyOrder) {
    var groups = {};
    items.forEach(function (it) { var k = keyFn(it); (groups[k] = groups[k] || []).push(it); });
    var keys = keyOrder.filter(function (k) { return groups[k]; });
    Object.keys(groups).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
    var out = [], left = items.length;
    while (left > 0) keys.forEach(function (k) { if (groups[k].length) { out.push(groups[k].shift()); left--; } });
    return out;
  }


  /* ---------------- v2: 빈칸(첫 글자 힌트) ---------------- */
  function cloze(en) {
    return splitRaw(en).map(function (raw) {
      return raw.replace(/[A-Za-z][A-Za-z']*/g, function (w) {
        if (w.length <= 1) return w;
        return w[0] + w.slice(1).replace(/[A-Za-z]/g, '_');
      });
    }).join(' ');
  }

  /* ---------------- v2: 날짜·주간·스트릭 ---------------- */
  function weekStart(now, hour) {
    var d = new Date(studyDayStart(now, hour));
    var dow = (d.getDay() + 6) % 7; // 월=0
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  function weekKeys(now) {
    var s = weekStart(now), out = [];
    for (var i = 0; i < 7; i++) out.push(dayKey(addDays(s, i) + 1));
    return out;
  }
  function isActiveDay(l) {
    return !!l && ((l.spokenSec || 0) > 0 || (l.newCount || 0) + (l.reviewCount || 0) + (l.speed || 0) > 0 || !!l.bridged || !!l.routineDone);
  }
  /** 부드러운 스트릭: '어제 못 한 3분 워밍업'으로 메운 날(bridged)은 이어진 것으로 본다 */
  function streak(log, now) {
    var t = studyDayStart(now), n = 0;
    if (!isActiveDay(log[dayKey(t)])) t = addDays(t, -1);
    while (isActiveDay(log[dayKey(t)])) { n++; t = addDays(t, -1); }
    return n;
  }
  function weekStats(log, now) {
    var sec = 0, sessions = 0;
    weekKeys(now).forEach(function (k) { var l = log[k]; if (l) { sec += l.spokenSec || 0; sessions += l.sessions || 0; } });
    return { spokenSec: sec, spokenMin: Math.round(sec / 6) / 10, sessions: sessions };
  }

  /* ---------------- v2: 루틴 엔진 ---------------- */
  var STEPS = ['shadow', 'output', 'feedback', 'chunks'];
  var BASE_MIN = { shadow: 8, output: 8, feedback: 3, chunks: 1 }; // 20분 기준
  function durations(minutes) {
    var f = (minutes || 20) / 20, out = {};
    STEPS.forEach(function (k) { out[k] = Math.round(BASE_MIN[k] * f * 10) / 10; });
    return out;
  }
  /** 4-3-2 라운드 초: 초급 2→1.5→1분, 중급+ 4→3→2분. 10분 루틴은 비율대로 줄임 */
  function fourThreeTwo(level, minutes) {
    var base = level === 'beginner' ? [120, 90, 60] : [240, 180, 120];
    var f = Math.min(1, (minutes || 20) / 20);
    return base.map(function (x) { return Math.round(x * f); });
  }
  function routinePlan(p) {
    var minutes = p.minutes || 20;
    var clipsN = minutes <= 10 ? 2 : minutes <= 20 ? 3 : 5;
    var reps = minutes <= 10 ? 3 : minutes <= 20 ? 4 : 5;
    var turns = minutes <= 10 ? 3 : minutes <= 20 ? 4 : 6;
    var pool = (p.clips || []).slice();
    var lvl = { beginner: ['a2'], intermediate: ['a2', 'b1'], upper: ['b1', 'b2'] }[p.level || 'intermediate'] || ['a2', 'b1'];
    var seen = p.seenClipIds || [];
    function score(c) {
      var sc = 0;
      if ((p.topics || []).indexOf(c.tag) >= 0) sc += 4;
      if (c.topic === (p.goal === 'work' ? 'work' : p.goal)) sc += 2;
      if (lvl.indexOf(c.level) >= 0) sc += 3;
      if (seen.indexOf(c.id) >= 0) sc -= 5;
      return sc + ((p.rng || Math.random)() * 1.5);
    }
    pool.sort(function (a, b) { return score(b) - score(a); });
    return {
      minutes: minutes, durations: durations(minutes),
      clipIds: pool.slice(0, clipsN).map(function (c) { return c.id; }),
      reps: reps, turns: turns, rounds: fourThreeTwo(p.level, minutes),
      warmup: p.warmup || null
    };
  }
  function createRoutine(date, plan) {
    return {
      date: date, step: 'shadow', plan: plan, startedAt: null, completedAt: null,
      shadow: { idx: 0, mode: 'listen', reps: 0, done: false, warmupDone: !plan.warmup, recIds: [] },
      output: { type: null, sessionId: null, done: false },
      feedback: { status: 'idle', items: [], idx: 0, reutter: [], repairAsked: false, repairDone: false, self: false, done: false },
      chunks: { suggested: [], savedIds: [], done: false }
    };
  }
  function stepIndex(step) { var i = STEPS.indexOf(step); return i < 0 ? STEPS.length : i; }
  /** 단계 완료 시도. 조건 미충족이면 {ok:false, reason} */
  function completeStep(r, step, now) {
    var x = JSON.parse(JSON.stringify(r));
    if (x.step !== step) return { ok: false, reason: 'not-current', routine: r };
    if (step === 'output') {
      if (!x.output.sessionId || !x.output.utterances) return { ok: false, reason: 'no-output', routine: r };
    }
    if (step === 'feedback') {
      var items = x.feedback.items || [];
      if (!items.length) return { ok: false, reason: 'no-items', routine: r };
      var all = items.every(function (_, i) { return !!x.feedback.reutter[i]; });
      if (!all) return { ok: false, reason: 'reutter-missing', routine: r };
      if (x.feedback.repairAsked && !x.feedback.repairDone) return { ok: false, reason: 'repair-missing', routine: r };
    }
    if (step === 'chunks') {
      if ((x.chunks.savedIds || []).length < 3) return { ok: false, reason: 'need-3-chunks', routine: r };
    }
    x[step].done = true;
    var i = stepIndex(step);
    x.step = i + 1 < STEPS.length ? STEPS[i + 1] : 'done';
    if (x.step === 'done') x.completedAt = now || Date.now();
    return { ok: true, routine: x };
  }
  function isRoutineComplete(r) {
    return !!r && r.step === 'done' && r.output.done && r.feedback.done &&
      (r.feedback.items || []).length > 0 && r.feedback.items.every(function (_, i) { return !!r.feedback.reutter[i]; }) &&
      (r.chunks.savedIds || []).length >= 3;
  }
  function checklist(r) {
    var out = {};
    STEPS.forEach(function (k) { out[k] = !!(r && r[k] && r[k].done); });
    return out;
  }

  /* ---------------- v2: 피드백 JSON ---------------- */
  var LAYERS = ['meaning', 'naturalness', 'delivery'];
  var SEVERITIES = ['low', 'medium', 'high'];
  function parseJSONLoose(text) {
    if (text && typeof text === 'object') return text;
    if (typeof text !== 'string') return null;
    var t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) { /* 계속 */ }
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) { return null; } }
    return null;
  }
  function str(x) { return typeof x === 'string' ? x.trim() : ''; }
  var PRAISE = /(great job|good job|well done|perfect|잘했|훌륭|완벽|좋아요!?$)/i;
  /** LLM 응답 → PRD 스키마로 정규화. 최대 3개, 칭찬만 있는 항목 제거 */
  function validateFeedback(raw) {
    var o = parseJSONLoose(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'not-json' };
    var items = Array.isArray(o.items) ? o.items : [];
    var seen = {};
    var clean = [];
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var original = str(it.original), improved = str(it.improved), issue = str(it.issue_ko);
      if (!original || !improved) return;
      if (!issue) return;
      if (PRAISE.test(issue) && tokens(original).join(' ') === tokens(improved).join(' ')) return;
      var key = tokens(improved).join(' ');
      if (seen[key]) return;
      seen[key] = 1;
      clean.push({
        original: original, issue_ko: issue, improved: improved,
        layer: LAYERS.indexOf(it.layer) >= 0 ? it.layer : 'naturalness',
        severity: SEVERITIES.indexOf(it.severity) >= 0 ? it.severity : 'medium'
      });
    });
    var sevRank = { high: 0, medium: 1, low: 2 };
    clean.sort(function (a, b) { return sevRank[a.severity] - sevRank[b.severity]; });
    var data = {
      comprehensible: typeof o.comprehensible === 'boolean' ? o.comprehensible : true,
      on_topic: typeof o.on_topic === 'boolean' ? o.on_topic : true,
      items: clean.slice(0, 3),
      repair_question: str(o.repair_question) || null
    };
    if (!data.on_topic && !data.repair_question) data.repair_question = 'Sorry, I want to make sure I understood. Could you say that another way?';
    if (data.on_topic) data.repair_question = data.repair_question || null;
    return { ok: true, data: data, dropped: items.length - data.items.length };
  }
  /** 교정 항목이 0개일 때: 가장 긴 발화를 더 매끄럽게 다시 말하기 (칭찬만 하는 카드 금지) */
  function fallbackItem(utterances) {
    var best = (utterances || []).filter(Boolean).sort(function (a, b) { return b.length - a.length; })[0];
    if (!best) return null;
    return { original: best, issue_ko: '의미는 잘 통했어요. 같은 문장을 멈춤 없이 한 번에 말하면 더 잘 통합니다.', improved: best, layer: 'delivery', severity: 'low' };
  }
  function validateRoleplay(raw) {
    var o = parseJSONLoose(raw);
    if (!o || typeof o !== 'object') return { ok: false, error: 'not-json' };
    var reply = str(o.reply);
    if (!reply) return { ok: false, error: 'no-reply' };
    return { ok: true, data: {
      reply: reply,
      understood: o.understood !== false,
      on_topic: o.on_topic !== false,
      is_repair: !!o.is_repair || /^(do you mean|you mean|sorry, do you mean|just to check)/i.test(reply),
      end: !!o.end
    } };
  }

  /* ---------------- v2: 오류 노트 ---------------- */
  function errorKey(item) { return tokens(item.improved).join(' '); }
  function addError(list, item, now) {
    var out = (list || []).slice(), key = errorKey(item), d = dayKey(now);
    for (var i = 0; i < out.length; i++) {
      if (out[i].key === key || (tokens(out[i].original).join(' ') === tokens(item.original).join(' '))) {
        var e = JSON.parse(JSON.stringify(out[i]));
        e.count += 1; e.lastAt = now; if (e.dates.indexOf(d) < 0) e.dates.push(d);
        e.original = item.original; e.issue_ko = item.issue_ko;
        out[i] = e;
        return out;
      }
    }
    out.push({ key: key, original: item.original, improved: item.improved, issue_ko: item.issue_ko, layer: item.layer || 'naturalness', count: 1, firstAt: now, lastAt: now, dates: [d], warmups: 0 });
    return out;
  }
  function recentErrors(list, now, days) {
    var since = now - (days || 14) * DAY;
    return (list || []).filter(function (e) { return e.lastAt >= since; })
      .sort(function (a, b) { return (b.count - a.count) || (b.lastAt - a.lastAt); });
  }
  /** 워밍업에 넣을 1개: 최근 2주 반복 오류 우선 → 없으면 어제 못 쓴 청크 */
  function pickWarmup(errors, missedCards, now) {
    var rec = recentErrors(errors, now, 14).filter(function (e) { return e.lastAt < studyDayStart(now); });
    rec.sort(function (a, b) { return (b.count - a.count) || (a.warmups - b.warmups) || (b.lastAt - a.lastAt); });
    if (rec.length) return { kind: 'error', key: rec[0].key, script: rec[0].improved, focus: rec[0].issue_ko, original: rec[0].original };
    var c = (missedCards || [])[0];
    if (c) return { kind: 'chunk', cardId: c.id, script: c.example || c.en, focus: '어제 못 쓴 청크: ' + c.en };
    return null;
  }

  /* ---------------- v2: 녹음 레벨 분석 (침묵·말한 길이) ---------------- */
  /** levels: RMS 배열, frameMs 간격. 잡음 적응 임계값. 1초 이상 침묵을 '멈춤'으로 센다 */
  function analyzeLevels(levels, frameMs, opt) {
    opt = opt || {};
    var n = levels.length;
    if (!n) return { durationSec: 0, voicedSec: 0, pauses: 0, longestPauseSec: 0 };
    var sorted = levels.slice().sort(function (a, b) { return a - b; });
    var floor = sorted[Math.floor(n * 0.1)] || 0;
    var p90 = sorted[Math.floor(n * 0.9)] || 0;
    // 바닥 소음의 2.5배. 단 계속 말해서 '바닥'이 말소리일 때를 위해 상위 10% 레벨의 40%를 넘지 않게
    var thr = Math.max(opt.minThreshold || 0.012, Math.min(floor * 2.5, p90 * 0.4));
    var voiced = levels.map(function (v) { return v > thr; });
    var first = voiced.indexOf(true), last = voiced.lastIndexOf(true);
    var vCount = voiced.filter(Boolean).length;
    var pauses = 0, longest = 0, run = 0, minPauseFrames = Math.round((opt.pauseMs || 1000) / frameMs);
    if (first >= 0) {
      for (var i = first; i <= last; i++) {
        if (!voiced[i]) run++;
        else { if (run >= minPauseFrames) pauses++; longest = Math.max(longest, run); run = 0; }
      }
    }
    return {
      durationSec: Math.round(n * frameMs / 100) / 10,
      voicedSec: Math.round(vCount * frameMs / 100) / 10,
      pauses: pauses,
      longestPauseSec: Math.round(longest * frameMs / 100) / 10
    };
  }

  /* ---------------- v2: v1 → v2 마이그레이션 ---------------- */
  function migrateV1(v1, fresh) {
    var d = fresh;
    if (!v1 || !Array.isArray(v1.cards)) return d;
    var st = v1.settings || {};
    d.migratedFrom = 1;
    d.migratedAt = Date.now();
    d.cards = v1.cards.map(function (c) { return JSON.parse(JSON.stringify(c)); });
    d.deletedIds = (v1.deletedIds || []).slice();
    d.log = JSON.parse(JSON.stringify(v1.log || {}));
    if (typeof st.ttsRate === 'number') d.settings.rate = Math.min(1.1, Math.max(0.8, st.ttsRate));
    if (st.voiceURI) d.settings.voiceURI = st.voiceURI;
    if (typeof st.newPerDay === 'number') d.settings.newPerDay = st.newPerDay;
    if (typeof st.maxReviews === 'number') d.settings.maxReviews = st.maxReviews;
    if (typeof st.latencyThreshold === 'number') d.settings.latencyThreshold = st.latencyThreshold;
    if (typeof st.autoPlay === 'boolean') d.settings.autoPlay = st.autoPlay;
    if (typeof st.useRecognition === 'boolean') d.settings.useWebSpeech = st.useRecognition;
    return d;
  }

  var api = {
    Scheduler: { DEFAULTS: DEFAULTS, GRADES: GRADES, MIN: MIN, DAY: DAY, schedule: schedule, preview: preview, newSrs: newSrs, isDue: isDue, studyDayStart: studyDayStart, addDays: addDays, dayKey: dayKey, formatInterval: formatInterval, formatDays: formatDays },
    Text: { analyze: analyze, tokens: tokens, compare: compare, containsChunk: containsChunk, suggestGrade: suggestGrade, cloze: cloze },
    Mix: { shuffle: shuffle, interleave: interleave, roundRobin: roundRobin },
    Days: { weekStart: weekStart, weekKeys: weekKeys, streak: streak, weekStats: weekStats, isActiveDay: isActiveDay },
    Routine: { STEPS: STEPS, durations: durations, fourThreeTwo: fourThreeTwo, plan: routinePlan, create: createRoutine, completeStep: completeStep, isComplete: isRoutineComplete, checklist: checklist },
    Feedback: { parseJSON: parseJSONLoose, validate: validateFeedback, fallbackItem: fallbackItem, validateRoleplay: validateRoleplay, LAYERS: LAYERS, SEVERITIES: SEVERITIES },
    Errors: { add: addError, recent: recentErrors, pickWarmup: pickWarmup, key: errorKey },
    Audio: { analyzeLevels: analyzeLevels },
    Migrate: { v1: migrateV1 }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpeakCore = api;
})(typeof self !== 'undefined' ? self : this);
