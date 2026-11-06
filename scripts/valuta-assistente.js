'use strict';
/**
 * Valutazione REALE dell'assistente integrato con un Ollama locale (NON fa parte della suite `node --test`: è lenta).
 * Usa le stesse funzioni pure dell'app (prompt, estrazione, normalizzazione, creaProposta) tramite NucleoAssistente.elabora.
 *
 * Uso:  node scripts/valuta-assistente.js [modello ...]      (predefiniti: qwen3:8b e, se presente, qwen3:14b)
 *       OLLAMA=http://localhost:11434  per un altro indirizzo;  SOLO=3,5  per eseguire solo alcune richieste.
 * Una chiamata oltre 120 s viene segnalata come TIMEOUT e si prosegue.
 */
const Schema = require('../www/js/core/schema.js');
const Client = require('../www/js/core/clienteia.js');
const Assistente = require('../www/js/core/assistente.js');

const BASE = process.env.OLLAMA || 'http://localhost:11434';
const TIMEOUT_MS = 120000;
const OGGI = '2026-11-06'; // venerdì (fisso: i risultati sono confrontabili)
const ADESSO = OGGI + 'T10:00:00.000Z';
const DOMANI = '2026-11-07', DOPODOMANI = '2026-11-08';

function statoConDati() {
  const s = Schema.statoDefault();
  s.routine.push({ id: 'routine_p1', nome: 'Palestra', descrizione: '', tipo: 'allenamento', oraInizio: '18:00', durataMinuti: 60, priorita: 5, giorni: [1, 3, 5], attiva: true });
  s.task.push({ id: 'task_b1', nome: 'Pagare bolletta', priorita: 5, tipo: 'altro', ambito: 'giorno', scadenza: OGGI, oraPromemoria: null, durataStimataMinuti: null, note: '', completata: false });
  s.obiettivi.push({ id: 'obiettivo_s1', titolo: 'Imparare lo spagnolo', tipo: 'concreto', ambito: '1anno', scadenza: '2027-06-01', descrizione: '', completato: false, attivitaCollegate: [], tappe: [] });
  return s;
}

const MSG1 = 'potresti aggiungere questo? - 14:00 alle 15:00: Fumetto per Venerdi';
const STORIA_RIFIUTO = [
  { ruolo: 'utente', testo: MSG1 },
  { ruolo: 'assistente', testo: 'Non posso aggiungere direttamente il task poiché non è presente alcun ID di riferimento nel contesto.' }
];
const STORIA_PROPOSTA = [
  { ruolo: 'utente', testo: MSG1 },
  { ruolo: 'assistente', testo: 'Ti propongo la routine Fumetto il venerdì dalle 14:00 alle 15:00.', anteprima: ['Aggiungi routine «Fumetto» alle 14:00 per 60 min, ven'] }
];

