const test = require('node:test');
const assert = require('node:assert');
const Schema = require('../www/js/core/schema.js');
const P = require('../ia/permessi.js');

const base = () => ({ abilitato: false, porta: 3040, client: [] });

test('creaClient: token mostrato una volta, config con solo hash', () => {
  const orig = base();
  const { config, token } = P.creaClient(orig, 'claude-desktop');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.strictEqual(orig.client.length, 0);
  assert.strictEqual(config.client.length, 1);
  assert.deepStrictEqual(config.client[0].sezioni, ['agenda', 'obiettivi']);
  assert.match(config.client[0].tokenHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(config).includes(token));
  assert.notStrictEqual(config.client[0].tokenHash, token);
});

test('creaClient: nome duplicato o non valido', () => {
  const { config } = P.creaClient(base(), 'uno');
  assert.throws(() => P.creaClient(config, 'uno'));
  for (const n of ['', 'Maiuscolo', 'con spazio', 'a_b', 'x'.repeat(41), 5, undefined]) {
    assert.throws(() => P.creaClient(base(), n), String(n));
  }
  assert.doesNotThrow(() => P.creaClient(base(), 'x'.repeat(40)));
});

test('creaClient: sezioni non valide', () => {
  assert.throws(() => P.creaClient(base(), 'a', ['inesistente']));
  assert.throws(() => P.creaClient(base(), 'a', []));
  assert.throws(() => P.creaClient(base(), 'a', ['agenda', 'agenda']));
  assert.throws(() => P.creaClient(base(), 'a', 'agenda'));
  assert.throws(() => P.creaClient(base(), 'a', ['__proto__']));
  const { config } = P.creaClient(base(), 'a', ['sonno']);
  assert.deepStrictEqual(config.client[0].sezioni, ['sonno']);
});

test('rimuoviClient: non muta e rimuove', () => {
  const { config } = P.creaClient(base(), 'uno');
  const r = P.rimuoviClient(config, 'uno');
  assert.strictEqual(r.client.length, 0);
  assert.strictEqual(config.client.length, 1);
  assert.strictEqual(P.rimuoviClient(config, 'altro').client.length, 1);
});

test('autentica', () => {
  const { config, token } = P.creaClient(base(), 'uno');
  assert.strictEqual(P.autentica(config, token).nome, 'uno');
  assert.strictEqual(P.autentica(config, 'a'.repeat(64)), null);
  assert.strictEqual(P.autentica(config, token.slice(1)), null);
  assert.strictEqual(P.autentica(config, token + 'a'), null);
  assert.strictEqual(P.autentica(config, ''), null);
  assert.strictEqual(P.autentica(config, undefined), null);
  assert.strictEqual(P.autentica(config, 123), null);
  assert.strictEqual(P.autentica(config, null), null);
  assert.strictEqual(P.autentica(base(), token), null);
});

test('vistaStato: solo sezioni permesse', () => {
  const stato = Schema.statoDefault();
  stato.impostazioniIA = { x: 1 };
  stato.impostazioni = { y: 1 };
  const v = P.vistaStato(stato, ['agenda']);
  for (const k of Schema.SEZIONI.agenda) assert.ok(k in v || !(k in stato), k);
  for (const k of ['journal', 'profilo', 'sonnoLog', 'impostazioniIA', 'impostazioni', 'obiettivi']) assert.ok(!(k in v), k);
  assert.deepStrictEqual(Object.keys(v).sort(), Schema.SEZIONI.agenda.filter(k => k in stato).sort());
  const w = P.vistaStato(stato, ['sonno', 'diario']);
  assert.deepStrictEqual(Object.keys(w).sort(), ['journal', 'sonnoLog']);
});

test('puoProporre', () => {
  const c = { nome: 'a', tokenHash: 'x', sezioni: ['agenda'] };
  assert.strictEqual(P.puoProporre(c, { tipo: 'sonno.imposta' }), false);
  assert.strictEqual(P.puoProporre({ ...c, sezioni: ['sonno'] }, { tipo: 'sonno.imposta' }), true);
  assert.strictEqual(P.puoProporre(c, { tipo: 'inesistente' }), false);
  assert.strictEqual(P.puoProporre(c, null), false);
});
