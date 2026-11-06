const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Schema = require('../www/js/core/schema.js');
const { creaArchivio } = require('../ia/archivio.js');
const S = require('../ia/strumenti.js');

const OGGI = '2026-11-05'; // giovedi = 4
const ADESSO = '2026-11-05T10:00:00.000Z';
const nuovaDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'strumenti-'));
const cl = (sezioni, nome = 'claude') => ({ nome, tokenHash: 'HASHSEGRETO', sezioni });
const ctx = (archivio, client) => ({ archivio, client, oggiISO: OGGI, adessoISO: ADESSO });

function conStato(mod) {
  const dir = nuovaDir();
  const a = creaArchivio(dir);
  const s = Schema.statoDefault();
  mod(s);
  a.scriviStato(s);
  return { dir, a };
}
const leggiByte = (dir, n) => fs.readFileSync(path.join(dir, n));

test('STRUMENTI: quattro strumenti con schema chiuso', () => {
  assert.deepStrictEqual(S.STRUMENTI.map(t => t.name), ['ap_oggi', 'ap_leggi', 'ap_proponi', 'ap_stato_proposta']);
  for (const t of S.STRUMENTI) {
    assert.ok(t.description.length > 10);
    assert.strictEqual(t.inputSchema.type, 'object');
    assert.strictEqual(t.inputSchema.additionalProperties, false);
    assert.ok(Array.isArray(t.inputSchema.required));
  }
});

test('strumento sconosciuto -> ErroreStrumento', () => {
  const a = creaArchivio(nuovaDir());
  assert.throws(() => S.eseguiStrumento('ap_boh', {}, ctx(a, cl(['agenda']))), S.ErroreStrumento);
});

test('ap_oggi: archivio vuoto -> liste vuote', () => {
  const a = creaArchivio(nuovaDir());
  assert.deepStrictEqual(S.eseguiStrumento('ap_oggi', {}, ctx(a, cl(['agenda']))), { data: OGGI, routine: [], task: [] });
});

test('ap_oggi: routine del giorno e task di oggi o scadute', () => {
  const { a } = conStato(s => {
    s.routine.push(
      { id: 'r1', nome: 'Corsa', tipo: 'altro', oraInizio: '07:00', durataMinuti: 30, priorita: 5, giorni: [4], attiva: true },
      { id: 'r2', nome: 'Lunedi', tipo: 'altro', oraInizio: '07:00', durataMinuti: 30, priorita: 5, giorni: [1], attiva: true },
      { id: 'r3', nome: 'Spenta', tipo: 'altro', oraInizio: '07:00', durataMinuti: 30, priorita: 5, giorni: [4], attiva: false });
    s.task.push(
      { id: 't1', nome: 'Oggi', priorita: 5, ambito: 'giorno', scadenza: OGGI, completata: false },
      { id: 't2', nome: 'Scaduta', priorita: 5, ambito: 'giorno', scadenza: '2026-11-01', completata: false },
      { id: 't3', nome: 'Fatta', priorita: 5, ambito: 'giorno', scadenza: OGGI, completata: true },
      { id: 't4', nome: 'Ambito giorno, scadenza lontana (visibile come nell app)', priorita: 5, ambito: 'giorno', scadenza: '2026-11-20', completata: false },
      { id: 't5', nome: 'Anno', priorita: 5, ambito: 'anno', scadenza: '2026-11-05', completata: false },
      { id: 't6', nome: 'Anno lontana', priorita: 5, ambito: 'anno', scadenza: '2027-06-01', completata: false });
  });
  const r = S.eseguiStrumento('ap_oggi', {}, ctx(a, cl(['agenda'])));
  assert.deepStrictEqual(r.routine.map(x => x.id), ['r1']);
  assert.deepStrictEqual(r.task.map(x => x.id).sort(), ['t1', 't2', 't4', 't5']);
  assert.strictEqual(r.task.find(x => x.id === 't2').scaduta, true);
  assert.strictEqual(r.task.find(x => x.id === 't1').scaduta, false);
});

