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

// ---- Round correzioni ----
function conVoci() {
  const s = nuovo();
  s.journal[OGGI] = { fattoBene: 'a', daMigliorare: 'b', obiettivoDomani: 'c', voto: '6', votoNumerico: 6 };
  s.sonnoLog[OGGI] = { oraInizio: '23:00', oraFine: '07:00', oreDormite: 8, qualita: null };
  return s;
}
const datiDiario = { data: OGGI, fattoBene: 'x', daMigliorare: 'y', obiettivoDomani: 'z', voto: '7' };
const datiSonno = { data: OGGI, oraInizio: '22:00', oraFine: '06:00' };

test('diario/sonno: sovrascrittura richiede baseHash corretto', () => {
  const s = conVoci();
  for (const [tipo, dati] of [['diario.imposta', datiDiario], ['sonno.imposta', datiSonno]]) {
    const giusto = O.hashRecord(O.bersaglio(s, { tipo, dati }));
    assert.equal(O.validaOperazione(s, { tipo, dati }, OGGI).ok, false, tipo + ' senza baseHash');
    assert.equal(O.validaOperazione(s, { tipo, baseHash: 'deadbeef', dati }, OGGI).ok, false, tipo + ' baseHash vecchio');
    assert.equal(O.validaOperazione(s, { tipo, baseHash: giusto, dati }, OGGI).ok, true, tipo + ' baseHash giusto');
    assert.equal(O.validaOperazione(nuovo(), { tipo, dati }, OGGI).ok, true, tipo + ' nuova voce');
  }
});

test('limiti di lunghezza', () => {
  const v = (tipo, dati) => O.validaOperazione(nuovo(), { tipo, dati }, OGGI);
  const l = (n) => 'a'.repeat(n);
  assert.equal(v('task.aggiungi', { nome: l(200), scadenza: OGGI }).ok, true);
  assert.equal(v('task.aggiungi', { nome: l(201), scadenza: OGGI }).ok, false);
  assert.equal(v('task.aggiungi', { nome: 'a', scadenza: OGGI, note: l(2001) }).ok, false);
  assert.equal(v('routine.aggiungi', { nome: l(201), oraInizio: '08:00', giorni: [1] }).ok, false);
  assert.equal(v('routine.aggiungi', { nome: 'a', descrizione: l(2001), oraInizio: '08:00', giorni: [1] }).ok, false);
  assert.equal(v('obiettivo.aggiungi', { titolo: l(201), tipo: 'concreto' }).ok, false);
  assert.equal(v('obiettivo.aggiungi', { titolo: 'a', tipo: 'concreto', descrizione: l(2001) }).ok, false);
  const col = Array.from({ length: 51 }, (_, i) => 'task:' + i);
  assert.equal(v('obiettivo.aggiungi', { titolo: 'a', tipo: 'concreto', attivitaCollegate: col }).ok, false);
  assert.equal(v('obiettivo.aggiungi', { titolo: 'a', tipo: 'concreto', attivitaCollegate: col.slice(0, 50) }).ok, true);
  assert.equal(v('obiettivo.aggiungi', { titolo: 'a', tipo: 'concreto', tappe: Array.from({ length: 51 }, () => ({})) }).ok, false);
  assert.equal(v('pasto.aggiungi', { data: OGGI, nome: l(201), kcal: 1, proteine: 0, carboidrati: 0, grassi: 0 }).ok, false);
  for (const k of ['fattoBene', 'daMigliorare', 'obiettivoDomani']) {
    assert.equal(v('diario.imposta', { ...datiDiario, [k]: l(2001) }).ok, false, k);
    assert.equal(v('diario.imposta', { ...datiDiario, [k]: l(2000) }).ok, true, k);
  }
});

test('__proto__ annidato in dati -> rifiutato', () => {
  const g = JSON.parse('[{"__proto__":{"evil":1}}]');
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'routine.aggiungi', dati: { nome: 'A', oraInizio: '08:00', giorni: g } }, OGGI).ok, false);
  const t = JSON.parse('{"titolo":"a","tipo":"concreto","tappe":[{"x":{"__proto__":{"evil":1}}}]}');
  assert.equal(O.validaOperazione(nuovo(), { tipo: 'obiettivo.aggiungi', dati: t }, OGGI).ok, false);
  assert.equal(({}).evil, undefined);
});

test('hashRecord con chiave __proto__ non imposta il prototipo e la distingue', () => {
  const a = JSON.parse('{"__proto__":{"x":1},"b":1}');
  const b = JSON.parse('{"__proto__":{"x":2},"b":1}');
  assert.notEqual(O.hashRecord(a), O.hashRecord(b));
  assert.notEqual(O.hashRecord(a), O.hashRecord({ b: 1 }));
});

test('hashRecord ignora le chiavi undefined come JSON.stringify', () => {
  assert.equal(O.hashRecord({ a: 1, b: undefined }), O.hashRecord({ a: 1 }));
  assert.equal(O.hashRecord({ a: { x: 1, y: undefined } }), O.hashRecord({ a: { x: 1 } }));
  assert.notEqual(O.hashRecord({ a: 1, b: null }), O.hashRecord({ a: 1 }));
  assert.equal(O.hashRecord([undefined]), O.hashRecord([null]));
});

test('validaOperazione rifiuta chiavi dell operazione diverse da tipo|id|baseHash|dati', () => {
  const s = conRoutine();
  const base = { tipo: 'task.aggiungi', dati: { nome: 'A' } };
  assert.equal(O.validaOperazione(s, base, OGGI).ok, true);
  const r = O.validaOperazione(s, { ...base, extra: 1 }, OGGI);
  assert.equal(r.ok, false);
  assert.match(r.errori.join(';'), /extra/);
  assert.equal(O.validaOperazione(s, { ...base, dati: { nome: 'A' }, __proto__x: 1 }, OGGI).ok, false);
  const ok = O.validaOperazione(s, { tipo: 'routine.modifica', id: 'r1', baseHash: O.hashRecord(s.routine[0]), dati: { nome: 'B' } }, OGGI);
  assert.equal(ok.ok, true);
});

test('validaOperazione rifiuta id quando il tipo non lo richiede', () => {
  const s = conRoutine();
  for (const op of [
    { tipo: 'task.aggiungi', id: 'x', dati: { nome: 'A' } },
    { tipo: 'diario.imposta', id: 'x', dati: { data: OGGI, fattoBene: 'a', daMigliorare: 'b', obiettivoDomani: 'c', voto: '7' } },
    { tipo: 'pasto.aggiungi', id: 'x', dati: { data: OGGI, nome: 'P', kcal: 100, proteine: 1, carboidrati: 1, grassi: 1 } },
  ]) {
    const r = O.validaOperazione(s, op, OGGI);
    assert.equal(r.ok, false, op.tipo);
    assert.match(r.errori.join(';'), /id/);
  }
});
