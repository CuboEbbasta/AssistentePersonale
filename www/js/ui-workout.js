/**
 * ui-workout.js
 * Due schede fisse (Veloce senza attrezzi, Completa con sbarra) sempre
 * uguali, una scheda Adattiva generata sui giorni disponibili a settimana,
 * e una scheda Personalizzata scritta interamente dall'utente (giorni ed
 * esercizi a piacere, coi giorni duplicabili). Tutte mostrate come tabella
 * leggibile. In fondo, log di quale scheda è stata fatta ogni giorno.
 *
 * Integrazione con la Dieta: se il profilo dieta è compilato, le schede
 * pronte vengono scalate sul suo obiettivo fisico, e i giorni suggeriti
 * per la scheda adattiva partono dal suo livello di attività invece di un
 * default fisso.
 */
const UiWorkout = (function () {
  let giornoSelezionatoAdattiva = 0;
  let modalita = 'pronte'; // 'pronte' | 'personalizzato'

  function obiettivoCorrente() {
    return (Dati.stato().profilo && Dati.stato().profilo.obiettivo) || 'mantenimento';
  }

  function giorniSuggeritiDaDieta() {
    const p = Dati.stato().profilo;
    if (!CalcoloDieta.profiloCompleto(p)) return null;
    const mappa = { sedentario: 2, leggero: 3, moderato: 3, attivo: 4, moltoattivo: 5 };
    return mappa[p.livelloAttivita] || 3;
  }

  function renderTabellaEsercizi(esercizi) {
    if (!esercizi.length) return '<div class="vuoto">Nessun esercizio.</div>';
    return `
      <table class="tabella-scheda">
        <thead><tr><th>Esercizio</th><th>Serie</th><th>Rip.</th><th>Recupero</th></tr></thead>
        <tbody>
          ${esercizi.map(e => `
            <tr>
              <td class="col-esercizio">${UiRoutine.escapeHtml(e.nome)}${e.richiedeSbarra ? ' <span class="badge badge-accent">sbarra</span>' : ''}</td>
              <td>${e.serie}</td>
              <td>${e.ripetizioni}</td>
              <td>${typeof e.recupero === 'number' ? e.recupero + 's' : (e.recupero || '—')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${esercizi.some(e => e.nota) ? `<div class="elemento-meta" style="margin-top:8px;">${esercizi.find(e => e.nota).nota}</div>` : ''}
    `;
  }

  function renderSelettoreModalita() {
    return `
      <div class="card">
        <label style="font-size:12.5px;font-weight:600;color:var(--ink-soft);">Tipo di scheda</label>
        <select id="f-modalita-workout" style="width:100%;padding:9px 10px;border:1px solid var(--border-strong);border-radius:8px;margin-top:6px;">
          <option value="pronte" ${modalita==='pronte'?'selected':''}>Schede pronte (veloce / con sbarra / adattiva)</option>
          <option value="personalizzato" ${modalita==='personalizzato'?'selected':''}>Personalizzata (fai la tua)</option>
        </select>
      </div>
    `;
  }

  // ---------------- Impostazioni allenamento ----------------
  function renderImpostazioni() {
    const pw = Dati.stato().profiloWorkout;
    const suggeriti = giorniSuggeritiDaDieta();
    return `
      <div class="card">
        <h3>Le tue impostazioni</h3>
        <div class="griglia-2">
          <div class="campo" style="margin-bottom:0;">
            <label>Livello</label>
            <select id="f-livello-workout">
              ${Object.keys(CalcoloWorkout.ETICHETTE_LIVELLO).map(k => `<option value="${k}" ${pw.livello===k?'selected':''}>${CalcoloWorkout.ETICHETTE_LIVELLO[k]}</option>`).join('')}
            </select>
          </div>
          <div class="campo" style="margin-bottom:0;">
            <label>Giorni disponibili/sett.</label>
            <input type="number" id="f-giorni-workout" min="1" max="7" value="${pw.giorniDisponibili}">
          </div>
        </div>
        <button class="btn btn-sm btn-accent btn-block" id="btn-salva-impostazioni-workout" style="margin-top:12px;">Salva</button>
        <div class="elemento-meta" style="margin-top:8px;">
          ${CalcoloDieta.profiloCompleto(Dati.stato().profilo)
            ? `Sto usando il tuo profilo Dieta: obiettivo <strong>${CalcoloDieta.ETICHETTE_OBIETTIVO[obiettivoCorrente()]}</strong>, attività <strong>${CalcoloDieta.ETICHETTE_ATTIVITA[Dati.stato().profilo.livelloAttivita]}</strong>${suggeriti ? ` (suggerimento: ${suggeriti} giorni/sett. di allenamento)` : ''}.`
            : `Compila il profilo in Dieta per calibrare meglio le schede sul tuo obiettivo fisico — per ora uso valori standard.`}
        </div>
      </div>
    `;
  }

  // ---------------- Schede fisse ----------------
  function renderSchedaFissa(titolo, idsEsercizi, tipo, sottotitolo) {
    const esercizi = CalcoloWorkout.costruisciScheda(idsEsercizi, obiettivoCorrente(), Dati.stato().profiloWorkout.livello);
    return `
      <div class="card">
        <h3>${titolo}</h3>
        <div class="elemento-meta">${sottotitolo}</div>
        ${renderTabellaEsercizi(esercizi)}
        <button class="btn btn-sm btn-ok" data-registra-tipo="${tipo}" data-registra-etichetta="${titolo}" style="margin-top:10px;">${Icone.svg('check', 14)} Ho fatto questa oggi</button>
      </div>
    `;
  }

  // ---------------- Scheda adattiva ----------------
  function renderSchedaAdattiva() {
    const scheda = Dati.stato().schedaAdattiva;
    const haScheda = scheda && scheda.generataIl && scheda.giorni.length;
    let corpo;
    if (haScheda) {
      if (giornoSelezionatoAdattiva >= scheda.giorni.length) giornoSelezionatoAdattiva = 0;
      const giornoCorrente = scheda.giorni[giornoSelezionatoAdattiva];
      corpo = `
        <div class="giorni-settimana" style="margin-bottom:10px;">
          ${scheda.giorni.map((g, i) => `<button type="button" class="giorno-toggle ${giornoSelezionatoAdattiva === i ? 'selezionato' : ''}" data-giorno-adattiva="${i}" style="width:auto;padding:0 10px;">${i+1}</button>`).join('')}
        </div>
        <div class="elemento-meta" style="margin-bottom:4px;"><strong>${UiRoutine.escapeHtml(giornoCorrente.etichetta)}</strong></div>
        ${renderTabellaEsercizi(giornoCorrente.esercizi)}
        <div class="riga-btn" style="margin-top:12px;">
          <button class="btn btn-sm btn-ok" data-registra-tipo="adattiva" data-registra-etichetta="${UiRoutine.escapeHtml(giornoCorrente.etichetta)}" data-registra-indice="${giornoSelezionatoAdattiva}">${Icone.svg('check', 14)} Ho fatto questa oggi</button>
          <button class="btn btn-sm btn-warn" id="btn-rigenera-adattiva">Rigenera</button>
        </div>
      `;
    } else {
      corpo = `
        <div class="vuoto">Nessuna scheda adattiva ancora.</div>
        <button class="btn btn-accent btn-block" id="btn-genera-adattiva">Genera scheda adattiva</button>
      `;
    }
    return `
      <div class="card">
        <h3>Scheda adattiva (${Dati.stato().profiloWorkout.giorniDisponibili} giorni/sett.)</h3>
        <div class="elemento-meta" style="margin-bottom:10px;">
          Differenza rispetto alle schede fisse: l'allenamento è diviso sui
          giorni che hai indicato, alternando gruppi muscolari, così ti alleni
          più spesso con meno volume per sessione invece di un'unica seduta.
        </div>
        ${corpo}
      </div>
    `;
  }

  // ---------------- Scheda personalizzata ----------------
  function renderPersonalizzata() {
    const scheda = Dati.stato().schedaPersonalizzata;
    return `
      <div class="card">
        <h3>Scheda personalizzata</h3>
        <div class="elemento-meta" style="margin-bottom:10px;">Fatta interamente da te: aggiungi i giorni e gli esercizi che vuoi. Se due giorni sono identici, duplica invece di riscrivere.</div>
        <button class="btn btn-sm btn-accent btn-block" id="btn-aggiungi-giorno-perso" style="margin-bottom:12px;">+ Aggiungi giorno</button>
        <div id="lista-giorni-perso">${renderGiorniPersonalizzati(scheda.giorni)}</div>
      </div>
    `;
  }

  function renderGiorniPersonalizzati(giorni) {
    if (!giorni.length) return '<div class="vuoto">Nessun giorno ancora.</div>';
    return giorni.map((g, indice) => `
      <div class="card-flat" style="margin-bottom:10px;">
        <div class="riga-btn" style="justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>${UiRoutine.escapeHtml(g.etichetta)}</strong>
          <div class="riga-btn">
            <button class="icon-btn btn-rinomina-giorno-perso" data-indice="${indice}" title="Rinomina">${Icone.svg('edit', 16)}</button>
            <button class="icon-btn btn-duplica-giorno-perso" data-indice="${indice}" title="Duplica">${Icone.svg('duplica', 16)}</button>
            <button class="icon-btn btn-elimina-giorno-perso" data-indice="${indice}" title="Elimina">${Icone.svg('delete', 16)}</button>
          </div>
        </div>
        ${renderTabellaEsercizi(g.esercizi)}
        <div class="riga-btn" style="margin-top:10px;">
          <button class="btn btn-sm" data-aggiungi-esercizio-perso="${indice}">+ Esercizio</button>
          <button class="btn btn-sm btn-ok" data-registra-tipo="personalizzato" data-registra-etichetta="${UiRoutine.escapeHtml(g.etichetta)}">${Icone.svg('check', 14)} Ho fatto questo oggi</button>
        </div>
      </div>
    `).join('');
  }

  function apriFormEsercizioPerso(indiceGiorno) {
    const html = `
      <div class="foglio-header"><h2>Nuovo esercizio</h2><button class="icon-btn" id="btn-chiudi-foglio">${Icone.svg('close', 18)}</button></div>
      <div class="campo"><label>Nome</label><input type="text" id="f-nome-eserc" placeholder="Es. Squat con zaino"></div>
      <div class="griglia-2">
        <div class="campo"><label>Serie</label><input type="number" id="f-serie-eserc" value="3" min="1"></div>
        <div class="campo"><label>Ripetizioni</label><input type="text" id="f-rip-eserc" value="10-12" placeholder="Es. 10-12 o 30 sec"></div>
      </div>
      <div class="campo"><label>Recupero (secondi)</label><input type="number" id="f-recupero-eserc" value="45"></div>
      <div class="riga-btn" style="margin-top:16px;"><button class="btn btn-primary btn-block" id="btn-salva-eserc-perso">Aggiungi</button></div>
    `;
    window.App.apriFoglio(html);
    document.getElementById('btn-chiudi-foglio').addEventListener('click', window.App.chiudiFoglio);
    document.getElementById('btn-salva-eserc-perso').addEventListener('click', async () => {
      const nome = document.getElementById('f-nome-eserc').value.trim();
      if (!nome) { window.App.mostraToast('Dai un nome all\'esercizio.'); return; }
      const serie = parseInt(document.getElementById('f-serie-eserc').value, 10);
      if (!serie || serie < 1) { window.App.mostraToast('Le serie devono essere almeno 1.'); return; }
      const ripetizioni = document.getElementById('f-rip-eserc').value.trim();
      if (!ripetizioni) { window.App.mostraToast('Indica le ripetizioni (es. "10-12" o "30 sec").'); return; }
      const scheda = Dati.stato().schedaPersonalizzata;
      scheda.giorni[indiceGiorno].esercizi.push({
        nome, serie, ripetizioni,
        recupero: Math.max(0, parseInt(document.getElementById('f-recupero-eserc').value, 10) || 0)
      });
      await Dati.salvaSchedaPersonalizzata(scheda);
      window.App.chiudiFoglio();
      render();
    });
  }

  // ---------------- Log di oggi + storico ----------------
  function renderLog() {
    const oggi = DataUtils.oggiISO();
    const log = Dati.stato().workoutLog;
    const vociOggi = log[oggi] || [];
    const storico = Object.entries(log).filter(([d]) => d !== oggi).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
    return `
      <div class="card">
        <h3>Oggi</h3>
        ${vociOggi.length ? vociOggi.map((v, i) => `
          <div class="legenda-riga">
            <span class="badge badge-ok">Fatto ${v.ora ? 'alle ' + v.ora : ''}</span>
            <span class="legenda-nome">${UiRoutine.escapeHtml(v.etichetta)}</span>
            <button class="icon-btn btn-rimuovi-workout-oggi" data-indice="${i}" title="Rimuovi">${Icone.svg('delete', 15)}</button>
          </div>
        `).join('') : '<div class="vuoto">Non hai ancora segnato un allenamento per oggi.</div>'}
        ${vociOggi.length ? '<div class="elemento-meta" style="margin-top:6px;">Puoi segnare più allenamenti nello stesso giorno: tocca di nuovo "Ho fatto questa oggi" su una scheda qui sopra.</div>' : ''}
        ${storico.length ? `
        <div class="divisore-testo">Ultimi giorni</div>
        ${storico.map(([data, voci]) => `<div class="legenda-riga"><span class="legenda-nome">${DataUtils.formatDataBreve(data)}</span><span class="legenda-tempo">${voci.map(v => UiRoutine.escapeHtml(v.etichetta)).join(', ')}</span></div>`).join('')}
        ` : ''}
      </div>
    `;
  }

  // ---------------- Render principale ----------------
  function render() {
    const cont = document.getElementById('workout-corpo');

    if (!CalcoloDieta.profiloCompleto(Dati.stato().profilo)) {
      cont.innerHTML = `
        <div class="card">
          <h3>Prima completa il profilo in Dieta</h3>
          <div class="elemento-meta" style="margin-bottom:12px;">
            Lo sforzo giusto è diverso se vuoi mantenere, aumentare o perdere massa: senza
            queste informazioni non posso calibrare bene le schede. Bastano due minuti.
          </div>
          <button class="btn btn-accent btn-block" id="btn-vai-a-dieta">Vai al profilo Dieta</button>
        </div>`;
      document.getElementById('btn-vai-a-dieta').addEventListener('click', () => window.App.mostraTab('dieta'));
      return;
    }

    cont.innerHTML = renderSelettoreModalita() + renderImpostazioni() +
      (modalita === 'pronte'
        ? renderSchedaFissa('Scheda veloce (senza attrezzi)', DatabaseWorkout.SCHEDA_VELOCE_IDS, 'veloce', 'Circa 15-20 minuti, corpo libero, nessun attrezzo.') +
          renderSchedaFissa('Scheda completa (con sbarra)', DatabaseWorkout.SCHEDA_COMPLETA_IDS, 'completa', 'Circa 40-45 minuti, usa anche la sbarra per trazioni.') +
          renderSchedaAdattiva()
        : renderPersonalizzata()) +
      renderLog();

    document.getElementById('f-modalita-workout').addEventListener('change', (e) => { modalita = e.target.value; render(); });

    document.getElementById('btn-salva-impostazioni-workout').addEventListener('click', async () => {
      const livello = document.getElementById('f-livello-workout').value;
      const giorniDisponibili = Math.max(1, Math.min(7, parseInt(document.getElementById('f-giorni-workout').value, 10) || 3));
      await Dati.salvaProfiloWorkout({ livello, giorniDisponibili });
      window.App.mostraToast('Impostazioni salvate.');
      render();
    });

    if (modalita === 'pronte') {
      const btnGeneraAdattiva = document.getElementById('btn-genera-adattiva');
      if (btnGeneraAdattiva) btnGeneraAdattiva.addEventListener('click', () => generaAdattiva(false));
      const btnRigeneraAdattiva = document.getElementById('btn-rigenera-adattiva');
      if (btnRigeneraAdattiva) btnRigeneraAdattiva.addEventListener('click', () => generaAdattiva(true));
      cont.querySelectorAll('[data-giorno-adattiva]').forEach(b => b.addEventListener('click', () => {
        giornoSelezionatoAdattiva = parseInt(b.dataset.giornoAdattiva, 10);
        render();
      }));
    } else {
      document.getElementById('btn-aggiungi-giorno-perso').addEventListener('click', async () => {
        const scheda = Dati.stato().schedaPersonalizzata;
        scheda.giorni.push({ id: Dati.generaId('giornoperso'), etichetta: `Giorno ${scheda.giorni.length + 1}`, esercizi: [] });
        await Dati.salvaSchedaPersonalizzata(scheda);
        render();
      });
      cont.querySelectorAll('[data-aggiungi-esercizio-perso]').forEach(b => b.addEventListener('click', () => apriFormEsercizioPerso(parseInt(b.dataset.aggiungiEsercizioPerso, 10))));
      cont.querySelectorAll('.btn-duplica-giorno-perso').forEach(b => b.addEventListener('click', async () => {
        const scheda = Dati.stato().schedaPersonalizzata;
        const originale = scheda.giorni[parseInt(b.dataset.indice, 10)];
        scheda.giorni.push({ id: Dati.generaId('giornoperso'), etichetta: originale.etichetta + ' (copia)', esercizi: JSON.parse(JSON.stringify(originale.esercizi)) });
        await Dati.salvaSchedaPersonalizzata(scheda);
        window.App.mostraToast('Giorno duplicato.');
        render();
      }));
      cont.querySelectorAll('.btn-elimina-giorno-perso').forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Eliminare questo giorno?')) return;
        const scheda = Dati.stato().schedaPersonalizzata;
        scheda.giorni.splice(parseInt(b.dataset.indice, 10), 1);
        await Dati.salvaSchedaPersonalizzata(scheda);
        render();
      }));
      cont.querySelectorAll('.btn-rinomina-giorno-perso').forEach(b => b.addEventListener('click', async () => {
        const scheda = Dati.stato().schedaPersonalizzata;
        const indice = parseInt(b.dataset.indice, 10);
        const nuovoNome = window.prompt ? prompt('Nuovo nome del giorno:', scheda.giorni[indice].etichetta) : null;
        if (nuovoNome && nuovoNome.trim()) {
          scheda.giorni[indice].etichetta = nuovoNome.trim();
          await Dati.salvaSchedaPersonalizzata(scheda);
          render();
        }
      }));
    }

    cont.querySelectorAll('[data-registra-tipo]').forEach(b => b.addEventListener('click', async () => {
      await Dati.registraWorkoutGiorno(DataUtils.oggiISO(), {
        schedaTipo: b.dataset.registraTipo,
        etichetta: b.dataset.registraEtichetta,
        completato: true
      });
      window.App.mostraToast('Allenamento registrato per oggi.');
      render();
    }));

    cont.querySelectorAll('.btn-rimuovi-workout-oggi').forEach(b => b.addEventListener('click', async () => {
      await Dati.rimuoviWorkoutGiorno(DataUtils.oggiISO(), parseInt(b.dataset.indice, 10));
      render();
    }));
  }

  async function generaAdattiva(conConferma) {
    if (conConferma && !confirm('Rigenerare la scheda adattiva? Quella attuale verrà sostituita.')) return;
    const pw = Dati.stato().profiloWorkout;
    const giorni = GeneratorePianoWorkout.generaSchedaAdattiva(pw.giorniDisponibili, obiettivoCorrente(), pw.livello);
    giornoSelezionatoAdattiva = 0;
    await Dati.salvaSchedaAdattiva({ generataIl: DataUtils.oggiISO(), giorni });
    window.App.mostraToast('Scheda adattiva generata.');
    render();
  }

  return { render };
})();

window.UiWorkout = UiWorkout;