test('ap_oggi: senza sezione agenda -> errore', () => {
  const a = creaArchivio(nuovaDir());
  assert.throws(() => S.eseguiStrumento('ap_oggi', {}, ctx(a, cl(['diario']))), S.ErroreStrumento);
});

test('ap_leggi: sezione non permessa -> errore e nessun dato', () => {
  const { a } = conStato(s => { s.journal['2026-11-01'] = { fattoBene: 'SEGRETO' }; });
  let err;
  try { S.eseguiStrumento('ap_leggi', { sezione: 'diario' }, ctx(a, cl(['agenda']))); } catch (e) { err = e; }
  assert.ok(err instanceof S.ErroreStrumento);
  assert.ok(!/SEGRETO/.test(err.message));
  assert.throws(() => S.eseguiStrumento('ap_leggi', { sezione: 'inesistente' }, ctx(a, cl(['agenda']))), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_leggi', {}, ctx(a, cl(['agenda']))), S.ErroreStrumento);
});

test('ap_leggi: sezione permessa e filtro per date su journal e dietaLog', () => {
  const { a } = conStato(s => {
    s.journal = { '2026-10-30': { voto: '6' }, '2026-11-02': { voto: '7' }, '2026-11-04': { voto: '8' } };
    s.dietaLog = { '2026-11-02': [], '2026-11-04': [] };
  });
  const tutto = S.eseguiStrumento('ap_leggi', { sezione: 'diario' }, ctx(a, cl(['diario'])));
  assert.strictEqual(Object.keys(tutto.journal).length, 3);
  const f = S.eseguiStrumento('ap_leggi', { sezione: 'diario', da: '2026-11-01', a: '2026-11-03' }, ctx(a, cl(['diario'])));
  assert.deepStrictEqual(Object.keys(f.journal), ['2026-11-02']);
  const d = S.eseguiStrumento('ap_leggi', { sezione: 'dieta', da: '2026-11-03' }, ctx(a, cl(['dieta'])));
  assert.deepStrictEqual(Object.keys(d.dietaLog), ['2026-11-04']);
  assert.throws(() => S.eseguiStrumento('ap_leggi', { sezione: 'diario', da: '2026-13-45' }, ctx(a, cl(['diario']))), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_leggi', { sezione: 'diario', da: 'ieri' }, ctx(a, cl(['diario']))), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_leggi', { sezione: 'diario', da: '2026-11-05', a: '2026-11-01' }, ctx(a, cl(['diario']))), S.ErroreStrumento);
});

test('ap_proponi: operazione di sezione non permessa -> errore, niente scritto', () => {
  const { dir, a } = conStato(() => {});
  const ops = [{ tipo: 'diario.imposta', dati: { data: OGGI } }];
  assert.throws(() => S.eseguiStrumento('ap_proponi', { motivo: 'x', operazioni: ops }, ctx(a, cl(['agenda']))), S.ErroreStrumento);
  assert.deepStrictEqual(a.elencaProposte(), []);
  assert.ok(!fs.existsSync(path.join(dir, 'proposte.json')));
});

test('ap_proponi: valido -> una riga in proposte.json, stato.json identico', () => {
  const { dir, a } = conStato(() => {});
  const prima = leggiByte(dir, 'stato.json');
  const r = S.eseguiStrumento('ap_proponi', { motivo: 'serve', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'Leggi' } }] }, ctx(a, cl(['agenda'])));
  assert.strictEqual(r.stato, 'in_attesa');
  assert.ok(r.id);
  assert.strictEqual(r.anteprima.length, 1);
  assert.deepStrictEqual(Object.keys(r).sort(), ['anteprima', 'id', 'messaggio', 'stato']);
  assert.match(r.messaggio, /NON/);
  const lista = a.elencaProposte();
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].client, 'claude');
  assert.strictEqual(lista[0].id, r.id);
  assert.ok(leggiByte(dir, 'stato.json').equals(prima));
});

