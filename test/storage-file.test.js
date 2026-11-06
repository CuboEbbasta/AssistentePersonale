const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Schema = require('../www/js/core/schema.js');
const { creaArchivio } = require('../ia/archivio.js');
const { creaGestoriDati } = require('../ia/ipc.js');

const SORGENTE = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'storage.js'), 'utf8');

// Carica storage.js in un contesto con electronAPI finto e Preferences finto.
function ambiente(t, { preferences, gestori } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stfile-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const g = gestori || creaGestoriDati(creaArchivio(d));
  const toast = [];
  const plugins = preferences === undefined ? {} : { Preferences: preferences };
  const window = {
    electronAPI: { dati: {
      statoLeggi: async () => g.statoLeggi(),
      statoScrivi: async (j) => g.statoScrivi(j),
      statoMigra: async (v) => g.statoMigra(v)
    } },
    Capacitor: { Plugins: plugins },
    App: { mostraToast: (m) => toast.push(m) }
  };
  const ctx = { window, NucleoSchema: Schema, DataUtils: {}, console: { log() {}, warn() {}, error() {} }, setTimeout: (f) => { ctx.ritentati.push(f); return 0; }, ritentati: [] };
  vm.createContext(ctx);
  vm.runInContext(SORGENTE + ';this.Dati = Dati', ctx);
  return { d, g, ctx, toast, Dati: ctx.Dati };
}

const prefCon = (valore) => ({ get: async () => ({ value: valore }), set: async () => { throw new Error('non deve scrivere'); } });

test('primo avvio: importa Preferences nel file', async (t) => {
  const vecchio = JSON.stringify(Object.assign(Schema.statoDefault(), { routine: [{ id: 'vec' }] }));
  const { Dati, d, toast } = ambiente(t, { preferences: prefCon(vecchio) });
  const s = await Dati.carica();
  assert.strictEqual(s.routine[0].id, 'vec');
  assert.ok(fs.existsSync(path.join(d, 'stato.json')));
  assert.ok(toast.some((m) => m.includes('stato.import-backup.json')));
});

test('Preferences assente: salvataggio bloccato con avviso', async (t) => {
  const { Dati, d, toast } = ambiente(t);
  await Dati.carica();
  assert.ok(toast.length >= 1);
  assert.strictEqual(await Dati.salva(), false);
  assert.ok(!fs.existsSync(path.join(d, 'stato.json')));
});

test('valore Preferences corrotto: bloccato, avviso con nome file e cartella dati', async (t) => {
  const { Dati, d, toast } = ambiente(t, { preferences: prefCon('{rotto') });
  await Dati.carica();
  assert.ok(toast[0].includes('stato.import-backup.json') && toast[0].includes('cartella dati'));
  assert.strictEqual(await Dati.salva(), false);
  assert.ok(!fs.existsSync(path.join(d, 'stato.json')));
});

test('gia_presente (file creato da altri durante il caricamento): rilegge, non usa il default', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stfile-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const a = creaArchivio(d);
  const g = creaGestoriDati(a);
  let prima = true;
  const finto = Object.assign({}, g, { statoLeggi() {
    if (prima) { prima = false; return { ok: true, json: null, daBackup: false }; }
    return g.statoLeggi();
  } });
  a.scriviStato(Object.assign(Schema.statoDefault(), { routine: [{ id: 'esiste' }] }));
  const { Dati } = ambiente(t, { preferences: prefCon(null), gestori: finto });
  const s = await Dati.carica();
  assert.strictEqual(s.routine[0].id, 'esiste');
});

test('salvataggio fallito: un solo avviso per sessione e un nuovo tentativo', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stfile-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const g = creaGestoriDati(creaArchivio(d));
  let falliti = 0;
  const finto = Object.assign({}, g, { statoScrivi(j) { if (falliti < 2) { falliti++; return { ok: false }; } return g.statoScrivi(j); } });
  const { Dati, toast, ctx } = ambiente(t, { preferences: prefCon(null), gestori: finto });
  await Dati.carica();
  assert.strictEqual(await Dati.salva(), false);
  assert.strictEqual(await Dati.salva(), false);
  assert.strictEqual(toast.filter((m) => m.includes('Non riesco a salvare')).length, 1);
  assert.strictEqual(ctx.ritentati.length, 1); // un solo ritento pendente
  await ctx.ritentati[0]();
  assert.strictEqual(await Dati.salva(), true);
});
