/**
 * core/assistente.js
 * Logica PURA dell'assistente integrato (chat «Altro → Assistente IA»): prompt di sistema per modelli piccoli,
 * estrazione tollerante del JSON, normalizzazione e creazione della proposta. Nessun accesso a rete o DOM:
 * la usano ui-ia.js e scripts/valuta-assistente.js (stesse funzioni nell'app e nella valutazione).
 * Modulo UMD: Node (module.exports) e browser (NucleoAssistente).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./operazioni'), require('./proposte'), require('./normalizza'));
  else root.NucleoAssistente = factory(root.NucleoOperazioni, root.NucleoProposte, root.NucleoNormalizza);
})(typeof self !== 'undefined' ? self : this, function (NucleoOperazioni, NucleoProposte, NucleoNormalizza) {
  const OPERAZIONI = NucleoOperazioni.OPERAZIONI;
  const CLIENT = 'assistente-app';
  const MAX_MESSAGGI = 6;
  const GIORNI_ESTESI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
  const GIORNI_BREVI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

  function aggiungiGiorni(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function weekdayISO(iso) { const js = new Date(iso + 'T00:00:00Z').getUTCDay(); return js === 0 ? 7 : js; }
  const taglia = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

  // ---------- elenco delle operazioni (ricavato da operazioni.js: non si disallinea) ----------
  const FORMATO = {
    nome: 'testo', titolo: 'testo', descrizione: 'testo', note: 'testo',
    oraInizio: '"HH:MM"', oraFine: '"HH:MM"', oraPromemoria: '"HH:MM"',
    durataMinuti: 'minuti, numero', durataStimataMinuti: 'minuti, numero',
    priorita: 'da 1 a 10', giorni: 'lista, 1=lunedì … 7=domenica',
    scadenza: '"AAAA-MM-GG"', data: '"AAAA-MM-GG"',
    fattoBene: 'testo', daMigliorare: 'testo', obiettivoDomani: 'testo',
    voto: '"7", "7+", "7-" o "7½" (da 1 a 10)',
    kcal: 'intero', proteine: 'intero', carboidrati: 'intero', grassi: 'intero',
    qualita: 'da 1 a 5', attivitaCollegate: 'lista, es. ["task:ID"]'
  };
  function formatoCampo(tipoOp, campo, stato) {
    if (campo === 'tipo') {
      if (tipoOp.startsWith('obiettivo.')) return 'concreto, generale o valoriale';
      const ids = ['altro'].concat(((stato && stato.tipiAttivita) || []).map(t => t.id));
      return ids.join(', ');
    }
    if (campo === 'ambito') return tipoOp.startsWith('obiettivo.') ? '1mese, 6mesi, 1anno, 5anni o 10anni' : 'giorno, settimana, mese o anno';
    return FORMATO[campo] || 'valore';
  }
  function campiDi(tipo, stato, oggiISO) {
    const d = OPERAZIONI[tipo];
    const tutti = Object.keys(d.campi(stato, oggiISO));
    const obbligatori = d.tutti ? tutti.filter(k => !(d.opzionali || []).includes(k)) : (d.richiesti || []);
    return { tutti, obbligatori };
  }
  /** Una riga per operazione, con i nomi ESATTI dei campi ricavati dinamicamente da operazioni.js. */
  function descriviOperazioni(stato, oggiISO) {
    return Object.keys(OPERAZIONI).map(tipo => {
      const d = OPERAZIONI[tipo];
      const { tutti, obbligatori } = campiDi(tipo, stato, oggiISO);
      const campi = tutti.map(k => k + (obbligatori.includes(k) ? '*' : '') + ' (' + formatoCampo(tipo, k, stato) + ')').join(', ');
      return '- ' + tipo + (d.richiedeId ? ' [serve "id"; in dati metti SOLO i campi da cambiare]' : '') + ': ' + campi;
    }).join('\n');
  }

  // ---------- contesto compatto ----------
  function abbrevGiorni(giorni) {
    if (!Array.isArray(giorni) || !giorni.length) return '';
    if (giorni.length === 7) return 'ogni giorno';
    return giorni.map(g => GIORNI_BREVI[g - 1] || g).join(' ');
  }
  function contestoCompatto(stato) {
    const s = stato || {};
    const righe = [];
    const routine = (s.routine || []).slice(0, 40);
    const task = (s.task || []).filter(t => !t.completata).slice(0, 30);
    const obiettivi = (s.obiettivi || []).filter(o => !o.completato).slice(0, 20);
    if (!routine.length && !task.length && !obiettivi.length) {
      return "L'utente non ha ancora nessun dato: puoi comunque creare.";
    }
    righe.push('Routine: ' + (routine.length ? '' : 'nessuna'));
    routine.forEach(r => righe.push('- id ' + r.id + ' | ' + taglia(r.nome, 60) + ' | ' + (r.oraInizio || '') + ' | ' + abbrevGiorni(r.giorni)));
    righe.push('Task da fare: ' + (task.length ? '' : 'nessuna'));
    task.forEach(t => righe.push('- id ' + t.id + ' | ' + taglia(t.nome, 60) + ' | scadenza ' + (t.scadenza || '-') + ' | priorità ' + (t.priorita == null ? '-' : t.priorita)));
    righe.push('Obiettivi: ' + (obiettivi.length ? '' : 'nessuno'));
    obiettivi.forEach(o => righe.push('- id ' + o.id + ' | ' + taglia(o.titolo, 60) + ' | ' + (o.ambito || '')));
    const tipi = (s.tipiAttivita || []).map(t => t.id + '=' + t.nome);
    if (tipi.length) righe.push('Tipi di attività (campo "tipo"): ' + tipi.join(', ') + '. Se nessuno calza usa "altro".');
    return righe.join('\n');
  }

  // ---------- esempi ----------
  function esempi(oggiISO) {
    const J = (o) => JSON.stringify(o);
    return [
      ['potresti aggiungere questo? - 14:00 alle 15:00: Fumetto per Venerdi',
        { risposta: 'Ti propongo la routine Fumetto il venerdì dalle 14:00 alle 15:00.', operazioni: [{ tipo: 'routine.aggiungi', dati: { nome: 'Fumetto', oraInizio: '14:00', durataMinuti: 60, giorni: [5] } }] }],
      ['ricordami di chiamare il dentista domani, priorità alta',
        { risposta: 'Ti propongo una task per domani.', operazioni: [{ tipo: 'task.aggiungi', dati: { nome: 'Chiamare il dentista', scadenza: 'domani', priorita: 8 } }] }],
      ['ieri ho dormito dalle 23 alle 7, qualità 4',
        { risposta: 'Registro il sonno di ieri.', operazioni: [{ tipo: 'sonno.imposta', dati: { data: 'ieri', oraInizio: '23:00', oraFine: '07:00', qualita: 4 } }] }],
      ['a pranzo pasta al pomodoro: 600 kcal, 20 proteine, 90 carboidrati, 15 grassi',
        { risposta: 'Aggiungo il pasto di oggi.', operazioni: [{ tipo: 'pasto.aggiungi', dati: { data: 'oggi', nome: 'Pasta al pomodoro', kcal: 600, proteine: 20, carboidrati: 90, grassi: 15 } }] }],
      ['sposta la palestra alle 19 (nei dati c\'è: id routine_k3 | Palestra | 18:00)',
        { risposta: 'Sposto la palestra alle 19:00.', operazioni: [{ tipo: 'routine.modifica', id: 'routine_k3', dati: { oraInizio: '19:00' } }] }],
      ['cosa posso fare per dormire meglio?',
        { risposta: 'Vai a letto sempre alla stessa ora, evita schermi e caffeina la sera. Vuoi che aggiunga una routine serale?', operazioni: [] }]
    ].map(([u, r]) => 'Utente: ' + u + '\nRisposta: ' + J(r)).join('\n\n');
  }

  function promptSistema(stato, oggiISO) {
    return [
      "Sei l'assistente di un'app di agenda personale. Rispondi sempre in italiano.",
      'Oggi è ' + GIORNI_ESTESI[weekdayISO(oggiISO) - 1] + ' ' + oggiISO + '.',
      '',
      'Rispondi SOLO con un oggetto JSON in questa forma:',
      '{"risposta":"...","operazioni":[{"tipo":"...","id":"...","dati":{...}}]}',
      '"risposta" è un messaggio breve per l\'utente. "operazioni" elenca cosa creare o modificare; l\'app le mostra come proposta e l\'utente le conferma.',
      '',
      'Operazioni possibili (* = campo obbligatorio; usa SOLO questi nomi di campo):',
      descriviOperazioni(stato, oggiISO),
      '',
      'Regole:',
      '- Metti operazioni SOLO se l\'utente chiede di aggiungere, creare, modificare, segnare o registrare qualcosa; in quel caso metti sempre l\'operazione e non dire mai che non puoi.',
      '- Domande, consigli e chiacchiere ("come", "cosa", "perché", "?") NON sono richieste di modifica: rispondi con "operazioni":[].',
      '- "id" serve solo per le modifiche e solo se l\'elemento è nei dati qui sotto. Per aggiungere NON serve nessun id: non inventarlo e non chiederlo.',
      '- Se manca un dato non indispensabile usa i valori predefiniti, non fare domande: durata 30 minuti, priorità 5, giorni = tutti, data = oggi.',
      '- Orari in formato "HH:MM". Se c\'è un intervallo (dalle 14:00 alle 15:00) metti oraInizio e durataMinuti. Giorni: 1=lunedì … 7=domenica; "lunedì-venerdì" = [1,2,3,4,5].',
      '- Una routine si ripete nei giorni indicati; una task ha una scadenza (data AAAA-MM-GG, anche "domani").',
      '- Se l\'utente fa riferimento a qualcosa detto prima ("quella che ti ho chiesto", "fallo", "sì"), ricostruisci la richiesta dalla conversazione recente e usa gli stessi dati.',
      '- "tipo" è la categoria dell\'attività, non il nome: se non sei sicuro usa "altro" e non chiedere. Se l\'utente parla di "id" o di tipo (es. "crea tu l\'id", "metti altro") sono dettagli tecnici: il nome dell\'attività resta quello della richiesta originale.Per le date relative scrivi proprio "oggi", "domani", "dopodomani" o "ieri" (l\'app le converte): non calcolarle.',
      '- Fai solo quello che l\'utente ha chiesto, niente di più.',
      '',
      'Esempi:',
      esempi(oggiISO),
      '',
      'Dati attuali dell\'utente:',
      contestoCompatto(stato)
    ].join('\n');
  }

  /** Richiesta all'IA: ultimi messaggi della conversazione + richiesta attuale. cronologia: [{ruolo:'utente'|'assistente', testo, anteprima?}] */
  function costruisciPrompt(testo, cronologia) {
    const prec = (cronologia || []).filter(m => m && typeof m.testo === 'string' && m.testo.trim()).slice(-MAX_MESSAGGI);
    if (!prec.length) return 'Utente: ' + testo + '\nRisposta:';
    const righe = prec.map(m => {
      if (m.ruolo === 'utente') return 'Utente: ' + taglia(m.testo, 500);
      const extra = Array.isArray(m.anteprima) && m.anteprima.length ? ' [proposta in attesa di conferma: ' + m.anteprima.map(a => taglia(a, 120)).join('; ') + ']' : '';
      return 'Assistente: ' + taglia(m.testo, 500) + extra;
    });
    return 'Conversazione recente:\n' + righe.join('\n') + '\n\nNuova richiesta (se riguarda quanto detto sopra, usa i dati della richiesta precedente: nome, orari, giorni).\nUtente: ' + testo + '\nRisposta:';
  }

  // ---------- estrazione tollerante del JSON ----------
  function provaParse(t) { try { return JSON.parse(t); } catch (_) { return undefined; } }
  function senzaVirgoleFinali(t) { return t.replace(/,\s*([}\]])/g, '$1'); }
  /** Scorre da `inizio` (una { o [) e chiude le parentesi rimaste aperte (output troncato). */
  function chiudiAperte(t, inizio) {
    const pila = []; let stringa = false, esc = false, fine = -1;
    for (let i = inizio; i < t.length; i++) {
      const c = t[i];
      if (stringa) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') stringa = false; continue; }
      if (c === '"') stringa = true;
      else if (c === '{') pila.push('}');
      else if (c === '[') pila.push(']');
      else if (c === '}' || c === ']') { pila.pop(); if (!pila.length) { fine = i; break; } }
    }
    if (fine >= 0) return t.slice(inizio, fine + 1);
    return t.slice(inizio) + (stringa ? '"' : '') + pila.reverse().join('');
  }
  function estraiJSON(testo) {
    if (typeof testo !== 'string') return null;
    let t = testo.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<think>[\s\S]*$/i, ' ').trim();
    const blocchi = [];
    const re = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(t))) blocchi.push(m[1]);
    const candidati = blocchi.concat([t]);
    for (const c of candidati) {
      const s = c.trim();
      for (const f of [s, senzaVirgoleFinali(s)]) { const v = provaParse(f); if (v !== undefined && v !== null && typeof v === 'object') return v; }
      const i = s.search(/[{[]/);
      if (i < 0) continue;
      const pezzo = chiudiAperte(s, i);
      for (const f of [pezzo, senzaVirgoleFinali(pezzo)]) { const v = provaParse(f); if (v !== undefined && v !== null && typeof v === 'object') return v; }
    }
    return null;
  }

  // ---------- interpretazione della risposta ----------
  function nomeCampo(k) { return '«' + k + '»'; }
  function amichevole(errore) {
    let e = String(errore);
    e = e.replace(/campo obbligatorio mancante: (\w+)/, (_, k) => 'manca ' + nomeCampo(k));
    e = e.replace(/^operazione (\d+): /, 'Operazione $1: ');
    return e.charAt(0).toUpperCase() + e.slice(1);
  }
  function testoRisposta(obj) {
    for (const k of ['risposta', 'response', 'messaggio', 'testo', 'answer']) if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim();
    return '';
  }
  function listaOperazioni(obj) {
    if (Array.isArray(obj)) return obj;
    for (const k of ['operazioni', 'operations', 'azioni']) if (Array.isArray(obj[k])) return obj[k];
    if (obj.operazione && typeof obj.operazione === 'object') return [obj.operazione];
    if (typeof obj.tipo === 'string') return [obj]; // il modello ha risposto con una sola operazione
    return [];
  }

  /**
   * Trasforma il testo del modello in { risposta, proposta, errori, formato }.
   *  - formato: 'ok' (JSON letto), 'testo' (nessun JSON: il testo è mostrato com'è, nessuna operazione).
   *  - proposta: oggetto di NucleoProposte.creaProposta, oppure null (nessuna operazione o errori).
   *  - errori: elenco di messaggi in italiano (vuoto se tutto bene).
   */
  function interpreta(testoModello, stato, oggiISO, adessoISO, generaId) {
    const obj = estraiJSON(testoModello);
    if (obj === null) {
      const pulito = String(testoModello || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```/g, '').trim();
      return { risposta: pulito, proposta: null, errori: ['la risposta del modello non è nel formato JSON richiesto'], formato: 'testo', operazioni: [] };
    }
    const risposta = Array.isArray(obj) ? '' : testoRisposta(obj);
    const grezze = listaOperazioni(obj);
    if (!grezze.length) return { risposta, proposta: null, errori: [], formato: 'ok', operazioni: [] };
    const operazioni = grezze.map(op => NucleoNormalizza.normalizzaOperazione(op, stato, oggiISO, { tollerante: true }));
    const idMancanti = [];
    operazioni.forEach((op, i) => {
      const d = op && OPERAZIONI[op.tipo];
      if (d && d.richiedeId && !(stato[d.lista] || []).some(x => x.id === op.id)) idMancanti.push(i + 1);
    });
    const motivo = (risposta || "Richiesta dell'utente").slice(0, 500);
    const r = NucleoProposte.creaProposta({ client: CLIENT, motivo, operazioni }, stato, oggiISO, adessoISO, generaId);
    if (!r.ok) {
      const errori = r.errori.map(amichevole);
      idMancanti.forEach(n => errori.push('Operazione ' + n + ': l\'elemento da modificare non è tra i tuoi dati (serve l\'id esatto indicato nei dati)'));
      return { risposta, proposta: null, errori, formato: 'ok', operazioni };
    }
    return { risposta, proposta: r.proposta, errori: [], formato: 'ok', operazioni };
  }

  /** Seconda richiesta (una sola) dopo un errore di validazione. */
  function promptCorrezione(testoUtente, rispostaPrecedente, errori, cronologia) {
    const base = costruisciPrompt(testoUtente, cronologia).replace(/\nRisposta:$/, '');
    return base + '\nRisposta precedente (NON valida): ' + taglia(rispostaPrecedente, 1500)
      + '\nProblemi: ' + errori.join('; ')
      + '\nCorreggi: rispondi di nuovo SOLO con il JSON completo, con tutti i campi obbligatori e solo i campi elencati. Per aggiungere non usare "id".\nRisposta:';
  }

  /** Testo da mostrare in chat quando, anche dopo la correzione, la proposta non è valida. */
  function messaggioErrore(errori, formato) {
    if (formato === 'testo') return 'Non sono riuscito a capire la risposta del modello. Riprova, magari con una frase più semplice.';
    return 'Non sono riuscito a preparare la modifica. ' + errori.slice(0, 4).join('. ') + '. Riformula la richiesta aggiungendo questi dettagli.';
  }

  /**
   * Flusso completo con la rete iniettata: chiama(prompt, sistema) -> Promise<{ok, testo | errore}>.
   * Un solo tentativo di correzione se la proposta non è valida. Restituisce
   * { ok:false, errore } se il server non risponde, altrimenti { ok:true, risposta, proposta, errori, messaggio, tentativi, grezzo }.
   * Se errori non è vuoto, "messaggio" è il testo da mostrare in chat (mai il JSON grezzo).
   */
  async function elabora(opz) {
    const { testo, stato, oggiISO, adessoISO, generaId, cronologia, chiama } = opz;
    const sistema = promptSistema(stato, oggiISO);
    const r1 = await chiama(costruisciPrompt(testo, cronologia), sistema);
    if (!r1.ok) return { ok: false, errore: r1.errore };
    let esito = interpreta(r1.testo, stato, oggiISO, adessoISO, generaId);
    let tentativi = 1, grezzo = r1.testo;
    if (esito.errori.length) {
      const r2 = await chiama(promptCorrezione(testo, r1.testo, esito.errori, cronologia), sistema);
      tentativi = 2;
      if (r2.ok) { grezzo = r2.testo; esito = interpreta(r2.testo, stato, oggiISO, adessoISO, generaId); }
    }
    const out = { ok: true, risposta: esito.risposta, proposta: esito.proposta, errori: esito.errori, tentativi, grezzo };
    if (esito.errori.length) out.messaggio = messaggioErrore(esito.errori, esito.formato);
    return out;
  }

  return {
    elabora,
    CLIENT, MAX_MESSAGGI, promptSistema, costruisciPrompt, promptCorrezione, estraiJSON, interpreta, messaggioErrore,
    descriviOperazioni, contestoCompatto, esempi
  };
});
