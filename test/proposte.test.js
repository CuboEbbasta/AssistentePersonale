const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../www/js/core/schema');
const P = require('../www/js/core/proposte');

const OGGI = '2026-11-05';
const ADESSO = '2026-11-05T10:00:00.000Z';
let n = 0;
const generaId = (p) => p + '_' + (++n);
const ctx = { oggiISO: OGGI, generaId };

function conTask() {
  const s = S.statoDefault();
  s.task.push({ id: 't1', nome: 'Studia', priorita: 5, tipo: 'altro', ambito: 'giorno', scadenza: '2026-11-10', oraPromemoria: null, durataStimataMinuti: null, note: '', completata: false });
  return s;
}
const nuova = (stato, operazioni) => P.creaProposta({ client: 'ia', motivo: 'test', operazioni }, stato, OGGI, ADESSO, generaId);

test('proposta valida: in_attesa con anteprima', () => {
  const r = nuova(conTask(), [{ tipo: 'task.aggiungi', dati: { nome: 'Leggi', scadenza: '2026-11-10' } }]);
  assert.equal(r.ok, true);
  assert.equal(r.proposta.stato, 'in_attesa');
  assert.equal(r.proposta.client, 'ia');
  assert.equal(r.proposta.creatoIl, ADESSO);
  assert.equal(r.proposta.anteprima.length, 1);
  assert.match(r.proposta.anteprima[0], /Aggiungi task «Leggi» entro 2026-11-10/);
  assert.equal(r.proposta.operazioni[0].baseHash, undefined);
});

test('baseHash compilato per bersaglio esistente', () => {
  const r = nuova(conTask(), [{ tipo: 'task.modifica', id: 't1', dati: { nome: 'Nuovo' } }]);
  assert.equal(r.ok, true);
  assert.equal(typeof r.proposta.operazioni[0].baseHash, 'string');
  assert.equal(r.proposta.anteprima.length, 1);
});

test('51 operazioni: errore', () => {
  const ops = Array.from({ length: 51 }, () => ({ tipo: 'task.aggiungi', dati: { nome: 'x' } }));
  const r = nuova(conTask(), ops);
  assert.equal(r.ok, false);
  assert.ok(r.errori.length);
});

test('nessuna operazione: errore', () => {
  assert.equal(nuova(conTask(), []).ok, false);
});

test('una operazione invalida: nessuna proposta', () => {
  const r = nuova(conTask(), [{ tipo: 'task.aggiungi', dati: { nome: 'ok' } }, { tipo: 'task.aggiungi', dati: { nome: '' } }]);
  assert.equal(r.ok, false);
  assert.ok(r.errori.length);
});

test('applicaProposta applica tutte le operazioni', () => {
  const s = conTask();
  const r = nuova(s, [{ tipo: 'task.aggiungi', dati: { nome: 'A' } }, { tipo: 'task.modifica', id: 't1', dati: { nome: 'B' } }]);
  const a = P.applicaProposta(s, r.proposta, ctx);
  assert.equal(a.ok, true);
  assert.equal(a.stato.task.length, 2);
  assert.equal(a.stato.task.find(t => t.id === 't1').nome, 'B');
  assert.equal(s.task.length, 1);
});

test('due modifiche allo stesso record nella stessa proposta sono ok', () => {
  const s = conTask();
  const r = nuova(s, [{ tipo: 'task.modifica', id: 't1', dati: { nome: 'B' } }, { tipo: 'task.modifica', id: 't1', dati: { priorita: 7 } }]);
  assert.equal(r.ok, true);
  const a = P.applicaProposta(s, r.proposta, ctx);
  assert.equal(a.ok, true);
  assert.equal(a.stato.task[0].priorita, 7);
});

test('atomicita: se la 2a fallisce lo stato e l originale', () => {
  const s = conTask();
  const r = nuova(s, [{ tipo: 'task.aggiungi', dati: { nome: 'A' } }, { tipo: 'task.aggiungi', dati: { nome: 'B' } }]);
  r.proposta.operazioni[1].dati.nome = '';
  const a = P.applicaProposta(s, r.proposta, ctx);
  assert.equal(a.ok, false);
  assert.equal(a.stato, 'non_valida');
  assert.ok(a.motivi.length);
  assert.equal(s.task.length, 1);
});

test('due proposte task.modifica sullo stesso id: la seconda e obsoleta', () => {
  const s = conTask();
  const p1 = nuova(s, [{ tipo: 'task.modifica', id: 't1', dati: { nome: 'Uno' } }]).proposta;
  const p2 = nuova(s, [{ tipo: 'task.modifica', id: 't1', dati: { nome: 'Due' } }]).proposta;
  const a = P.applicaProposta(s, p1, ctx);
  assert.equal(a.ok, true);
  const c = P.controllaApplicabile(a.stato, p2, OGGI);
  assert.equal(c.stato, 'obsoleta');
  const b = P.applicaProposta(a.stato, p2, ctx);
  assert.equal(b.ok, false);
  assert.equal(b.stato, 'obsoleta');
});

test('record cancellato nel frattempo: obsoleta', () => {
  const s = conTask();
  const p = nuova(s, [{ tipo: 'task.modifica', id: 't1', dati: { nome: 'Uno' } }]).proposta;
  s.task = [];
  assert.equal(P.controllaApplicabile(s, p, OGGI).stato, 'obsoleta');
});

test('applicabile quando nulla e cambiato', () => {
  const s = conTask();
  const p = nuova(s, [{ tipo: 'task.modifica', id: 't1', dati: { nome: 'Uno' } }]).proposta;
  assert.deepEqual(P.controllaApplicabile(s, p, OGGI), { stato: 'applicabile', motivi: [] });
});

test('diario creato nel frattempo: obsoleta', () => {
  const s = S.statoDefault();
  const dati = { data: '2026-11-04', fattoBene: 'a', daMigliorare: 'b', obiettivoDomani: 'c', voto: '7' };
  const p = nuova(s, [{ tipo: 'diario.imposta', dati }]).proposta;
  s.journal['2026-11-04'] = { fattoBene: 'x' };
  assert.equal(P.controllaApplicabile(s, p, OGGI).stato, 'obsoleta');
});

test('non_valida quando la validazione fallisce per altri motivi', () => {
  const s = conTask();
  const p = nuova(s, [{ tipo: 'task.aggiungi', dati: { nome: 'A', scadenza: '2026-11-06' } }]).proposta;
  const c = P.controllaApplicabile(s, p, '2026-11-20');
  assert.equal(c.stato, 'non_valida');
  assert.ok(c.motivi.length);
});
