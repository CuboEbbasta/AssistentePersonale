/**
 * storage.js
 * Unica fonte di verità per i dati dell'app. Il salvataggio avviene tramite
 * il plugin Capacitor Preferences (funziona sia su Android nativo che
 * nell'anteprima web durante lo sviluppo).
 *
 * Filosofia di conservazione dati (vedi discussione con l'utente):
 * - i dati "vivi" (routine, task) restano qui per intero;
 * - lo storico giorno per giorno (state.log) viene tenuto come riepilogo
 *   compatto per data, non come log grezzo di ogni evento: questo lo rende
 *   sostenibile anche dopo anni di utilizzo.
 */
const Dati = (function () {
  const CHIAVE = 'assistente_stato_v1';

  const statoDefault = NucleoSchema.statoDefault;

  let statoCorrente = null;

  function generaId(prefisso) {
    return `${prefisso}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  function plugins() {
    return (window.Capacitor && window.Capacitor.Plugins) || {};
  }

  // ---- Desktop (Electron): lo stato vive in un file, via IPC (vedi desktop/preload.js) ----
  function apiFile() {
    return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.dati) || null;
  }

  // Se true, stato.json esiste ma non è leggibile e non c'è un backup valido:
  // non si salva nulla per non sovrascrivere il file dell'utente.
  let salvataggioBloccato = false;

  function avvisa(testo) {
    if (window.App && window.App.mostraToast) window.App.mostraToast(testo, 8000);
    else console.warn(testo);
  }

  const DOVE_BACKUP = "La copia dei dati precedenti è in stato.import-backup.json, nella cartella dati di Tarvio (%APPDATA%\\Tarvio, o la cartella indicata da ASSISTENTE_DATI).";

  function blocca(testo) {
    salvataggioBloccato = true;
    avvisa(testo);
    return statoDefault();
  }

  async function caricaDaFile(api) {
    let r = await api.statoLeggi();
    if (r && r.ok && r.json === null) {
      // primo avvio con il file: importa i dati dal vecchio salvataggio (Preferences), se ci sono
      const { Preferences } = plugins();
      if (!Preferences) {
        return blocca("Non trovo il vecchio salvataggio (Preferences): salvataggio sospeso per non perdere i dati. Riavvia l'app.");
      }
      let vecchio;
      try { vecchio = await Preferences.get({ key: CHIAVE }); } catch (e) {
        return blocca("Non riesco a leggere il vecchio salvataggio: salvataggio sospeso per non perdere i dati. Riavvia l'app.");
      }
      const m = await api.statoMigra((vecchio && vecchio.value) || null);
      if (!m || !m.ok) {
        return blocca('Impossibile importare i dati precedenti (valore danneggiato o errore): salvataggio sospeso per non perderli. ' + DOVE_BACKUP);
      }
      if (m.esito === 'importato') avvisa('Dati importati dal vecchio salvataggio nel nuovo file. ' + DOVE_BACKUP);
      if (m.esito === 'importato' || m.esito === 'gia_presente') r = await api.statoLeggi();
    }
    if (r && r.ok) {
      if (r.daBackup) avvisa("Il file dei dati era danneggiato: ripristinata l'ultima copia di sicurezza.");
      return r.json === null ? statoDefault() : JSON.parse(r.json);
    }
    return blocca("Il file dei dati non è leggibile e non c'è una copia di sicurezza: salvataggio sospeso, i dati non vengono toccati.");
  }

  async function carica() {
    try {
      const api = apiFile();
      if (api) {
        statoCorrente = NucleoSchema.migra(await caricaDaFile(api));
        return statoCorrente;
      }
      const { Preferences } = plugins();
      const res = Preferences ? await Preferences.get({ key: CHIAVE }) : null;
      statoCorrente = (res && res.value) ? JSON.parse(res.value) : statoDefault();
      statoCorrente = NucleoSchema.migra(statoCorrente);
    } catch (e) {
      console.error('Errore caricamento stato, uso i valori di default', e);
      statoCorrente = statoDefault();
      if (apiFile()) salvataggioBloccato = true; // errore con il file attivo: non sovrascrivere
    }
    return statoCorrente;
  }

  let avvisoSalvataggioMostrato = false;
  let ritentoInCorso = false;
  const ATTESA_RITENTO_MS = 2000;

  async function salva() {
    const ok = await salvaUnaVolta();
    if (!ok && apiFile()) {
      if (!avvisoSalvataggioMostrato) {
        avvisoSalvataggioMostrato = true;
        avvisa("Non riesco a salvare i dati: non chiudere l'app e riprova tra poco. Le ultime modifiche potrebbero andare perse.");
      }
      if (!ritentoInCorso && !salvataggioBloccato) {
        ritentoInCorso = true;
        setTimeout(async () => {
          ritentoInCorso = false;
          await salvaUnaVolta();
        }, ATTESA_RITENTO_MS);
      }
    }
    return ok;
  }

  async function salvaUnaVolta() {
    try {
      const api = apiFile();
      if (api) {
        if (salvataggioBloccato) return false;
        const r = await api.statoScrivi(JSON.stringify(statoCorrente));
        return !!(r && r.ok);
      }
      const { Preferences } = plugins();
      if (Preferences) {
        await Preferences.set({ key: CHIAVE, value: JSON.stringify(statoCorrente) });
      }
      return true;
    } catch (e) {
      console.error('Errore salvataggio stato', e);
      return false;
    }
  }

  function stato() { return statoCorrente; }

  /**
   * Sostituisce lo stato vivo con uno nuovo (es. dopo aver applicato una
   * proposta) e salva. Se il salvataggio fallisce ripristina lo stato
   * precedente, cosi' memoria e disco restano coerenti. Restituisce l'esito.
   */
  async function sostituisciStato(nuovo) {
    const precedente = statoCorrente;
    statoCorrente = nuovo;
    let ok = false;
    try { ok = await salva(); } catch (e) { ok = false; }
    if (!ok) statoCorrente = precedente;
    return ok;
  }

  function logGiorno(dataISO) {
    if (!statoCorrente.log[dataISO]) {
      statoCorrente.log[dataISO] = { tipo: 'abituale', completamenti: {} };
    }
    return statoCorrente.log[dataISO];
  }

  async function impostaCompletamento(chiaveElemento, dataISO, valore) {
    const giorno = logGiorno(dataISO);
    giorno.completamenti[chiaveElemento] = valore;
    await salva();
  }

  async function impostaTipoGiorno(dataISO, tipo) {
    const giorno = logGiorno(dataISO);
    giorno.tipo = tipo;
    await salva();
  }

  async function salvaVoceDiario(dataISO, voce) {
    statoCorrente.journal[dataISO] = voce;
    await salva();
  }

  // ---------------- Profilo / dieta ----------------
  async function salvaProfilo(datiProfilo) {
    Object.assign(statoCorrente.profilo, datiProfilo);
    await salva();
  }

  async function registraPeso(dataISO, peso) {
    const storico = statoCorrente.profilo.storicoPeso;
    const esistente = storico.find(v => v.data === dataISO);
    if (esistente) esistente.peso = peso;
    else storico.push({ data: dataISO, peso });
    storico.sort((a, b) => a.data.localeCompare(b.data));
    statoCorrente.profilo.pesoKg = peso;
    await salva();
  }

  async function salvaPianoDieta(piano) {
    statoCorrente.dietaPiano = piano;
    await salva();
  }

  function logDietaGiorno(dataISO) {
    if (!statoCorrente.dietaLog[dataISO]) statoCorrente.dietaLog[dataISO] = { pasti: [] };
    return statoCorrente.dietaLog[dataISO];
  }

  async function aggiungiPastoLog(dataISO, pasto) {
    logDietaGiorno(dataISO).pasti.push(pasto);
    await salva();
  }

  async function rimuoviPastoLog(dataISO, indice) {
    logDietaGiorno(dataISO).pasti.splice(indice, 1);
    await salva();
  }

  // ---------------- Workout ----------------
  async function salvaProfiloWorkout(dati) {
    Object.assign(statoCorrente.profiloWorkout, dati);
    await salva();
  }

  async function salvaSchedaAdattiva(scheda) {
    statoCorrente.schedaAdattiva = scheda;
    await salva();
  }

  async function salvaSchedaPersonalizzata(scheda) {
    statoCorrente.schedaPersonalizzata = scheda;
    await salva();
  }

  async function registraWorkoutGiorno(dataISO, voce) {
    if (!statoCorrente.workoutLog[dataISO]) statoCorrente.workoutLog[dataISO] = [];
    statoCorrente.workoutLog[dataISO].push(Object.assign({ ora: DataUtils.formatOraMinutiInGiorno(DataUtils.minutiAdesso()) }, voce));
    await salva();
  }

  async function rimuoviWorkoutGiorno(dataISO, indice) {
    if (statoCorrente.workoutLog[dataISO]) {
      statoCorrente.workoutLog[dataISO].splice(indice, 1);
      await salva();
    }
  }

  async function registraSonno(dataISO, voce) {
    statoCorrente.sonnoLog[dataISO] = voce;
    await salva();
  }

  // ---------------- Orario fisso / periodi dell'anno ----------------
  async function salvaOrarioFisso(elenco) {
    statoCorrente.orarioFisso = elenco;
    await salva();
  }

  async function salvaPeriodiAnno(elenco) {
    statoCorrente.periodiAnno = elenco;
    await salva();
  }

  // ---------------- Tipi di attività (condivisi Routine/Task) ----------------
  async function aggiungiTipoAttivita(nome) {
    const id = 'tipo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    statoCorrente.tipiAttivita.push({ id, nome, protetto: false });
    await salva();
    return id;
  }

  async function eliminaTipoAttivita(id) {
    const t = statoCorrente.tipiAttivita.find(x => x.id === id);
    if (!t || t.protetto) return { ok: false, errore: 'Questo tipo non può essere eliminato.' };
    statoCorrente.tipiAttivita = statoCorrente.tipiAttivita.filter(x => x.id !== id);
    // le routine/task che usavano questo tipo tornano genericamente ad "altro"
    statoCorrente.routine.forEach(r => { if (r.tipo === id) r.tipo = 'altro'; });
    statoCorrente.task.forEach(t2 => { if (t2.tipo === id) t2.tipo = 'altro'; });
    await salva();
    return { ok: true };
  }

  async function aggiungiParolaChiave(parola, tipoId) {
    statoCorrente.paroleChiaveTipi.push({ parola: parola.trim(), tipoId });
    await salva();
  }

  async function eliminaParolaChiave(indice) {
    statoCorrente.paroleChiaveTipi.splice(indice, 1);
    await salva();
  }

  /** Crea più routine in un colpo solo (usato dall'importazione da testo) */
  async function importaRoutineMultiple(voci) {
    voci.forEach(v => {
      statoCorrente.routine.push({
        id: generaId('routine'), nome: v.nome, tipo: v.tipo || 'altro', descrizione: '',
        oraInizio: v.oraInizio, durataMinuti: v.durataMinuti, priorita: 5, giorni: v.giorni, attiva: true
      });
    });
    await salva();
  }

  async function salvaImpostazioniIA(dati) {
    Object.assign(statoCorrente.impostazioniIA, dati);
    await salva();
  }

  // ---------------- Export ----------------
  async function esporta() {
    const json = JSON.stringify(statoCorrente, null, 2);
    const nomeFile = `assistente-backup-${DataUtils.oggiISO()}.json`;

    // Su desktop (Electron) usiamo il vero filesystem del PC tramite una
    // finestra di salvataggio nativa (vedi desktop/preload.js e main.js):
    // il risultato è un file reale che puoi poi trasferire sul telefono.
    if (window.electronAPI && window.electronAPI.esportaJSON) {
      const res = await window.electronAPI.esportaJSON(nomeFile, json);
      if (res.annullato) return { ok: false, annullato: true };
      return res.ok ? { ok: true, percorso: res.percorso, nomeFile } : { ok: false, errore: res.errore };
    }

    const { Filesystem, Share } = plugins();

    if (!Filesystem) {
      // Anteprima nel browser (nessun plugin nativo): scarica il file col metodo web classico.
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nomeFile;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return { ok: true, percorso: nomeFile, nomeFile };
    }

    try {
      const scrittura = await Filesystem.writeFile({
        path: nomeFile,
        data: json,
        directory: 'CACHE',
        encoding: 'utf8'
      });
      if (Share) {
        try {
          await Share.share({
            title: 'Backup Tarvio',
            text: 'Backup dei dati dell\'app',
            url: scrittura.uri
          });
        } catch (eShare) {
          console.warn('Condivisione annullata o non disponibile', eShare);
        }
      }
      return { ok: true, percorso: scrittura.uri, nomeFile };
    } catch (e) {
      console.error('Errore esportazione', e);
      return { ok: false, errore: e.message || String(e) };
    }
  }

  // ---------------- Import ----------------
  function importaDaTesto(testoJson, modalita) {
    // modalita: 'sostituisci' | 'unisci'
    let nuovo;
    try {
      nuovo = JSON.parse(testoJson);
    } catch (e) {
      return { ok: false, errore: 'Il file scelto non è un JSON valido.' };
    }
    if (!nuovo || typeof nuovo !== 'object') {
      return { ok: false, errore: 'Contenuto non riconosciuto.' };
    }

    if (modalita === 'sostituisci') {
      statoCorrente = Object.assign(statoDefault(), nuovo);
    } else {
      const s = statoCorrente;
      (nuovo.routine || []).forEach(r => { if (!s.routine.find(x => x.id === r.id)) s.routine.push(r); });
      (nuovo.task || []).forEach(t => { if (!s.task.find(x => x.id === t.id)) s.task.push(t); });
      (nuovo.obiettivi || []).forEach(o => { if (!s.obiettivi.find(x => x.id === o.id)) s.obiettivi.push(o); });
      Object.entries(nuovo.journal || {}).forEach(([data, voce]) => {
        if (!s.journal[data]) s.journal[data] = voce; // non sovrascrive una voce già scritta per quella data
      });
      if (nuovo.profilo) {
        Object.assign(s.profilo, nuovo.profilo);
        (nuovo.profilo.storicoPeso || []).forEach(v => {
          if (!s.profilo.storicoPeso.find(x => x.data === v.data)) s.profilo.storicoPeso.push(v);
        });
      }
      if (nuovo.dietaPiano && nuovo.dietaPiano.generatoIl) {
        if (!s.dietaPiano.generatoIl || nuovo.dietaPiano.generatoIl > s.dietaPiano.generatoIl) {
          s.dietaPiano = nuovo.dietaPiano; // tiene il piano più recente tra i due
        }
      }
      Object.entries(nuovo.dietaLog || {}).forEach(([data, voce]) => {
        if (!s.dietaLog[data]) s.dietaLog[data] = voce;
      });
      if (nuovo.profiloWorkout) Object.assign(s.profiloWorkout, nuovo.profiloWorkout);
      if (nuovo.schedaAdattiva && nuovo.schedaAdattiva.generataIl) {
        if (!s.schedaAdattiva.generataIl || nuovo.schedaAdattiva.generataIl > s.schedaAdattiva.generataIl) {
          s.schedaAdattiva = nuovo.schedaAdattiva;
        }
      }
      Object.entries(nuovo.workoutLog || {}).forEach(([data, voce]) => {
        if (!s.workoutLog[data]) s.workoutLog[data] = voce;
      });
      Object.entries(nuovo.sonnoLog || {}).forEach(([data, voce]) => {
        if (!s.sonnoLog[data]) s.sonnoLog[data] = voce;
      });
      (nuovo.orarioFisso || []).forEach(o => { if (!s.orarioFisso.find(x => x.id === o.id)) s.orarioFisso.push(o); });
      (nuovo.periodiAnno || []).forEach(p => { if (!s.periodiAnno.find(x => x.id === p.id)) s.periodiAnno.push(p); });
      (nuovo.tipiAttivita || []).forEach(t => { if (!s.tipiAttivita.find(x => x.id === t.id)) s.tipiAttivita.push(t); });
      Object.entries(nuovo.log || {}).forEach(([data, giorno]) => {
        if (!s.log[data]) {
          s.log[data] = giorno;
        } else {
          s.log[data].completamenti = Object.assign({}, giorno.completamenti, s.log[data].completamenti);
        }
      });
    }
    return { ok: true };
  }

  return {
    statoDefault, generaId, carica, salva, stato, sostituisciStato,
    logGiorno, impostaCompletamento, impostaTipoGiorno, salvaVoceDiario,
    salvaProfilo, registraPeso, salvaPianoDieta, logDietaGiorno, aggiungiPastoLog, rimuoviPastoLog,
    salvaProfiloWorkout, salvaSchedaAdattiva, salvaSchedaPersonalizzata, registraWorkoutGiorno, rimuoviWorkoutGiorno,
    registraSonno,
    salvaOrarioFisso, salvaPeriodiAnno,
    aggiungiTipoAttivita, eliminaTipoAttivita, salvaImpostazioniIA,
    aggiungiParolaChiave, eliminaParolaChiave, importaRoutineMultiple,
    esporta, importaDaTesto
  };
})();

window.Dati = Dati;
