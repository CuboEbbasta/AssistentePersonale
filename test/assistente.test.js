const test = require('node:test');
const assert = require('node:assert/strict');
const Schema = require('../www/js/core/schema.js');
const O = require('../www/js/core/operazioni.js');
const P = require('../www/js/core/proposte.js');
const N = require('../www/js/core/normalizza.js');
const A = require('../www/js/core/assistente.js');

const OGGI = '2026-11-06'; // venerdì
const ADESSO = '2026-11-06T10:00:00.000Z';
let n = 0;
const genera = (p) => p + '_t' + (++n);
const stato = () => Schema.statoDefault();

test('prompt di sistema: data, giorno, tutti i campi esatti di ogni operazione, regole ed esempi', () => {
  const p = A.promptSistema(stato(), OGGI);
  assert.match(p, /venerdì 2026-11-06/);
  for (const tipo of Object.keys(O.OPERAZIONI)) {
    assert.ok(p.includes('- ' + tipo + ':') || p.includes('- ' + tipo + ' ['), tipo);
    const d = O.OPERAZIONI[tipo];
    for (const k of Object.keys(d.campi(stato(), OGGI))) assert.ok(p.includes(k), tipo + ' ' + k);
  }
  assert.match(p, /routine\.aggiungi:.*nome\*.*oraInizio\*.*giorni\*/);
  assert.match(p, /NON serve nessun id/);
  assert.match(p, /domande/i);
  assert.match(p, /Fumetto/);
  assert.match(p, /nessun dato: puoi comunque creare/);
});

test('contesto: elenca id e nome, solo task aperte; vuoto = frase esplicita', () => {
  const s = stato();
  s.routine.push({ id: 'routine_1', nome: 'Palestra', oraInizio: '18:00', giorni: [1, 3, 5] });
  s.task.push({ id: 'task_1', nome: 'Aperta', scadenza: OGGI, priorita: 5 }, { id: 'task_2', nome: 'Chiusa', completata: true });
  const c = A.contestoCompatto(s);
  assert.match(c, /id routine_1 \| Palestra \| 18:00 \| lun mer ven/);
  assert.match(c, /id task_1 \| Aperta/);
  assert.ok(!c.includes('Chiusa'));
  assert.ok(!A.promptSistema(s, OGGI).includes('nessun dato'));
});

test('ogni esempio del prompt è valido: normalizzato e accettato da creaProposta', () => {
  const s = stato();
  s.routine.push({ id: 'routine_k3', nome: 'Palestra', tipo: 'allenamento', oraInizio: '18:00', durataMinuti: 60, priorita: 5, giorni: [1], attiva: true, descrizione: '' });
  const blocchi = A.esempi(OGGI).split('\n\n');
  assert.equal(blocchi.length, 6);
  for (const b of blocchi) {
    const json = b.split('\nRisposta: ')[1];
    const r = A.interpreta(json, s, OGGI, ADESSO, genera);
    assert.deepEqual(r.errori, [], b);
    assert.equal(r.formato, 'ok');
  }
});

test('prompt utente: ultimi 6 messaggi con le proposte in attesa', () => {
  const cron = [];
  for (let i = 0; i < 10; i++) cron.push({ ruolo: i % 2 ? 'assistente' : 'utente', testo: 'm' + i, anteprima: i === 9 ? ['Aggiungi task «X»'] : undefined });
  const p = A.costruisciPrompt('ciao', cron);
  assert.ok(!p.includes('m3')); assert.ok(p.includes('m4')); assert.ok(p.includes('m9'));
  assert.match(p, /proposta in attesa di conferma: Aggiungi task «X»/);
  assert.match(p, /Utente: ciao\nRisposta:$/);
  assert.equal(A.costruisciPrompt('ciao', []), 'Utente: ciao\nRisposta:');
});

