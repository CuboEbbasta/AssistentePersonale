'use strict';
/**
 * Gestori dei canali IPC dell'assistente IA integrato (elenco modelli e
 * generazione). Logica senza Electron: main.js li collega ai canali.
 * Valida gli argomenti, applica i timeout e al renderer restituisce solo
 * messaggi generici: mai stack trace, percorsi né la chiave API.
 */
const NucleoClienteIA = require('../www/js/core/clienteia.js');

const TIMEOUT_GENERAZIONE_MS = 120000;
const TIMEOUT_ELENCO_MS = 10000;
const LIMITE_INDIRIZZO = 2048;
const LIMITE_MODELLO = 200;
const LIMITE_CHIAVE = 1024;
const LIMITE_TESTO = 1024 * 1024; // prompt e prompt di sistema

class ErroreIA extends Error {}

function validaConfig(cfg, { conModello }) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new ErroreIA('Impostazioni IA non valide.');
  if (!NucleoClienteIA.TIPI.includes(cfg.tipoServer)) throw new ErroreIA('Tipo di server IA non ammesso.');
  const ind = cfg.indirizzoServer;
  if (typeof ind !== 'string' || ind.length === 0 || ind.length > LIMITE_INDIRIZZO || !/^https?:\/\//i.test(ind)) {
    throw new ErroreIA('Indirizzo del server non valido: deve iniziare con http:// o https://.');
  }
  let u;
  try { u = new URL(ind); } catch (_) { throw new ErroreIA('Indirizzo del server non valido.'); }
  if (u.username || u.password) throw new ErroreIA('Indirizzo del server non valido: niente credenziali nell\'indirizzo (usa il campo Chiave API).');
  const modello = cfg.modello;
  if (conModello) {
    if (typeof modello !== 'string' || modello.trim().length === 0 || modello.length > LIMITE_MODELLO) throw new ErroreIA('Nome del modello non valido.');
  } else if (modello !== undefined && (typeof modello !== 'string' || modello.length > LIMITE_MODELLO)) {
    throw new ErroreIA('Nome del modello non valido.');
  }
  const chiave = cfg.chiaveApi === undefined ? '' : cfg.chiaveApi;
  if (typeof chiave !== 'string' || chiave.length > LIMITE_CHIAVE || /[\u0000-\u001f\u007f]/.test(chiave)) {
    throw new ErroreIA('Chiave API non valida.');
  }
  return {
    tipoServer: cfg.tipoServer,
    indirizzoServer: ind,
    modello: typeof modello === 'string' ? modello.trim() : '',
    chiaveApi: chiave
  };
}

function creaGestoriIA(opzioni = {}) {
  const timeoutGenerazione = opzioni.timeoutGenerazioneMs || TIMEOUT_GENERAZIONE_MS;
  const timeoutElenco = opzioni.timeoutElencoMs || TIMEOUT_ELENCO_MS;
  const doFetch = opzioni.fetch || ((...a) => fetch(...a));

  // Esegue la richiesta e restituisce il JSON; ogni fallimento diventa ErroreIA con messaggio generico.
  async function richiediJson(url, init, timeoutMs) {
    let risposta;
    try {
      risposta = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        throw new ErroreIA('Tempo scaduto: il server non ha risposto in ' + Math.round(timeoutMs / 1000) + ' secondi.');
      }
      throw new ErroreIA('Impossibile raggiungere il server IA.');
    }
    if (!risposta.ok) throw new ErroreIA('Il server ha risposto con codice ' + risposta.status + '.');
    try {
      return await risposta.json();
    } catch (_) {
      throw new ErroreIA('Risposta del server non valida (non è JSON).');
    }
  }

  // Nessun dettaglio dell'eccezione arriva al renderer, salvo i messaggi nostri.
  function comeErrore(e) {
    return { ok: false, errore: e instanceof ErroreIA || (e && e.message && /^(Risposta del server|Tipo di server)/.test(e.message)) ? e.message : 'Operazione IA non riuscita.' };
  }

  async function elencaModelli(arg) {
    try {
      const cfg = validaConfig(arg, { conModello: false });
      const richiesta = NucleoClienteIA.costruisciElencoModelli(cfg);
      const json = await richiediJson(richiesta.url, { method: 'GET', headers: richiesta.headers }, timeoutElenco);
      return { ok: true, modelli: NucleoClienteIA.leggiElencoModelli(cfg.tipoServer, json) };
    } catch (e) { return comeErrore(e); }
  }

  async function chiama(arg) {
    try {
      const cfg = validaConfig(arg, { conModello: true });
      const { prompt, sistema } = arg;
      if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > LIMITE_TESTO) throw new ErroreIA('Testo della richiesta non valido.');
      if (sistema !== undefined && sistema !== null && (typeof sistema !== 'string' || sistema.length > LIMITE_TESTO)) throw new ErroreIA('Istruzioni di sistema non valide.');
      if (arg.json !== undefined && typeof arg.json !== 'boolean') throw new ErroreIA('Opzione json non valida.');
      if (arg.think !== undefined && typeof arg.think !== 'boolean') throw new ErroreIA('Opzione think non valida.');
      const opz = { json: arg.json === true };
      if (arg.think === false) opz.think = false;
      const invia = (o) => {
        const richiesta = NucleoClienteIA.costruisciGenerazione(cfg, prompt, sistema || '', o);
        return richiediJson(richiesta.url, { method: 'POST', headers: richiesta.headers, body: richiesta.corpo }, timeoutGenerazione);
      };
      let json;
      try { json = await invia(opz); } catch (e) {
        // server vecchio che rifiuta "think" (400): riprova una volta senza
        if (opz.think === false && e instanceof ErroreIA && /codice 400/.test(e.message)) json = await invia({ json: opz.json });
        else throw e;
      }
      return { ok: true, testo: NucleoClienteIA.leggiGenerazione(cfg.tipoServer, json) };
    } catch (e) { return comeErrore(e); }
  }

  return { elencaModelli, chiama };
}

module.exports = { creaGestoriIA, validaConfig, TIMEOUT_GENERAZIONE_MS, TIMEOUT_ELENCO_MS };
