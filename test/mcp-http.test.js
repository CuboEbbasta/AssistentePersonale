const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { creaArchivio } = require('../ia/archivio.js');
const Permessi = require('../ia/permessi.js');
const { creaServerMcp } = require('../ia/mcp-http.js');

async function avvia({ abilitato = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-'));
  const archivio = creaArchivio(dir);
  const r = Permessi.creaClient({ abilitato, porta: 0, client: [] }, 'claude', ['agenda', 'obiettivi']);
  archivio.scriviConfig(r.config);
  const server = creaServerMcp({ archivio });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const porta = server.address().port;
  return {
    dir, archivio, server, porta, token: r.token,
    chiudi: () => new Promise(ok => { server.close(ok); if (server.closeAllConnections) server.closeAllConnections(); }),
  };
}

function richiesta(porta, { metodo = 'POST', percorso = '/mcp', headers = {}, corpo } = {}) {
  return new Promise((ok, ko) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: percorso, headers }, res => {
      const pezzi = [];
      res.on('data', c => pezzi.push(c));
      res.on('end', () => ok({ stato: res.statusCode, testo: Buffer.concat(pezzi).toString('utf8') }));
    });
    req.on('error', ko);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

const rpc = (porta, token, msg, extra = {}) => richiesta(porta, {
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra },
  corpo: typeof msg === 'string' ? msg : JSON.stringify(msg),
});

test('GET /salute -> ok', async () => {
  const t = await avvia();
  try {
    const r = await richiesta(t.porta, { metodo: 'GET', percorso: '/salute' });
    assert.strictEqual(r.stato, 200);
    assert.strictEqual(r.testo, 'ok');
  } finally { await t.chiudi(); }
});

test('senza Authorization o con token errato -> 401', async () => {
  const t = await avvia();
  try {
    const msg = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    assert.strictEqual((await rpc(t.porta, null, msg)).stato, 401);
    assert.strictEqual((await rpc(t.porta, 'sbagliato', msg)).stato, 401);
  } finally { await t.chiudi(); }
});

test('token giusto: initialize, ping, tools/list con i 4 strumenti', async () => {
  const t = await avvia();
  try {
    const i = JSON.parse((await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).testo);
    assert.strictEqual(i.result.protocolVersion, '2025-06-18');
    assert.strictEqual(i.result.serverInfo.name, 'kyklion');
    const p = JSON.parse((await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 2, method: 'ping' })).testo);
    assert.deepStrictEqual(p.result, {});
    const l = JSON.parse((await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 3, method: 'tools/list' })).testo);
    assert.deepStrictEqual(l.result.tools.map(x => x.name), ['ap_oggi', 'ap_leggi', 'ap_proponi', 'ap_stato_proposta']);
  } finally { await t.chiudi(); }
});

test('notifications/initialized -> 202 senza corpo', async () => {
  const t = await avvia();
  try {
    const r = await rpc(t.porta, t.token, { jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.strictEqual(r.stato, 202);
    assert.strictEqual(r.testo, '');
  } finally { await t.chiudi(); }
});

test('Origin presente -> 403; Host non locale -> 403; Host localhost:porta ok', async () => {
  const t = await avvia();
  try {
    const msg = { jsonrpc: '2.0', id: 1, method: 'ping' };
    assert.strictEqual((await rpc(t.porta, t.token, msg, { Origin: 'http://evil.example' })).stato, 403);
    assert.strictEqual((await rpc(t.porta, t.token, msg, { Host: 'evil.example' })).stato, 403);
    assert.strictEqual((await rpc(t.porta, t.token, msg, { Host: 'localhost:' + t.porta })).stato, 200);
    assert.strictEqual((await rpc(t.porta, t.token, msg, { Host: '[::1]:' + t.porta })).stato, 200);
  } finally { await t.chiudi(); }
});

test('Content-Type non JSON -> 415', async () => {
  const t = await avvia();
  try {
    const r = await richiesta(t.porta, { headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + t.token }, corpo: '{}' });
    assert.strictEqual(r.stato, 415);
  } finally { await t.chiudi(); }
});

test('corpo oltre 100000 byte -> 413', async () => {
  const t = await avvia();
  try {
    const r = await rpc(t.porta, t.token, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { x: 'a'.repeat(100100) } }));
    assert.strictEqual(r.stato, 413);
  } finally { await t.chiudi(); }
});

