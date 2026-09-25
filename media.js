/* media.js — 녹음(MediaRecorder) · 레벨 분석 · IndexedDB 저장 · 재생 */
(function () {
  'use strict';
  var Core = window.SpeakCore;

  /* ---------- IndexedDB: 녹음은 localStorage가 아니라 여기 ---------- */
  var DB_NAME = 'speakapp-media', DB_VER = 2, dbp = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blob')) db.createObjectStore('blob', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('tts')) db.createObjectStore('tts', { keyPath: 'id' }); // AI 음성 캐시 (v2.1)
      };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
    return dbp;
  }
  function tx(stores, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(stores, mode), out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
        out = fn(t);
      });
    });
  }
  function reqP(rq) { return new Promise(function (res, rej) { rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; }); }
  var Store = {
    put: function (meta, blob) {
      return tx(['meta', 'blob'], 'readwrite', function (t) {
        t.objectStore('meta').put(meta);
        if (blob) t.objectStore('blob').put({ id: meta.id, blob: blob });
        return meta;
      });
    },
    updateMeta: function (id, patch) {
      return openDb().then(function (db) {
        return reqP(db.transaction('meta').objectStore('meta').get(id)).then(function (m) {
          if (!m) return null;
          Object.assign(m, patch);
          return tx(['meta'], 'readwrite', function (t) { t.objectStore('meta').put(m); return m; });
        });
      });
    },
    meta: function (id) { return openDb().then(function (db) { return reqP(db.transaction('meta').objectStore('meta').get(id)); }); },
    blob: function (id) { return openDb().then(function (db) { return reqP(db.transaction('blob').objectStore('blob').get(id)); }).then(function (r) { return r ? r.blob : null; }); },
    list: function (filter) {
      return openDb().then(function (db) { return reqP(db.transaction('meta').objectStore('meta').getAll()); })
        .then(function (all) { return (all || []).filter(filter || function () { return true; }).sort(function (a, b) { return a.createdAt - b.createdAt; }); });
    },
    del: function (id) { return tx(['meta', 'blob'], 'readwrite', function (t) { t.objectStore('meta').delete(id); t.objectStore('blob').delete(id); }); },
    clear: function () { return tx(['meta', 'blob'], 'readwrite', function (t) { t.objectStore('meta').clear(); t.objectStore('blob').clear(); }); },
    count: function () { return openDb().then(function (db) { return reqP(db.transaction('meta').objectStore('meta').count()); }); }
  };

  /* AI 음성(Gemini TTS) 캐시: 같은 문장·억양·속도는 한 번만 생성 */
  var TTS_MAX = 300;
  var TTSCache = {
    get: function (id) { return openDb().then(function (db) { return reqP(db.transaction('tts').objectStore('tts').get(id)); }).then(function (r) { return r ? r.blob : null; }, function () { return null; }); },
    put: function (id, blob) {
      return tx(['tts'], 'readwrite', function (t) { t.objectStore('tts').put({ id: id, blob: blob, at: Date.now() }); }).then(function () {
        return openDb().then(function (db) { return reqP(db.transaction('tts').objectStore('tts').getAll()); }).then(function (all) {
          if (!all || all.length <= TTS_MAX) return;
          all.sort(function (a, b) { return a.at - b.at; });
          var old = all.slice(0, all.length - TTS_MAX);
          return tx(['tts'], 'readwrite', function (t) { old.forEach(function (o) { t.objectStore('tts').delete(o.id); }); });
        });
      }).catch(function () { /* 캐시 실패는 무시 */ });
    },
    count: function () { return openDb().then(function (db) { return reqP(db.transaction('tts').objectStore('tts').count()); }); },
    clear: function () { return tx(['tts'], 'readwrite', function (t) { t.objectStore('tts').clear(); }); }
  };

  /* ---------- 오디오 세션 (iOS Safari 16.4+) ----------
   * 마이크가 켜져 있으면 iOS는 'play-and-record' 모드가 되어 소리가 작은 수화부(귀 스피커)로 나가거나 줄어듦.
   * → 녹음 중에만 play-and-record, 끝나면 트랙을 모두 멈추고 'playback'으로 되돌린다. */
  function setSession(type) { try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch (e) { /* 미지원 */ } }

  /* ---------- 녹음 ---------- */
  var stream = null, playCtx = null;
  function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) { /* noop */ } }
    return '';
  }
  function getStream() {
    if (stream && stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; })) return Promise.resolve(stream);
    setSession('play-and-record');
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (s) { stream = s; return s; }, function (e) { setSession('playback'); throw e; });
  }
  /** 마이크 완전히 끄기: 모든 트랙 stop + 스트림 해제 + 오디오 세션을 재생 모드로 */
  function release() {
    if (stream) { stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* noop */ } }); stream = null; }
    setSession('playback');
  }
  function isMicLive() { return !!(stream && stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; })); }
  /** 탭 이벤트 안에서 동기로 호출: iOS Safari는 사용자 제스처 안에서만 AudioContext를 깨울 수 있음 (재생용 컨텍스트) */
  function unlock() {
    try {
      playCtx = playCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (playCtx.state === 'suspended' || playCtx.state === 'interrupted') playCtx.resume();
    } catch (e) { playCtx = null; /* Web Audio 없이도 <audio>로 재생됨 */ }
  }
  function uid(prefix) { return (prefix || 'r') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /**
   * 녹음 시작. opt: {maxSec, onLevel(rms, voiced), onTick(sec)}
   * 반환: Promise<controller>, controller.stop() → Promise<{blob, mime, durationSec, voicedSec, pauses, longestPauseSec}>
   */
  function record(opt) {
    opt = opt || {};
    if (!supported()) return Promise.reject(new Error('unsupported'));
    return getStream().then(function (s) {
      var mime = pickMime();
      var mr = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      var chunks = [], levels = [], frameMs = 50, startedAt = Date.now(), stopped = false, timer = null, analyser = null, src = null, meterCtx = null;
      function teardown() { // 레벨 측정용 컨텍스트 닫고 마이크 완전히 해제
        try { if (src) src.disconnect(); } catch (e) { /* noop */ }
        try { if (meterCtx && meterCtx.close) meterCtx.close(); } catch (e) { /* noop */ }
        meterCtx = null; src = null;
        recording = false;
        release();
      }
      try {
        meterCtx = new (window.AudioContext || window.webkitAudioContext)(); // 녹음마다 따로 만들고 끝나면 닫음
        if (meterCtx.state === 'suspended') meterCtx.resume();
        src = meterCtx.createMediaStreamSource(s);
        analyser = meterCtx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
      } catch (e) { analyser = null; }
      var buf = analyser ? new Float32Array(analyser.fftSize) : null;
      timer = setInterval(function () {
        var rms = 0;
        if (analyser) {
          if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(buf);
          var sum = 0; for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          rms = Math.sqrt(sum / buf.length);
        }
        levels.push(rms);
        var el = (Date.now() - startedAt) / 1000;
        if (opt.onLevel) opt.onLevel(rms, levels);
        if (opt.onTick) opt.onTick(el);
        if (opt.maxSec && el >= opt.maxSec) ctrl.stop();
      }, frameMs);
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var done = new Promise(function (resolve) {
        mr.onstop = function () {
          clearInterval(timer);
          teardown();
          var type = (mr.mimeType || mime || 'audio/webm');
          var blob = new Blob(chunks, { type: type });
          var st = Core.Audio.analyzeLevels(levels, frameMs);
          st.durationSec = Math.max(st.durationSec, Math.round((Date.now() - startedAt) / 100) / 10);
          var maxLv = levels.reduce(function (m, v) { return v > m ? v : m; }, 0);
          st.levelsOk = !!analyser && maxLv > 0;
          if (!st.levelsOk) { st.voicedSec = st.durationSec; st.pauses = 0; st.longestPauseSec = 0; } // 레벨을 못 읽으면 녹음 길이로 대체
          resolve(Object.assign({ blob: blob, mime: type }, st));
        };
      });
      var ctrl = {
        startedAt: startedAt,
        done: done,
        levels: levels,
        stop: function () {
          if (!stopped) { stopped = true; try { if (mr.state !== 'inactive') mr.stop(); } catch (e) { /* noop */ } }
          return done;
        },
        cancel: function () { stopped = true; try { mr.onstop = null; mr.stop(); } catch (e) { /* noop */ } clearInterval(timer); teardown(); }
      };
      mr.start(250);
      recording = true;
      return ctrl;
    });
  }

  /* ---------- 재생 ----------
   * 녹음(내 녹음·비교 플레이어·온보딩 소개)과 AI 음성은 Web Audio로 재생: 최고점 정규화 × 부스트(기본 2배) → 리미터(클리핑 방지).
   * Web Audio를 못 쓰면(디코딩 실패·컨텍스트 잠김) <audio> volume 1로 재생. */
  var current = null, boost = 2, playToken = 0;
  function setBoost(x) { x = Number(x); boost = x > 0 ? x : 1; }
  function getBoost() { return boost; }
  /** 재생 직전: 마이크가 남아 있으면 끄고 오디오 세션을 재생 모드로 (TTS 재생 전에도 호출) */
  function prepPlayback() { if (!recording) release(); else setSession('play-and-record'); }
  var recording = false;
  function ctxRunning() {
    if (!playCtx) return Promise.resolve(false);
    if (playCtx.state === 'running') return Promise.resolve(true);
    return Promise.race([
      Promise.resolve(playCtx.resume ? playCtx.resume() : null).then(function () { return playCtx.state === 'running'; }, function () { return false; }),
      new Promise(function (r) { setTimeout(function () { r(false); }, 400); })
    ]);
  }
  function decode(ab) {
    return new Promise(function (res, rej) {
      try { var p = playCtx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); }
    });
  }
  function peakOf(buf) {
    var peak = 0;
    for (var c = 0; c < buf.numberOfChannels; c++) { var d = buf.getChannelData(c); for (var i = 0; i < d.length; i += 4) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; } }
    return peak;
  }
  function playViaElement(blob, my) {
    if (my !== playToken) return Promise.resolve();
    var url = URL.createObjectURL(blob);
    var a = new Audio(url);
    a.volume = 1;
    return new Promise(function (resolve) {
      var done = false;
      var fin = function () { if (done) return; done = true; URL.revokeObjectURL(url); if (current && current.el === a) current = null; resolve(); };
      current = { el: a, stop: function () { try { a.pause(); } catch (e) { /* noop */ } fin(); } };
      a.onended = fin; a.onerror = fin;
      var p = a.play(); if (p && p.catch) p.catch(fin);
    });
  }
  function playViaWebAudio(buf, my, gainOverride) {
    return new Promise(function (resolve) {
      if (my !== playToken) return resolve();
      var g = gainOverride != null ? gainOverride : Core.Audio.playbackGain(peakOf(buf), boost);
      var src = playCtx.createBufferSource(); src.buffer = buf;
      var gain = playCtx.createGain(); gain.gain.value = g;
      var node = gain;
      if (g > 1 && playCtx.createDynamicsCompressor) { // 리미터: 증폭으로 넘치는 피크를 눌러 찢어지는 소리 방지
        var lim = playCtx.createDynamicsCompressor();
        lim.threshold.value = -6; lim.knee.value = 4; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
        gain.connect(lim); node = lim;
      }
      src.connect(gain); node.connect(playCtx.destination);
      var done = false;
      var fin = function () { if (done) return; done = true; try { src.disconnect(); gain.disconnect(); if (node !== gain) node.disconnect(); } catch (e) { /* noop */ } if (current && current.src === src) current = null; resolve(); };
      current = { src: src, stop: function () { try { src.stop(); } catch (e) { /* noop */ } fin(); } };
      src.onended = fin;
      src.start(0);
    });
  }
  /** opt: {gain} 고정 증폭(없으면 설정값 부스트 + 정규화) */
  function playBlob(blob, opt) {
    stop();
    prepPlayback();
    if (!blob) return Promise.resolve();
    var my = ++playToken, gainOverride = opt && opt.gain;
    if (!playCtx || (boost <= 1 && gainOverride == null)) return playViaElement(blob, my);
    return ctxRunning().then(function (ok) {
      if (my !== playToken) return;
      if (!ok) return playViaElement(blob, my);
      return (blob.arrayBuffer ? blob.arrayBuffer() : new Response(blob).arrayBuffer()).then(decode).then(function (buf) {
        return playViaWebAudio(buf, my, gainOverride);
      }, function () { return playViaElement(blob, my); });
    });
  }
  function playId(id) { return Store.blob(id).then(function (b) { return playBlob(b); }); }
  function stop() { playToken++; if (current) { var c = current; current = null; try { c.stop(); } catch (e) { /* noop */ } } }
  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { rej(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, type) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'audio/webm' });
  }

  window.SpeakMedia = { Store: Store, TTSCache: TTSCache, supported: supported, unlock: unlock, pickMime: pickMime, getStream: getStream, release: release, isMicLive: isMicLive, setSession: setSession, prepPlayback: prepPlayback, setBoost: setBoost, getBoost: getBoost, record: record, playBlob: playBlob, playId: playId, stop: stop, uid: uid, blobToBase64: blobToBase64, base64ToBlob: base64ToBlob };
})();
