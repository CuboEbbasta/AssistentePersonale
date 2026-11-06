'use strict';
/**
 * Server MCP su HTTP (CommonJS, solo libreria standard).
 * JSON-RPC su POST /mcp, GET /salute. Legge la Config a ogni richiesta.
 * Nessun dettaglio interno (percorsi, hash, messaggi di errore) esce mai.
 */
const http = require('node:http');
const Permessi = require('./permessi.js');
const { STRUMENTI, eseguiStrumento, ErroreStrumento } = require('./strumenti.js');

const PROTOCOLLO = '2025-06-18';
const MAX_CORPO = 100000;
const TIMEOUT_MS = 10000;
const HOST_AMMESSI = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostAmmesso(host) {
  if (typeof host !== 'string') return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::\d{1,5})?$/.exec(host.trim().toLowerCase());
  return !!m && HOST_AMMESSI.has(m[1]);
}

function dataLocaleISO(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

const errRpc = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

function rispondiRpc(msg, client, archivio) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return errRpc(null, -32600, 'Richiesta non valida');
  const id = msg.id;
  if (id === undefined || id === null) return null; // notifica
  try {
    let res;
    switch (msg.method) {
      case 'initialize':
        res = { protocolVersion: PROTOCOLLO, capabilities: { tools: {} }, serverInfo: { name: 'kyklion', version: '1.0.0' } };
        break;
      case 'ping':
        res = {};
        break;
      case 'tools/list':
        res = { tools: STRUMENTI };
        break;
      case 'tools/call': {
        const p = msg.params;
        if (p === null || typeof p !== 'object' || Array.isArray(p) || typeof p.name !== 'string') {
          return errRpc(id, -32602, 'Parametri non validi');
        }
        const adesso = new Date();
        const ctx = { archivio, client, oggiISO: dataLocaleISO(adesso), adessoISO: adesso.toISOString() };
        try {
          const r = eseguiStrumento(p.name, p.arguments, ctx);
          res = { content: [{ type: 'text', text: JSON.stringify(r) }] };
        } catch (e) {
          if (!(e instanceof ErroreStrumento)) throw e;
          res = { isError: true, content: [{ type: 'text', text: e.message }] };
        }
        break;
      }
      default:
        return errRpc(id, -32601, 'Metodo non supportato');
    }
    return { jsonrpc: '2.0', id, result: res };
  } catch (_) {
    return errRpc(id, -32603, 'Errore interno');
  }
}

/**
 * Crea il server SENZA metterlo in ascolto. Per avviarlo usare solo avviaServerMcp,
 * che lega sempre 127.0.0.1 (l'host non e configurabile).
 */
function creaServerMcp({ archivio } = {}) {
  function manda(res, codice, corpo, tipo, chiudi) {
    const buf = Buffer.from(corpo || '', 'utf8');
    const h = { 'Content-Type': tipo || 'application/json', 'Content-Length': buf.length };
    if (chiudi) h.Connection = 'close';
    res.writeHead(codice, h);
    res.end(buf);
  }
  // Corpo troppo grande: risposta subito, poi la connessione viene chiusa.
  function troppoGrande(req, res) {
    res.on('finish', () => req.destroy());
    manda(res, 413, JSON.stringify({ error: 'corpo troppo grande' }), null, true);
  }
  const errore = (res, codice, testo) => manda(res, codice, JSON.stringify({ error: testo }));

  function gestisci(req, res) {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/salute') return manda(res, 200, 'ok', 'text/plain');
    if (url !== '/mcp') return manda(res, 404, '', 'text/plain');
    if (req.method !== 'POST') return errore(res, 405, 'metodo non ammesso');
    if (!hostAmmesso(req.headers.host)) return errore(res, 403, 'host non ammesso');
    if (req.headers.origin !== undefined) return errore(res, 403, 'origine non ammessa');
    if (!/^application\/json\s*(;|$)/i.test(req.headers['content-type'] || '')) return errore(res, 415, 'serve Content-Type: application/json');

    let config;
    try {
      config = archivio.leggiConfig();
    } catch (_) {
      return errore(res, 500, 'errore interno');
    }
    if (!config || config.abilitato !== true) return errore(res, 503, 'accesso IA disabilitato');

    const m = /^bearer (.+)$/i.exec(req.headers.authorization || '');
    const client = m ? Permessi.autentica(config, m[1]) : null;
    if (!client) return errore(res, 401, 'non autorizzato');

    const lungh = Number(req.headers['content-length']);
    if (Number.isFinite(lungh) && lungh > MAX_CORPO) {
      return troppoGrande(req, res);
    }
    const pezzi = [];
    let totale = 0;
    let troppo = false;
    req.on('data', (c) => {
      totale += c.length;
      if (troppo) return;
      if (totale > MAX_CORPO) { troppo = true; pezzi.length = 0; troppoGrande(req, res); return; }
      pezzi.push(c);
    });
    req.on('error', () => {});
    req.on('end', () => {
      if (troppo) return;
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(pezzi).toString('utf8'));
      } catch (_) {
        return manda(res, 200, JSON.stringify(errRpc(null, -32700, 'JSON non valido')));
      }
      const r = rispondiRpc(msg, client, archivio);
      if (r === null) return manda(res, 202, '');
      manda(res, 200, JSON.stringify(r));
    });
  }

  const server = http.createServer((req, res) => {
    try {
      gestisci(req, res);
    } catch (_) {
      if (!res.headersSent) errore(res, 500, 'errore interno');
      else res.end();
    }
  });
  server.setTimeout(TIMEOUT_MS);
  server.headersTimeout = TIMEOUT_MS;
  server.requestTimeout = TIMEOUT_MS;
  return server;
}

function avviaServerMcp({ archivio, porta }) {
  const server = creaServerMcp({ archivio });
  return new Promise((ok, ko) => {
    server.once('error', ko);
    server.listen(porta, '127.0.0.1', () => { server.removeListener('error', ko); ok(server); });
  });
}

module.exports = { creaServerMcp, avviaServerMcp, dataLocaleISO };
