/* media.js — 녹음(MediaRecorder) · 레벨 분석 · IndexedDB 저장 · 재생 */
(function () {
  'use strict';
  var Core = window.SpeakCore;

  /* ---------- IndexedDB: 녹음은 localStorage가 아니라 여기 ---------- */
  var DB_NAME = 'speakapp-media', DB_VER = 1, dbp = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function () {
        var db = rq.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blob')) db.createObjectStore('blob', { keyPath: 'id' });
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

  /* ---------- 녹음 ---------- */
  var stream = null, audioCtx = null;
  function supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2'];
    for (var i = 0; i < c.length; i++) { try { if (MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) { /* noop */ } }
    return '';
  }
  function getStream() {
    if (stream && stream.getAudioTracks().some(function (t) { return t.readyState === 'live'; })) return Promise.resolve(stream);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (s) { stream = s; return s; });
  }
  function release() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
  }
  /** 탭 이벤트 안에서 동기로 호출: iOS Safari는 사용자 제스처 안에서만 AudioContext를 깨울 수 있음 */
  function unlock() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* 레벨 분석 없이도 녹음은 됨 */ }
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
      var chunks = [], levels = [], frameMs = 50, startedAt = Date.now(), stopped = false, timer = null, analyser = null, src = null;
      try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        src = audioCtx.createMediaStreamSource(s);
        analyser = audioCtx.createAnalyser();
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
          try { if (src) src.disconnect(); } catch (e) { /* noop */ }
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
        cancel: function () { stopped = true; try { mr.onstop = null; mr.stop(); } catch (e) { /* noop */ } clearInterval(timer); }
      };
      mr.start(250);
      return ctrl;
    });
  }

  /* ---------- 재생 ---------- */
  var current = null;
  function playBlob(blob) {
    stop();
    if (!blob) return Promise.resolve();
    var url = URL.createObjectURL(blob);
    var a = new Audio(url);
    current = a;
    return new Promise(function (resolve) {
      var fin = function () { URL.revokeObjectURL(url); if (current === a) current = null; resolve(); };
      a.onended = fin; a.onerror = fin;
      var p = a.play(); if (p && p.catch) p.catch(fin);
    });
  }
  function playId(id) { return Store.blob(id).then(playBlob); }
  function stop() { if (current) { try { current.pause(); } catch (e) { /* noop */ } current = null; } }
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

  window.SpeakMedia = { Store: Store, supported: supported, unlock: unlock, pickMime: pickMime, getStream: getStream, release: release, record: record, playBlob: playBlob, playId: playId, stop: stop, uid: uid, blobToBase64: blobToBase64, base64ToBlob: base64ToBlob };
})();