test('JSON non valido -> -32700; non oggetto -> -32600; metodo ignoto -> -32601; params non valido -> -32602', async () => {
  const t = await avvia();
  try {
    assert.strictEqual(JSON.parse((await rpc(t.porta, t.token, '{non json')).testo).error.code, -32700);
    assert.strictEqual(JSON.parse((await rpc(t.porta, t.token, '[1]')).testo).error.code, -32600);
    assert.strictEqual(JSON.parse((await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 1, method: 'boh' })).testo).error.code, -32601);
    assert.strictEqual(JSON.parse((await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: 5 })).testo).error.code, -32602);
  } finally { await t.chiudi(); }
});

test('abilitato:false -> 503; la config e letta a ogni richiesta', async () => {
  const t = await avvia({ abilitato: false });
  try {
    const msg = { jsonrpc: '2.0', id: 1, method: 'ping' };
    assert.strictEqual((await rpc(t.porta, t.token, msg)).stato, 503);
    t.archivio.scriviConfig({ ...t.archivio.leggiConfig(), abilitato: true });
    assert.strictEqual((await rpc(t.porta, t.token, msg)).stato, 200);
    t.archivio.scriviConfig(Permessi.rimuoviClient(t.archivio.leggiConfig(), 'claude'));
    assert.strictEqual((await rpc(t.porta, t.token, msg)).stato, 401);
  } finally { await t.chiudi(); }
});

test('tools/call ap_proponi end-to-end crea la proposta; errori di strumento come isError', async () => {
  const t = await avvia();
  try {
    const r = await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ap_proponi', arguments: {
      motivo: 'prova', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'Leggere' } }] } } });
    const ris = JSON.parse(r.testo).result;
    assert.ok(!ris.isError);
    const out = JSON.parse(ris.content[0].text);
    assert.strictEqual(out.stato, 'in_attesa');
    const prop = t.archivio.elencaProposte();
    assert.strictEqual(prop.length, 1);
    assert.strictEqual(prop[0].client, 'claude');

    const e = JSON.parse((await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ap_leggi', arguments: { sezione: 'dieta' } } })).testo).result;
    assert.strictEqual(e.isError, true);
    assert.strictEqual(e.content[0].type, 'text');
    const s = JSON.parse((await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ap_boh', arguments: {} } })).testo).result;
    assert.strictEqual(s.isError, true);
  } finally { await t.chiudi(); }
});

test('nessuna risposta contiene tokenHash ne percorsi dei file', async () => {
  const t = await avvia();
  try {
    const hash = t.archivio.leggiConfig().client[0].tokenHash;
    const msgs = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ap_oggi', arguments: {} } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ap_stato_proposta', arguments: { id: 'x' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'ap_leggi', arguments: { sezione: 'agenda' } } },
    ];
    for (const m of msgs) {
      const r = await rpc(t.porta, t.token, m);
      assert.ok(!r.testo.includes('tokenHash'));
      assert.ok(!r.testo.includes(hash));
      assert.ok(!r.testo.includes(t.dir));
      assert.ok(!r.testo.includes('stato.json'));
    }
    const r401 = await rpc(t.porta, null, msgs[0]);
    assert.ok(!r401.testo.includes(t.dir));
  } finally { await t.chiudi(); }
});

