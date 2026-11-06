/**
 * core/clienteia.js
 * Funzioni PURE che costruiscono e interpretano le richieste verso il server IA.
 * Supporta due tipi di server: 'ollama' (API nativa) e 'openai' (qualunque server
 * compatibile OpenAI: LiteLLM, LM Studio, llama.cpp, vLLM, OpenRouter...).
 * Nessun accesso alla rete qui: lo fanno main.js (Electron) o fetch (Android/web).
 * Modulo UMD: Node (module.exports) e browser (NucleoClienteIA).
 */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.NucleoClienteIA = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const TIPI = ['ollama', 'openai'];
  const PREDEFINITO = { ollama: 'http://localhost:11434', openai: 'http://localhost:4000' };

  function controllaTipo(tipo) {
    if (!TIPI.includes(tipo)) throw new Error('Tipo di server IA non riconosciuto.');
    return tipo;
  }

  function senzaBarreFinali(indirizzo) {
    return String(indirizzo || '').trim().replace(/\/+$/, '');
  }

  // Per OpenAI la base può già finire con /v1: non va duplicato.
  function baseApi(cfg) {
    const base = senzaBarreFinali(cfg.indirizzoServer);
    if (cfg.tipoServer === 'openai') return (/\/v1$/.test(base) ? base : base + '/v1');
    return base;
  }

  function intestazioni(cfg, conCorpo) {
    const h = {};
    if (conCorpo) h['Content-Type'] = 'application/json';
    const chiave = typeof cfg.chiaveApi === 'string' ? cfg.chiaveApi.trim() : '';
    if (cfg.tipoServer === 'openai' && chiave) h.Authorization = 'Bearer ' + chiave;
    return h;
  }

  function costruisciElencoModelli(cfg) {
    controllaTipo(cfg.tipoServer);
    const url = cfg.tipoServer === 'openai' ? baseApi(cfg) + '/models' : baseApi(cfg) + '/api/tags';
    return { url, headers: intestazioni(cfg, false) };
  }

  function formatoNonValido() {
    return new Error('Risposta del server non valida (formato non riconosciuto).');
  }

  function leggiElencoModelli(tipoServer, json) {
    controllaTipo(tipoServer);
    if (!json || typeof json !== 'object') throw formatoNonValido();
    if (tipoServer === 'openai') {
      if (!Array.isArray(json.data)) throw formatoNonValido();
      return json.data.map(m => m && m.id).filter(id => typeof id === 'string' && id);
    }
    if (!Array.isArray(json.models)) throw formatoNonValido();
    return json.models.map(m => m && m.name).filter(n => typeof n === 'string' && n);
  }

  // opzioni (facoltative): { json: true } chiede una risposta JSON al server (Ollama format:'json', OpenAI response_format);
  // { think: false } spegne il «ragionamento» dei modelli che lo hanno (Ollama): più veloce, e la risposta resta solo JSON.
  // In modalità json la temperatura è bassa e su Ollama il contesto è 8192 token (prompt con esempi + dati dell'utente).
  function costruisciGenerazione(cfg, prompt, sistema, opzioni) {
    controllaTipo(cfg.tipoServer);
    const opz = opzioni || {};
    if (cfg.tipoServer === 'openai') {
      const messages = [];
      if (sistema) messages.push({ role: 'system', content: sistema });
      messages.push({ role: 'user', content: prompt });
      const corpo = { model: cfg.modello, messages, stream: false };
      if (opz.json) { corpo.response_format = { type: 'json_object' }; corpo.temperature = 0.2; }
      return { url: baseApi(cfg) + '/chat/completions', headers: intestazioni(cfg, true), corpo: JSON.stringify(corpo) };
    }
    const corpo = { model: cfg.modello, prompt, stream: false };
    if (sistema) corpo.system = sistema;
    if (opz.json) { corpo.format = 'json'; corpo.options = { temperature: 0.2, num_ctx: 8192 }; }
    if (opz.think === false) corpo.think = false;
    return { url: baseApi(cfg) + '/api/generate', headers: intestazioni(cfg, true), corpo: JSON.stringify(corpo) };
  }

  function leggiGenerazione(tipoServer, json) {
    controllaTipo(tipoServer);
    if (!json || typeof json !== 'object') throw formatoNonValido();
    let testo;
    if (tipoServer === 'openai') {
      const scelta = Array.isArray(json.choices) ? json.choices[0] : null;
      testo = scelta && scelta.message ? scelta.message.content : undefined;
    } else {
      testo = json.response;
    }
    if (typeof testo !== 'string') throw formatoNonValido();
    return testo;
  }

  return { TIPI, PREDEFINITO, costruisciElencoModelli, leggiElencoModelli, costruisciGenerazione, leggiGenerazione };
});
