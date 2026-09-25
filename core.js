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

  var api = {
    Scheduler: { DEFAULTS: DEFAULTS, GRADES: GRADES, MIN: MIN, DAY: DAY, schedule: schedule, preview: preview, newSrs: newSrs, isDue: isDue, studyDayStart: studyDayStart, addDays: addDays, dayKey: dayKey, formatInterval: formatInterval, formatDays: formatDays },
    Text: { analyze: analyze, tokens: tokens, compare: compare, containsChunk: containsChunk, suggestGrade: suggestGrade },
    Mix: { shuffle: shuffle, interleave: interleave, roundRobin: roundRobin }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpeakCore = api;
})(typeof self !== 'undefined' ? self : this);
