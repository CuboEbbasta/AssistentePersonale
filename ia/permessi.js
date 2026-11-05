'use strict';
/**
 * Permessi e client dell'assistente (CommonJS, solo libreria standard).
 * Funzioni pure sulla Config: nessun I/O, nessuna mutazione dell'input.
 * Config = { abilitato, porta, client: [{ nome, tokenHash, sezioni }] }
 */
const crypto = require('node:crypto');
const Schema = require('../www/js/core/schema.js');
const Operazioni = require('../www/js/core/operazioni.js');

const RE_NOME = /^[a-z0-9-]{1,40}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const hashToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

function creaClient(config, nome, sezioni = ['agenda', 'obiettivi']) {
  if (typeof nome !== 'string' || !RE_NOME.test(nome)) throw new Error('nome client non valido (a-z, 0-9, trattino, 1-40 caratteri)');
  if (config.client.some(c => c.nome === nome)) throw new Error('esiste gia un client con questo nome');
  if (!Array.isArray(sezioni) || sezioni.length === 0) throw new Error('sezioni: serve almeno una sezione');
  if (new Set(sezioni).size !== sezioni.length) throw new Error('sezioni duplicate');
  for (const s of sezioni) {
    if (typeof s !== 'string' || !has(Schema.SEZIONI, s)) throw new Error('sezione inesistente: ' + String(s));
  }
  const token = crypto.randomBytes(32).toString('hex');
  const client = { nome, tokenHash: hashToken(token), sezioni: sezioni.slice() };
  return { config: { ...config, client: [...config.client, client] }, token };
}

function rimuoviClient(config, nome) {
  return { ...config, client: config.client.filter(c => c.nome !== nome) };
}

function autentica(config, token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return null;
  const h = Buffer.from(hashToken(token), 'utf8');
  let trovato = null;
  for (const c of config.client) {
    const atteso = Buffer.from(String(c.tokenHash), 'utf8');
    if (atteso.length === h.length && crypto.timingSafeEqual(atteso, h) && !trovato) trovato = c;
  }
  return trovato;
}

function vistaStato(stato, sezioni) {
  const out = {};
  for (const s of sezioni) {
    if (!has(Schema.SEZIONI, s)) continue;
    for (const k of Schema.SEZIONI[s]) if (has(stato, k)) out[k] = stato[k];
  }
  return out;
}

function puoProporre(client, op) {
  const sez = op && typeof op === 'object' ? Operazioni.sezioneDi(op.tipo) : null;
  return !!sez && client.sezioni.includes(sez);
}

module.exports = { creaClient, rimuoviClient, autentica, vistaStato, puoProporre };
