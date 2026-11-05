const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../www/js/core/schema');

test('migra({}) ha tutte le chiavi di statoDefault()', () => {
  const m = S.migra({});
  Object.keys(S.statoDefault()).forEach(k => assert.ok(k in m, 'manca ' + k));
});

test('migra e idempotente', () => {
  const x = { workoutLog: { '2026-01-01': { schedaTipo: 'a' } }, tipiAttivita: [], extra: 1 };
  const una = JSON.parse(JSON.stringify(S.migra(x)));
  assert.deepEqual(S.migra(JSON.parse(JSON.stringify(una))), una);
});

test('i 4 tipi protetti tornano se mancano', () => {
  const m = S.migra({ tipiAttivita: [{ id: 'x', nome: 'X' }], paroleChiaveTipi: [] });
  ['allenamento', 'pasto', 'sonno', 'diario'].forEach(id => assert.ok(m.tipiAttivita.find(t => t.id === id)));
  assert.ok(m.tipiAttivita.find(t => t.id === 'x'));
});

test('workoutLog non-array diventa array', () => {
  const m = S.migra({ workoutLog: { '2026-01-01': { etichetta: 'A' } } });
  assert.deepEqual(m.workoutLog['2026-01-01'], [{ etichetta: 'A' }]);
});

test('chiavi sconosciute sopravvivono', () => {
  assert.equal(S.migra({ extra: 1 }).extra, 1);
});

test('migra(null) = statoDefault()', () => {
  assert.deepEqual(S.migra(null), S.statoDefault());
});

test('SEZIONI e SEZIONI_SENSIBILI', () => {
  assert.deepEqual(S.SEZIONI.agenda, ['routine', 'task', 'tipiAttivita', 'paroleChiaveTipi', 'orarioFisso', 'periodiAnno', 'log']);
  assert.deepEqual(S.SEZIONI.obiettivi, ['obiettivi']);
  assert.deepEqual(S.SEZIONI.diario, ['journal']);
  assert.deepEqual(S.SEZIONI.dieta, ['profilo', 'dietaPiano', 'dietaLog']);
  assert.deepEqual(S.SEZIONI.workout, ['profiloWorkout', 'schedaAdattiva', 'schedaPersonalizzata', 'workoutLog']);
  assert.deepEqual(S.SEZIONI.sonno, ['sonnoLog']);
  assert.deepEqual(S.SEZIONI_SENSIBILI, ['dieta', 'workout', 'sonno', 'diario']);
});
