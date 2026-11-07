/**
 * ollama-client.js
 * Parla con il server IA scelto dall'utente: Ollama oppure qualunque server
 * compatibile OpenAI (LiteLLM, LM Studio, llama.cpp, vLLM, OpenRouter...).
 * Le richieste si costruiscono e si leggono con le funzioni pure di
 * core/clienteia.js (NucleoClienteIA). Non gira mai un modello sul telefono:
 * ci si collega sempre a un server esterno (di norma quello del PC, raggiunto
 * anche dal telefono via IP di rete locale — vedi ui-ia.js).
 *
 * Su PC (Electron) la chiamata passa dal processo main (Node, nessun
 * problema di CORS; validazione e timeout in ia/ipc-ia.js). Su Android/anteprima
 * web usa fetch diretto con le stesse funzioni pure: se CapacitorHttp è
 * abilitato (vedi capacitor.config.json), Android instrada la richiesta
 * nativamente, aggirando le restrizioni CORS della WebView.
 */
const ClienteIA = (function () {
  const TIMEOUT_GENERAZIONE_MS = 120000;
  const TIMEOUT_ELENCO_MS = 10000;

  function config() { return Dati.stato().impostazioniIA; }

  // Configurazione "pulita" da inviare: tipo, indirizzo, modello, chiave.
  // `sovrascrivi` permette di verificare i valori del modulo prima di salvarli.
  function cfgCompleta(sovrascrivi) {
    const c = Object.assign({}, config(), sovrascrivi || {});
    const tipoServer = NucleoClienteIA.TIPI.includes(c.tipoServer) ? c.tipoServer : 'ollama';
    return {
      tipoServer,
      indirizzoServer: (c.indirizzoServer || NucleoClienteIA.PREDEFINITO[tipoServer]).trim().replace(/\/+$/, ''),
      modello: c.modello || '',
      chiaveApi: c.chiaveApi || ''
    };
  }

  // Dentro l'app Android si usa direttamente il plugin nativo CapacitorHttp: è più affidabile del fetch «patchato»
  // (niente problemi di contenuto misto https→http né di segnale di timeout) e restituisce l'errore vero.
  function plugHttpNativo() {
    const C = window.Capacitor;
    return (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform() && C.Plugins && C.Plugins.CapacitorHttp) || null;
  }

  async function leggiJsonNativo(plug, url, init, timeoutMs) {
    let r;
    try {
      r = await plug.request({
        url, method: init.method || 'GET', headers: init.headers || {},
        data: init.body ? JSON.parse(init.body) : undefined,
        connectTimeout: 10000, readTimeout: timeoutMs, responseType: 'json'
      });
    } catch (e) {
      const dettaglio = String((e && (e.message || e.errorMessage)) || e || '').slice(0, 160);
      if (/time ?out|timed out/i.test(dettaglio)) throw new Error('Tempo scaduto: il server non ha risposto in ' + Math.round(timeoutMs / 1000) + ' secondi.');
      throw new Error('Impossibile raggiungere ' + url.replace(/\?.*$/, '') + (dettaglio ? ' (' + dettaglio + ')' : '') + '.');
    }
    if (!r || r.status < 200 || r.status >= 300) throw new Error('Il server ha risposto con codice ' + (r && r.status) + '.');
    let dati = r.data;
    if (typeof dati === 'string') { try { dati = JSON.parse(dati); } catch (_) { throw new Error('Risposta del server non valida (non è JSON).'); } }
    if (dati === null || typeof dati !== 'object') throw new Error('Risposta del server non valida (non è JSON).');
    return dati;
  }

  async function leggiJson(url, init, timeoutMs) {
    const plug = plugHttpNativo();
    if (plug) return leggiJsonNativo(plug, url, init, timeoutMs);
    let risposta;
    try {
      risposta = await fetch(url, Object.assign({}, init, { signal: AbortSignal.timeout(timeoutMs) }));
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new Error('Tempo scaduto: il server non ha risposto in ' + Math.round(timeoutMs / 1000) + ' secondi.');
      }
      throw new Error('Impossibile raggiungere il server IA.');
    }
    if (!risposta.ok) throw new Error('Il server ha risposto con codice ' + risposta.status + '.');
    try { return await risposta.json(); } catch (_) { throw new Error('Risposta del server non valida (non è JSON).'); }
  }

  async function testConnessione(sovrascrivi) {
    const cfg = cfgCompleta(sovrascrivi);
    try {
      if (window.electronAPI && window.electronAPI.elencaModelliIA) {
        return await window.electronAPI.elencaModelliIA(cfg);
      }
      const richiesta = NucleoClienteIA.costruisciElencoModelli(cfg);
      const json = await leggiJson(richiesta.url, { method: 'GET', headers: richiesta.headers }, TIMEOUT_ELENCO_MS);
      return { ok: true, modelli: NucleoClienteIA.leggiElencoModelli(cfg.tipoServer, json) };
    } catch (e) {
      return { ok: false, errore: e.message };
    }
  }

  // opzioni (facoltative): { json: true } risposta JSON dal server; { think: false } niente «ragionamento» (Ollama).
  async function chiamaIA(prompt, promptSistema, opzioni) {
    const cfg = config();
    if (!cfg.abilitata) return { ok: false, errore: 'IA non abilitata nelle impostazioni.' };
    const completa = cfgCompleta();
    try {
      if (window.electronAPI && window.electronAPI.chiamaIA) {
        // il processo main (ia/ipc-ia.js) applica json/think e, se il server rifiuta think, riprova senza
        return await window.electronAPI.chiamaIA(Object.assign({}, completa, { prompt, sistema: promptSistema || '' }, opzioni && opzioni.json ? { json: true } : {}, opzioni && opzioni.think === false ? { think: false } : {}));
      }
      const invia = (o) => {
        const richiesta = NucleoClienteIA.costruisciGenerazione(completa, prompt, promptSistema || '', o);
        return leggiJson(richiesta.url, { method: 'POST', headers: richiesta.headers, body: richiesta.corpo }, TIMEOUT_GENERAZIONE_MS);
      };
      let json;
      try { json = await invia(opzioni); } catch (e) {
        // server vecchio che rifiuta «think» (400): riprova una volta senza
        if (opzioni && opzioni.think === false && /codice 400/.test(e.message)) json = await invia({ json: opzioni.json });
        else throw e;
      }
      return { ok: true, testo: NucleoClienteIA.leggiGenerazione(completa.tipoServer, json) };
    } catch (e) {
      return { ok: false, errore: e.message };
    }
  }

  // chiamaOllama resta come alias per compatibilità: ora vale per qualunque tipo di server.
  return { config, testConnessione, chiamaIA, chiamaOllama: chiamaIA };
})();

window.ClienteIA = ClienteIA;
