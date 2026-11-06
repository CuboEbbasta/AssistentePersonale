/**
 * ui-ia.js
 * Sezione IA: si collega a un server esterno a scelta (Ollama, oppure uno
 * compatibile OpenAI come LiteLLM o LM Studio; PC di casa o setup Termux) —
 * mai un modello sul telefono stesso. Chat semplice: scrivi
 * cosa vuoi, l'IA risponde e può proporre modifiche ai tuoi dati (solo su
 * campi di testo libero come nome/descrizione/note), che vedi in anteprima
 * e applichi tu con un tocco. Non modifica mai nulla da sola.
 */
const UiIA = (function () {
  // Whitelist di sicurezza: l'IA può proporre modifiche SOLO a questi campi.
  const CAMPI_MODIFICABILI = {
    routine: { array: 'routine', campi: ['nome', 'descrizione'] },
    task: { array: 'task', campi: ['nome', 'note'] },
    obiettivo: { array: 'obiettivi', campi: ['titolo', 'descrizione'] }
  };

  let cronologia = []; // [{ruolo:'utente'|'assistente', testo, modifiche:[...]}]

  function costruisciContesto() {
    const s = Dati.stato();
    return {
      routine: s.routine.map(r => ({ id: r.id, nome: r.nome, tipo: r.tipo, descrizione: r.descrizione || '' })),
      task: s.task.filter(t => !t.completata).slice(0, 30).map(t => ({ id: t.id, nome: t.nome, note: t.note || '', scadenza: t.scadenza })),
      obiettivi: s.obiettivi.map(o => ({ id: o.id, titolo: o.titolo, tipo: o.tipo, descrizione: o.descrizione || '' }))
    };
  }

  function promptSistema() {
    return `Sei l'assistente dentro un'app di produttività personale, in italiano.
Ricevi il contesto attuale dei dati dell'utente in JSON. Rispondi SEMPRE e SOLO con un
oggetto JSON valido, senza testo prima o dopo, con questa forma esatta:
{"risposta": "testo della tua risposta per l'utente", "modifiche": [{"tipo":"routine|task|obiettivo","id":"...","campo":"nome|descrizione|note|titolo","nuovoValore":"..."}]}
Il campo "modifiche" è un array (anche vuoto se non proponi nessuna modifica).
Puoi proporre modifiche SOLO ai campi indicati sopra, riferendoti sempre a un id
realmente presente nel contesto fornito. Non inventare id. Se non sei sicuro, lascia
"modifiche" vuoto e chiedi chiarimenti nella risposta.
Contesto attuale: ${JSON.stringify(costruisciContesto())}`;
  }

  function estraiJSON(testo) {
    try { return JSON.parse(testo); } catch (e) { /* prova a isolare il primo blocco {...} */ }
    const inizio = testo.indexOf('{'), fine = testo.lastIndexOf('}');
    if (inizio === -1 || fine === -1) return null;
    try { return JSON.parse(testo.slice(inizio, fine + 1)); } catch (e) { return null; }
  }

  function validaModifica(m) {
    if (!m || !m.tipo || !m.id || !m.campo) return false;
    const regola = CAMPI_MODIFICABILI[m.tipo];
    if (!regola || !regola.campi.includes(m.campo)) return false;
    const entita = Dati.stato()[regola.array].find(x => x.id === m.id);
    return !!entita;
  }

  async function applicaModifica(m, bottone) {
    const regola = CAMPI_MODIFICABILI[m.tipo];
    const entita = Dati.stato()[regola.array].find(x => x.id === m.id);
    if (!entita) { window.App.mostraToast('Elemento non più esistente.'); return; }
    entita[m.campo] = m.nuovoValore;
    await Dati.salva();
    window.App.aggiornaTutto();
    bottone.closest('.card-flat').innerHTML = '<div class="elemento-meta">Modifica applicata.</div>';
  }

  function renderMessaggio(msg) {
    const bolla = msg.ruolo === 'utente'
      ? `<div class="card-flat" style="margin-bottom:8px;background:var(--accent-soft);"><strong>Tu:</strong> ${UiRoutine.escapeHtml(msg.testo)}</div>`
      : `<div class="card-flat" style="margin-bottom:8px;"><strong>IA:</strong> ${UiRoutine.escapeHtml(msg.testo)}</div>`;

    let modificheHtml = '';
    if (msg.modifiche && msg.modifiche.length) {
      modificheHtml = msg.modifiche.filter(validaModifica).map(m => {
        const regola = CAMPI_MODIFICABILI[m.tipo];
        const entita = Dati.stato()[regola.array].find(x => x.id === m.id);
        const nomeAttuale = entita.nome || entita.titolo;
        return `
        <div class="card-flat" style="margin-bottom:8px;border:1px solid var(--accent);">
          <div class="elemento-meta">Proposta per <strong>${UiRoutine.escapeHtml(nomeAttuale)}</strong> (${UiRoutine.escapeHtml(m.tipo)}, campo "${UiRoutine.escapeHtml(m.campo)}")</div>
          <div style="margin:6px 0;font-size:13.5px;">${UiRoutine.escapeHtml(m.nuovoValore)}</div>
          <div class="riga-btn">
            <button class="btn btn-sm btn-ok btn-applica-modifica">${Icone.svg('check', 14)} Applica</button>
            <button class="btn btn-sm btn-ghost btn-ignora-modifica">Ignora</button>
          </div>
        </div>`;
      }).join('');
    }
    return bolla + modificheHtml;
  }

  function renderChat() {
    const cont = document.getElementById('ia-chat');
    if (!cronologia.length) {
      cont.innerHTML = '<div class="vuoto">Scrivi qualcosa qui sotto per iniziare.</div>';
      return;
    }
    cont.innerHTML = cronologia.map(renderMessaggio).join('');
    const bottoniApplica = cont.querySelectorAll('.btn-applica-modifica');
    const bottoniIgnora = cont.querySelectorAll('.btn-ignora-modifica');
    let cursore = 0;
    cronologia.forEach(msg => {
      (msg.modifiche || []).filter(validaModifica).forEach(m => {
        const bApplica = bottoniApplica[cursore], bIgnora = bottoniIgnora[cursore];
        if (bApplica) bApplica.addEventListener('click', () => applicaModifica(m, bApplica));
        if (bIgnora) bIgnora.addEventListener('click', () => { bIgnora.closest('.card-flat').remove(); });
        cursore++;
      });
    });
    cont.scrollTop = cont.scrollHeight;
  }

  const TESTI_TIPO = {
    ollama: { segnaposto: 'http://localhost:11434', aiuto: 'Non gira sul telefono: si collega a un server Ollama, di solito quello del tuo PC sulla stessa rete WiFi. Su PC di norma va bene "localhost".' },
    openai: { segnaposto: 'http://localhost:4000', aiuto: "Qualunque server compatibile OpenAI (LiteLLM, LM Studio, llama.cpp, vLLM, OpenRouter...). Se l'indirizzo finisce già con /v1 non viene duplicato." }
  };
  const MODELLO_MANUALE = '__manuale__';
  let modelliNoti = []; // ultimo elenco ottenuto da "Verifica connessione"

  function renderImpostazioni() {
    const cfg = Dati.stato().impostazioniIA;
    const tipo = cfg.tipoServer === 'openai' ? 'openai' : 'ollama';
    return `
      <div class="card">
        <h3>Server IA</h3>
        <div class="elemento-meta" id="ia-aiuto-tipo" style="margin-bottom:10px;"></div>
        <div class="campo">
          <label>Abilitata</label>
          <div class="riga-btn">
            <button class="btn btn-sm ${cfg.abilitata ? 'btn-primary' : ''}" id="btn-ia-on">Sì</button>
            <button class="btn btn-sm ${!cfg.abilitata ? 'btn-primary' : ''}" id="btn-ia-off">No</button>
          </div>
        </div>
        <div class="campo">
          <label>Tipo di server</label>
          <select id="f-ia-tipo">
            <option value="ollama" ${tipo === 'ollama' ? 'selected' : ''}>Ollama</option>
            <option value="openai" ${tipo === 'openai' ? 'selected' : ''}>Compatibile OpenAI: LiteLLM, LM Studio…</option>
          </select>
        </div>
        <div class="campo">
          <label>Indirizzo server</label>
          <input type="text" id="f-ia-indirizzo" value="${UiRoutine.escapeHtml(cfg.indirizzoServer)}" placeholder="${TESTI_TIPO[tipo].segnaposto}">
        </div>
        <div class="campo" id="campo-ia-chiave">
          <label>Chiave API (facoltativa)</label>
          <input type="password" id="f-ia-chiave" value="${UiRoutine.escapeHtml(cfg.chiaveApi || '')}" autocomplete="off">
          <div class="elemento-meta">La chiave resta salvata sul dispositivo, in chiaro, insieme agli altri tuoi dati; viene inviata solo al server indicato sopra.</div>
        </div>
        <div class="campo">
          <label>Modello</label>
          <select id="f-ia-modello"></select>
          <input type="text" id="f-ia-modello-manuale" style="margin-top:6px;" placeholder="Nome del modello, es. qwen3:8b">
        </div>
        <div class="riga-btn">
          <button class="btn btn-sm btn-accent" id="btn-ia-salva">Salva</button>
          <button class="btn btn-sm" id="btn-ia-test">Verifica connessione</button>
        </div>
        <div id="ia-test-risultato" class="elemento-meta" style="margin-top:8px;"></div>
      </div>
    `;
  }

  // Menu del modello: modelli noti + (se serve) quello salvato + "Altro…". Tutto via DOM/textContent.
  function riempiMenuModello(selezionato) {
    const sel = document.getElementById('f-ia-modello');
    const manuale = document.getElementById('f-ia-modello-manuale');
    const nomi = modelliNoti.slice();
    if (selezionato && selezionato !== MODELLO_MANUALE && !nomi.includes(selezionato)) {
      if (modelliNoti.length) { manuale.value = selezionato; selezionato = MODELLO_MANUALE; } // non è nell'elenco: nome a mano
      else nomi.unshift(selezionato);
    }
    sel.textContent = '';
    nomi.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
    const altro = document.createElement('option');
    altro.value = MODELLO_MANUALE;
    altro.textContent = 'Altro… (scrivi a mano)';
    sel.appendChild(altro);
    sel.value = selezionato || (nomi.length ? nomi[0] : MODELLO_MANUALE);
    aggiornaCampoManuale();
  }

  function aggiornaCampoManuale() {
    const mostra = document.getElementById('f-ia-modello').value === MODELLO_MANUALE;
    const manuale = document.getElementById('f-ia-modello-manuale');
    manuale.hidden = !mostra;
    manuale.style.display = mostra ? '' : 'none';
  }

  function modelloScelto() {
    const sel = document.getElementById('f-ia-modello');
    return sel.value === MODELLO_MANUALE ? document.getElementById('f-ia-modello-manuale').value.trim() : sel.value;
  }

  function tipoScelto() { return document.getElementById('f-ia-tipo').value === 'openai' ? 'openai' : 'ollama'; }

  function aggiornaCampiTipo() {
    const tipo = tipoScelto();
    const campoChiave = document.getElementById('campo-ia-chiave');
    campoChiave.hidden = tipo !== 'openai';
    campoChiave.style.display = tipo === 'openai' ? '' : 'none';
    document.getElementById('f-ia-indirizzo').placeholder = TESTI_TIPO[tipo].segnaposto;
    document.getElementById('ia-aiuto-tipo').textContent = TESTI_TIPO[tipo].aiuto;
  }

  function render() {
    const cont = document.getElementById('ia-corpo');
    cont.innerHTML = renderImpostazioni() + `
      <div class="card">
        <h3>Chiedi qualcosa</h3>
        <div id="ia-chat" style="max-height:340px;overflow-y:auto;margin-bottom:10px;"></div>
        <div class="riga-btn">
          <input type="text" id="ia-input" placeholder="Es. Aggiorna la descrizione della routine Palestra..." style="flex:1;padding:9px 10px;border:1px solid var(--border-strong);border-radius:8px;">
          <button class="btn btn-accent" id="btn-ia-invia">Invia</button>
        </div>
      </div>
    `;
    renderChat();

    document.getElementById('btn-ia-on').addEventListener('click', async () => { await Dati.salvaImpostazioniIA({ abilitata: true }); render(); });
    document.getElementById('btn-ia-off').addEventListener('click', async () => { await Dati.salvaImpostazioniIA({ abilitata: false }); render(); });
    riempiMenuModello(Dati.stato().impostazioniIA.modello);
    aggiornaCampiTipo();
    document.getElementById('f-ia-tipo').addEventListener('change', () => {
      const tipo = tipoScelto();
      const campoInd = document.getElementById('f-ia-indirizzo');
      const altro = tipo === 'openai' ? 'ollama' : 'openai';
      // se l'indirizzo è ancora quello predefinito dell'altro tipo, passa a quello del nuovo tipo
      if (!campoInd.value.trim() || campoInd.value.trim() === TESTI_TIPO[altro].segnaposto) campoInd.value = TESTI_TIPO[tipo].segnaposto;
      const modello = modelloScelto();
      modelliNoti = [];
      riempiMenuModello(modello);
      aggiornaCampiTipo();
    });
    document.getElementById('f-ia-modello').addEventListener('change', aggiornaCampoManuale);
    document.getElementById('btn-ia-salva').addEventListener('click', async () => {
      const tipo = tipoScelto();
      await Dati.salvaImpostazioniIA({
        tipoServer: tipo,
        indirizzoServer: document.getElementById('f-ia-indirizzo').value.trim() || TESTI_TIPO[tipo].segnaposto,
        chiaveApi: document.getElementById('f-ia-chiave').value.trim(),
        modello: modelloScelto() || (tipo === 'ollama' ? 'qwen3:8b' : '')
      });
      window.App.mostraToast('Impostazioni IA salvate.');
    });
    document.getElementById('btn-ia-test').addEventListener('click', async () => {
      const box = document.getElementById('ia-test-risultato');
      box.textContent = 'Verifica in corso…';
      const tipo = tipoScelto();
      const risultato = await ClienteIA.testConnessione({
        tipoServer: tipo,
        indirizzoServer: document.getElementById('f-ia-indirizzo').value.trim() || TESTI_TIPO[tipo].segnaposto,
        chiaveApi: document.getElementById('f-ia-chiave').value.trim()
      });
      if (!risultato.ok) { box.textContent = 'Non raggiungibile: ' + risultato.errore; return; }
      modelliNoti = (risultato.modelli || []).filter(m => typeof m === 'string');
      riempiMenuModello(modelloScelto());
      box.textContent = modelliNoti.length
        ? 'Connesso. Modelli disponibili: ' + modelliNoti.length + ' (scegli dal menu Modello).'
        : 'Connesso, ma il server non elenca modelli: scrivi il nome a mano (menu Modello, voce Altro).';
    });

    const invia = async () => {
      const input = document.getElementById('ia-input');
      const testo = input.value.trim();
      if (!testo) return;
      cronologia.push({ ruolo: 'utente', testo });
      input.value = '';
      renderChat();
      window.App.mostraToast('In attesa di risposta…');

      const risultato = await ClienteIA.chiamaIA(testo, promptSistema());
      if (!risultato.ok) {
        cronologia.push({ ruolo: 'assistente', testo: 'Errore: ' + risultato.errore, modifiche: [] });
      } else {
        const parsed = estraiJSON(risultato.testo);
        if (parsed && parsed.risposta) {
          cronologia.push({ ruolo: 'assistente', testo: parsed.risposta, modifiche: parsed.modifiche || [] });
        } else {
          cronologia.push({ ruolo: 'assistente', testo: risultato.testo, modifiche: [] });
        }
      }
      renderChat();
    };
    document.getElementById('btn-ia-invia').addEventListener('click', invia);
    document.getElementById('ia-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') invia(); });
  }

  return { render, estraiJSON, validaModifica, CAMPI_MODIFICABILI };
})();

window.UiIA = UiIA;
