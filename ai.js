/* ai.js — AI 제공자(Gemini / OpenAI / xAI) 호출. 키는 이 기기 localStorage에만 저장됩니다. */
(function () {
  'use strict';
  var Core = window.SpeakCore;
  var KEY_PREFIX = 'speakapp.key.';

  var PROVIDERS = {
    gemini: {
      name: 'Google Gemini', model: 'gemini-3.5-flash-lite', keyHint: 'Google AI Studio에서 발급한 키',
      keyUrl: 'https://aistudio.google.com/apikey',
      note: '무료 등급이 있습니다. 단, 무료 등급으로 보낸 내용은 Google이 제품 개선에 사용할 수 있다고 약관에 적혀 있습니다(유료 등급은 사용 안 함).',
      stt: 'gemini'
    },
    openai: {
      name: 'OpenAI', model: 'gpt-6-luna', sttModel: 'gpt-transcribe', keyHint: 'platform.openai.com의 API 키',
      keyUrl: 'https://platform.openai.com/api-keys',
      note: '유료(사용량 과금). API로 보낸 데이터는 기본적으로 모델 학습에 쓰이지 않는다고 OpenAI가 밝히고 있습니다.',
      stt: 'openai'
    },
    xai: {
      name: 'xAI (Grok)', model: 'grok-4.20-0309-non-reasoning', keyHint: 'console.x.ai의 API 키',
      keyUrl: 'https://console.x.ai',
      note: '유료(사용량 과금). 음성 인식은 xAI STT(/v1/stt)를 씁니다.',
      stt: 'xai'
    }
  };

  function getKey(p) { try { return localStorage.getItem(KEY_PREFIX + p) || ''; } catch (e) { return ''; } }
  function setKey(p, k) { try { if (k) localStorage.setItem(KEY_PREFIX + p, k.trim()); else localStorage.removeItem(KEY_PREFIX + p); } catch (e) { /* noop */ } }
  function clearKeys() { Object.keys(PROVIDERS).forEach(function (p) { setKey(p, ''); }); }

  var cfg = { provider: 'gemini', models: {} };
  function configure(c) { cfg = Object.assign({}, cfg, c || {}); }
  function provider() { return PROVIDERS[cfg.provider] ? cfg.provider : 'gemini'; }
  function model() { var p = provider(); return (cfg.models && cfg.models[p]) || PROVIDERS[p].model; }
  function hasKey() { return !!getKey(provider()); }

  function AIError(kind, msg, status) { var e = new Error(msg || kind); e.kind = kind; e.status = status; return e; }
  function friendly(e) {
    var k = e && e.kind;
    if (k === 'nokey') return '설정에서 AI 키를 넣으면 열려요.';
    if (k === 'auth') return 'AI 키가 맞지 않는 것 같아요. 설정에서 키를 확인해 주세요.';
    if (k === 'quota') return '요청 한도를 넘었어요. 잠시 뒤 다시 해 보세요.';
    if (k === 'timeout') return 'AI 응답이 늦어요. 다시 시도해 주세요.';
    if (k === 'network') return '인터넷 연결을 확인해 주세요.';
    if (k === 'model') return '모델 이름을 확인해 주세요(설정 → AI).';
    if (k === 'parse') return 'AI 응답을 읽지 못했어요. 다시 시도해 주세요.';
    return 'AI 호출 중 문제가 생겼어요. 다시 시도해 주세요.';
  }

  function http(url, init, timeoutMs) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 30000);
    if (ctl) init.signal = ctl.signal;
    return fetch(url, init).then(function (r) {
      clearTimeout(t);
      return r.text().then(function (txt) {
        var body = null; try { body = JSON.parse(txt); } catch (e) { body = txt; }
        if (r.ok) return body;
        var msg = body && body.error ? (body.error.message || JSON.stringify(body.error)) : String(txt).slice(0, 200);
        if (r.status === 401 || r.status === 403) throw AIError('auth', msg, r.status);
        if (r.status === 429) throw AIError('quota', msg, r.status);
        if (r.status === 404) throw AIError('model', msg, r.status);
        if (r.status === 400 && /api key|API_KEY|invalid.*key/i.test(msg)) throw AIError('auth', msg, r.status);
        throw AIError('http', msg, r.status);
      });
    }, function (err) {
      clearTimeout(t);
      throw AIError(err && err.name === 'AbortError' ? 'timeout' : 'network', String(err && err.message || err));
    });
  }

  function geminiMime(m) {
    m = String(m || 'audio/webm').split(';')[0].trim();
    if (m === 'audio/mp4' || m === 'audio/x-m4a') return 'audio/m4a';
    if (m === 'audio/mpeg') return 'audio/mp3';
    return m;
  }
  function extFor(m) { m = String(m || ''); return /mp4|m4a/.test(m) ? 'm4a' : /ogg/.test(m) ? 'ogg' : /wav/.test(m) ? 'wav' : /mpeg|mp3/.test(m) ? 'mp3' : 'webm'; }

  /** 텍스트 → JSON (system, user). 반환: 파싱된 객체 */
  function json(system, user, opt) {
    opt = opt || {};
    var p = provider(), key = getKey(p), m = model();
    if (!key) return Promise.reject(AIError('nokey'));
    var req;
    if (p === 'gemini') {
      req = http('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(m) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: opt.temperature == null ? 0.6 : opt.temperature }
        })
      }, opt.timeout).then(function (b) {
        var parts = b && b.candidates && b.candidates[0] && b.candidates[0].content && b.candidates[0].content.parts || [];
        return parts.map(function (x) { return x.text || ''; }).join('');
      });
    } else {
      var url = p === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.x.ai/v1/chat/completions';
      var body = { model: m, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } };
      if (p === 'openai' && /^gpt-(5|6)/.test(m)) body.reasoning_effort = 'none';
      else body.temperature = opt.temperature == null ? 0.6 : opt.temperature;
      req = http(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key }, body: JSON.stringify(body) }, opt.timeout)
        .then(function (b) { return b && b.choices && b.choices[0] && b.choices[0].message && b.choices[0].message.content || ''; });
    }
    return req.then(function (text) {
      var o = Core.Feedback.parseJSON(text);
      if (!o) throw AIError('parse', String(text).slice(0, 200));
      return o;
    });
  }

  /** 음성 → 영어 텍스트. 실패하면 reject (호출 측이 Web Speech 결과로 대체) */
  function transcribe(blob, mime) {
    var p = provider(), key = getKey(p);
    if (!key) return Promise.reject(AIError('nokey'));
    if (!blob || blob.size < 800) return Promise.resolve('');
    mime = mime || blob.type;
    if (p === 'gemini') {
      return window.SpeakMedia.blobToBase64(blob).then(function (b64) {
        return http('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model()) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: 'TASK: TRANSCRIBE. You are a verbatim speech-to-text engine for an English learner. Output only JSON {"text": "..."} with exactly what was said in English, keeping grammar mistakes, fillers like "um", and false starts. If nothing intelligible, return {"text": ""}.' }] },
            contents: [{ role: 'user', parts: [{ text: 'Transcribe this recording.' }, { inline_data: { mime_type: geminiMime(mime), data: b64 } }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0 }
          })
        }, 45000);
      }).then(function (b) {
        var parts = b && b.candidates && b.candidates[0] && b.candidates[0].content && b.candidates[0].content.parts || [];
        var o = Core.Feedback.parseJSON(parts.map(function (x) { return x.text || ''; }).join(''));
        return o && typeof o.text === 'string' ? o.text.trim() : '';
      });
    }
    var fd = new FormData();
    fd.append('file', blob, 'speech.' + extFor(mime));
    fd.append('language', 'en');
    var url;
    if (p === 'openai') { url = 'https://api.openai.com/v1/audio/transcriptions'; fd.append('model', (cfg.sttModels && cfg.sttModels.openai) || PROVIDERS.openai.sttModel); }
    else url = 'https://api.x.ai/v1/stt';
    return http(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + key }, body: fd }, 45000)
      .then(function (b) { return (b && typeof b.text === 'string') ? b.text.trim() : ''; });
  }

  /* ---------- 프롬프트 ---------- */
  var LEVEL_EN = { beginner: 'A2 (beginner)', intermediate: 'B1 (intermediate)', upper: 'B2 (upper-intermediate)' };

  function roleplayTurn(sc, history, ctx) {
    var sys = [
      'TASK: ROLEPLAY.',
      'You are a conversation partner for a Korean office worker practicing spoken English. Level: ' + (LEVEL_EN[ctx.level] || 'B1') + '.',
      'Scenario: ' + sc.situation + ' Your role: ' + sc.ai_role + '. Learner goal: ' + sc.goal + '.',
      'Rules:',
      '- Reply with ONE short spoken turn (max 2 sentences, under 25 words). Natural spoken English, no lists, no emojis.',
      '- Stay in role. Do NOT correct grammar during the roleplay. Keep the conversation moving toward the goal.',
      '- If the learner\'s meaning is unclear, ask a repair question starting with "Do you mean ...?" offering your best guess, and set is_repair true.',
      '- If the learner goes off-topic, first confirm what they meant ("Just to check, do you mean ...?"), then steer back. Set on_topic false.',
      '- If the learner asks you to repeat or slow down (e.g. "Could you say that again?"), repeat your last point more slowly and simply.',
      sc.fastTalk ? '- For THIS scenario, keep your first answers slightly fast and casual (natural contractions) so the learner practices asking for repetition.' : '',
      '- Use vocabulary at or below the learner\'s level.',
      '- Set end true when the goal is reached or after turn ' + ctx.maxTurns + '.',
      'Return JSON only: {"reply": string, "understood": boolean, "on_topic": boolean, "is_repair": boolean, "end": boolean}'
    ].filter(Boolean).join('\n');
    var user = 'Conversation so far (turn ' + ctx.turn + ' of ' + ctx.maxTurns + '):\n' +
      history.map(function (h) { return (h.who === 'ai' ? 'PARTNER: ' : 'LEARNER: ') + h.text; }).join('\n') +
      '\nWrite the PARTNER\'s next turn.';
    return json(sys, user, { temperature: 0.7 }).then(function (o) {
      var v = Core.Feedback.validateRoleplay(o);
      if (!v.ok) throw AIError('parse', v.error);
      return v.data;
    });
  }

  function feedback(ctx) {
    var sys = [
      'TASK: FEEDBACK.',
      'You are a speaking coach for a Korean office worker. Goal: being understood at once, not perfect grammar.',
      'Learner level: ' + (LEVEL_EN[ctx.level] || 'B1') + '. Improved sentences must use words at or below this level and sound like natural spoken English.',
      'Pick AT MOST 3 items, only issues that break comprehension or sound clearly unnatural. Ignore tiny slips that do not hurt understanding. Never add praise-only items.',
      'For each item: "original" = what the learner actually said (short quote), "issue_ko" = ONE short line in Korean, friendly coaching tone like "이렇게 말하면 더 잘 통합니다" (never blame; no words like 틀렸습니다), "improved" = one natural sentence they can say out loud, "layer" = meaning | naturalness | delivery, "severity" = low | medium | high.',
      'Set comprehensible=false if a listener would not understand the main point. Set on_topic=false if the answer did not match the task; then put ONE English question in repair_question that confirms what they meant (e.g. "Do you mean ...?"). Otherwise repair_question = null.',
      'Return JSON only, exactly: {"comprehensible": boolean, "on_topic": boolean, "items": [{"original": string, "issue_ko": string, "improved": string, "layer": string, "severity": string}], "repair_question": string|null}'
    ].join('\n');
    var user = 'Task: ' + ctx.task + '\n' + (ctx.transcriptLabel || 'Learner said') + ':\n' +
      ctx.utterances.map(function (u, i) { return (i + 1) + '. ' + u; }).join('\n');
    return json(sys, user, { temperature: 0.3 }).then(function (o) {
      var v = Core.Feedback.validate(o);
      if (!v.ok) throw AIError('parse', v.error);
      return v.data;
    });
  }

  function testConnection() {
    return json('TASK: PING. Return JSON {"ok": true}.', 'ping', { timeout: 20000 }).then(function (o) { return !!o; });
  }

  window.SpeakAI = { PROVIDERS: PROVIDERS, configure: configure, provider: provider, model: model, hasKey: hasKey, getKey: getKey, setKey: setKey, clearKeys: clearKeys, json: json, transcribe: transcribe, roleplayTurn: roleplayTurn, feedback: feedback, testConnection: testConnection, friendly: friendly, geminiMime: geminiMime, KEY_PREFIX: KEY_PREFIX };
})();
