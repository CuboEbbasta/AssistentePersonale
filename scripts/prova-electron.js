// Prova end-to-end con Electron VERO (richiede `npm install` in desktop/). Uso: node scripts/prova-electron.js
// Usa profilo e dati temporanei: non tocca i tuoi dati. Porta MCP 3040 e CDP 9333 devono essere libere.
// Prova end-to-end reale: avvia Electron (profilo e dati temporanei), pilota la finestra via CDP,
// simula un'IA via MCP HTTP, applica la proposta e verifica la persistenza su file.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http');
const REPO = path.join(__dirname, '..');
const SCR = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-foto-')); // screenshot in cartella temporanea
const ELECTRON = path.join(REPO, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
const DATI = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-dati-'));
const PROFILO = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-profilo-'));
const PORTA_CDP = 9333, PORTA_MCP = 3040;
const env = { ...process.env, ASSISTENTE_DATI: DATI };
const esiti = []; const ok = (n, c, extra = '') => { esiti.push([n, !!c]); console.log((c ? 'OK   ' : 'FAIL ') + n + (extra ? '  -> ' + extra : '')); };
const attendi = (ms) => new Promise(r => setTimeout(r, ms));

function cli(...a) { return execFileSync('node', [path.join(REPO, 'ia/bin/ap-ia.js'), ...a], { env, encoding: 'utf8' }); }
function get(url) { return new Promise((res, rej) => http.get(url, r => { let t = ''; r.on('data', c => t += c); r.on('end', () => res(t)); }).on('error', rej)); }
function mcp(token, name, args) {
  return new Promise((res, rej) => {
    const d = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    const r = http.request({ host: '127.0.0.1', port: PORTA_MCP, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Content-Length': Buffer.byteLength(d) } },
      x => { let t = ''; x.on('data', c => t += c); x.on('end', () => res({ stato: x.statusCode, corpo: t })); });
    r.on('error', rej); r.end(d);
  });
}
async function cdp() {
  let lista; for (let i = 0; i < 40; i++) { try { lista = JSON.parse(await get(`http://127.0.0.1:${PORTA_CDP}/json`)); if (lista.find(t => t.type === 'page')) break; } catch (_) {} await attendi(500); }
  const pag = lista.find(t => t.type === 'page'); const ws = new WebSocket(pag.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r)); let id = 0; const att = new Map();
  ws.addEventListener('message', m => { const j = JSON.parse(m.data); if (j.id && att.has(j.id)) { att.get(j.id)(j); att.delete(j.id); } });
  const invia = (method, params = {}) => new Promise(r => { const i = ++id; att.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (js) => { const r = await invia('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails)); return r.result.result.value; };
  const foto = async (nome) => { const r = await invia('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCR, nome), Buffer.from(r.result.data, 'base64')); };
  return { ev, foto, chiudi: () => ws.close() };
}
function avvia() { return spawn(ELECTRON, [path.join(REPO, 'desktop'), `--remote-debugging-port=${PORTA_CDP}`, `--user-data-dir=${PROFILO}`], { env, stdio: 'ignore' }); }
async function ferma(p) { try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {} await attendi(1500); }

(async () => {
  console.log('Cartella dati:', DATI);
  const tok = cli('client', 'add', 'prova').trim().split(/\r?\n/).pop(); cli('abilita');
  const srv = spawn('node', [path.join(REPO, 'ia/bin/ap-ia.js'), 'serve'], { env, stdio: 'ignore' }); await attendi(1500);
  let app = avvia(); let c = await cdp(); await attendi(2500);

  ok('app caricata', await c.ev('typeof Dati !== "undefined" && !!Dati.stato()'));
  ok('electronAPI.dati presente', await c.ev('!!(window.electronAPI && window.electronAPI.dati)'));
  ok('primo avvio: mostra la presentazione (onboarding)', await c.ev('Dati.stato().impostazioni.onboardingCompletato === false'));
  await c.foto('00-onboarding.png');
  // salto la presentazione (come farebbe l'utente) e ricarico
  await c.ev('(async () => { Dati.stato().impostazioni.onboardingCompletato = true; return await Dati.salva(); })()');
  await c.ev('location.reload()'); await attendi(3000);
  const disp = await c.ev('getComputedStyle(document.getElementById("badge-altro")).display');
  ok('badge "0" su Altro NON visibile', disp === 'none', 'display=' + disp);
  await c.foto('01-avvio.png');

  // routine creata dall'utente -> persistenza su file
  await c.ev(`(async () => { const s = Dati.stato(); s.routine.push({ id: 'r_prova', nome: 'Routine di prova', descrizione: '', tipo: 'altro', oraInizio: '08:00', durataMinuti: 30, priorita: 5, giorni: [1,2,3,4,5,6,7], attiva: true }); return await Dati.salva(); })()`);
  await attendi(500);
  const st1 = JSON.parse(fs.readFileSync(path.join(DATI, 'stato.json'), 'utf8'));
  ok('stato.json scritto con la routine', st1.routine.some(r => r.id === 'r_prova'));

  // l'IA legge e propone
  const oggi1 = await mcp(tok, 'ap_oggi', {});
  ok('IA: ap_oggi legge la routine', oggi1.corpo.includes('Routine di prova'));
  const d = new Date(); const p2 = n => String(n).padStart(2, '0'); const data = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const pr = await mcp(tok, 'ap_proponi', { motivo: 'Prova automatica', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'Task proposto dall\'IA', priorita: 5, ambito: 'giorno', scadenza: data } }, { tipo: 'routine.aggiungi', dati: { nome: '<img src=x onerror="window.__xss=1">', oraInizio: '09:00', durataMinuti: 15, priorita: 5, giorni: [1, 2, 3] } }] });
  ok('IA: ap_proponi accettata', pr.corpo.includes('in_attesa'), pr.corpo.slice(0, 120));
  const stSenzaApplicare = fs.readFileSync(path.join(DATI, 'stato.json'), 'utf8');
  ok('stato.json non toccato dalla proposta', !stSenzaApplicare.includes('Task proposto'));

  // l'app vede la proposta (al rientro in primo piano)
  await c.ev('window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"))'); await attendi(1500);
  const badge = await c.ev('(() => { const b = document.getElementById("badge-altro"); return { testo: b.textContent, display: getComputedStyle(b).display }; })()');
  ok('badge Altro mostra 1', badge.testo === '1' && badge.display !== 'none', JSON.stringify(badge));
  await c.ev('document.querySelector(\'.tab-btn[data-tab="altro"]\').click()'); await attendi(300);
  await c.ev('(document.querySelector(\'[data-figlio="proposte"]\')||{click(){}}).click()'); await attendi(800);
  await c.foto('02-proposta.png');
  const testoVista = await c.ev('document.getElementById("view-proposte").innerText');
  ok('schermata Proposte mostra la proposta', /Task proposto/.test(testoVista) && /Prova automatica/.test(testoVista));
  ok('testo malevolo mostrato come testo (nessun img creato)', await c.ev('document.querySelectorAll("#view-proposte img").length === 0 && window.__xss === undefined'));

  // Applica
  await c.ev('[...document.querySelectorAll("#view-proposte button")].find(b => /^Applica/.test(b.textContent)).click()'); await attendi(2000);
  const st2 = JSON.parse(fs.readFileSync(path.join(DATI, 'stato.json'), 'utf8'));
  ok('dopo Applica: task e routine in stato.json', st2.task.some(t => t.nome === 'Task proposto dall\'IA') && st2.routine.some(r => /onerror/.test(r.nome)));
  ok('dopo Applica: nessuno script eseguito (XSS)', await c.ev('window.__xss === undefined && document.querySelectorAll("img[src=x]").length === 0'));
  await c.ev('document.querySelector(\'.tab-btn[data-tab="oggi"]\').click()'); await attendi(800); await c.foto('03-oggi.png');
  ok('"Oggi" non ha elementi img iniettati', await c.ev('document.querySelectorAll("#view-oggi img").length === 0'));
  const badge2 = await c.ev('getComputedStyle(document.getElementById("badge-altro")).display');
  ok('badge sparisce dopo Applica', badge2 === 'none', 'display=' + badge2);
  const props = (await mcp(tok, 'ap_stato_proposta', { id: JSON.parse(JSON.parse(pr.corpo).result.content[0].text).id })).corpo;
  console.log('   stato proposta lato IA:', props.slice(0, 160));

  // riavvio: persistenza e nessuna doppia applicazione
  c.chiudi(); await ferma(app); app = avvia(); c = await cdp(); await attendi(2500);
  const nTask = await c.ev('Dati.stato().task.filter(t => t.nome === "Task proposto dall\'IA").length');
  ok('dopo riavvio: il task c\'è, una sola volta', nTask === 1, 'n=' + nTask);
  const nProp = await c.ev('(async () => (await window.electronAPI.dati.proposteElenca()).proposte.filter(p => p.stato === "in_attesa").length)()');
  ok('dopo riavvio: nessuna proposta in attesa', nProp === 0, 'n=' + nProp);
  await c.ev('document.querySelector(\'.tab-btn[data-tab="altro"]\').click()'); await attendi(300);
  await c.ev('(document.querySelector(\'[data-figlio="proposte"]\')||{click(){}}).click()'); await attendi(600); await c.foto('04-vuota.png');

  // sicurezza server
  const tokenErrato = await mcp('x'.repeat(64), 'ap_oggi', {});
  ok('token errato rifiutato (401)', tokenErrato.stato === 401);
  const leggiDiario = await mcp(tok, 'ap_leggi', { sezione: 'diario' });
  ok('sezione non permessa (diario) rifiutata', /errore|permess|non/i.test(leggiDiario.corpo) && !/journal/.test(leggiDiario.corpo), leggiDiario.corpo.slice(0, 100));

  c.chiudi(); await ferma(app); await ferma(srv);
  const falliti = esiti.filter(e => !e[1]);
  console.log(`\n${esiti.length - falliti.length}/${esiti.length} controlli passati`);
  process.exit(falliti.length ? 1 : 0);
})().catch(e => { console.error('ERRORE', e); process.exit(2); });
