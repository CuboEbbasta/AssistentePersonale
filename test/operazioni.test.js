const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../www/js/core/schema');
const O = require('../www/js/core/operazioni');

const OGGI = '2026-11-05';
let n = 0;
const ctx = { oggiISO: OGGI, generaId: (p) => p + '_' + (++n) };
const nuovo = () => S.statoDefault();

function conRoutine() {
  const s = nuovo();
  s.routine.push({ id: 'r1', nome: 'Corsa', descrizione: 'x', tipo: 'altro', oraInizio: '07:00', durataMinuti: 30, priorita: 5, giorni: [1, 3], attiva: true });
  return s;
}

test('sezioneDi mappa i tipi alle sezioni', () => {
  assert.equal(O.sezioneDi('routine.aggiungi'), 'agenda');
  assert.equal(O.sezioneDi('task.modifica'), 'agenda');
  assert.equal(O.sezioneDi('obiettivo.aggiungi'), 'obiettivi');
  assert.equal(O.sezioneDi('diario.imposta'), 'diario');
  assert.equal(O.sezioneDi('pasto.aggiungi'), 'dieta');
  assert.equal(O.sezioneDi('sonno.imposta'), 'sonno');
  assert.equal(O.sezioneDi('inesistente'), null);
  assert.equal(O.sezioneDi('constructor'), null);
});

test('hashRecord e stabile rispetto all ordine delle chiavi', () => {
  assert.equal(O.hashRecord({ a: 1, b: [1, 2] }), O.hashRecord({ b: [1, 2], a: 1 }));
  assert.notEqual(O.hashRecord({ a: 1 }), O.hashRecord({ a: 2 }));
  assert.match(O.hashRecord({ a: 1 }), /^[0-9a-f]{8}$/);
});

test('tipo inesistente -> errore', () => {
  const r = O.validaOperazione(nuovo(), { tipo: 'cancella.tutto', dati: {} }, OGGI);
  assert.equal(r.ok, false);
  assert.ok(r.errori.length);
});

test('task con scadenza nel passato -> errore', () => {
  const r = O.validaOperazione(nuovo(), { tipo: 'task.aggiungi', dati: { nome: 'A', ambito: 'giorno', scadenza: '2026-11-04' } }, OGGI);
  assert.equal(r.ok, false);
});

test('task con priorita fuori 1-10 -> errore', () => {
  for (const p of [0, 11, 5.5, '5']) {
    const r = O.validaOperazione(nuovo(), { tipo: 'task.aggiungi', dati: { nome: 'A', scadenza: OGGI, priorita: p } }, OGGI);
    assert.equal(r.ok, false, 'priorita ' + p);
  }
});

test('oraInizio 25:00 -> errore', () => {
  const r = O.validaOperazione(nuovo(), { tipo: 'routine.aggiungi', dati: { nome: 'A', oraInizio: '25:00', giorni: [1] } }, OGGI);
  assert.equal(r.ok, false);
});

test('giorni fuori 1-7 -> errore', () => {
  for (const g of [[0], [8], [1, 1], [], 'x']) {
    const r = O.validaOperazione(nuovo(), { tipo: 'routine.aggiungi', dati: { nome: 'A', oraInizio: '08:00', giorni: g } }, OGGI);
    assert.equal(r.ok, false, JSON.stringify(g));
  }
});

test('pasto tutto a zero -> errore (regola di ui-dieta.js)', () => {
  const r = O.validaOperazione(nuovo(), { tipo: 'pasto.aggiungi', dati: { data: OGGI, nome: 'Niente', kcal: 0, proteine: 0, carboidrati: 0, grassi: 0 } }, OGGI);
  assert.equal(r.ok, false);
});

test('pasto con kcal > 5000 o negativi -> errore', () => {
  const base = { data: OGGI, nome: 'P', kcal: 500, proteine: 10, carboidrati: 10, grassi: 10 };
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'pasto.aggiungi', dati: { ...base, kcal: 5001 } }, OGGI).ok, false);
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'pasto.aggiungi', dati: { ...base, grassi: -1 } }, OGGI).ok, false);
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'pasto.aggiungi', dati: base }, OGGI).ok, true);
});

test('campo non ammesso -> errore', () => {
  const r = O.validaOperazione(nuovo(), { tipo: 'task.aggiungi', dati: { nome: 'A', scadenza: OGGI, evil: 1 } }, OGGI);
  assert.equal(r.ok, false);
});

test('dati con __proto__ / constructor / prototype -> errore, nessun inquinamento', () => {
  for (const chiave of ['__proto__', 'constructor', 'prototype']) {
    const dati = JSON.parse('{"nome":"A","scadenza":"' + OGGI + '","' + chiave + '":{"evil":1}}');
    const op = { tipo: 'task.aggiungi', dati };
    const r = O.validaOperazione(nuovo(), op, OGGI);
    assert.equal(r.ok, false, chiave);
    assert.throws(() => O.applicaOperazione(nuovo(), op, ctx));
    assert.equal(({}).evil, undefined);
  }
});

