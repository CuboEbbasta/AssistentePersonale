const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { creaGestoriIA } = require('../ia/ipc-ia.js');

// Server finto: compatibile OpenAI (/v1/models, /v1/chat/completions) e Ollama (/api/tags, /api/generate).
function avviaFinto(t, opzioni = {}) {
  const richieste = [];
  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => {
      richieste.push({ metodo: req.method, url: req.url, auth: req.headers.authorization, corpo });
      if (opzioni.chiaveRichiesta && req.headers.authorization !== 'Bearer ' + opzioni.chiaveRichiesta) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end('{"error":"chiave errata"}');
      }
      if (opzioni.lento && req.url.includes('chat')) return; // non risponde mai
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (opzioni.rispostaStrana) return res.end('non json');
      if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'm-uno' }, { id: 'm-due' }] }));
      if (req.url === '/v1/chat/completions') return res.end(JSON.stringify({ choices: [{ message: { content: 'risposta openai' } }] }));
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
      if (req.url === '/api/generate') return res.end(JSON.stringify({ response: 'risposta ollama' }));
      res.end('{}');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    t.after(() => { server.closeAllConnections(); server.close(); });
    resolve({ base: 'http://127.0.0.1:' + server.address().port, richieste });
  }));
}

const cfgDi = (base, extra) => ({ tipoServer: 'openai', indirizzoServer: base, modello: 'm-uno', chiaveApi: '', ...extra });

test('elencaModelli OpenAI: usa /v1/models e restituisce gli id', async (t) => {
  const f = await avviaFinto(t);
  const g = creaGestoriIA();
  assert.deepEqual(await g.elencaModelli(cfgDi(f.base)), { ok: true, modelli: ['m-uno', 'm-due'] });
  assert.equal(f.richieste[0].url, '/v1/models');
  assert.equal(f.richieste[0].auth, undefined);
});

test('elencaModelli OpenAI: base con /v1 non duplicato; chiave inviata solo come Bearer', async (t) => {
  const f = await avviaFinto(t, { chiaveRichiesta: 'sk-prova' });
  const g = creaGestoriIA();
  const r = await g.elencaModelli(cfgDi(f.base + '/v1', { chiaveApi: 'sk-prova' }));
  assert.equal(r.ok, true);
  assert.equal(f.richieste[0].url, '/v1/models');
  assert.equal(f.richieste[0].auth, 'Bearer sk-prova');
});

test('chiave errata: errore con codice HTTP, senza la chiave nel messaggio', async (t) => {
  const f = await avviaFinto(t, { chiaveRichiesta: 'giusta' });
  const g = creaGestoriIA();
  const r = await g.elencaModelli(cfgDi(f.base, { chiaveApi: 'sbagliata-segreta' }));
  assert.equal(r.ok, false);
  assert.match(r.errore, /401/);
  assert.ok(!JSON.stringify(r).includes('sbagliata-segreta'));
});

test('chiama OpenAI: POST /v1/chat/completions con system e user', async (t) => {
  const f = await avviaFinto(t);
  const g = creaGestoriIA();
  const r = await g.chiama({ ...cfgDi(f.base), prompt: 'ciao', sistema: 'sys' });
  assert.deepEqual(r, { ok: true, testo: 'risposta openai' });
  const rich = f.richieste[0];
  assert.equal(rich.metodo, 'POST');
  assert.equal(rich.url, '/v1/chat/completions');
  assert.deepEqual(JSON.parse(rich.corpo).messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'ciao' }]);
});

test('Ollama invariato: /api/tags e /api/generate', async (t) => {
  const f = await avviaFinto(t);
  const g = creaGestoriIA();
  const cfg = { tipoServer: 'ollama', indirizzoServer: f.base, modello: 'qwen3:8b', chiaveApi: '' };
  assert.deepEqual(await g.elencaModelli(cfg), { ok: true, modelli: ['qwen3:8b'] });
  assert.deepEqual(await g.chiama({ ...cfg, prompt: 'p', sistema: '' }), { ok: true, testo: 'risposta ollama' });
  assert.deepEqual(f.richieste.map(r => r.url), ['/api/tags', '/api/generate']);
});

test('risposta non JSON: errore chiaro, senza stack', async (t) => {
  const f = await avviaFinto(t, { rispostaStrana: true });
  const r = await creaGestoriIA().elencaModelli(cfgDi(f.base));
  assert.equal(r.ok, false);
  assert.match(r.errore, /non valida/i);
  assert.ok(!/\bat \w|node_modules|\.js:\d/.test(r.errore));
});

