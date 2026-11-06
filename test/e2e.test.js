const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { creaArchivio } = require('../ia/archivio.js');
const Permessi = require('../ia/permessi.js');
const Schema = require('../www/js/core/schema.js');
const NucleoProposte = require('../www/js/core/proposte.js');
const { avviaServerMcp, dataLocaleISO } = require('../ia/mcp-http.js');

// Client MCP minimale: JSON-RPC su HTTP, come farebbe una vera IA.
function creaClientMcp(porta, token) {
  let id = 0;
  function post(msg) {
    return new Promise((ok, ko) => {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const req = http.request({ host: '127.0.0.1', port: porta, method: 'POST', path: '/mcp', headers }, (res) => {
        const pezzi = [];
        res.on('data', c => pezzi.push(c));
        res.on('end', () => ok({ stato: res.statusCode, testo: Buffer.concat(pezzi).toString('utf8') }));
      });
      req.on('error', ko);
      req.end(JSON.stringify(msg));
    });
  }
  async function rpc(method, params) {
    const r = await post({ jsonrpc: '2.0', id: ++id, method, params });
    return { stato: r.stato, corpo: r.testo ? JSON.parse(r.testo) : null };
  }
  async function chiama(nome, args) {
    const r = await rpc('tools/call', { name: nome, arguments: args || {} });
    const ris = r.corpo.result;
    return { errore: !!ris.isError, testo: ris.content[0].text, dati: ris.isError ? null : JSON.parse(ris.content[0].text) };
  }
  return { rpc, chiama };
}

test('end-to-end: leggo, propongo, l\'utente applica, rileggo; permessi e token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-ia-'));
  const archivio = creaArchivio(dir);
  const oggi = dataLocaleISO(new Date());

  // Stato iniziale scritto dall'"app", con un task gia presente.
  const stato0 = Schema.statoDefault();
  stato0.task.push({ id: 't0', nome: 'Gia presente', priorita: 5, tipo: 'altro', ambito: 'giorno', scadenza: oggi, oraPromemoria: null, durataStimataMinuti: null, note: '', completata: false });
  archivio.scriviStato(stato0);

  // Due client: agenda e solo obiettivi.
  let cfg = { abilitato: true, porta: 0, client: [] };
  const a = Permessi.creaClient(cfg, 'agenda-ia', ['agenda']);
  const b = Permessi.creaClient(a.config, 'solo-obiettivi', ['obiettivi']);
  archivio.scriviConfig(b.config);

  const server = await avviaServerMcp({ archivio, porta: 0 });
  const porta = server.address().port;
  try {
    const ia = creaClientMcp(porta, a.token);
    const ob = creaClientMcp(porta, b.token);

    const init = await ia.rpc('initialize', {});
    assert.equal(init.corpo.result.serverInfo.name, 'assistente-personale');
    const lista = await ia.rpc('tools/list');
    assert.deepEqual(lista.corpo.result.tools.map(t => t.name), ['ap_oggi', 'ap_leggi', 'ap_proponi', 'ap_stato_proposta']);

    // 1. Lettura di oggi
    const oggi1 = await ia.chiama('ap_oggi');
    assert.equal(oggi1.errore, false);
    assert.deepEqual(oggi1.dati.task.map(t => t.nome), ['Gia presente']);

    // 2. Proposta: lo stato NON cambia
    const byteStato = fs.readFileSync(path.join(dir, 'stato.json'));
    const pr = await ia.chiama('ap_proponi', { motivo: 'prova e2e', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'Nuovo da IA', scadenza: oggi } }] });
    assert.equal(pr.errore, false);
    assert.equal(pr.dati.stato, 'in_attesa');
    assert.ok(fs.readFileSync(path.join(dir, 'stato.json')).equals(byteStato), 'stato.json deve restare identico');
    const proposte = archivio.elencaProposte();
    assert.equal(proposte.length, 1);
    assert.equal(proposte[0].id, pr.dati.id);
    assert.equal(proposte[0].stato, 'in_attesa');
    assert.equal((await ia.chiama('ap_oggi')).dati.task.length, 1);

    // 3. L'utente applica (simulando l'app)
    const r = NucleoProposte.applicaProposta(archivio.leggiStato(), proposte[0], { oggiISO: oggi, generaId: (p) => p + '_e2e' });
    assert.equal(r.ok, true);
    archivio.scriviStato(r.stato);
    archivio.aggiornaProposta(proposte[0].id, { stato: 'applicata' });
    assert.equal((await ia.chiama('ap_stato_proposta', { id: pr.dati.id })).dati.stato, 'applicata');

    // 4. Ora il task compare
    const oggi2 = await ia.chiama('ap_oggi');
    assert.deepEqual(oggi2.dati.task.map(t => t.nome).sort(), ['Gia presente', 'Nuovo da IA']);

    // 5. Il client con solo obiettivi non vede i task e non puo proporli
    const negato = await ob.chiama('ap_oggi');
    assert.equal(negato.errore, true);
    assert.ok(!negato.testo.includes('Nuovo da IA'));
    const leggi = await ob.chiama('ap_leggi', { sezione: 'agenda' });
    assert.equal(leggi.errore, true);
    const propNeg = await ob.chiama('ap_proponi', { motivo: 'x', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'No' } }] });
    assert.equal(propNeg.errore, true);
    assert.equal(archivio.elencaProposte().length, 1);
    const suoi = await ob.chiama('ap_leggi', { sezione: 'obiettivi' });
    assert.equal(suoi.errore, false);
    assert.ok(!('task' in suoi.dati));

    // 6. Token errato -> 401
    assert.equal((await creaClientMcp(porta, 'token-sbagliato').rpc('tools/list')).stato, 401);
    assert.equal((await creaClientMcp(porta, null).rpc('tools/list')).stato, 401);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
