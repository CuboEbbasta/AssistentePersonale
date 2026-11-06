'use strict';
/**
 * Strumenti condivisi dell'assistente (CommonJS, solo libreria standard).
 * Quattro strumenti, pochi e semplici per i modelli piccoli.
 * Non scrivono mai stato.json: le modifiche passano da proposte.json.
 */
const crypto = require('node:crypto');
const Schema = require('../www/js/core/schema.js');
const Operazioni = require('../www/js/core/operazioni.js');
const Proposte = require('../www/js/core/proposte.js');
const Permessi = require('./permessi.js');

class ErroreStrumento extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreStrumento';
  }
}

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const MS_GIORNO = 86400000;
const MAX_IN_ATTESA = 50; // proposte in attesa per client

// Chiavi dello stato indicizzate per data (YYYY-MM-DD)
const CHIAVI_PER_DATA = ['journal', 'dietaLog', 'workoutLog', 'sonnoLog', 'log'];

const STRUMENTI = [
  {
    name: 'ap_oggi',
    description: 'Mostra cosa c\'e da fare oggi: le routine di oggi e le task da fare oggi o in ritardo. Non servono parametri.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'ap_leggi',
    description: 'Legge i dati di una sezione dell\'assistente personale (agenda, obiettivi, diario, dieta, workout, sonno). Si possono limitare le date con da e a (formato AAAA-MM-GG).',
    inputSchema: {
      type: 'object',
      properties: {
        sezione: { type: 'string', enum: Object.keys(Schema.SEZIONI), description: 'Sezione da leggere' },
        da: { type: 'string', description: 'Prima data inclusa, AAAA-MM-GG (facoltativa)' },
        a: { type: 'string', description: 'Ultima data inclusa, AAAA-MM-GG (facoltativa)' },
      },
      required: ['sezione'],
      additionalProperties: false,
    },
  },
  {
    name: 'ap_proponi',
    description: 'Propone modifiche all\'assistente personale. Non modifica nulla subito: l\'utente deve approvare la proposta. Ogni operazione ha tipo, dati e, per le modifiche, l\'id dell\'elemento. Esempi: '
      + '{"tipo":"task.aggiungi","dati":{"nome":"Leggere","scadenza":"2026-11-10"}} (obbligatorio: nome); '
      + '{"tipo":"diario.imposta","dati":{"data":"2026-11-05","fattoBene":"...","daMigliorare":"...","obiettivoDomani":"...","voto":"7+"}} (tutti i campi obbligatori); '
      + '{"tipo":"pasto.aggiungi","dati":{"data":"2026-11-05","nome":"Pasta","kcal":600,"proteine":20,"carboidrati":90,"grassi":15}} (tutti obbligatori, numeri interi).',
    inputSchema: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Perche proponi queste modifiche' },
        operazioni: {
          type: 'array',
          description: 'Elenco di operazioni da proporre',
          items: {
            type: 'object',
            properties: {
              tipo: { type: 'string', enum: Object.keys(Operazioni.OPERAZIONI), description: 'Tipo di operazione' },
              id: { type: 'string', description: 'Id dell\'elemento (solo per le modifiche)' },
              dati: { type: 'object', description: 'Campi da impostare' },
            },
            required: ['tipo', 'dati'],
            additionalProperties: false,
          },
        },
      },
      required: ['motivo', 'operazioni'],
      additionalProperties: false,
    },
  },
  {
    name: 'ap_stato_proposta',
    description: 'Dice a che punto e una proposta che hai fatto (in attesa, applicata, rifiutata) e se si puo ancora applicare.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Id della proposta' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

function dataValida(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function giorniTra(daISO, aISO) {
  return Math.round((Date.parse(aISO + 'T00:00:00Z') - Date.parse(daISO + 'T00:00:00Z')) / MS_GIORNO);
}

function weekdayISO(iso) {
  const js = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0=domenica
  return js === 0 ? 7 : js;
}

// Stesse regole di cascade.js (task): anno > mese > settimana > giorno
const ORDINE_AMBITO = ['anno', 'mese', 'settimana', 'giorno'];
const SOGLIE_AMBITO = { anno: 31, mese: 7, settimana: 1 };
function ambitoEffettivo(ambito, giorniMancanti) {
  let i = ORDINE_AMBITO.indexOf(ambito);
  if (i === -1) i = ORDINE_AMBITO.length - 1;
  while (i < ORDINE_AMBITO.length - 1 && giorniMancanti <= SOGLIE_AMBITO[ORDINE_AMBITO[i]]) i++;
  return ORDINE_AMBITO[i];
}

function richiediSezione(client, sezione) {
  if (!Array.isArray(client.sezioni) || !client.sezioni.includes(sezione)) {
    throw new ErroreStrumento('Non hai il permesso di usare la sezione «' + sezione + '».');
  }
}

function apOggi(args, ctx) {
  richiediSezione(ctx.client, 'agenda');
  const stato = ctx.archivio.leggiStato();
  const oggi = ctx.oggiISO;
  const giorno = weekdayISO(oggi);
  const routine = (stato.routine || [])
    .filter(r => r.attiva !== false && Array.isArray(r.giorni) && r.giorni.includes(giorno))
    .map(r => ({ id: r.id, nome: r.nome, oraInizio: r.oraInizio, durataMinuti: r.durataMinuti, priorita: r.priorita }))
    .sort((a, b) => String(a.oraInizio).localeCompare(String(b.oraInizio)));
  const task = (stato.task || [])
    .filter(t => !t.completata && dataValida(t.scadenza))
    .map(t => ({ t, mancanti: giorniTra(oggi, t.scadenza) }))
    .filter(x => x.mancanti < 0 || ambitoEffettivo(x.t.ambito, x.mancanti) === 'giorno')
    .map(({ t, mancanti }) => ({
      id: t.id, nome: t.nome, priorita: t.priorita, scadenza: t.scadenza,
      oraPromemoria: t.oraPromemoria || null, scaduta: mancanti < 0,
    }));
  return { data: oggi, routine, task };
}

function apLeggi(args, ctx) {
  const sezione = args.sezione;
  if (typeof sezione !== 'string' || !has(Schema.SEZIONI, sezione)) throw new ErroreStrumento('Sezione non valida.');
  richiediSezione(ctx.client, sezione);
  const { da, a } = args;
  if (da !== undefined && !dataValida(da)) throw new ErroreStrumento('La data «da» non e valida (usa AAAA-MM-GG).');
  if (a !== undefined && !dataValida(a)) throw new ErroreStrumento('La data «a» non e valida (usa AAAA-MM-GG).');
  if (da !== undefined && a !== undefined && da > a) throw new ErroreStrumento('La data «da» deve venire prima di «a».');
  const vista = Permessi.vistaStato(ctx.archivio.leggiStato(), [sezione]);
  if (da === undefined && a === undefined) return vista;
  if (!CHIAVI_PER_DATA.some(k => Schema.SEZIONI[sezione].includes(k))) {
    vista.nota = 'da/a ignorati: questa sezione non ha date';
    return vista;
  }
  for (const k of CHIAVI_PER_DATA) {
    if (!has(vista, k) || !isObj(vista[k])) continue;
    const filtrato = {};
    for (const d of Object.keys(vista[k])) {
      if ((da === undefined || d >= da) && (a === undefined || d <= a)) filtrato[d] = vista[k][d];
    }
    vista[k] = filtrato;
  }
  return vista;
}

function apProponi(args, ctx) {
  const { motivo, operazioni } = args;
  if (typeof motivo !== 'string') throw new ErroreStrumento('Il motivo deve essere un testo.');
  if (!Array.isArray(operazioni) || operazioni.length === 0) throw new ErroreStrumento('Serve almeno un\'operazione.');
  const tipiValidi = Object.keys(Operazioni.OPERAZIONI);
  operazioni.forEach((op, i) => {
    if (!op || typeof op !== 'object' || Operazioni.sezioneDi(op.tipo) === null) {
      const tipo = op && typeof op === 'object' && typeof op.tipo === 'string' ? op.tipo.slice(0, 60) : '(mancante)';
      throw new ErroreStrumento('Tipo di operazione sconosciuto: ' + tipo + '. Tipi validi: ' + tipiValidi.join(', '));
    }
    if (!Permessi.puoProporre(ctx.client, op)) {
      throw new ErroreStrumento('Operazione ' + (i + 1) + ': non hai il permesso di proporre questa modifica.');
    }
  });
  const inAttesa = ctx.archivio.elencaProposte().filter(x => x && x.client === ctx.client.nome && x.stato === 'in_attesa').length;
  if (inAttesa >= MAX_IN_ATTESA) {
    throw new ErroreStrumento('Hai già ' + inAttesa + ' proposte in attesa (massimo ' + MAX_IN_ATTESA + '): aspetta che vengano approvate o rifiutate nell app prima di proporne altre.');
  }
  const r = Proposte.creaProposta(
    { client: ctx.client.nome, motivo, operazioni },
    ctx.archivio.leggiStato(), ctx.oggiISO, ctx.adessoISO,
    (prefisso) => prefisso + '_' + crypto.randomUUID()
  );
  if (!r.ok) throw new ErroreStrumento('Proposta non valida: ' + r.errori.join('; '));
  ctx.archivio.aggiungiProposta(r.proposta);
  return {
    id: r.proposta.id, stato: 'in_attesa', anteprima: r.proposta.anteprima,
    messaggio: 'Proposta inviata: la modifica NON è ancora applicata, l\'utente deve approvarla nell\'app. Usa ap_stato_proposta con questo id per controllare.',
  };
}

function apStatoProposta(args, ctx) {
  if (typeof args.id !== 'string' || !args.id) throw new ErroreStrumento('Serve l\'id della proposta.');
  const p = ctx.archivio.elencaProposte().find(x => x && x.id === args.id && x.client === ctx.client.nome);
  if (!p) throw new ErroreStrumento('Proposta non trovata.');
  const out = { id: p.id, stato: p.stato };
  if (p.stato === 'in_attesa') {
    const c = Proposte.controllaApplicabile(ctx.archivio.leggiStato(), p, ctx.oggiISO);
    out.applicabile = c.stato === 'applicabile';
    if (!out.applicabile) out.motivi = c.motivi;
  }
  return out;
}

const ESECUTORI = { ap_oggi: apOggi, ap_leggi: apLeggi, ap_proponi: apProponi, ap_stato_proposta: apStatoProposta };

function eseguiStrumento(nome, args, ctx) {
  if (typeof nome !== 'string' || !has(ESECUTORI, nome)) throw new ErroreStrumento('Strumento sconosciuto.');
  if (args === undefined || args === null) args = {};
  if (!isObj(args)) throw new ErroreStrumento('Gli argomenti devono essere un oggetto.');
  const schema = STRUMENTI.find(t => t.name === nome).inputSchema;
  for (const k of Object.keys(args)) {
    if (!has(schema.properties, k)) throw new ErroreStrumento('Argomento non previsto: ' + k + '.');
  }
  try {
    return ESECUTORI[nome](args, ctx);
  } catch (e) {
    if (e instanceof ErroreStrumento) throw e;
    throw new ErroreStrumento('Operazione non riuscita. Riprova piu tardi.');
  }
}

module.exports = { STRUMENTI, eseguiStrumento, ErroreStrumento };
