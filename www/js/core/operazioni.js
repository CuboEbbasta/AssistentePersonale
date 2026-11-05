/**
 * core/operazioni.js
 * Operazioni su stato: validazione e applicazione. Modulo UMD: Node (module.exports) e browser (NucleoOperazioni).
 * Le regole replicano quelle dei form dell'app (file citati accanto a ciascuna), senza cambiarle.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./schema'));
  else root.NucleoOperazioni = factory(root.NucleoSchema);
})(typeof self !== 'undefined' ? self : this, function (NucleoSchema) {

  const CHIAVI_VIETATE = ['__proto__', 'constructor', 'prototype'];
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // ---------- Validatori elementari: ritornano null se ok, altrimenti il messaggio ----------
  const isStr = (v) => typeof v === 'string';
  const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

  function dataValida(v) {
    if (!isStr(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }
  function oraValida(v) { return isStr(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v); }
  function oraAMinuti(v) { const [h, m] = v.split(':').map(Number); return h * 60 + m; }

  const vNomeNonVuoto = (etichetta) => (v) => (isStr(v) && v.trim() ? null : etichetta + ' obbligatorio');
  const vTesto = (v) => (isStr(v) ? null : 'deve essere testo');
  const vData = (v) => (dataValida(v) ? null : 'data non valida (YYYY-MM-DD)');
  const vOra = (v) => (oraValida(v) ? null : 'orario non valido (HH:MM)');
  // ui-routine.js / ui-task.js: slider priorita min=1 max=10
  const vPriorita = (v) => (isInt(v) && v >= 1 && v <= 10 ? null : 'priorita deve essere un intero da 1 a 10');
  // ui-routine.js: giorni 1..7 (1=Lunedi), DataUtils.NOMI_GIORNI; almeno uno, senza doppioni
  const vGiorni = (v) => (Array.isArray(v) && v.length >= 1 && v.every(isInt) && v.every(g => g >= 1 && g <= 7) && new Set(v).size === v.length
    ? null : 'giorni deve essere una lista non vuota di interi unici da 1 a 7');
  // ui-routine.js: durataMinuti = Math.max(5, ...)
  const vDurataRoutine = (v) => (isInt(v) && v >= 5 ? null : 'durataMinuti deve essere un intero >= 5');
  // ui-task.js: durata stimata facoltativa
  const vDurataTask = (v) => (v === null || (isInt(v) && v >= 1) ? null : 'durataStimataMinuti deve essere null o un intero >= 1');
  const vOraOpz = (v) => (v === null ? null : vOra(v));
  // ui-task.js: cascade.js ordine delle task
  const vAmbitoTask = (v) => (['giorno', 'settimana', 'mese', 'anno'].includes(v) ? null : 'ambito task non valido');
  // ui-obiettivi.js: ETICHETTE_TIPO e cascade.js ordine degli obiettivi
  const vTipoObiettivo = (v) => (['concreto', 'generale', 'valoriale'].includes(v) ? null : 'tipo obiettivo non valido');
  const vAmbitoObiettivo = (v) => (['1mese', '6mesi', '1anno', '5anni', '10anni'].includes(v) ? null : 'ambito obiettivo non valido');
  // ui-obiettivi.js: attivitaCollegate = ["routine:ID"|"task:ID"]
  const vCollegate = (v) => (Array.isArray(v) && v.every(x => isStr(x) && /^(routine|task):.+/.test(x)) ? null : 'attivitaCollegate non valide');

  // ui-tipi.js / schema: 'altro' oppure l'id di un tipo esistente
  function vTipoAttivita(stato) {
    return (v) => (isStr(v) && (v === 'altro' || (stato.tipiAttivita || []).some(t => t.id === v)) ? null : 'tipo attivita inesistente');
  }

  // ui-dieta.js validaValoriPasto: tutto a zero no, negativi no, kcal > 5000 no
  function erroriPasto(d) {
    const e = [];
    ['kcal', 'proteine', 'carboidrati', 'grassi'].forEach(k => { if (!isInt(d[k])) e.push(k + ' deve essere un intero'); });
    if (e.length) return e;
    if (d.kcal === 0 && d.proteine === 0 && d.carboidrati === 0 && d.grassi === 0) e.push('un pasto non puo essere tutto a 0');
    if (d.kcal < 0 || d.proteine < 0 || d.carboidrati < 0 || d.grassi < 0) e.push('i valori del pasto non possono essere negativi');
    if (d.kcal > 5000) e.push('kcal troppo alte per un singolo pasto');
    return e;
  }

  // ui-journal.js MODIFICATORI / costruisciVoto: base 1-10 + '-', '', '+', '½'
  const DELTA_VOTO = { '-': -0.25, '': 0, '+': 0.25, '½': 0.5 };
  const MODIFICATORE_ID = { '-': 'meno', '': 'pieno', '+': 'piu', '½': 'mezzo' };
  function parseVoto(v) {
    const m = isStr(v) ? /^(10|[1-9])(-|\+|½)?$/.exec(v) : null;
    if (!m) return null;
    const base = parseInt(m[1], 10), sim = m[2] || '';
    return { base, modificatore: MODIFICATORE_ID[sim], testo: v, numerico: Math.min(10, base + DELTA_VOTO[sim]) };
  }

  // ui-sonno.js calcolaOreDormite: attraversa la mezzanotte; plausibile solo 1-16 ore
  function oreDormite(inizio, fine) {
    let diff = oraAMinuti(fine) - oraAMinuti(inizio);
    if (diff <= 0) diff += 24 * 60;
    return Math.round((diff / 60) * 10) / 10;
  }

  // ---------- Tabella delle operazioni ----------
  // campi: nome -> validatore (o funzione(stato) che lo produce); richiesti: obbligatori in "aggiungi"
  // (per "imposta" sono tutti obbligatori salvo quelli in `opzionali`).
  const OPERAZIONI = {
    'routine.aggiungi': {
      sezione: 'agenda', richiedeId: false,
      campi: (s) => ({ nome: vNomeNonVuoto('nome'), descrizione: vTesto, tipo: vTipoAttivita(s), oraInizio: vOra, durataMinuti: vDurataRoutine, priorita: vPriorita, giorni: vGiorni }),
      richiesti: ['nome', 'oraInizio', 'giorni'],
      extra: (s, op) => {
        // ui-routine.js: puo esistere una sola routine di tipo "diario"
        return op.dati.tipo === 'diario' && s.routine.some(r => r.tipo === 'diario') ? ['esiste gia una routine di tipo diario'] : [];
      },
      applica: (s, op, ctx) => {
        s.routine.push(Object.assign({ id: ctx.generaId('routine'), nome: '', descrizione: '', tipo: 'altro', oraInizio: '08:00', durataMinuti: 30, priorita: 5, giorni: [1, 2, 3, 4, 5, 6, 7], attiva: true }, op.dati));
      }
    },
    'routine.modifica': {
      sezione: 'agenda', richiedeId: true, lista: 'routine',
      campi: (s) => ({ nome: vNomeNonVuoto('nome'), descrizione: vTesto, tipo: vTipoAttivita(s), oraInizio: vOra, durataMinuti: vDurataRoutine, priorita: vPriorita, giorni: vGiorni }),
      extra: (s, op, bers) => {
        return op.dati.tipo === 'diario' && s.routine.some(r => r.tipo === 'diario' && r.id !== bers.id) ? ['esiste gia una routine di tipo diario'] : [];
      }
    },
    'task.aggiungi': {
      sezione: 'agenda', richiedeId: false,
      campi: (s, oggi) => ({
        nome: vNomeNonVuoto('nome'), priorita: vPriorita, tipo: vTipoAttivita(s), ambito: vAmbitoTask,
        // ui-task.js: una task non puo mai avere scadenza nel passato (min=oggi)
        scadenza: (v) => vData(v) || (v < oggi ? 'la scadenza non puo essere nel passato' : null),
        oraPromemoria: vOraOpz, durataStimataMinuti: vDurataTask, note: vTesto
      }),
      richiesti: ['nome'],
      applica: (s, op, ctx) => {
        s.task.push(Object.assign({ id: ctx.generaId('task'), nome: '', priorita: 5, tipo: 'altro', ambito: 'giorno', scadenza: ctx.oggiISO, oraPromemoria: null, durataStimataMinuti: null, note: '', completata: false }, op.dati));
      }
    },
    'task.modifica': {
      sezione: 'agenda', richiedeId: true, lista: 'task',
      campi: (s, oggi) => OPERAZIONI['task.aggiungi'].campi(s, oggi)
    },
    'obiettivo.aggiungi': {
      sezione: 'obiettivi', richiedeId: false,
      campi: () => ({ titolo: vNomeNonVuoto('titolo'), tipo: vTipoObiettivo, ambito: vAmbitoObiettivo, scadenza: vData, descrizione: vTesto, attivitaCollegate: vCollegate }),
      richiesti: ['titolo', 'tipo'],
      applica: (s, op, ctx) => {
        s.obiettivi.push(Object.assign({ id: ctx.generaId('obiettivo'), titolo: '', tipo: 'concreto', ambito: '1anno', scadenza: ctx.oggiISO, descrizione: '', completato: false, attivitaCollegate: [], tappe: [] }, op.dati));
      }
    },
    'obiettivo.modifica': {
      sezione: 'obiettivi', richiedeId: true, lista: 'obiettivi',
      campi: () => OPERAZIONI['obiettivo.aggiungi'].campi()
    },
    'diario.imposta': {
      sezione: 'diario', richiedeId: false, chiave: 'journal',
      // ui-journal.js: non si scrive nel futuro (vaiA limita a oggi)
      campi: (s, oggi) => ({
        data: (v) => vData(v) || (v > oggi ? 'non si puo scrivere il diario nel futuro' : null),
        fattoBene: vTesto, daMigliorare: vTesto, obiettivoDomani: vTesto,
        voto: (v) => (parseVoto(v) ? null : 'voto non valido (da 1 a 10 con - + o ½)')
      }),
      tutti: true,
      applica: (s, op) => {
        const d = op.dati, v = parseVoto(d.voto);
        s.journal[d.data] = { fattoBene: d.fattoBene.trim(), daMigliorare: d.daMigliorare.trim(), obiettivoDomani: d.obiettivoDomani.trim(), voto: v.testo, votoNumerico: v.numerico, votoBase: v.base, votoModificatore: v.modificatore };
      }
    },
    'pasto.aggiungi': {
      sezione: 'dieta', richiedeId: false,
      campi: (s, oggi) => ({
        data: (v) => vData(v) || (v > oggi ? 'non si registra un pasto nel futuro' : null),
        nome: vNomeNonVuoto('nome'), kcal: () => null, proteine: () => null, carboidrati: () => null, grassi: () => null
      }),
      tutti: true,
      extra: (s, op) => erroriPasto(op.dati),
      applica: (s, op) => {
        const d = op.dati;
        if (!s.dietaLog[d.data]) s.dietaLog[d.data] = { pasti: [] };
        s.dietaLog[d.data].pasti.push({ nome: d.nome.trim(), kcal: d.kcal, proteine: d.proteine, carboidrati: d.carboidrati, grassi: d.grassi, fonte: 'libero' });
      }
    },
    'sonno.imposta': {
      sezione: 'sonno', richiedeId: false, chiave: 'sonnoLog',
      campi: (s, oggi) => ({
        data: (v) => vData(v) || (v > oggi ? 'non si registra il sonno nel futuro' : null),
        oraInizio: vOra, oraFine: vOra,
        // ui-sonno.js: qualita 1-5 facoltativa
        qualita: (v) => (v === null || (isInt(v) && v >= 1 && v <= 5) ? null : 'qualita deve essere null o un intero da 1 a 5')
      }),
      tutti: true, opzionali: ['qualita'],
      extra: (s, op) => {
        const d = op.dati;
        if (!oraValida(d.oraInizio) || !oraValida(d.oraFine)) return [];
        const ore = oreDormite(d.oraInizio, d.oraFine);
        return ore < 1 || ore > 16 ? ['ore dormite non plausibili (' + ore + ' h)'] : [];
      },
      applica: (s, op) => {
        const d = op.dati;
        s.sonnoLog[d.data] = { oraInizio: d.oraInizio, oraFine: d.oraFine, oreDormite: oreDormite(d.oraInizio, d.oraFine), qualita: d.qualita === undefined ? null : d.qualita };
      }
    }
  };

  function def(tipo) { return isStr(tipo) && has(OPERAZIONI, tipo) ? OPERAZIONI[tipo] : null; }

  function sezioneDi(tipo) { const d = def(tipo); return d ? d.sezione : null; }

  // ---------- Hash (FNV-1a 32 bit su JSON con chiavi ordinate) ----------
  function ordina(v) {
    if (Array.isArray(v)) return v.map(ordina);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = ordina(v[k]); }); return o; }
    return v === undefined ? null : v;
  }
  function hashRecord(valore) {
    const s = JSON.stringify(ordina(valore));
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  function bersaglio(stato, op) {
    const d = op && def(op.tipo);
    if (!d) return null;
    if (d.lista) return (stato[d.lista] || []).find(x => x.id === op.id) || null;
    if (d.chiave && op.dati && isStr(op.dati.data) && has(stato[d.chiave] || {}, op.dati.data)) return stato[d.chiave][op.dati.data];
    return null;
  }

  function chiaviVietate(v, prof) {
    if (!v || typeof v !== 'object' || prof > 8) return false;
    return Object.getOwnPropertyNames(v).some(k => CHIAVI_VIETATE.includes(k) || chiaviVietate(v[k], prof + 1));
  }

  function validaOperazione(stato, op, oggiISO) {
    const errori = [];
    if (!op || typeof op !== 'object') return { ok: false, errori: ['operazione mancante'] };
    const d = def(op.tipo);
    if (!d) return { ok: false, errori: ['tipo di operazione non ammesso'] };
    if (!op.dati || typeof op.dati !== 'object' || Array.isArray(op.dati)) return { ok: false, errori: ['dati mancanti'] };
    if (chiaviVietate(op.dati, 0)) return { ok: false, errori: ['dati con chiavi vietate'] };

    let bers = null;
    if (d.richiedeId) {
      bers = bersaglio(stato, op);
      if (!bers) errori.push('elemento da modificare non trovato');
      else if (op.baseHash !== undefined && op.baseHash !== hashRecord(bers)) errori.push('l\'elemento e cambiato dopo la proposta (baseHash)');
    }

    const campi = d.campi(stato, oggiISO);
    Object.keys(op.dati).forEach(k => {
      if (!has(campi, k)) { errori.push('campo non ammesso: ' + k); return; }
      const e = campi[k](op.dati[k]);
      if (e) errori.push(k + ': ' + e);
    });
    const richiesti = d.tutti ? Object.keys(campi).filter(k => !(d.opzionali || []).includes(k)) : (d.richiesti || []);
    richiesti.forEach(k => { if (!has(op.dati, k)) errori.push('campo obbligatorio mancante: ' + k); });
    if (d.richiedeId && !d.richiesti && Object.keys(op.dati).length === 0) errori.push('nessun campo da modificare');

    if (d.extra && !errori.length) errori.push(...d.extra(stato, op, bers));
    return { ok: errori.length === 0, errori };
  }

  function clona(v) { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }

  function applicaOperazione(stato, op, ctx) {
    const r = validaOperazione(stato, op, ctx.oggiISO);
    if (!r.ok) throw new Error('Operazione non valida: ' + r.errori.join('; '));
    const d = def(op.tipo);
    const copia = clona(stato);
    if (d.richiedeId) {
      Object.assign(copia[d.lista].find(x => x.id === op.id), clona(op.dati));
    } else {
      d.applica(copia, { tipo: op.tipo, dati: clona(op.dati) }, ctx);
    }
    return copia;
  }

  return { OPERAZIONI, sezioneDi, hashRecord, bersaglio, validaOperazione, applicaOperazione };
});