const ops = (r, tipo) => (r.proposta ? r.proposta.operazioni : []).filter(o => !tipo || o.tipo === tipo);
const ha = (testo, parte) => String(testo || '').toLowerCase().includes(parte);
const uguali = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Ogni caso: richiesta, stato, cronologia, verifica(r) -> null se OK, altrimenti motivo del FAIL
const CASI = [
  { nome: 'utente 1: routine Fumetto venerdì 14-15', testo: MSG1, verifica: (r) => {
    const o = ops(r, 'routine.aggiungi')[0]; if (!o) return 'manca routine.aggiungi';
    const d = o.dati; return ha(d.nome, 'fumetto') && d.oraInizio === '14:00' && d.durataMinuti === 60 && uguali(d.giorni, [5]) ? null : 'dati: ' + JSON.stringify(d);
  } },
  { nome: 'utente 2: «crea te ID Lettura oppure altro»', testo: 'crea te ID Lettura oppure inserisci semplicemente altro', cronologia: STORIA_RIFIUTO, verifica: (r) => {
    const o = ops(r).find(x => /aggiungi$/.test(x.tipo) && ha(x.dati.nome || x.dati.titolo, 'fumetto')); return o ? null : 'nessuna aggiunta di «Fumetto»: ' + JSON.stringify(ops(r));
  } },
  { nome: 'utente 3: «in Fare, aggiungi in routine di venerdi»', testo: 'in Fare, aggiungi in routine di venerdi la task che ti ho chiesto', cronologia: STORIA_PROPOSTA, verifica: (r) => {
    const o = ops(r, 'routine.aggiungi')[0]; if (!o) return 'manca routine.aggiungi';
    const d = o.dati; return ha(d.nome, 'fumetto') && d.oraInizio === '14:00' && uguali(d.giorni, [5]) ? null : 'dati: ' + JSON.stringify(d);
  } },
  { nome: 'task con scadenza «domani»', testo: 'Aggiungi la task comprare il latte, scade domani', verifica: (r) => {
    const o = ops(r, 'task.aggiungi')[0]; if (!o) return 'manca task.aggiungi';
    return ha(o.dati.nome, 'latte') && o.dati.scadenza === DOMANI ? null : 'dati: ' + JSON.stringify(o.dati);
  } },
  { nome: 'routine lunedì-venerdì alle 7 sveglia', testo: 'Crea una routine sveglia alle 7 dal lunedì al venerdì', verifica: (r) => {
    const o = ops(r, 'routine.aggiungi')[0]; if (!o) return 'manca routine.aggiungi';
    return ha(o.dati.nome, 'sveglia') && o.dati.oraInizio === '07:00' && uguali(o.dati.giorni, [1, 2, 3, 4, 5]) ? null : 'dati: ' + JSON.stringify(o.dati);
  } },
  { nome: 'obiettivo', testo: 'Voglio un nuovo obiettivo: correre una maratona entro un anno', verifica: (r) => {
    const o = ops(r, 'obiettivo.aggiungi')[0]; if (!o) return 'manca obiettivo.aggiungi';
    return ha(o.dati.titolo, 'maratona') ? null : 'dati: ' + JSON.stringify(o.dati);
  } },
  { nome: 'diario di oggi', testo: 'Scrivi il diario di oggi: ho fatto bene a studiare, devo migliorare la puntualità, domani voglio svegliarmi presto. Voto 7+', verifica: (r) => {
    const o = ops(r, 'diario.imposta')[0]; if (!o) return 'manca diario.imposta';
    return o.dati.data === OGGI && o.dati.voto === '7+' ? null : 'dati: ' + JSON.stringify(o.dati);
  } },
  { nome: 'pasto', testo: 'Ho mangiato un panino al prosciutto: 450 kcal, 20 g di proteine, 50 g di carboidrati, 15 g di grassi', verifica: (r) => {
    const o = ops(r, 'pasto.aggiungi')[0]; if (!o) return 'manca pasto.aggiungi';
    const d = o.dati; return d.kcal === 450 && d.proteine === 20 && d.carboidrati === 50 && d.grassi === 15 && d.data === OGGI ? null : 'dati: ' + JSON.stringify(d);
  } },
  { nome: 'sonno', testo: 'Stanotte ho dormito dalle 23:30 alle 7:00, qualità 4', verifica: (r) => {
    const o = ops(r, 'sonno.imposta')[0]; if (!o) return 'manca sonno.imposta';
    const d = o.dati; return d.oraInizio === '23:30' && d.oraFine === '07:00' && d.qualita === 4 ? null : 'dati: ' + JSON.stringify(d);
  } },
  { nome: 'domanda senza operazioni', testo: 'Come posso organizzare meglio la mia mattina?', verifica: (r) => {
    if (r.proposta) return 'ha proposto operazioni: ' + JSON.stringify(r.proposta.anteprima);
    return r.risposta && r.risposta.length > 10 && !r.errori.length ? null : 'risposta vuota o errori: ' + JSON.stringify(r.errori);
  } },
  { nome: 'modifica routine con id dal contesto', testo: 'Sposta la palestra alle 19', stato: statoConDati, verifica: (r) => {
    const o = ops(r, 'routine.modifica')[0]; if (!o) return 'manca routine.modifica';
    return o.id === 'routine_p1' && o.dati.oraInizio === '19:00' ? null : JSON.stringify(o);
  } },
  { nome: 'modifica task con id dal contesto', testo: 'Metti priorità 9 alla task Pagare bolletta e spostala a dopodomani', stato: statoConDati, verifica: (r) => {
    const o = ops(r, 'task.modifica')[0]; if (!o) return 'manca task.modifica';
    return o.id === 'task_b1' && o.dati.priorita === 9 && o.dati.scadenza === DOPODOMANI ? null : JSON.stringify(o);
  } }
];

