const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const { creaArchivio } = require('../ia/archivio.js');
const { creaGestoriAccesso } = require('../ia/ipc-accesso.js');

function setup(t, porta = 0) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
  const a = creaArchivio(d);
  a.scriviConfig({ abilitato: false, porta, client: [] });
  const g = creaGestoriAccesso(a);
  t.after(async () => { await g.chiudi(); fs.rmSync(d, { recursive: true, force: true }); });
  return { d, a, g };
}

function chiama(porta, metodo, p, token) {
  return new Promise((res, rej) => {
    const corpo = p ? JSON.stringify(p) : '';
    const h = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) };
    if (token) h.Authorization = 'Bearer ' + token;
    const r = http.request({ host: '127.0.0.1', port: porta, path: p ? '/mcp' : '/salute', method: metodo, headers: h, agent: false }, (x) => {
      let tx = ''; x.on('data', (c) => { tx += c; }); x.on('end', () => res({ stato: x.statusCode, corpo: tx }));
    });
    r.on('error', rej); r.end(corpo);
  });
}
const rpc = (porta, token, method, params) => chiama(porta, 'POST', { jsonrpc: '2.0', id: 1, method, params: params || {} }, token);

test('leggi di default: spento, nessun client', (t) => {
  const { g } = setup(t);
  assert.deepStrictEqual(g.accessoLeggi(), { ok: true, abilitato: false, porta: 0, avviato: false, client: [] });
});

test('abilita avvia il server (200 su /salute), disabilita lo ferma', async (t) => {
  const { g, a } = setup(t);
  const r = await g.accessoAbilita(true);
  assert.strictEqual(r.ok, true);
  const l = g.accessoLeggi();
  assert.ok(l.abilitato && l.avviato && l.porta > 0);
  assert.strictEqual(a.leggiConfig().abilitato, true);
  assert.strictEqual((await chiama(l.porta, 'GET', null)).stato, 200);
  assert.strictEqual((await g.accessoAbilita(false)).ok, true);
  assert.strictEqual(g.accessoLeggi().avviato, false);
  assert.strictEqual(a.leggiConfig().abilitato, false);
  await assert.rejects(chiama(l.porta, 'GET', null));
});

test('abilita valida l\'argomento', async (t) => {
  const { g } = setup(t);
  for (const v of ['si', 1, null, undefined, {}]) assert.strictEqual((await g.accessoAbilita(v)).ok, false);
});

test('creaClient: il token autentica, il tokenHash non esce mai, rimuovi -> 401', async (t) => {
  const { g } = setup(t);
  await g.accessoAbilita(true);
  const c = g.accessoCreaClient('prova', ['agenda', 'obiettivi']);
  assert.ok(c.ok && /^[0-9a-f]{64}$/.test(c.token));
  const l = g.accessoLeggi();
  assert.deepStrictEqual(l.client, [{ nome: 'prova', sezioni: ['agenda', 'obiettivi'] }]);
  assert.ok(!JSON.stringify(l).includes('tokenHash') && !JSON.stringify(l).includes(c.token));
  const ini = await rpc(l.porta, c.token, 'initialize');
  assert.strictEqual(ini.stato, 200);
  assert.ok(ini.corpo.includes('protocolVersion'));
  assert.strictEqual((await rpc(l.porta, 'x'.repeat(64), 'initialize')).stato, 401);
  assert.deepStrictEqual(g.accessoRimuoviClient('prova'), { ok: true });
  assert.strictEqual((await rpc(l.porta, c.token, 'initialize')).stato, 401);
  assert.strictEqual(g.accessoRimuoviClient('prova').ok, false);
});

test('sezione sensibile non concessa: ap_leggi rifiutato; concessa: ok', async (t) => {
  const { g } = setup(t);
  await g.accessoAbilita(true);
  const { token } = g.accessoCreaClient('solo-agenda', ['agenda']);
  const porta = g.accessoLeggi().porta;
  const r = await rpc(porta, token, 'tools/call', { name: 'ap_leggi', arguments: { sezione: 'diario' } });
  assert.strictEqual(r.stato, 200);
  assert.strictEqual(JSON.parse(r.corpo).result.isError, true, r.corpo);
  const ok = JSON.parse((await rpc(porta, token, 'tools/call', { name: 'ap_leggi', arguments: { sezione: 'agenda' } })).corpo);
  assert.ok(!ok.result.isError);
});

test('creaClient valida nome e sezioni', (t) => {
  const { g } = setup(t);
  for (const n of ['', 'Maiuscolo', 'con spazio', 'a'.repeat(41), '<img>', 5, null, '../x']) {
    assert.strictEqual(g.accessoCreaClient(n, ['agenda']).ok, false, String(n));
  }
  for (const s of [undefined, [], 'agenda', ['inesistente'], ['agenda', 'agenda'], [5], ['__proto__'], ['constructor']]) {
    assert.strictEqual(g.accessoCreaClient('ok', s).ok, false, JSON.stringify(s));
  }
  assert.strictEqual(g.accessoLeggi().client.length, 0);
});

test('creaClient: sezioni sensibili solo se richieste esplicitamente', (t) => {
  const { g } = setup(t);
  assert.ok(g.accessoCreaClient('ampio', ['agenda', 'dieta', 'diario']).ok);
  assert.deepStrictEqual(g.accessoLeggi().client[0].sezioni, ['agenda', 'dieta', 'diario']);
});

test('creaClient: nome duplicato rifiutato', (t) => {
  const { g } = setup(t);
  assert.ok(g.accessoCreaClient('a', ['agenda']).ok);
  const r = g.accessoCreaClient('a', ['agenda']);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codice, 'NOME_ESISTENTE');
});

test('rimuovi valida il nome', (t) => {
  const { g } = setup(t);
  for (const n of [null, 3, '', 'X Y', '../x']) assert.strictEqual(g.accessoRimuoviClient(n).ok, false);
});

test('porta occupata: errore chiaro, config non abilitata, senza percorsi', async (t) => {
  const occupante = net.createServer();
  await new Promise((r) => occupante.listen(0, '127.0.0.1', r));
  t.after(() => occupante.close());
  const { g, a, d } = setup(t, occupante.address().port);
  const r = await g.accessoAbilita(true);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.codice, 'PORTA_OCCUPATA');
  assert.ok(/porta/i.test(r.errore) && !r.errore.includes(d));
  assert.strictEqual(a.leggiConfig().abilitato, false);
  assert.strictEqual(g.accessoLeggi().avviato, false);
});

test('config illeggibile: errore generico senza percorsi', (t) => {
  const { g, d } = setup(t);
  fs.writeFileSync(path.join(d, 'ia-config.json'), '{rotto');
  const r = g.accessoLeggi();
  assert.strictEqual(r.ok, false);
  assert.ok(!r.errore.includes(d) && !/JSON|position/i.test(r.errore));
  assert.strictEqual(g.accessoCreaClient('a', ['agenda']).ok, false);
});

test('avviaSeAbilitato: parte solo se abilitato', async (t) => {
  const { g, a } = setup(t);
  assert.deepStrictEqual(await g.avviaSeAbilitato(), { ok: true, avviato: false });
  a.scriviConfig({ abilitato: true, porta: 0, client: [] });
  assert.deepStrictEqual(await g.avviaSeAbilitato(), { ok: true, avviato: true });
  assert.strictEqual(g.accessoLeggi().avviato, true);
});
