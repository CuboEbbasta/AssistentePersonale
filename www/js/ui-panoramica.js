/**
 * ui-panoramica.js
 * Raggruppa le viste "oltre il giorno": vista mese (calendario + torta),
 * vista anno (periodi + torta), storico/recap. L'orario fisso è stato
 * spostato nella sezione Fare (vedi ui-orario.js).
 */
const UiPanoramica = (function () {
  let sottoVista = 'mese'; // 'mese' | 'anno' | 'storico'
  let meseVisualizzato = DataUtils.primoGiornoMese(DataUtils.oggiISO());
  let recapPeriodo = 'settimana'; // 'settimana' | 'mese'

  const COLORI_TIPO_PERIODO = { esami: '#B24F3C', studio: '#B8863E', lavoro: '#2F7D6E', altro: '#5B6BB0' };
  const ETICHETTE_TIPO_PERIODO = { esami: 'Esami', studio: 'Studio', lavoro: 'Lavoro', altro: 'Altro' };

  function renderSottoNav() {
    const opzioni = [['mese', 'Mese'], ['anno', 'Anno'], ['storico', 'Storico']];
    return `<div class="riga-btn" id="panoramica-subnav" style="margin-bottom:14px;">
      ${opzioni.map(([v, l]) => `<button type="button" class="btn btn-sm ${sottoVista === v ? 'btn-primary' : ''}" data-sv="${v}">${l}</button>`).join('')}
    </div>`;
  }

  // =================================================================
  // MESE
  // =================================================================
  function coloreAderenza(perc) {
    if (perc == null) return 'var(--surface-alt)';
    if (perc >= 75) return 'var(--ok)';
    if (perc >= 40) return 'var(--accent)';
    return 'var(--warn)';
  }

  function renderMese() {
    const oggi = DataUtils.oggiISO();
    const giorni = DataUtils.giorniDelMese(meseVisualizzato);
    const primoGiorno = giorni[0];
    const offsetIniziale = DataUtils.weekdayISO(primoGiorno) - 1; // 0 = lunedì

    let celle = '';
    for (let i = 0; i < offsetIniziale; i++) celle += '<div></div>';
    giorni.forEach(g => {
      const isFuturo = g > oggi;
      const stats = isFuturo ? null : UiOggi.calcolaStatistiche(g);
      const haOrario = Dati.stato().orarioFisso.some(o => o.giorno === DataUtils.weekdayISO(g));
      const colore = isFuturo ? 'var(--surface-alt)' : coloreAderenza(stats && stats.totali ? stats.percCompletate : null);
      const isOggi = g === oggi;
      celle += `
        <div style="aspect-ratio:1;border-radius:8px;background:${colore};display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;font-family:var(--font-mono);color:${isFuturo?'var(--ink-faint)':'#fff'};${isOggi?'box-shadow:0 0 0 2px var(--ink) inset;':''}position:relative;">
          ${parseInt(g.slice(-2), 10)}
          ${haOrario ? '<span style="position:absolute;bottom:2px;width:4px;height:4px;border-radius:50%;background:currentColor;opacity:0.8;"></span>' : ''}
        </div>`;
    });

    const minutiPerRoutine = {};
    giorni.filter(g => g <= oggi).forEach(g => {
      const log = Dati.stato().log[g];
      if (!log) return;
      Dati.stato().routine.forEach(r => {
        if (log.completamenti[`routine:${r.id}`] === true) {
          minutiPerRoutine[r.nome] = (minutiPerRoutine[r.nome] || 0) + r.durataMinuti;
        }
      });
    });
    const fetteMese = Object.entries(minutiPerRoutine).map(([nome, min], i) => ({
      nome, valore: min, colore: UiRoutine.coloreDaPriorita(((i * 3) % 9) + 1)
    }));

    return `
      ${renderSottoNav()}
      <div class="card">
        <div class="riga-btn" style="justify-content:space-between;align-items:center;margin-bottom:10px;">
          <button class="btn btn-sm" id="btn-mese-prev">${Icone.svg('indietro', 16)}</button>
          <strong>${DataUtils.nomeMeseAnno(meseVisualizzato)}</strong>
          <button class="btn btn-sm" id="btn-mese-next">${Icone.svg('avanti', 16)}</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
          ${DataUtils.NOMI_GIORNI.map(n => `<div style="text-align:center;font-size:10px;color:var(--ink-faint);font-family:var(--font-mono);">${n}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${celle}</div>
        <div class="elemento-meta" style="margin-top:10px;">Colore = aderenza del giorno (verde alta, ambra media, rosso bassa). Il punto = c'è un orario fisso quel giorno.</div>
      </div>
      <div class="card">
        <h3>Come hai speso il tempo questo mese</h3>
        ${fetteMese.length ? `
        <div class="quadrante-wrap"><div>${Quadrante.renderTortaGenerica(fetteMese, 220)}</div></div>
        <div class="quadrante-legenda">
          ${fetteMese.map(f => `<div class="legenda-riga"><span class="legenda-swatch" style="background:${f.colore}"></span><span class="legenda-nome">${UiRoutine.escapeHtml(f.nome)}</span><span class="legenda-tempo">${(f.valore/60).toFixed(1)} h</span></div>`).join('')}
        </div>` : '<div class="vuoto">Ancora nessuna routine completata questo mese.</div>'}
      </div>
    `;
  }

  function wireMese(cont) {
    document.getElementById('btn-mese-prev').addEventListener('click', () => { meseVisualizzato = DataUtils.meseSuccessivo(meseVisualizzato, -1); render(); });
    document.getElementById('btn-mese-next').addEventListener('click', () => { meseVisualizzato = DataUtils.meseSuccessivo(meseVisualizzato, 1); render(); });
  }

  // =================================================================
  // ANNO (12 mesi)
  // =================================================================
  function periodoDelGiorno(dataISO) {
    return Dati.stato().periodiAnno.find(p => dataISO >= p.dataInizio && dataISO <= p.dataFine);
  }

  function renderAnno() {
    const oggi = DataUtils.oggiISO();
    const anno = DataUtils.isoToData(oggi).getFullYear();
    const periodi = Dati.stato().periodiAnno.slice().sort((a, b) => a.dataInizio.localeCompare(b.dataInizio));

    const meseBlocchi = DataUtils.NOMI_MESI.map((nomeMese, i) => {
      const isoMese = `${anno}-${DataUtils.pad2(i + 1)}-01`;
      const coperti = periodi.filter(p => p.dataInizio <= DataUtils.fineMese(isoMese) && p.dataFine >= isoMese);
      return `
        <div class="card-flat" style="padding:8px 10px;">
          <div style="font-size:11px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;">${nomeMese.slice(0,3)}</div>
          ${coperti.length ? coperti.map(p => `<div class="badge" style="background:${COLORI_TIPO_PERIODO[p.tipo]}22;color:${COLORI_TIPO_PERIODO[p.tipo]};margin-top:4px;display:block;width:fit-content;">${UiRoutine.escapeHtml(p.titolo)}</div>`).join('') : ''}
        </div>`;
    }).join('');

    const inizioAnno = `${anno}-01-01`, fineAnno = `${anno}-12-31`;
    const conteggi = { esami: 0, studio: 0, lavoro: 0, altro: 0, libero: 0 };
    let cursore = inizioAnno;
    while (cursore <= fineAnno) {
      const p = periodoDelGiorno(cursore);
      conteggi[p ? p.tipo : 'libero']++;
      cursore = DataUtils.addGiorni(cursore, 1);
    }
    const fetteAnno = Object.entries(conteggi).filter(([, v]) => v > 0).map(([tipo, v]) => ({
      nome: tipo === 'libero' ? 'Nessun periodo' : ETICHETTE_TIPO_PERIODO[tipo],
      valore: v, colore: tipo === 'libero' ? Quadrante.COLORE_LIBERO : COLORI_TIPO_PERIODO[tipo]
    }));

    return `
      ${renderSottoNav()}
      <div class="card">
        <h3>Periodi dell'anno ${anno}</h3>
        <div class="elemento-meta" style="margin-bottom:10px;">Utile per segnare sessioni d'esame, periodi di studio intenso o di lavoro.</div>
        <button class="btn btn-sm btn-accent btn-block" id="btn-nuovo-periodo" style="margin-bottom:12px;">+ Nuovo periodo</button>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">${meseBlocchi}</div>
      </div>
      <div class="card">
        <h3>Elenco periodi</h3>
        <div id="lista-periodi">${renderListaPeriodi(periodi)}</div>
      </div>
      <div class="card">
        <h3>Com'è andato l'anno</h3>
        <div class="quadrante-wrap"><div>${Quadrante.renderTortaGenerica(fetteAnno, 220)}</div></div>
        <div class="quadrante-legenda">
          ${fetteAnno.map(f => `<div class="legenda-riga"><span class="legenda-swatch" style="background:${f.colore}"></span><span class="legenda-nome">${UiRoutine.escapeHtml(f.nome)}</span><span class="legenda-tempo">${f.valore} gg</span></div>`).join('')}
        </div>
      </div>
    `;
  }

  function renderListaPeriodi(periodi) {
    if (!periodi.length) return '<div class="vuoto">Nessun periodo ancora.</div>';
    return periodi.map((p) => {
      const indice = Dati.stato().periodiAnno.indexOf(p);
      return `
      <div class="elemento-riga" data-indice="${indice}">
        <div class="priorita-pill" style="background:${COLORI_TIPO_PERIODO[p.tipo]}"></div>
        <div class="elemento-corpo">
          <div class="elemento-titolo">${UiRoutine.escapeHtml(p.titolo)}</div>
          <div class="elemento-meta"><span class="badge badge-accent">${ETICHETTE_TIPO_PERIODO[p.tipo]}</span> ${DataUtils.formatDataBreve(p.dataInizio)} → ${DataUtils.formatDataBreve(p.dataFine)}</div>
        </div>
        <div class="elemento-azioni">
          <button class="icon-btn btn-modifica-periodo" data-indice="${indice}">${Icone.svg('edit', 16)}</button>
          <button class="icon-btn btn-elimina-periodo" data-indice="${indice}">${Icone.svg('delete', 16)}</button>
        </div>
      </div>`;
    }).join('');
  }

  function apriFormPeriodo(indiceEsistente) {
    const esistente = indiceEsistente != null ? Dati.stato().periodiAnno[indiceEsistente] : null;
    const p = esistente || { titolo: '', tipo: 'studio', dataInizio: DataUtils.oggiISO(), dataFine: DataUtils.addGiorni(DataUtils.oggiISO(), 7), note: '' };
    const html = `
      <div class="foglio-header"><h2>${esistente ? 'Modifica periodo' : 'Nuovo periodo'}</h2><button class="icon-btn" id="btn-chiudi-foglio">${Icone.svg('close', 18)}</button></div>
      <div class="campo"><label>Titolo</label><input type="text" id="f-titolo-periodo" value="${UiRoutine.escapeHtml(p.titolo)}" placeholder="Es. Sessione esami estiva"></div>
      <div class="campo"><label>Tipo</label>
        <select id="f-tipo-periodo">${Object.keys(ETICHETTE_TIPO_PERIODO).map(k => `<option value="${k}" ${p.tipo===k?'selected':''}>${ETICHETTE_TIPO_PERIODO[k]}</option>`).join('')}</select>
      </div>
      <div class="griglia-2">
        <div class="campo"><label>Dal</label><input type="date" id="f-inizio-periodo" value="${p.dataInizio}"></div>
        <div class="campo"><label>Al</label><input type="date" id="f-fine-periodo" value="${p.dataFine}"></div>
      </div>
      <div class="riga-btn" style="margin-top:16px;"><button class="btn btn-primary btn-block" id="btn-salva-periodo">Salva</button></div>
    `;
    window.App.apriFoglio(html);
    document.getElementById('btn-chiudi-foglio').addEventListener('click', window.App.chiudiFoglio);
    document.getElementById('btn-salva-periodo').addEventListener('click', async () => {
      const titolo = document.getElementById('f-titolo-periodo').value.trim();
      if (!titolo) { window.App.mostraToast('Dai un titolo al periodo.'); return; }
      const nuovo = {
        id: esistente ? p.id : Dati.generaId('periodo'),
        titolo, tipo: document.getElementById('f-tipo-periodo').value,
        dataInizio: document.getElementById('f-inizio-periodo').value,
        dataFine: document.getElementById('f-fine-periodo').value,
        note: ''
      };
      const elenco = Dati.stato().periodiAnno;
      if (indiceEsistente != null) elenco[indiceEsistente] = nuovo; else elenco.push(nuovo);
      await Dati.salvaPeriodiAnno(elenco);
      window.App.chiudiFoglio();
      window.App.mostraToast('Periodo salvato.');
      render();
    });
  }

  function wireAnno(cont) {
    document.getElementById('btn-nuovo-periodo').addEventListener('click', () => apriFormPeriodo(null));
    cont.querySelectorAll('.btn-modifica-periodo').forEach(b => b.addEventListener('click', () => apriFormPeriodo(parseInt(b.dataset.indice, 10))));
    cont.querySelectorAll('.btn-elimina-periodo').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Eliminare questo periodo?')) return;
      const elenco = Dati.stato().periodiAnno;
      elenco.splice(parseInt(b.dataset.indice, 10), 1);
      await Dati.salvaPeriodiAnno(elenco);
      render();
    }));
  }

  // =================================================================
  // STORICO / RECAP
  // =================================================================
  function rigaConfronto(etichetta, corrente, precedente, unita, invertiMiglioramento) {
    unita = unita || '';
    if (corrente == null) return `<div class="legenda-riga"><span class="legenda-nome">${etichetta}</span><span class="legenda-tempo">— dati insufficienti</span></div>`;
    let delta = '';
    if (precedente != null) {
      const diff = Math.round((corrente - precedente) * 100) / 100;
      const migliora = invertiMiglioramento ? diff < 0 : diff > 0;
      const colore = diff === 0 ? 'var(--ink-faint)' : (migliora ? 'var(--ok)' : 'var(--warn)');
      const segno = diff > 0 ? '+' : '';
      delta = ` <span style="color:${colore};font-family:var(--font-mono);font-size:12px;">(${segno}${diff}${unita})</span>`;
    }
    return `<div class="legenda-riga"><span class="legenda-nome">${etichetta}</span><span class="legenda-tempo">${corrente}${unita}${delta}</span></div>`;
  }

  function renderStorico() {
    const recap = recapPeriodo === 'settimana' ? CalcoloRecap.recapSettimanale() : CalcoloRecap.recapMensile();
    const { corrente, precedente } = recap;
    return `
      ${renderSottoNav()}
      <div class="card">
        <div class="riga-btn" style="margin-bottom:12px;">
          <button class="btn btn-sm ${recapPeriodo === 'settimana' ? 'btn-primary' : ''}" data-rp="settimana">Ultimi 7 giorni</button>
          <button class="btn btn-sm ${recapPeriodo === 'mese' ? 'btn-primary' : ''}" data-rp="mese">Ultimi 30 giorni</button>
        </div>
        <div class="elemento-meta" style="margin-bottom:10px;">Dal ${DataUtils.formatDataBreve(corrente.dataInizio)} al ${DataUtils.formatDataBreve(corrente.dataFine)}, confrontato col periodo immediatamente precedente. ${corrente.giorniViaggio ? `(${corrente.giorniViaggio} giorno/i "viaggio" escluso/i dalle medie)` : ''}</div>
        ${rigaConfronto('Aderenza media', corrente.aderenzaMedia, precedente.aderenzaMedia, '%')}
        ${rigaConfronto('Pesata per priorità', corrente.pesataMedia, precedente.pesataMedia, '%')}
        ${rigaConfronto('Voto medio diario', corrente.votoMedio, precedente.votoMedio, '')}
        ${rigaConfronto('Peso', corrente.variazionePeso, null, ' kg', true)}
        <div class="legenda-riga"><span class="legenda-nome">Task completate</span><span class="legenda-tempo">${corrente.taskCompletate}/${corrente.taskTotali}</span></div>
      </div>
    `;
  }

  function wireStorico(cont) {
    cont.querySelectorAll('[data-rp]').forEach(b => b.addEventListener('click', () => { recapPeriodo = b.dataset.rp; render(); }));
  }

  // =================================================================
  function render() {
    const cont = document.getElementById('panoramica-corpo');
    if (sottoVista === 'mese') { cont.innerHTML = renderMese(); wireSubnav(cont); wireMese(cont); }
    else if (sottoVista === 'anno') { cont.innerHTML = renderAnno(); wireSubnav(cont); wireAnno(cont); }
    else { cont.innerHTML = renderStorico(); wireSubnav(cont); wireStorico(cont); }
  }

  function wireSubnav(cont) {
    cont.querySelectorAll('#panoramica-subnav [data-sv]').forEach(b => b.addEventListener('click', () => { sottoVista = b.dataset.sv; render(); }));
  }

  return { render };
})();

window.UiPanoramica = UiPanoramica;