test('errore interno (non di strumento) -> -32603 senza dettagli', async () => {
  const t = await avvia();
  try {
    // config corrotta dopo l'avvio: errore imprevisto, nessun dettaglio in uscita
    fs.writeFileSync(path.join(t.dir, 'ia-config.json'), '{rotto');
    const r = await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.ok(!r.testo.includes(t.dir));
    assert.ok(!r.testo.includes('ia-config'));
    assert.ok(r.stato === 500 || r.stato === 503);
  } finally { await t.chiudi(); }
});

// ---- Round di correzioni: socket grezzi, ordine dei controlli, schema Bearer, data locale ----
const net = require('node:net');
const { avviaServerMcp, dataLocaleISO } = require('../ia/mcp-http.js');

function grezza(porta, testo, { attesaMs = 3000 } = {}) {
  return new Promise((ok, ko) => {
    const s = net.connect(porta, '127.0.0.1');
    let buf = '';
    const fine = () => { clearTimeout(timer); s.destroy(); ok({ stato: Number((/^HTTP\/1\.1 (\d{3})/.exec(buf) || [])[1]), testo: buf }); };
    const timer = setTimeout(fine, attesaMs);
    s.on('data', (c) => { buf += c; if (/^HTTP\/1\.1 \d{3}/.test(buf) && buf.includes('\r\n\r\n')) { const m = /content-length: (\d+)/i.exec(buf); const corpo = buf.split('\r\n\r\n')[1] || ''; if (!m || corpo.length >= Number(m[1])) fine(); } });
    s.on('error', () => {});
    s.on('close', fine);
    s.write(testo);
  });
}
const intest = (t, extra = []) => ['POST /mcp HTTP/1.1', 'Host: 127.0.0.1:' + t.porta, 'Content-Type: application/json', 'Authorization: Bearer ' + t.token, ...extra].join('\r\n');

test('413 con Content-Length dichiarato > 100000, senza leggere il corpo', async () => {
  const t = await avvia();
  try {
    const r = await grezza(t.porta, intest(t, ['Content-Length: 100001', 'Connection: close']) + '\r\n\r\n{');
    assert.strictEqual(r.stato, 413);
    assert.match(r.testo, /connection: close/i);
  } finally { await t.chiudi(); }
});

test('corpo di esattamente 100000 byte passa; 100001 -> 413', async () => {
  const t = await avvia();
  try {
    const base = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    const ok = base + ' '.repeat(100000 - base.length);
    assert.strictEqual(Buffer.byteLength(ok), 100000);
    assert.strictEqual((await rpc(t.porta, t.token, ok)).stato, 200);
    assert.strictEqual((await rpc(t.porta, t.token, ok + ' ')).stato, 413);
  } finally { await t.chiudi(); }
});

test('corpo chunked oltre il limite: 413 oppure connessione chiusa (mai elaborato); il server resta vivo', async () => {
  const t = await avvia();
  try {
    const r = await new Promise((ok) => {
      const req = http.request({ host: '127.0.0.1', port: t.porta, method: 'POST', path: '/mcp', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t.token } }, (res) => { res.resume(); ok(res.statusCode); });
      req.on('error', () => ok('chiusa'));
      req.write('x'.repeat(200000));
      req.end();
    });
    assert.ok(r === 413 || r === 'chiusa', String(r));
    assert.strictEqual((await richiesta(t.porta, { metodo: 'GET', percorso: '/salute' })).testo, 'ok');
  } finally { await t.chiudi(); }
});