test('estraiJSON: blocchi ```json, testo prima/dopo, virgole finali, think, troncato', () => {
  assert.deepEqual(A.estraiJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(A.estraiJSON('Ecco: {"a":1} fatto'), { a: 1 });
  assert.deepEqual(A.estraiJSON('{"a":[1,2,],"b":2,}'), { a: [1, 2], b: 2 });
  assert.deepEqual(A.estraiJSON('<think>{"x":0}</think>\n{"a":1}'), { a: 1 });
  assert.deepEqual(A.estraiJSON('{"a":{"b":"c}"}} extra }'), { a: { b: 'c}' } });
  assert.deepEqual(A.estraiJSON('{"risposta":"ok","operazioni":[{"tipo":"x","dati":{"n":1}'), { risposta: 'ok', operazioni: [{ tipo: 'x', dati: { n: 1 } }] });
  assert.equal(A.estraiJSON('nessun json qui'), null);
  assert.equal(A.estraiJSON(5), null);
});

test('il caso reale: «14:00 alle 15:00: Fumetto per Venerdi» diventa una proposta valida', () => {
  const modello = '```json\n{"risposta":"Ok","operazioni":[{"tipo":"routine.aggiungi","id":"routine_1","dati":{"nome":"Fumetto","ora":"14:00","fine":"15:00","giorno":"Venerdi"}}]}\n```';
  const r = A.interpreta(modello, stato(), OGGI, ADESSO, genera);
  assert.deepEqual(r.errori, []);
  assert.equal(r.proposta.client, 'assistente-app');
  assert.equal(r.proposta.stato, 'in_attesa');
  assert.deepEqual(r.proposta.operazioni[0].dati, { nome: 'Fumetto', oraInizio: '14:00', durataMinuti: 60, giorni: [5] });
  assert.match(r.proposta.anteprima[0], /Fumetto.*14:00.*60 min.*ven/);
  // applicabile davvero
  const ap = P.applicaProposta(stato(), r.proposta, { oggiISO: OGGI, generaId: genera });
  assert.equal(ap.ok, true);
  assert.equal(ap.stato.routine.length, 1);
});

test('nessuna operazione: solo risposta, nessun errore', () => {
  const r = A.interpreta('{"risposta":"Dormi regolare.","operazioni":[]}', stato(), OGGI, ADESSO, genera);
  assert.equal(r.proposta, null); assert.deepEqual(r.errori, []); assert.equal(r.risposta, 'Dormi regolare.');
});

test('operazione senza campo obbligatorio: errori in italiano, niente proposta', () => {
  const r = A.interpreta('{"risposta":"ok","operazioni":[{"tipo":"routine.aggiungi","dati":{"nome":"Yoga"}}]}', stato(), OGGI, ADESSO, genera);
  assert.equal(r.proposta, null);
  assert.ok(r.errori.some(e => /manca «oraInizio»/.test(e)), r.errori.join('|'));
  assert.match(A.messaggioErrore(r.errori, r.formato), /oraInizio/);
});

test('modifica di un elemento inesistente: errore chiaro', () => {
  const r = A.interpreta('{"risposta":"ok","operazioni":[{"tipo":"task.modifica","id":"task_zzz","dati":{"priorita":9}}]}', stato(), OGGI, ADESSO, genera);
  assert.equal(r.proposta, null);
  assert.ok(r.errori.some(e => /non è tra i tuoi dati/.test(e)));
});

test('modifica con id dal contesto o col nome', () => {
  const s = stato(); s.task.push({ id: 'task_a', nome: 'Pagare bolletta', priorita: 5, tipo: 'altro', ambito: 'giorno', scadenza: OGGI, oraPromemoria: null, durataStimataMinuti: null, note: '', completata: false });
  const a = A.interpreta('{"risposta":"ok","operazioni":[{"tipo":"task.modifica","id":"task_a","dati":{"priorita":"alta"}}]}', s, OGGI, ADESSO, genera);
  assert.deepEqual(a.errori, []); assert.equal(a.proposta.operazioni[0].dati.priorita, 8);
  const b = A.interpreta('{"risposta":"ok","operazioni":[{"tipo":"task.modifica","id":"Pagare bolletta","dati":{"scadenza":"domani"}}]}', s, OGGI, ADESSO, genera);
  assert.deepEqual(b.errori, []); assert.equal(b.proposta.operazioni[0].id, 'task_a');
});

test('testo senza JSON: formato testo, nessuna operazione', () => {
  const r = A.interpreta('Non posso farlo.', stato(), OGGI, ADESSO, genera);
  assert.equal(r.formato, 'testo'); assert.equal(r.proposta, null); assert.ok(r.errori.length);
  assert.match(A.messaggioErrore(r.errori, r.formato), /Riprova/);
});

test('prompt di correzione: contiene richiesta, risposta sbagliata ed errori', () => {
  const p = A.promptCorrezione('aggiungi yoga', '{"x":1}', ['Operazione 1: manca «oraInizio»'], []);
  assert.match(p, /aggiungi yoga/); assert.match(p, /NON valida/); assert.match(p, /oraInizio/);
});

test('NucleoNormalizza è usato: stesse regole di strumenti', () => {
  assert.equal(typeof N.normalizzaOperazione, 'function');
});

test('elabora: nessun errore = una sola chiamata; errore = una sola correzione', async () => {
  const chiamate = [];
  const base = { testo: 'aggiungi yoga alle 7 tutti i giorni', stato: stato(), oggiISO: OGGI, adessoISO: ADESSO, generaId: genera, cronologia: [] };
  const sbagliata = '{"risposta":"ok","operazioni":[{"tipo":"routine.aggiungi","dati":{"nome":"Yoga"}}]}';
  const giusta = '{"risposta":"ok","operazioni":[{"tipo":"routine.aggiungi","dati":{"nome":"Yoga","oraInizio":"07:00","giorni":"tutti i giorni"}}]}';
  const r = await A.elabora({ ...base, chiama: async (p) => { chiamate.push(p); return { ok: true, testo: chiamate.length === 1 ? sbagliata : giusta }; } });
  assert.equal(r.tentativi, 2); assert.equal(chiamate.length, 2);
  assert.match(chiamate[1], /manca «oraInizio»/);
  assert.deepEqual(r.errori, []); assert.ok(r.proposta);
  // sempre sbagliata: massimo 2 chiamate e messaggio chiaro, non il JSON
  let k = 0;
  const r2 = await A.elabora({ ...base, chiama: async () => { k++; return { ok: true, testo: sbagliata }; } });
  assert.equal(k, 2); assert.equal(r2.proposta, null);
  assert.match(r2.messaggio, /oraInizio/); assert.ok(!r2.messaggio.includes('{'));
  // già giusta: una chiamata
  k = 0;
  const r3 = await A.elabora({ ...base, chiama: async () => { k++; return { ok: true, testo: giusta }; } });
  assert.equal(k, 1); assert.equal(r3.tentativi, 1);
  // errore di rete
  const r4 = await A.elabora({ ...base, chiama: async () => ({ ok: false, errore: 'Impossibile raggiungere il server IA.' }) });
  assert.deepEqual(r4, { ok: false, errore: 'Impossibile raggiungere il server IA.' });
});