test('task.aggiungi valido -> +1 task con completata:false', () => {
  const s = nuovo();
  const out = O.applicaOperazione(s, { tipo: 'task.aggiungi', dati: { nome: 'Chiamare Luca', scadenza: OGGI, priorita: 7 } }, ctx);
  assert.equal(out.task.length, 1);
  assert.equal(out.task[0].completata, false);
  assert.equal(out.task[0].nome, 'Chiamare Luca');
  assert.equal(out.task[0].priorita, 7);
  assert.ok(out.task[0].id);
  assert.equal(s.task.length, 0);
});

test('routine.modifica cambia solo i campi dati', () => {
  const s = conRoutine();
  const out = O.applicaOperazione(s, { tipo: 'routine.modifica', id: 'r1', dati: { oraInizio: '08:30' } }, ctx);
  assert.equal(out.routine[0].oraInizio, '08:30');
  assert.deepEqual({ ...out.routine[0], oraInizio: '07:00' }, s.routine[0]);
});

test('modifica con id inesistente o baseHash diverso -> errore', () => {
  const s = conRoutine();
  assert.equal(O.validaOperazione(s, { tipo: 'routine.modifica', id: 'zzz', dati: { nome: 'B' } }, OGGI).ok, false);
  assert.equal(O.validaOperazione(s, { tipo: 'routine.modifica', id: 'r1', baseHash: 'deadbeef', dati: { nome: 'B' } }, OGGI).ok, false);
  assert.equal(O.validaOperazione(s, { tipo: 'routine.modifica', id: 'r1', baseHash: O.hashRecord(s.routine[0]), dati: { nome: 'B' } }, OGGI).ok, true);
});

test('applicaOperazione non muta l input', () => {
  const s = conRoutine();
  const copia = JSON.parse(JSON.stringify(s));
  O.applicaOperazione(s, { tipo: 'routine.modifica', id: 'r1', dati: { nome: 'Nuova' } }, ctx);
  O.applicaOperazione(s, { tipo: 'sonno.imposta', dati: { data: OGGI, oraInizio: '23:00', oraFine: '07:00' } }, ctx);
  assert.deepEqual(s, copia);
});

test('applicaOperazione lancia se non valida', () => {
  assert.throws(() => O.applicaOperazione(nuovo(), { tipo: 'task.aggiungi', dati: {} }, ctx));
});

test('sonno.imposta calcola oreDormite e rifiuta durate implausibili', () => {
  const out = O.applicaOperazione(nuovo(), { tipo: 'sonno.imposta', dati: { data: OGGI, oraInizio: '23:00', oraFine: '07:00', qualita: 4 } }, ctx);
  assert.deepEqual(out.sonnoLog[OGGI], { oraInizio: '23:00', oraFine: '07:00', oreDormite: 8, qualita: 4 });
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'sonno.imposta', dati: { data: OGGI, oraInizio: '23:00', oraFine: '23:30' } }, OGGI).ok, false);
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'sonno.imposta', dati: { data: OGGI, oraInizio: '23:00', oraFine: '07:00', qualita: 6 } }, OGGI).ok, false);
});

test('diario.imposta scrive la voce con voto e votoNumerico; rifiuta il futuro', () => {
  const dati = { data: OGGI, fattoBene: 'a', daMigliorare: 'b', obiettivoDomani: 'c', voto: '7+' };
  const out = O.applicaOperazione(nuovo(), { tipo: 'diario.imposta', dati }, ctx);
  assert.equal(out.journal[OGGI].voto, '7+');
  assert.equal(out.journal[OGGI].votoNumerico, 7.25);
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'diario.imposta', dati: { ...dati, data: '2026-11-06' } }, OGGI).ok, false);
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'diario.imposta', dati: { ...dati, voto: '11' } }, OGGI).ok, false);
});

test('pasto.aggiungi aggiunge a dietaLog', () => {
  const out = O.applicaOperazione(nuovo(), { tipo: 'pasto.aggiungi', dati: { data: OGGI, nome: 'Pasta', kcal: 600, proteine: 20, carboidrati: 90, grassi: 10 } }, ctx);
  assert.equal(out.dietaLog[OGGI].pasti.length, 1);
  assert.equal(out.dietaLog[OGGI].pasti[0].kcal, 600);
});

test('obiettivo.aggiungi valido e tipo non valido', () => {
  const ok = O.applicaOperazione(nuovo(), { tipo: 'obiettivo.aggiungi', dati: { titolo: 'Libro', tipo: 'concreto', ambito: '1anno', scadenza: '2027-11-05' } }, ctx);
  assert.equal(ok.obiettivi[0].completato, false);
  assert.deepEqual(ok.obiettivi[0].tappe, []);
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'obiettivo.aggiungi', dati: { titolo: 'x', tipo: 'boh' } }, OGGI).ok, false);
});

test('bersaglio', () => {
  const s = conRoutine();
  assert.equal(O.bersaglio(s, { tipo: 'routine.modifica', id: 'r1', dati: {} }).nome, 'Corsa');
  assert.equal(O.bersaglio(s, { tipo: 'routine.modifica', id: 'zz', dati: {} }), null);
  assert.equal(O.bersaglio(s, { tipo: 'sonno.imposta', dati: { data: OGGI } }), null);
});