test('ap_proponi: operazione invalida o argomenti errati -> ErroreStrumento', () => {
  const { a } = conStato(() => {});
  const c = ctx(a, cl(['agenda']));
  assert.throws(() => S.eseguiStrumento('ap_proponi', { motivo: 'x', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: '' } }] }, c), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_proponi', { motivo: 'x', operazioni: [] }, c), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_proponi', { motivo: 5, operazioni: [{}] }, c), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_proponi', { operazioni: 'no' }, c), S.ErroreStrumento);
  assert.deepStrictEqual(a.elencaProposte(), []);
});

test('ap_stato_proposta: propria, altrui, inesistente', () => {
  const { a } = conStato(() => {});
  const mia = S.eseguiStrumento('ap_proponi', { motivo: 'm', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'A' } }] }, ctx(a, cl(['agenda'])));
  const st = S.eseguiStrumento('ap_stato_proposta', { id: mia.id }, ctx(a, cl(['agenda'])));
  assert.strictEqual(st.stato, 'in_attesa');
  assert.strictEqual(st.applicabile, true);
  assert.throws(() => S.eseguiStrumento('ap_stato_proposta', { id: mia.id }, ctx(a, cl(['agenda'], 'altro'))), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_stato_proposta', { id: 'nope' }, ctx(a, cl(['agenda']))), S.ErroreStrumento);
  assert.throws(() => S.eseguiStrumento('ap_stato_proposta', {}, ctx(a, cl(['agenda']))), S.ErroreStrumento);
  a.aggiornaProposta(mia.id, { stato: 'rifiutata' });
  const r = S.eseguiStrumento('ap_stato_proposta', { id: mia.id }, ctx(a, cl(['agenda'])));
  assert.strictEqual(r.stato, 'rifiutata');
  assert.ok(!('applicabile' in r));
});

test('ap_stato_proposta: obsoleta con motivi', () => {
  const { a } = conStato(s => { s.task.push({ id: 't1', nome: 'A', priorita: 5, tipo: 'altro', ambito: 'giorno', scadenza: OGGI, oraPromemoria: null, durataStimataMinuti: null, note: '', completata: false }); });
  const p = S.eseguiStrumento('ap_proponi', { motivo: 'm', operazioni: [{ tipo: 'task.modifica', id: 't1', dati: { nome: 'B' } }] }, ctx(a, cl(['agenda'])));
  const s2 = a.leggiStato(); s2.task[0].nome = 'cambiata'; a.scriviStato(s2);
  const r = S.eseguiStrumento('ap_stato_proposta', { id: p.id }, ctx(a, cl(['agenda'])));
  assert.strictEqual(r.applicabile, false);
  assert.ok(r.motivi.length > 0);
});

test('nessuna risposta espone hash o percorsi', () => {
  const { dir, a } = conStato(() => {});
  const c = ctx(a, cl(['agenda', 'diario']));
  const out = JSON.stringify([
    S.eseguiStrumento('ap_oggi', {}, c),
    S.eseguiStrumento('ap_leggi', { sezione: 'agenda' }, c),
    S.eseguiStrumento('ap_proponi', { motivo: 'm', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'A' } }] }, c),
  ]);
  assert.ok(!out.includes('HASHSEGRETO'));
  assert.ok(!out.includes(dir));
});

test('ap_proponi: tipo sconosciuto o operazione malformata -> elenco tipi validi', () => {
  const { a } = conStato(() => {});
  const c = ctx(a, cl(['agenda']));
  for (const op of [{ tipo: 'boh.fai', dati: {} }, null, {}, 'x', { tipo: '__proto__' }]) {
    let err;
    try { S.eseguiStrumento('ap_proponi', { motivo: 'm', operazioni: [op] }, c); } catch (e) { err = e; }
    assert.ok(err instanceof S.ErroreStrumento);
    assert.match(err.message, /Tipo di operazione sconosciuto/);
    assert.match(err.message, /Tipi validi: routine.aggiungi, routine.modifica, task.aggiungi/);
    assert.ok(!/permesso/.test(err.message));
  }
  assert.throws(() => S.eseguiStrumento('ap_proponi', { motivo: 'm', operazioni: [{ tipo: 'diario.imposta', dati: {} }] }, c), /permesso/);
});