test('ordine: token errato + chunked 200 KB -> 401 (non 413)', async () => {
  const t = await avvia();
  try {
    const r = await new Promise((ok) => {
      const req = http.request({ host: '127.0.0.1', port: t.porta, method: 'POST', path: '/mcp', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sbagliato' } }, (res) => { res.resume(); ok(res.statusCode); });
      req.on('error', () => ok('errore'));
      req.write('x'.repeat(200000));
      req.end();
    });
    assert.strictEqual(r, 401);
  } finally { await t.chiudi(); }
});

test('ordine: Origin+token errato -> 403; Content-Type errato+token errato -> 415; disabilitato+token errato -> 503', async () => {
  const t = await avvia();
  try {
    const msg = { jsonrpc: '2.0', id: 1, method: 'ping' };
    assert.strictEqual((await rpc(t.porta, 'sbagliato', msg, { Origin: 'http://evil.example' })).stato, 403);
    const r = await richiesta(t.porta, { headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer sbagliato' }, corpo: '{}' });
    assert.strictEqual(r.stato, 415);
    t.archivio.scriviConfig({ ...t.archivio.leggiConfig(), abilitato: false });
    assert.strictEqual((await rpc(t.porta, 'sbagliato', msg)).stato, 503);
  } finally { await t.chiudi(); }
});

test('Authorization malformata -> 401; schema bearer case-insensitive; Host LOCALHOST:porta ok', async () => {
  const t = await avvia();
  try {
    const msg = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const con = (auth) => richiesta(t.porta, { headers: { 'Content-Type': 'application/json', Authorization: auth }, corpo: JSON.stringify(msg) });
    assert.strictEqual((await con('Basic x')).stato, 401);
    assert.strictEqual((await con('Bearer ')).stato, 401);
    assert.strictEqual((await con('Bearer')).stato, 401);
    assert.strictEqual((await con('bearer ' + t.token)).stato, 200);
    assert.strictEqual((await con('BEARER ' + t.token)).stato, 200);
    assert.strictEqual((await rpc(t.porta, t.token, msg, { Host: 'LOCALHOST:' + t.porta })).stato, 200);
  } finally { await t.chiudi(); }
});

test('dataLocaleISO usa la data locale, non UTC', () => {
  assert.strictEqual(dataLocaleISO(new Date(2026, 10, 5, 23, 59, 59)), '2026-11-05');
  assert.strictEqual(dataLocaleISO(new Date(2026, 0, 1, 0, 0, 1)), '2026-01-01');
});

test('config corrotta -> esattamente 500, senza dettagli', async () => {
  const t = await avvia();
  try {
    fs.writeFileSync(path.join(t.dir, 'ia-config.json'), '{rotto');
    const r = await rpc(t.porta, t.token, { jsonrpc: '2.0', id: 1, method: 'ping' });
    assert.strictEqual(r.stato, 500);
    assert.ok(!r.testo.includes(t.dir));
  } finally { await t.chiudi(); }
});

test('avviaServerMcp ascolta solo su 127.0.0.1 e risolve col server in ascolto', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-http-'));
  const server = await avviaServerMcp({ archivio: creaArchivio(dir), porta: 0 });
  try {
    assert.strictEqual(server.address().address, '127.0.0.1');
    assert.strictEqual((await richiesta(server.address().port, { metodo: 'GET', percorso: '/salute' })).testo, 'ok');
  } finally { server.close(); server.closeAllConnections(); }
});

test('stato.json troncato: tools/call fallisce con errore generico e non scrive nulla', async () => {
  const t = await avvia();
  try {
    fs.writeFileSync(path.join(t.dir, 'stato.json'), '{"versione": 1, "routine": [');
    const prima = fs.readFileSync(path.join(t.dir, 'stato.json'));
    for (const [id, name, args] of [
      [1, 'ap_oggi', {}],
      [2, 'ap_proponi', { motivo: 'm', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'A' } }] }],
    ]) {
      const r = await rpc(t.porta, t.token, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
      const ris = JSON.parse(r.testo).result;
      assert.strictEqual(ris.isError, true, name);
      assert.ok(!r.testo.includes(path.basename(t.dir)) && !/Unexpected|stato[.]json/i.test(r.testo), r.testo);
    }
    assert.ok(fs.readFileSync(path.join(t.dir, 'stato.json')).equals(prima));
    assert.deepStrictEqual(t.archivio.elencaProposte(), []);
    assert.ok(!fs.existsSync(path.join(t.dir, 'proposte.json')));
  } finally { await t.chiudi(); }
});
