const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Schema = require('../www/js/core/schema.js');
const { creaArchivio } = require('../ia/archivio.js');
const { migraDaPreferences } = require('../ia/migrazione.js');

function tmp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'migrazione-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('valore valido e nessun file: importato, stato e copia creati', (t) => {
  const d = tmp(t);
  const a = creaArchivio(d);
  const s = Schema.statoDefault();
  s.routine = [{ id: 'r1', nome: 'Corsa' }];
  const grezzo = JSON.stringify(s);
  assert.strictEqual(migraDaPreferences(a, grezzo), 'importato');
  assert.ok(fs.existsSync(path.join(d, 'stato.json')));
  assert.strictEqual(fs.readFileSync(path.join(d, 'stato.import-backup.json'), 'utf8'), grezzo);
  assert.strictEqual(a.leggiStato().routine[0].id, 'r1');
});

test('file già presente: gia_presente, nessuna sovrascrittura', (t) => {
  const d = tmp(t);
  const a = creaArchivio(d);
  a.scriviStato(Schema.statoDefault());
  const prima = fs.readFileSync(path.join(d, 'stato.json'), 'utf8');
  assert.strictEqual(migraDaPreferences(a, JSON.stringify({ routine: [{ id: 'x' }] })), 'gia_presente');
  assert.strictEqual(fs.readFileSync(path.join(d, 'stato.json'), 'utf8'), prima);
  assert.ok(!fs.existsSync(path.join(d, 'stato.import-backup.json')));
});

test('null o stringa vuota: nessun_dato, nessun file', (t) => {
  const d = tmp(t);
  const a = creaArchivio(d);
  assert.strictEqual(migraDaPreferences(a, null), 'nessun_dato');
  assert.strictEqual(migraDaPreferences(a, ''), 'nessun_dato');
  assert.ok(!fs.existsSync(path.join(d, 'stato.json')));
});

test('valore non JSON o non oggetto: lancia, nessun file creato', (t) => {
  const d = tmp(t);
  const a = creaArchivio(d);
  assert.throws(() => migraDaPreferences(a, '{rotto'));
  assert.throws(() => migraDaPreferences(a, '[1,2]'));
  assert.throws(() => migraDaPreferences(a, '42'));
  assert.ok(!fs.existsSync(path.join(d, 'stato.json')));
  assert.ok(!fs.existsSync(path.join(d, 'stato.import-backup.json')));
});
