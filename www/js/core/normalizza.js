/**
 * core/normalizza.js
 * Tolleranza per i modelli piccoli (8B): prende un'operazione "sporca" (nomi di campo con accenti/sinonimi,
 * numeri scritti come testo, giorni in italiano, ore «14», date «domani»...) e la porta alla forma canonica
 * di core/operazioni.js. Non valida: dopo la normalizzazione serve comunque validaOperazione.
 * Regola: mai sovrascrivere un campo canonico già presente.
 * Modulo UMD: Node (module.exports) e browser (NucleoNormalizza).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./operazioni'));
  else root.NucleoNormalizza = factory(root.NucleoOperazioni);
})(typeof self !== 'undefined' ? self : this, function (NucleoOperazioni) {
  const OPERAZIONI = NucleoOperazioni.OPERAZIONI;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // minuscolo, senza accenti, solo lettere: confronto tollerante dei nomi
  const norm = (k) => String(k).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  // minuscolo senza accenti, mantiene cifre e spazi
  const semplice = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const SINONIMI = {
    scadenza: ['data', 'entro', 'deadline', 'duedate', 'giorno', 'quando'],
    nome: ['titolo', 'title', 'name', 'attivita', 'task', 'pasto', 'alimento', 'cibo'],
    titolo: ['nome', 'title', 'name', 'obiettivo'],
    priorita: ['priority', 'prio', 'importanza'],
    note: ['descrizione', 'description', 'nota'],
    descrizione: ['description', 'dettagli', 'note'],
    oraInizio: ['ora', 'orario', 'inizio', 'start', 'dalle', 'da', 'from', 'orainizio', 'coricato'],
    durataMinuti: ['durata', 'duration', 'minuti'],
    durataStimataMinuti: ['durata', 'duration', 'minuti'],
    oraPromemoria: ['promemoria', 'ora', 'orario'],
    giorni: ['giorno', 'giornata', 'weekday', 'day', 'days', 'ripeti', 'ripetizione', 'frequenza', 'quando'],
    oraFine: ['fine', 'alle', 'end', 'to', 'sveglia', 'svegliato', 'finisce'],
    fattoBene: ['bene', 'positivo', 'positivi'],
    daMigliorare: ['migliorare', 'negativo', 'negativi'],
    obiettivoDomani: ['domani', 'obiettivo'],
    voto: ['valutazione', 'punteggio', 'rating', 'votogiornata'],
    kcal: ['calorie', 'caloria', 'energia', 'kilocalorie'],
    proteine: ['proteina', 'protein', 'proteins'],
    carboidrati: ['carbo', 'carboidrato', 'carbs', 'carboidrat'],
    grassi: ['grasso', 'lipidi', 'fat', 'fats'],
    qualita: ['qualitasonno', 'riposo']
  };
  const CAMPI_NUMERICI = new Set(['priorita', 'durataMinuti', 'durataStimataMinuti', 'kcal', 'proteine', 'carboidrati', 'grassi', 'qualita']);
  const CAMPI_ORA = new Set(['oraInizio', 'oraFine', 'oraPromemoria']);
  const CAMPI_DATA = new Set(['scadenza', 'data']);
  const CAMPI_NULLABILI = new Set(['oraPromemoria', 'durataStimataMinuti', 'qualita']);
  // sinonimi di "ora di fine" per le routine, che non hanno oraFine ma durata
  const SINONIMI_FINE = new Set(['orafine', 'fine', 'alle', 'end', 'to', 'finisce', 'orafinale']);

  // ---------- date ----------
  function aggiungiGiorni(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekdayISO(iso) { const js = new Date(iso + 'T00:00:00Z').getUTCDay(); return js === 0 ? 7 : js; }
  function dataIsoValida(y, m, d) {
    const iso = String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    const dt = new Date(iso + 'T00:00:00Z');
    return !isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
  }

  // ---------- giorni della settimana ----------
  const PREFISSI_GIORNO = [['lun', 1], ['mar', 2], ['mer', 3], ['gio', 4], ['ven', 5], ['sab', 6], ['dom', 7],
    ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6], ['sun', 7]];
  function giornoDaParola(p) {
    for (const [pre, n] of PREFISSI_GIORNO) if (p.startsWith(pre)) return n;
    return null;
  }

  /** «lunedì-venerdì», «feriali», [1,3,5], «lun, mer e ven»... -> [1..7] ordinato; se non capisce, restituisce il valore com'è. */
  function normalizzaGiorni(valore) {
    let testo;
    if (typeof valore === 'number') testo = String(valore);
    else if (typeof valore === 'string') testo = valore;
    else if (Array.isArray(valore)) {
      if (!valore.every(x => typeof x === 'string' || typeof x === 'number')) return valore;
      testo = valore.join(',');
    } else return valore;
    let s = semplice(testo).replace(/[–—]/g, '-');
    const out = new Set();
    // gruppi
    const gruppi = [
      [/\b(tutti i giorni|ogni giorno|giornalier\w*|quotidian\w*|tutta la settimana|tutti)\b/g, [1, 2, 3, 4, 5, 6, 7]],
      [/\b(feriali|lavorativ\w*|infrasettimanal\w*|giorni feriali|giorni lavorativi)\b/g, [1, 2, 3, 4, 5]],
      [/\b(weekend|week-end|fine settimana|festivi)\b/g, [6, 7]]
    ];
    for (const [re, giorni] of gruppi) {
      if (re.test(s)) { giorni.forEach(g => out.add(g)); s = s.replace(re, ' '); }
    }
    const tok = s.match(/[a-z]+|\d+|-/g) || [];
    const elem = []; // {n} giorno, '-' o 'a' intervallo
    for (const t of tok) {
      if (/^\d+$/.test(t)) {
        const n = Number(t) === 0 ? 7 : Number(t);
        if (n < 1 || n > 7) return valore;
        elem.push({ n });
      } else if (t === '-' || t === 'a' || t === 'al' || t === 'fino') elem.push('-');
      else { const n = giornoDaParola(t); if (n) elem.push({ n }); }
    }
    for (let i = 0; i < elem.length; i++) {
      const e = elem[i];
      if (e === '-') continue;
      if (elem[i + 1] === '-' && elem[i + 2] && elem[i + 2] !== '-') {
        let a = e.n; const b = elem[i + 2].n;
        out.add(a);
        while (a !== b) { a = a === 7 ? 1 : a + 1; out.add(a); }
        i += 2;
      } else out.add(e.n);
    }
    if (!out.size) return valore;
    return [...out].sort((x, y) => x - y);
  }

  // ---------- orari ----------
  /** «14», «14.00», «14:00:00», «alle 9:5», «14h30» -> «HH:MM»; altrimenti com'è. */
  function normalizzaOra(v) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23) return String(v).padStart(2, '0') + ':00';
    if (typeof v !== 'string') return v;
    const m = /^\s*(?:alle|ore|h)?\s*(\d{1,2})(?:\s*[:.h]\s*(\d{1,2}))?(?:\s*[:.]\s*\d{1,2})?\s*(?:h|ore)?\s*$/i.exec(v);
    if (!m) return v;
    const h = Number(m[1]), mi = m[2] === undefined ? 0 : Number(m[2]);
    if (h > 23 || mi > 59) return v;
    return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
  }

  /** «14:00 alle 15:00», «14-15», «14:00-15:00» -> [inizio, fine] se contiene due orari. */
  function dividiIntervallo(v) {
    if (typeof v !== 'string') return null;
    const m = /^\s*(?:dalle|dal|da)?\s*(\d{1,2}(?:\s*[:.h]\s*\d{1,2})?(?::\d{2})?)\s*(?:-|–|—|a|alle|ore|fino alle|fino a)\s*(\d{1,2}(?:\s*[:.h]\s*\d{1,2})?(?::\d{2})?)\s*$/i.exec(v);
    if (!m) return null;
    const a = normalizzaOra(m[1]), b = normalizzaOra(m[2]);
    return /^\d\d:\d\d$/.test(a) && /^\d\d:\d\d$/.test(b) ? [a, b] : null;
  }

  const minuti = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

  /** «60», «1 ora», «90 min», «1h30», «2 ore» -> minuti interi; altrimenti com'è. */
  function normalizzaDurata(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : v;
    if (typeof v !== 'string') return v;
    const s = semplice(v).replace(',', '.');
    let m = /^(\d+)\s*h\s*(\d+)?\s*(?:m|min|minuti)?$/.exec(s);
    if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
    m = /^(\d+(?:\.\d+)?)\s*(?:ore|ora|h)$/.exec(s);
    if (m) return Math.round(Number(m[1]) * 60);
    m = /^(\d+(?:\.\d+)?)\s*(?:minuti|minuto|min|m|')?$/.exec(s);
    if (m) return Math.round(Number(m[1]));
    return v;
  }

  // ---------- numeri, priorità, voto ----------
  function numeroDaTesto(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : v;
    if (typeof v !== 'string') return v;
    const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(?:kcal|cal|g|gr|grammi|\/10|\/5)?\s*$/i.exec(v);
    return m ? Math.round(Number(m[1].replace(',', '.'))) : v;
  }
  function normalizzaPriorita(v) {
    if (typeof v === 'string') {
      const s = semplice(v);
      if (/^(alt[ao]|high|urgente|importante)$/.test(s)) return 8;
      if (/^(medi[ao]|normale|media|medium|standard)$/.test(s)) return 5;
      if (/^(bass[ao]|low|poco importante)$/.test(s)) return 2;
    }
    const n = numeroDaTesto(v);
    return typeof n === 'number' && Number.isInteger(n) ? Math.min(10, Math.max(1, n)) : n;
  }
  function normalizzaVoto(v) {
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string') return v;
    const s = v.trim().replace(',', '.').replace(/\s*\/\s*10$/, '');
    if (/^(10|[1-9])(-|\+|½)?$/.test(s)) return s;
    const m = /^(10|[1-9])(?:\.(\d+))?$/.exec(s);
    if (m) {
      const frac = m[2] ? Number('0.' + m[2]) : 0;
      if (frac === 0) return m[1];
      if (frac >= 0.4 && frac <= 0.6) return m[1] + '½';
      if (frac > 0 && frac < 0.4) return m[1] + '+';
      if (frac > 0.6 && Number(m[1]) < 10) return String(Number(m[1]) + 1) + '-';
    }
    return v;
  }

  // ---------- date relative ----------
  function normalizzaData(v, oggiISO) {
    if (typeof v !== 'string') return v;
    const s = semplice(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (!oggiISO) return v;
    const rel = { oggi: 0, domani: 1, dopodomani: 2, 'dopo domani': 2, ieri: -1, 'ieri l altro': -2, 'l altro ieri': -2, altroieri: -2 };
    const sp = s.replace(/[']/g, ' ').replace(/\s+/g, ' ');
    if (has(rel, sp)) return aggiungiGiorni(oggiISO, rel[sp]);
    let m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/.exec(s);
    if (m) {
      const anno = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(oggiISO.slice(0, 4));
      return dataIsoValida(anno, Number(m[2]), Number(m[1])) || v;
    }
    const g = giornoDaParola(sp.replace(/^(prossimo|questo|di|il)\s+/, ''));
    if (g && /^(prossimo |questo |di |il )?[a-z]+$/.test(sp) && !/^\d/.test(sp)) {
      let diff = (g - weekdayISO(oggiISO) + 7) % 7;
      if (diff === 0) diff = 7;
      return aggiungiGiorni(oggiISO, diff);
    }
    return v;
  }

  // ---------- tipi ----------
  function normalizzaTipoAttivita(v, stato) {
    if (typeof v !== 'string') return v;
    const t = norm(v);
    if (!t || t === 'altro') return 'altro';
    const tipi = (stato && stato.tipiAttivita) || [];
    const trovato = tipi.find(x => norm(x.id) === t || norm(x.nome) === t);
    if (trovato) return trovato.id;
    // sinonimi/parole chiave: «pranzo» -> pasto, «palestra» -> allenamento...
    const chiavi = (stato && stato.paroleChiaveTipi) || [];
    const k = chiavi.find(x => norm(x.parola) === t && tipi.some(y => y.id === x.tipoId));
    if (k) return k.tipoId;
    const parziale = tipi.find(x => t.length >= 4 && (norm(x.nome).startsWith(t) || t.startsWith(norm(x.nome))));
    return parziale ? parziale.id : 'altro';
  }
  function normalizzaTipoObiettivo(v) {
    if (typeof v !== 'string') return v;
    const t = norm(v);
    for (const c of ['concreto', 'generale', 'valoriale']) if (t && (t === c || c.startsWith(t.slice(0, 5)) && t.length >= 5)) return c;
    return v;
  }
  function normalizzaAmbitoObiettivo(v) {
    if (typeof v !== 'string') return v;
    const s = semplice(v).replace(/\s+/g, '');
    const m = /^(\d+)(mese|mesi|anno|anni)$/.exec(s);
    if (!m) return v;
    const r = m[1] + (m[2].startsWith('mes') ? (m[1] === '1' ? 'mese' : 'mesi') : (m[1] === '1' ? 'anno' : 'anni'));
    return ['1mese', '6mesi', '1anno', '5anni', '10anni'].includes(r) ? r : v;
  }
  function normalizzaAmbitoTask(v) {
    if (typeof v !== 'string') return v;
    const s = semplice(v);
    const mappa = { giorno: 'giorno', giornaliero: 'giorno', oggi: 'giorno', settimana: 'settimana', settimanale: 'settimana', mese: 'mese', mensile: 'mese', anno: 'anno', annuale: 'anno' };
    return has(mappa, s) ? mappa[s] : v;
  }

  // ---------- tipo di operazione ----------
  const ENTITA = ['routine', 'task', 'obiettivo', 'diario', 'pasto', 'sonno'];
  const VERBI = { aggiungi: 'aggiungi', aggiungere: 'aggiungi', crea: 'aggiungi', creare: 'aggiungi', nuovo: 'aggiungi', nuova: 'aggiungi', add: 'aggiungi', create: 'aggiungi', new: 'aggiungi', inserisci: 'aggiungi',
    modifica: 'modifica', modificare: 'modifica', aggiorna: 'modifica', cambia: 'modifica', update: 'modifica', edit: 'modifica',
    imposta: 'imposta', set: 'imposta', scrivi: 'imposta', registra: 'imposta', salva: 'imposta' };
  function normalizzaTipoOperazione(tipo) {
    if (typeof tipo !== 'string') return tipo;
    if (has(OPERAZIONI, tipo)) return tipo;
    const parti = semplice(tipo).split(/[^a-z]+/).filter(Boolean);
    const ent = ENTITA.find(e => parti.includes(e) || parti.includes(e + 's') || (e === 'obiettivo' && parti.includes('obiettivi')));
    if (!ent) return tipo;
    let verbo = null;
    for (const p of parti) if (has(VERBI, p)) { verbo = VERBI[p]; break; }
    let cand;
    if (ent === 'diario' || ent === 'sonno') cand = ent + '.imposta';
    else if (ent === 'pasto') cand = 'pasto.aggiungi';
    else cand = ent + '.' + (verbo === 'modifica' ? 'modifica' : 'aggiungi');
    return has(OPERAZIONI, cand) ? cand : tipo;
  }

  // ---------- elementi esistenti (id da nome) ----------
  function risolviId(def, op, stato) {
    if (!def.lista || !stato) return op.id;
    const lista = stato[def.lista] || [];
    if (typeof op.id === 'string' && lista.some(x => x.id === op.id)) return op.id;
    const cerca = [op.id, op.dati && (op.dati.nome || op.dati.titolo)].filter(x => typeof x === 'string' && x.trim());
    for (const c of cerca) {
      const n = norm(c);
      const esatti = lista.filter(x => norm(x.nome || x.titolo || '') === n);
      if (esatti.length === 1) return esatti[0].id;
    }
    return op.id;
  }

  /**
   * Normalizza un'operazione. opzioni (usate dalla chat):
   *  - tollerante: appiattisce i campi senza "dati", scarta i campi sconosciuti, data mancante = oggi, risolve gli id dal nome.
   */
  function normalizzaOperazione(op, stato, oggiISO, opzioni) {
    if (!isObj(op)) return op;
    const toll = !!(opzioni && opzioni.tollerante);
    const st = stato || {};
    if (typeof op.tipo === 'string') {
      const t = normalizzaTipoOperazione(op.tipo);
      if (t !== op.tipo) op = Object.assign({}, op, { tipo: t });
    }
    const def = OPERAZIONI[op.tipo];
    if (!def) return op;
    if (!def.richiedeId && ('id' in op || 'baseHash' in op)) { op = Object.assign({}, op); delete op.id; delete op.baseHash; } // un "aggiungi" non ha id
    if (toll && !isObj(op.dati)) {
      const resto = {};
      for (const [k, v] of Object.entries(op)) if (!['tipo', 'id', 'baseHash', 'dati'].includes(k)) resto[k] = v;
      op = Object.assign({ tipo: op.tipo }, def.richiedeId && 'id' in op ? { id: op.id } : {}, { dati: resto });
    }
    if (!isObj(op.dati)) return op;
    if (toll && def.richiedeId) { const id = risolviId(def, op, st); if (id !== op.id) op = Object.assign({}, op, { id }); }

    const canonici = Object.keys(def.campi(st, oggiISO));
    const eRoutine = op.tipo.startsWith('routine.');
    const out = {};
    const presenti = new Set(Object.keys(op.dati).filter(k => canonici.includes(k)));
    let fine;
    for (const [k, v] of Object.entries(op.dati)) {
      if (eRoutine && !canonici.includes(k) && SINONIMI_FINE.has(norm(k))) { if (fine === undefined) fine = v; continue; }
      let c = canonici.includes(k) ? k : canonici.find(x => norm(x) === norm(k));
      if (!c) c = canonici.find(x => (SINONIMI[x] || []).includes(norm(k)));
      if (c && c !== k && presenti.has(c)) c = null; // il campo giusto c'è già: il sinonimo resta e verrà rifiutato
      const chiave = c || k;
      if (c) presenti.add(c);
      if (c && has(out, c)) continue; // due sinonimi per lo stesso campo: vale il primo
      out[chiave] = v;
    }

    // normalizzazione dei valori (solo campi canonici)
    for (const k of Object.keys(out)) {
      if (!canonici.includes(k)) continue;
      let v = out[k];
      if (typeof v === 'string' && v.trim() === '' && !['descrizione', 'note', 'fattoBene', 'daMigliorare', 'obiettivoDomani'].includes(k)) v = CAMPI_NULLABILI.has(k) ? null : undefined;
      if (v === null && !CAMPI_NULLABILI.has(k)) v = undefined;
      if (v === undefined) { delete out[k]; continue; }
      if (v === null) { out[k] = null; continue; }
      if (k === 'giorni') v = normalizzaGiorni(v);
      else if (CAMPI_ORA.has(k)) {
        if (k === 'oraInizio' && eRoutine && fine === undefined) {
          const iv = dividiIntervallo(v);
          if (iv) { v = iv[0]; fine = iv[1]; }
        }
        if (k === 'oraInizio' && op.tipo === 'sonno.imposta' && out.oraFine === undefined) {
          const iv = dividiIntervallo(v);
          if (iv) { v = iv[0]; out.oraFine = iv[1]; }
        }
        v = normalizzaOra(v);
      }
      else if (CAMPI_DATA.has(k)) v = normalizzaData(v, oggiISO);
      else if (k === 'priorita') v = normalizzaPriorita(v);
      else if (k === 'durataMinuti' || k === 'durataStimataMinuti') v = normalizzaDurata(v);
      else if (CAMPI_NUMERICI.has(k)) v = numeroDaTesto(v);
      else if (k === 'voto') v = normalizzaVoto(v);
      else if (k === 'tipo') {
        if (op.tipo.startsWith('obiettivo.')) v = normalizzaTipoObiettivo(v);
        else v = normalizzaTipoAttivita(v, st);
      } else if (k === 'ambito') v = op.tipo.startsWith('obiettivo.') ? normalizzaAmbitoObiettivo(v) : normalizzaAmbitoTask(v);
      out[k] = v;
    }

    // routine: ora di fine -> durata (solo se la durata non c'è già e la fine viene dopo l'inizio)
    if (eRoutine && fine !== undefined && !has(out, 'durataMinuti')) {
      const a = out.oraInizio, b = normalizzaOra(fine);
      if (typeof a === 'string' && /^\d\d:\d\d$/.test(a) && typeof b === 'string' && /^\d\d:\d\d$/.test(b) && minuti(b) > minuti(a)) {
        out.durataMinuti = minuti(b) - minuti(a);
      }
    }
    if (toll) {
      for (const k of Object.keys(out)) if (!canonici.includes(k)) delete out[k];
      if (canonici.includes('data') && !has(out, 'data') && oggiISO && (op.tipo === 'diario.imposta' || op.tipo === 'pasto.aggiungi' || op.tipo === 'sonno.imposta')) out.data = oggiISO;
    }
    return Object.assign({}, op, { dati: out });
  }

  return {
    SINONIMI, CAMPI_NUMERICI, norm,
    normalizzaOperazione, normalizzaGiorni, normalizzaOra, normalizzaDurata, normalizzaData,
    normalizzaPriorita, normalizzaVoto, normalizzaTipoAttivita, normalizzaTipoOperazione
  };
});
