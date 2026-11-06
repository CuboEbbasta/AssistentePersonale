const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Schema = require('../www/js/core/schema.js');
const { creaArchivio } = require('../ia/archivio.js');
const { creaGestoriDati, LIMITE_STATO } = require('../ia/ipc.js');

function setup(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const a = creaArchivio(d);
  return { d, a, g: creaGestoriDati(a) };
}

test('statoLeggi senza file: json null', (t) => {
  const { g } = setup(t);
  assert.deepStrictEqual(g.statoLeggi(), { ok: true, json: null, daBackup: false });
});

test('statoScrivi poi statoLeggi', (t) => {
  const { g } = setup(t);
  const s = Schema.statoDefault();
  s.routine = [{ id: 'r1' }];
  assert.deepStrictEqual(g.statoScrivi(JSON.stringify(s)), { ok: true });
  const r = g.statoLeggi();
  assert.ok(r.ok && !r.daBackup);
  assert.strictEqual(JSON.parse(r.json).routine[0].id, 'r1');
});

test('statoScrivi valida gli argomenti', (t) => {
  const { g, d } = setup(t);
  for (const v of [null, 5, {}, '{rotto', '[1]', 'null', 'x'.repeat(LIMITE_STATO + 1)]) {
    assert.strictEqual(g.statoScrivi(v).ok, false);
  }
  assert.ok(!fs.existsSync(path.join(d, 'stato.json')));
});

test('stato corrotto con backup: usa il backup e lo segnala', (t) => {
  const { g, d } = setup(t);
  g.statoScrivi(JSON.stringify(Schema.statoDefault()));
  g.statoScrivi(JSON.stringify(Object.assign(Schema.statoDefault(), { routine: [{ id: 'b' }] })));
  fs.writeFileSync(path.join(d, 'stato.json'), '{"troncato');
  const r = g.statoLeggi();
  assert.ok(r.ok && r.daBackup);
  assert.deepStrictEqual(JSON.parse(r.json).routine, []);
  assert.strictEqual(fs.readFileSync(path.join(d, 'stato.json'), 'utf8'), '{"troncato'); // non sovrascritto
});

test('stato corrotto senza backup: errore, nessuno stato vuoto, niente percorsi', (t) => {
  const { g, d } = setup(t);
  fs.writeFileSync(path.join(d, 'stato.json'), '{"troncato');
  const r = g.statoLeggi();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codice, 'STATO_CORROTTO');
  assert.ok(!JSON.stringify(r).includes(d));
});

test('statoMigra: importa il valore di Preferences una sola volta', (t) => {
  const { g } = setup(t);
  const grezzo = JSON.stringify(Object.assign(Schema.statoDefault(), { routine: [{ id: 'p' }] }));
  assert.deepStrictEqual(g.statoMigra(grezzo), { ok: true, esito: 'importato' });
  assert.strictEqual(g.statoMigra(grezzo).esito, 'gia_presente');
  const { g: g2 } = setup(t);
  assert.strictEqual(g2.statoMigra('{rotto').ok, false);
  assert.strictEqual(g.statoMigra(7).ok, false);
});

test('proposte: elenca e aggiorna solo con patch valida', (t) => {
  const { g, a } = setup(t);
  a.aggiungiProposta({ id: 'p1', stato: 'in_attesa', titolo: 'T' });
  assert.strictEqual(g.proposteElenca().proposte.length, 1);
  assert.strictEqual(g.proposteAggiorna('p1', { stato: 'applicata' }).proposta.stato, 'applicata');
  for (const [id, patch] of [[5, { stato: 'applicata' }], ['p1', { stato: 'boh' }], ['p1', { stato: 'rifiutata', titolo: 'x' }], ['p1', null], ['p1', []]]) {
    assert.strictEqual(g.proposteAggiorna(id, patch).ok, false);
  }
  const r = g.proposteAggiorna('inesistente', { stato: 'rifiutata' });
  assert.strictEqual(r.ok, false);
});

test('errori interni: nessuno stack né percorso verso il renderer', (t) => {
  const { d } = setup(t);
  const rotto = creaGestoriDati({
    dir: d,
    elencaProposte() { throw new Error('boom ' + d); },
    aggiornaProposta() { throw new Error('boom ' + d); },
    scriviStato() { throw new Error('boom ' + d); },
    leggiStato() { throw new Error('boom ' + d); }
  });
  for (const r of [rotto.proposteElenca(), rotto.statoScrivi('{}'), rotto.proposteAggiorna('a', { stato: 'applicata' })]) {
    assert.strictEqual(r.ok, false);
    assert.ok(!JSON.stringify(r).includes(d));
    assert.ok(!JSON.stringify(r).includes('boom'));
  }
});

test('stato.json mancante ma stato.bak.json valido: usa il backup, non reimporta le Preferences', (t) => {
  const { g, d } = setup(t);
  g.statoScrivi(JSON.stringify(Object.assign(Schema.statoDefault(), { routine: [{ id: 'b1' }] })));
  g.statoScrivi(JSON.stringify(Object.assign(Schema.statoDefault(), { routine: [{ id: 'b2' }] })));
  fs.unlinkSync(path.join(d, 'stato.json'));
  const r = g.statoLeggi();
  assert.ok(r.ok && r.daBackup === true);
  assert.strictEqual(JSON.parse(r.json).routine[0].id, 'b1');
  assert.ok(!fs.existsSync(path.join(d, 'stato.json'))); // la lettura non scrive
});

test('stato.json mancante e backup illeggibile: come se non ci fossero dati (json null)', (t) => {
  const { g, d } = setup(t);
  fs.writeFileSync(path.join(d, 'stato.bak.json'), '{"rotto');
  assert.deepStrictEqual(g.statoLeggi(), { ok: true, json: null, daBackup: false });
});