async function chiamaOllama(modello, prompt, sistema) {
  const cfg = { tipoServer: 'ollama', indirizzoServer: BASE, modello, chiaveApi: '' };
  const req = Client.costruisciGenerazione(cfg, prompt, sistema, { json: true, think: false });
  try {
    const risposta = await fetch(req.url, { method: 'POST', headers: req.headers, body: req.corpo, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!risposta.ok) return { ok: false, errore: 'HTTP ' + risposta.status };
    return { ok: true, testo: Client.leggiGenerazione('ollama', await risposta.json()) };
  } catch (e) {
    return { ok: false, errore: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'TIMEOUT (>120 s)' : 'rete: ' + (e && e.message) };
  }
}

async function modelliInstallati() {
  const r = await fetch(BASE + '/api/tags', { signal: AbortSignal.timeout(10000) });
  return (await r.json()).models.map(m => m.name);
}

async function valutaModello(modello, solo) {
  console.log('\n=== ' + modello + ' ===');
  let ok = 0, tot = 0, secondi = 0, correzioni = 0;
  for (let i = 0; i < CASI.length; i++) {
    if (solo && !solo.includes(i + 1)) continue;
    const c = CASI[i];
    const stato = c.stato ? c.stato() : Schema.statoDefault();
    const t0 = Date.now();
    let n = 0;
    const genera = (p) => p + '_v' + (++n);
    let r, motivo;
    try {
      r = await Assistente.elabora({ testo: c.testo, stato, oggiISO: OGGI, adessoISO: ADESSO, generaId: genera, cronologia: c.cronologia || [], chiama: (p, s) => chiamaOllama(modello, p, s) });
      motivo = !r.ok ? 'errore: ' + r.errore : r.errori.length ? 'proposta non valida: ' + r.errori.join('; ') : c.verifica(r);
    } catch (e) { motivo = 'eccezione: ' + e.message; r = { grezzo: '' }; }
    const dt = (Date.now() - t0) / 1000;
    tot++; secondi += dt; if (r && r.tentativi === 2) correzioni++;
    if (!motivo) ok++;
    console.log(String(i + 1).padStart(2) + '. ' + (motivo ? 'FAIL' : 'OK  ') + '  ' + dt.toFixed(1).padStart(5) + ' s  ' + c.nome + (r && r.tentativi === 2 ? '  [con correzione]' : '') + (motivo ? '\n      -> ' + motivo : ''));
    if (motivo && process.env.VERBOSO) console.log('      grezzo: ' + String(r.grezzo || '').replace(/\s+/g, ' ').slice(0, 600));
  }
  console.log('Risultato ' + modello + ': ' + ok + '/' + tot + ' (' + Math.round(100 * ok / tot) + '%) in ' + secondi.toFixed(0) + ' s totali (media ' + (secondi / tot).toFixed(1) + ' s); ' + correzioni + ' con correzione');
  return { modello, ok, tot, secondi };
}

(async () => {
  const solo = process.env.SOLO ? process.env.SOLO.split(',').map(Number) : null;
  let installati;
  try { installati = await modelliInstallati(); } catch (e) { console.error('Ollama non raggiungibile su ' + BASE); process.exit(2); }
  let modelli = process.argv.slice(2);
  if (!modelli.length) modelli = ['qwen3:8b'].concat(installati.includes('qwen3:14b') ? ['qwen3:14b'] : []);
  const mancanti = modelli.filter(m => !installati.includes(m));
  if (mancanti.length) { console.error('Modelli non installati (non scarico nulla): ' + mancanti.join(', ')); modelli = modelli.filter(m => installati.includes(m)); }
  const riassunto = [];
  for (const m of modelli) riassunto.push(await valutaModello(m, solo));
  console.log('\n--- Riepilogo ---');
  riassunto.forEach(x => console.log(x.modello + ': ' + x.ok + '/' + x.tot + ' (' + x.secondi.toFixed(0) + ' s)'));
})();