test('timeout: errore chiaro, la chiave non compare', async (t) => {
  const f = await avviaFinto(t, { lento: true });
  const g = creaGestoriIA({ timeoutGenerazioneMs: 150 });
  const r = await g.chiama({ ...cfgDi(f.base, { chiaveApi: 'segretissima' }), prompt: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.errore, /tempo|scadut/i);
  assert.ok(!JSON.stringify(r).includes('segretissima'));
});

test('server irraggiungibile: errore generico senza chiave né percorsi', async () => {
  const g = creaGestoriIA({ timeoutElencoMs: 2000 });
  const r = await g.elencaModelli(cfgDi('http://127.0.0.1:1', { chiaveApi: 'segretissima' }));
  assert.equal(r.ok, false);
  assert.match(r.errore, /raggiungere/i);
  assert.ok(!JSON.stringify(r).includes('segretissima'));
});

test('validazione degli argomenti', async () => {
  const g = creaGestoriIA();
  const ok = { tipoServer: 'openai', indirizzoServer: 'http://localhost:4000', modello: 'm', chiaveApi: '', prompt: 'p' };
  const casi = [
    undefined, null, 'testo', [],
    { ...ok, tipoServer: 'boh' },
    { ...ok, tipoServer: undefined },
    { ...ok, indirizzoServer: 'ftp://x' },
    { ...ok, indirizzoServer: 'file:///etc/passwd' },
    { ...ok, indirizzoServer: 'javascript:alert(1)' },
    { ...ok, indirizzoServer: 'http://' + 'a'.repeat(3000) },
    { ...ok, indirizzoServer: 'http://utente:pw@host' },
    { ...ok, indirizzoServer: 5 },
    { ...ok, modello: '' },
    { ...ok, modello: 'm'.repeat(500) },
    { ...ok, modello: 5 },
    { ...ok, chiaveApi: 'k'.repeat(2000) },
    { ...ok, chiaveApi: 'a\r\nX-Evil: 1' },
    { ...ok, chiaveApi: 5 },
    { ...ok, prompt: 5 },
    { ...ok, prompt: 'p'.repeat(2 * 1024 * 1024) },
    { ...ok, sistema: 5 }
  ];
  for (const c of casi) {
    const r = await g.chiama(c);
    assert.equal(r.ok, false, String(JSON.stringify(c)).slice(0, 80));
    assert.equal(typeof r.errore, 'string');
  }
  // L'elenco non richiede modello né prompt, ma valida il resto.
  assert.equal((await g.elencaModelli({ ...ok, tipoServer: 'boh' })).ok, false);
  assert.equal((await g.elencaModelli({ ...ok, indirizzoServer: 'ftp://x' })).ok, false);
  assert.equal((await g.elencaModelli(null)).ok, false);
});

test('chiama con json e think:false: inoltrati a Ollama; opzioni non booleane rifiutate', async (t) => {
  const f = await avviaFinto(t);
  const g = creaGestoriIA();
  const cfg = { tipoServer: 'ollama', indirizzoServer: f.base, modello: 'qwen3:8b', chiaveApi: '' };
  assert.equal((await g.chiama({ ...cfg, prompt: 'p', json: true, think: false })).ok, true);
  const c = JSON.parse(f.richieste[0].corpo);
  assert.equal(c.format, 'json'); assert.equal(c.think, false);
  assert.equal((await g.chiama({ ...cfg, prompt: 'p', json: 'si' })).ok, false);
  assert.equal((await g.chiama({ ...cfg, prompt: 'p', think: 0 })).ok, false);
});

test('chiama con think:false: se il server risponde 400 riprova senza think', async (t) => {
  const corpi = [];
  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', c => { corpo += c; });
    req.on('end', () => {
      corpi.push(JSON.parse(corpo));
      if ('think' in corpi[corpi.length - 1]) { res.writeHead(400); return res.end('{"error":"does not support thinking"}'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: '{"ok":1}' }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const cfg = { tipoServer: 'ollama', indirizzoServer: 'http://127.0.0.1:' + server.address().port, modello: 'gemma2:9b', chiaveApi: '' };
  const r = await creaGestoriIA().chiama({ ...cfg, prompt: 'p', json: true, think: false });
  assert.deepEqual(r, { ok: true, testo: '{"ok":1}' });
  assert.equal(corpi.length, 2);
  assert.ok(!('think' in corpi[1]) && corpi[1].format === 'json');
});
