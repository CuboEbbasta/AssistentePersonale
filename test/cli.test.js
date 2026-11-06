const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { creaArchivio } = require('../ia/archivio.js');

const BIN = path.join(__dirname, '..', 'ia', 'bin', 'ap-ia.js');
const nuovaDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
const lancia = (dir, ...args) => spawnSync(process.execPath, [BIN, ...args], { env: { ...process.env, ASSISTENTE_DATI: dir }, encoding: 'utf8' });

test('client add stampa il token una volta; list non lo mostra ne mostra hash', () => {
  const dir = nuovaDir();
  const add = lancia(dir, 'client', 'add', 'claude', '--sezioni', 'agenda,diario');
  assert.strictEqual(add.status, 0, add.stderr);
  const token = (add.stdout.match(/[0-9a-f]{64}/) || [])[0];
  assert.ok(token, 'token stampato');
  const cfg = creaArchivio(dir).leggiConfig();
  assert.deepStrictEqual(cfg.client[0].sezioni, ['agenda', 'diario']);
  const lista = lancia(dir, 'client', 'list');
  assert.strictEqual(lista.status, 0);
  assert.ok(lista.stdout.includes('claude'));
  assert.ok(!lista.stdout.includes(token));
  assert.ok(!lista.stdout.includes(cfg.client[0].tokenHash));
  assert.ok(!/[0-9a-f]{64}/.test(lista.stdout));
});

test('client add: nome duplicato o sezione inesistente -> codice != 0 e messaggio', () => {
  const dir = nuovaDir();
  assert.strictEqual(lancia(dir, 'client', 'add', 'a').status, 0);
  const dup = lancia(dir, 'client', 'add', 'a');
  assert.notStrictEqual(dup.status, 0);
  assert.ok(dup.stderr.length > 0);
  assert.notStrictEqual(lancia(dir, 'client', 'add', 'b', '--sezioni', 'boh').status, 0);
});

test('client remove rimuove; inesistente -> errore', () => {
  const dir = nuovaDir();
  lancia(dir, 'client', 'add', 'a');
  assert.strictEqual(lancia(dir, 'client', 'remove', 'a').status, 0);
  assert.strictEqual(creaArchivio(dir).leggiConfig().client.length, 0);
  assert.notStrictEqual(lancia(dir, 'client', 'remove', 'a').status, 0);
});

test('abilita / disabilita cambiano la config', () => {
  const dir = nuovaDir();
  assert.strictEqual(lancia(dir, 'abilita').status, 0);
  assert.strictEqual(creaArchivio(dir).leggiConfig().abilitato, true);
  assert.strictEqual(lancia(dir, 'disabilita').status, 0);
  assert.strictEqual(creaArchivio(dir).leggiConfig().abilitato, false);
});

test('proposte: elenco leggibile', () => {
  const dir = nuovaDir();
  assert.ok(lancia(dir, 'proposte').stdout.includes('Nessuna proposta'));
  creaArchivio(dir).aggiungiProposta({ id: 'prop_1', stato: 'in_attesa', client: 'claude', motivo: 'Per prova', anteprima: ['Aggiungi task Leggere'] });
  const r = lancia(dir, 'proposte');
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes('prop_1'));
  assert.ok(r.stdout.includes('in_attesa'));
  assert.ok(r.stdout.includes('Per prova'));
  assert.ok(r.stdout.includes('Aggiungi task Leggere'));
});

test('serve con server disabilitato esce con messaggio chiaro', () => {
  const dir = nuovaDir();
  const r = lancia(dir, 'serve');
  assert.notStrictEqual(r.status, 0);
  assert.ok(r.stderr.includes('disabilitato'));
  assert.ok(r.stderr.includes('abilita'));
});

test('serve abilitato: ascolta e risponde a /salute', async () => {
  const dir = nuovaDir();
  const a = creaArchivio(dir);
  a.scriviConfig({ ...a.leggiConfig(), abilitato: true, porta: 0 });
  const figlio = spawn(process.execPath, [BIN, 'serve'], { env: { ...process.env, ASSISTENTE_DATI: dir } });
  try {
    const url = await new Promise((ok, ko) => {
      let buf = '';
      figlio.stdout.on('data', (c) => { buf += c; const m = /http:\/\/127\.0\.0\.1:\d+/.exec(buf); if (m) ok(m[0]); });
      figlio.on('exit', () => ko(new Error('uscito: ' + buf)));
      setTimeout(() => ko(new Error('timeout')), 5000);
    });
    const r = await fetch(url + '/salute');
    assert.strictEqual(await r.text(), 'ok');
  } finally { figlio.kill(); }
});

test('comando sconosciuto e nessun comando', () => {
  const dir = nuovaDir();
  assert.notStrictEqual(lancia(dir, 'boh').status, 0);
  assert.ok(lancia(dir).stdout.includes('Uso'));
});

test('proposte: mostra la data di creazione (creatoIl)', () => {
  const dir = nuovaDir();
  creaArchivio(dir).aggiungiProposta({ id: 'prop_d', stato: 'in_attesa', client: 'claude', creatoIl: '2026-11-05T10:00:00.000Z', anteprima: [] });
  assert.ok(lancia(dir, 'proposte').stdout.includes('2026-11-05T10:00:00.000Z'));
});

test('proposte: i caratteri di controllo del testo dell IA non arrivano al terminale', () => {
  const dir = nuovaDir();
  creaArchivio(dir).aggiungiProposta({
    id: 'prop_c', stato: 'in_attesa', client: 'cl\x1b[2Jaude',
    motivo: 'ciao\x1b[31m rosso\r\nRIGA FINTA\x07\x7f',
    anteprima: ['voce\x1b]0;titolo\x07 ok', 'nel\u0085mezzo'],
  });
  const r = lancia(dir, 'proposte');
  assert.strictEqual(r.status, 0);
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(r.stdout), 'nessun carattere di controllo (a parte i ritorni a capo della CLI)');
  assert.ok(!r.stdout.includes('\x1b'));
  assert.ok(r.stdout.includes('ciao[31m rosso'));
  assert.ok(r.stdout.includes('RIGA FINTA'));
  // «RIGA FINTA» resta nella stessa riga del motivo: non puo fingere una riga nuova
  assert.ok(r.stdout.split('\n').some(l => l.startsWith('  Motivo: ') && l.includes('RIGA FINTA')));
});