test('ap_proponi: descrizione con esempi', () => {
  const d = S.STRUMENTI.find(t => t.name === 'ap_proponi').description;
  for (const k of ['task.aggiungi', 'diario.imposta', 'pasto.aggiungi', 'fattoBene', 'kcal']) assert.ok(d.includes(k), k);
});

test('ap_proponi: proposta mista -> errore e proposte.json invariato', () => {
  const { dir, a } = conStato(() => {});
  const ops = [{ tipo: 'task.aggiungi', dati: { nome: 'A' } }, { tipo: 'diario.imposta', dati: { data: OGGI } }];
  assert.throws(() => S.eseguiStrumento('ap_proponi', { motivo: 'm', operazioni: ops }, ctx(a, cl(['agenda']))), S.ErroreStrumento);
  assert.ok(!fs.existsSync(path.join(dir, 'proposte.json')));
});

test('ap_leggi: confini di sezione', () => {
  const { a } = conStato(s => { s.journal['2026-11-01'] = { voto: '7' }; });
  for (const sez of ['Diario', '__proto__', 'constructor', 5, null, ['diario']]) {
    assert.throws(() => S.eseguiStrumento('ap_leggi', { sezione: sez }, ctx(a, cl(['diario']))), S.ErroreStrumento, String(sez));
  }
  const ag = S.eseguiStrumento('ap_leggi', { sezione: 'agenda' }, ctx(a, cl(['agenda', 'diario'])));
  assert.deepStrictEqual(Object.keys(ag).sort(), [...Schema.SEZIONI.agenda].sort());
  assert.ok(!('journal' in ag) && !('impostazioniIA' in ag));
  assert.throws(() => S.eseguiStrumento('ap_leggi', { sezione: 'agenda' }, ctx(a, cl(['diario']))), S.ErroreStrumento);
  const di = S.eseguiStrumento('ap_leggi', { sezione: 'diario' }, ctx(a, cl(['diario'])));
  assert.deepStrictEqual(Object.keys(di), ['journal']);
  assert.throws(() => S.eseguiStrumento('ap_leggi', { sezione: 'diario' }, ctx(a, cl(['agenda']))), S.ErroreStrumento);
});

test('ap_leggi: nota se da/a non si applicano', () => {
  const { a } = conStato(() => {});
  const r = S.eseguiStrumento('ap_leggi', { sezione: 'obiettivi', da: '2026-11-01' }, ctx(a, cl(['obiettivi'])));
  assert.strictEqual(r.nota, 'da/a ignorati: questa sezione non ha date');
  const r2 = S.eseguiStrumento('ap_leggi', { sezione: 'obiettivi' }, ctx(a, cl(['obiettivi'])));
  assert.ok(!('nota' in r2));
  const r3 = S.eseguiStrumento('ap_leggi', { sezione: 'diario', da: '2026-11-01' }, ctx(a, cl(['diario'])));
  assert.ok(!('nota' in r3));
});

test('proposte.json corrotto -> messaggio senza percorsi', () => {
  const { dir, a } = conStato(() => {});
  fs.writeFileSync(path.join(dir, 'proposte.json'), '{non json');
  let err;
  try { S.eseguiStrumento('ap_stato_proposta', { id: 'x' }, ctx(a, cl(['agenda']))); } catch (e) { err = e; }
  assert.ok(err instanceof S.ErroreStrumento);
  assert.ok(!err.message.includes(dir) && !/proposte.json/.test(err.message));
});

test('ap_oggi: non espone log ne orarioFisso', () => {
  const { a } = conStato(s => { s.log[OGGI] = { completamenti: {} }; s.orarioFisso.push({ id: 'o1', giorno: 4, materia: 'X' }); });
  const r = S.eseguiStrumento('ap_oggi', {}, ctx(a, cl(['agenda'])));
  assert.deepStrictEqual(Object.keys(r).sort(), ['data', 'routine', 'task']);
  assert.ok(!JSON.stringify(r).includes('completamenti') && !JSON.stringify(r).includes('materia'));
});
