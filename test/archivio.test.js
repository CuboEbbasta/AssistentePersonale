const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const Schema = require('../www/js/core/schema.js');
const { creaArchivio, percorsoDati, ErroreArchivio } = require('../ia/archivio.js');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'archivio-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('percorsoDati usa ASSISTENTE_DATI se impostata', () => {
  assert.strictEqual(percorsoDati({ ASSISTENTE_DATI: '/x/y' }), '/x/y');
  assert.ok(percorsoDati({ APPDATA: 'C:\A', HOME: '/h', USERPROFILE: 'C:\U' }).length > 0);
});

test('cartella vuota: stato di default e nessuna proposta', (t) => {
  const a = creaArchivio(tmp(t));
  assert.deepStrictEqual(a.leggiStato(), Schema.statoDefault());
  assert.deepStrictEqual(a.elencaProposte(), []);
  assert.deepStrictEqual(a.leggiConfig(), { abilitato: false, porta: 3040, client: [] });
});

test('scrivi poi leggi ritorna lo stato migrato; la lettura non scrive', (t) => {
  const d = tmp(t);
  const a = creaArchivio(d);
  const s = Schema.statoDefault();
  a.scriviStato(s);
  assert.deepStrictEqual(a.leggiStato(), Schema.migra(s));
  const prima = fs.statSync(path.join(d, 'stato.json')).mtimeMs;
  a.leggiStato();
  assert.strictEqual(fs.statSync(path.join(d, 'stato.json')).mtimeMs, prima);
});

test('JSON troncato: STATO_CORROTTO, file intatto, backup leggibile', (t) => {
  const d = tmp(t);
  const a = creaArchivio(d);
  a.scriviStato(Schema.statoDefault());
  a.scriviStato(Schema.statoDefault());
  const p = path.join(d, 'stato.json');
  fs.writeFileSync(p, '{"versione": 1, "abc');
  assert.throws(() => a.leggiStato(), (e) => e instanceof ErroreArchivio && e.code === 'STATO_CORROTTO');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '{"versione": 1, "abc');
  assert.deepStrictEqual(a.leggiStatoDaBackup(), Schema.migra(Schema.statoDefault()));
});

test('scrittura atomica: dopo la 2a scrittura esiste il backup, nessun file temporaneo', (t) => {
  const d = tmp(t);
  const a = creaArchivio(d);
  a.scriviStato(Schema.statoDefault());
  assert.ok(!fs.existsSync(path.join(d, 'stato.bak.json')));
  a.scriviStato(Schema.statoDefault());
  assert.ok(fs.existsSync(path.join(d, 'stato.bak.json')));
  assert.deepStrictEqual(fs.readdirSync(d).sort(), ['stato.bak.json', 'stato.json']);
});

test('aggiornaProposta modifica; id inesistente lancia', (t) => {
  const a = creaArchivio(tmp(t));
  a.aggiungiProposta({ id: 'p1', stato: 'in_attesa' });
  const r = a.aggiornaProposta('p1', { stato: 'approvata' });
  assert.strictEqual(r.stato, 'approvata');
  assert.strictEqual(a.elencaProposte()[0].stato, 'approvata');
  assert.throws(() => a.aggiornaProposta('nope', {}), /nope/);
});

test('config: scrivi e rileggi', (t) => {
  const a = creaArchivio(tmp(t));
  a.scriviConfig({ abilitato: true, porta: 4000, client: [] });
  assert.deepStrictEqual(a.leggiConfig(), { abilitato: true, porta: 4000, client: [] });
});

test('due processi figli aggiungono 20 proposte ciascuno: 40 in proposte.json', async (t) => {
  const d = tmp(t);
  const helper = path.join(__dirname, 'helper-proposte.js');
  const lancia = (pref) => new Promise((ok, ko) => {
    const c = fork(helper, [d, pref, '20']);
    c.on('exit', (code) => (code === 0 ? ok() : ko(new Error('uscita ' + code))));
  });
  await Promise.all([lancia('A'), lancia('B')]);
  const ids = creaArchivio(d).elencaProposte().map((p) => p.id);
  assert.strictEqual(ids.length, 40);
  assert.strictEqual(new Set(ids).size, 40);
});

test('blocco vecchio (>10 s) rimosso', (t) => {
  const d = tmp(t);
  const lock = path.join(d, 'proposte.lock');
  fs.writeFileSync(lock, '');
  const vecchio = new Date(Date.now() - 11000);
  fs.utimesSync(lock, vecchio, vecchio);
  creaArchivio(d).aggiungiProposta({ id: 'x' });
  assert.strictEqual(creaArchivio(d).elencaProposte().length, 1);
  assert.ok(!fs.existsSync(lock));
});

test('blocco recente: riprova per ~2 s poi BLOCCO_SCADUTO', (t) => {
  const d = tmp(t);
  fs.writeFileSync(path.join(d, 'proposte.lock'), '');
  const t0 = Date.now();
  assert.throws(() => creaArchivio(d).aggiungiProposta({ id: 'x' }),
    (e) => e instanceof ErroreArchivio && e.code === 'BLOCCO_SCADUTO');
  const dt = Date.now() - t0;
  assert.ok(dt >= 1900 && dt < 4000, 'durata ' + dt);
});
