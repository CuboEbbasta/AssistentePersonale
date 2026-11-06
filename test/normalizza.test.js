const test = require('node:test');
const assert = require('node:assert/strict');
const Schema = require('../www/js/core/schema.js');
const N = require('../www/js/core/normalizza.js');
const O = require('../www/js/core/operazioni.js');

const OGGI = '2026-11-06'; // venerdì
const stato = () => Schema.statoDefault();
const norm = (op, s, opz) => N.normalizzaOperazione(op, s || stato(), OGGI, opz);

test('giorni: numeri, nomi, abbreviazioni, accenti', () => {
  assert.deepEqual(N.normalizzaGiorni(5), [5]);
  assert.deepEqual(N.normalizzaGiorni('Venerdi'), [5]);
  assert.deepEqual(N.normalizzaGiorni('venerdì'), [5]);
  assert.deepEqual(N.normalizzaGiorni('lun'), [1]);
  assert.deepEqual(N.normalizzaGiorni('Martedì'), [2]);
  assert.deepEqual(N.normalizzaGiorni('domenica'), [7]);
  assert.deepEqual(N.normalizzaGiorni(['lunedì', 3, 'ven']), [1, 3, 5]);
});

test('giorni: intervalli, gruppi e elenchi in testo', () => {
  assert.deepEqual(N.normalizzaGiorni('lunedì-venerdì'), [1, 2, 3, 4, 5]);
  assert.deepEqual(N.normalizzaGiorni('dal lunedi al venerdi'), [1, 2, 3, 4, 5]);
  assert.deepEqual(N.normalizzaGiorni('lun - mer'), [1, 2, 3]);
  assert.deepEqual(N.normalizzaGiorni('sabato-lunedì'), [1, 6, 7]);
  assert.deepEqual(N.normalizzaGiorni('feriali'), [1, 2, 3, 4, 5]);
  assert.deepEqual(N.normalizzaGiorni('weekend'), [6, 7]);
  assert.deepEqual(N.normalizzaGiorni('tutti i giorni'), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(N.normalizzaGiorni('lunedì, mercoledì e venerdì'), [1, 3, 5]);
  assert.deepEqual(N.normalizzaGiorni('1,3,5'), [1, 3, 5]);
  assert.deepEqual(N.normalizzaGiorni('1-5'), [1, 2, 3, 4, 5]);
});

test('giorni: valori incomprensibili restano com\'erano (li rifiuta la validazione)', () => {
  assert.equal(N.normalizzaGiorni('boh'), 'boh');
  assert.deepEqual(N.normalizzaGiorni([9]), [9]);
  assert.deepEqual(N.normalizzaGiorni({ a: 1 }), { a: 1 });
});

test('ore: formati diversi -> HH:MM', () => {
  assert.equal(N.normalizzaOra('14'), '14:00');
  assert.equal(N.normalizzaOra('14.00'), '14:00');
  assert.equal(N.normalizzaOra('14:00:00'), '14:00');
  assert.equal(N.normalizzaOra('9:30'), '09:30');
  assert.equal(N.normalizzaOra('alle 7'), '07:00');
  assert.equal(N.normalizzaOra('14h30'), '14:30');
  assert.equal(N.normalizzaOra(7), '07:00');
  assert.equal(N.normalizzaOra('25:00'), '25:00');
  assert.equal(N.normalizzaOra('mattina'), 'mattina');
});

test('routine: oraFine/fine/alle con oraInizio -> durataMinuti', () => {
  for (const chiave of ['oraFine', 'fine', 'alle']) {
    const r = norm({ tipo: 'routine.aggiungi', dati: { nome: 'Fumetto', oraInizio: '14:00', [chiave]: '15:00', giorni: 'Venerdi' } });
    assert.deepEqual(r.dati, { nome: 'Fumetto', oraInizio: '14:00', durataMinuti: 60, giorni: [5] });
  }
  const r = norm({ tipo: 'routine.aggiungi', dati: { nome: 'X', oraInizio: '14', oraFine: '15.30', giorni: [1] } });
  assert.equal(r.dati.oraInizio, '14:00'); assert.equal(r.dati.durataMinuti, 90);
});

test('routine: intervallo in un solo campo; fine prima dell\'inizio non crea durata; durata esplicita non si sovrascrive', () => {
  const a = norm({ tipo: 'routine.aggiungi', dati: { nome: 'X', oraInizio: '14:00 alle 15:00', giorni: [1] } });
  assert.equal(a.dati.oraInizio, '14:00'); assert.equal(a.dati.durataMinuti, 60);
  const b = norm({ tipo: 'routine.aggiungi', dati: { nome: 'X', oraInizio: '15:00', oraFine: '14:00', giorni: [1] } });
  assert.equal('durataMinuti' in b.dati, false);
  const c = norm({ tipo: 'routine.aggiungi', dati: { nome: 'X', oraInizio: '14:00', oraFine: '15:00', durataMinuti: 20, giorni: [1] } });
  assert.equal(c.dati.durataMinuti, 20);
});

test('sonno: oraFine resta un campo canonico', () => {
  const r = norm({ tipo: 'sonno.imposta', dati: { data: 'ieri', oraInizio: '23', oraFine: '7.00', qualita: '4' } });
  assert.deepEqual(r.dati, { data: '2026-11-05', oraInizio: '23:00', oraFine: '07:00', qualita: 4 });
});

test('tipo testuale: id esistente se riconoscibile, altrimenti altro', () => {
  const s = stato();
  assert.equal(norm({ tipo: 'routine.aggiungi', dati: { nome: 'x', tipo: 'Allenamento' } }, s).dati.tipo, 'allenamento');
  assert.equal(norm({ tipo: 'routine.aggiungi', dati: { nome: 'x', tipo: 'pasto' } }, s).dati.tipo, 'pasto');
  assert.equal(norm({ tipo: 'routine.aggiungi', dati: { nome: 'x', tipo: 'pranzo' } }, s).dati.tipo, 'pasto');
  assert.equal(norm({ tipo: 'task.aggiungi', dati: { nome: 'x', tipo: 'Lettura' } }, s).dati.tipo, 'altro');
  s.tipiAttivita.push({ id: 'tipo_9', nome: 'Studio' });
  assert.equal(norm({ tipo: 'task.aggiungi', dati: { nome: 'x', tipo: 'studio' } }, s).dati.tipo, 'tipo_9');
  assert.equal(norm({ tipo: 'task.aggiungi', dati: { nome: 'x', tipo: 'tipo_9' } }, s).dati.tipo, 'tipo_9');
});

test('priorità testuale e numerica', () => {
  const p = (v) => norm({ tipo: 'task.aggiungi', dati: { nome: 'x', priorita: v } }).dati.priorita;
  assert.equal(p('alta'), 8); assert.equal(p('Media'), 5); assert.equal(p('bassa'), 2);
  assert.equal(p('7'), 7); assert.equal(p(12), 10); assert.equal(p('7/10'), 7);
});

test('date relative e formati comuni', () => {
  const d = (v) => norm({ tipo: 'task.aggiungi', dati: { nome: 'x', scadenza: v } }).dati.scadenza;
  assert.equal(d('oggi'), '2026-11-06'); assert.equal(d('Domani'), '2026-11-07'); assert.equal(d('dopodomani'), '2026-11-08');
  assert.equal(d('2026-12-01'), '2026-12-01'); assert.equal(d('10/11/2026'), '2026-11-10'); assert.equal(d('10/11'), '2026-11-10');
  assert.equal(d('lunedì'), '2026-11-09'); assert.equal(d('venerdì'), '2026-11-13');
  assert.equal(d('boh'), 'boh');
  assert.equal(norm({ tipo: 'diario.imposta', dati: { data: 'ieri' } }).dati.data, '2026-11-05');
  assert.equal(N.normalizzaOperazione({ tipo: 'task.aggiungi', dati: { nome: 'x', scadenza: 'domani' } }, stato(), undefined).dati.scadenza, 'domani');
});

test('mai sovrascrivere un campo canonico già presente', () => {
  const r = norm({ tipo: 'task.aggiungi', dati: { nome: 'x', scadenza: '2026-12-01', data: 'domani' } });
  assert.equal(r.dati.scadenza, '2026-12-01');
  assert.equal(r.dati.data, 'domani'); // resta, lo rifiuta la validazione
  const q = norm({ tipo: 'routine.aggiungi', dati: { nome: 'x', oraInizio: '07:00', ora: '09:00', giorni: [1] } });
  assert.equal(q.dati.oraInizio, '07:00');
});

test('compatibilità: sinonimi, accenti, numeri come testo, id su aggiungi ignorato', () => {
  const r = norm({ tipo: 'task.aggiungi', id: 'task_1', dati: { Titolo: 'Leggere', 'priorità': '5', data: OGGI } });
  assert.deepEqual(r, { tipo: 'task.aggiungi', dati: { nome: 'Leggere', priorita: 5, scadenza: OGGI } });
});

test('pasto e diario: numeri con unità, voto decimale, sinonimi', () => {
  const p = norm({ tipo: 'pasto.aggiungi', dati: { pasto: 'Pasta', calorie: '600 kcal', proteine: '20g', carbo: 90, grassi: 15.4 } });
  assert.deepEqual(p.dati, { nome: 'Pasta', kcal: 600, proteine: 20, carboidrati: 90, grassi: 15 });
  assert.equal(norm({ tipo: 'diario.imposta', dati: { voto: 7 } }).dati.voto, '7');
  assert.equal(norm({ tipo: 'diario.imposta', dati: { voto: '7.5' } }).dati.voto, '7½');
  assert.equal(norm({ tipo: 'diario.imposta', dati: { voto: '7+' } }).dati.voto, '7+');
});

test('obiettivo: tipo e ambito in forme libere', () => {
  const r = norm({ tipo: 'obiettivo.aggiungi', dati: { nome: 'Correre una maratona', tipo: 'Concreto', ambito: '1 anno' } });
  assert.deepEqual(r.dati, { titolo: 'Correre una maratona', tipo: 'concreto', ambito: '1anno' });
  assert.equal(norm({ tipo: 'obiettivo.aggiungi', dati: { titolo: 'x', ambito: '6 mesi' } }).dati.ambito, '6mesi');
});

test('tipo di operazione scritto in modo diverso', () => {
  assert.equal(N.normalizzaTipoOperazione('Routine.Aggiungi'), 'routine.aggiungi');
  assert.equal(N.normalizzaTipoOperazione('aggiungi_routine'), 'routine.aggiungi');
  assert.equal(N.normalizzaTipoOperazione('task.crea'), 'task.aggiungi');
  assert.equal(N.normalizzaTipoOperazione('diario.aggiungi'), 'diario.imposta');
  assert.equal(N.normalizzaTipoOperazione('sonno'), 'sonno.imposta');
  assert.equal(N.normalizzaTipoOperazione('boh'), 'boh');
});

test('modalità tollerante: dati appiattiti, campi ignoti scartati, data mancante = oggi, id dal nome', () => {
  const a = norm({ tipo: 'task.aggiungi', nome: 'Leggere', completata: false }, stato(), { tollerante: true });
  assert.deepEqual(a, { tipo: 'task.aggiungi', dati: { nome: 'Leggere' } });
  const b = norm({ tipo: 'sonno.imposta', dati: { oraInizio: '23:00', oraFine: '07:00' } }, stato(), { tollerante: true });
  assert.equal(b.dati.data, OGGI);
  const s = stato(); s.task.push({ id: 'task_a', nome: 'Pagare bolletta', priorita: 5 });
  const c = norm({ tipo: 'task.modifica', id: 'Pagare bolletta', dati: { priorita: 'alta' } }, s, { tollerante: true });
  assert.equal(c.id, 'task_a'); assert.equal(c.dati.priorita, 8);
  // senza la modalità tollerante i campi ignoti restano (e verranno rifiutati)
  assert.equal(norm({ tipo: 'task.aggiungi', dati: { nome: 'x', boh: 1 } }).dati.boh, 1);
});

test('il caso reale dell\'utente produce una routine valida', () => {
  const s = stato();
  const r = norm({ tipo: 'routine.aggiungi', dati: { nome: 'Fumetto', oraInizio: '14:00', oraFine: '15:00', giorni: 'Venerdi' } }, s, { tollerante: true });
  assert.deepEqual(O.validaOperazione(s, r, OGGI), { ok: true, errori: [] });
});
