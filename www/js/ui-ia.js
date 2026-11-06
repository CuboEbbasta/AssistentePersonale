/**
 * ui-ia.js
 * Sezione IA: si collega a un server esterno a scelta (Ollama, oppure uno
 * compatibile OpenAI come LiteLLM o LM Studio; PC di casa o setup Termux) —
 * mai un modello sul telefono stesso. Chat: scrivi cosa vuoi e l'IA risponde.
 * Se chiedi di creare o modificare qualcosa (routine, task, obiettivi, diario,
 * pasti, sonno) prepara una PROPOSTA con anteprima e bottoni Applica / Ignora:
 * non modifica mai nulla da sola. La logica (prompt, estrazione del JSON,
 * normalizzazione, validazione) è in core/assistente.js; qui c'è solo l'interfaccia.
 *
 * SICUREZZA: tutto il testo che arriva dall'IA è trattato come dato non fidato
 * e inserito SOLO con textContent / nodi DOM, mai come HTML.
 */
const UiIA = (function () {
  // Conversazione in memoria: [{ruolo:'utente'|'assistente', testo, proposta?, anteprima?, esito?, avviso?}]
  // esito: 'attesa' | 'applicata' | 'ignorata'
  let cronologia = [];
  let inAttesa = false;            // richiesta in corso (anti doppio invio)
  const inApplicazione = new Set(); // proposte con "Applica" in corso (anti doppio clic)
  let sequenza = 0;

  function el(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined && testo !== null) e.textContent = String(testo);
    return e;
  }

  function oggi() { return DataUtils.oggiISO(); }

  // ---- disegno della chat (solo DOM + textContent) ----

  function bollaUtente(msg) {
    const b = el('div', 'card-flat');
    b.style.marginBottom = '8px';
    b.style.background = 'var(--accent-soft)';
    b.appendChild(el('strong', null, 'Tu: '));
    b.appendChild(document.createTextNode(msg.testo));
    return b;
  }

  function bollaAssistente(msg) {
    const b = el('div', 'card-flat');
    b.style.marginBottom = '8px';
    b.appendChild(el('strong', null, 'IA: '));
    b.appendChild(document.createTextNode(msg.testo));
    if (msg.proposta) b.appendChild(schedaProposta(msg));
    return b;
  }

  function schedaProposta(msg) {
    const p = msg.proposta;
    const scheda = el('div');
    scheda.style.cssText = 'margin-top:8px;padding:8px;border:1px solid var(--accent);border-radius:8px;';
    scheda.setAttribute('data-proposta-ia', p.id);
    scheda.appendChild(el('div', 'elemento-meta', 'Proposta (non ancora applicata)'));
    const ul = el('ul');
    ul.style.margin = '6px 0 6px 18px';
    (p.anteprima || []).forEach(r => ul.appendChild(el('li', null, r)));
    scheda.appendChild(ul);

    if (msg.esito === 'applicata') { scheda.appendChild(el('div', 'elemento-meta', 'Applicata.')); return scheda; }
    if (msg.esito === 'ignorata') { scheda.appendChild(el('div', 'elemento-meta', 'Ignorata.')); return scheda; }

    // in attesa: ricontrolla che sia ancora applicabile sui dati di adesso
    const verifica = NucleoProposte.controllaApplicabile(Dati.stato(), p, oggi());
    const applicabile = verifica.stato === 'applicabile';
    if (!applicabile || msg.avviso) {
      const box = el('div', 'elemento-meta');
      box.setAttribute('data-avviso', '1');
      if (!applicabile) {
        box.appendChild(el('strong', null, verifica.stato === 'obsoleta' ? 'Non più applicabile: i dati sono cambiati. ' : 'Non applicabile. '));
        box.appendChild(document.createTextNode((verifica.motivi || []).join('; ')));
      } else box.textContent = msg.avviso;
      scheda.appendChild(box);
    }
    const riga = el('div', 'riga-btn');
    if (applicabile) {
      const bA = el('button', 'btn btn-sm btn-ok');
      bA.type = 'button';
      bA.setAttribute('data-azione', 'applica');
      bA.innerHTML = Icone.svg('check', 14) + ' ';
      bA.appendChild(document.createTextNode('Applica'));
      bA.disabled = inApplicazione.has(msg.idMessaggio);
      bA.addEventListener('click', () => applica(msg));
      riga.appendChild(bA);
    }
    const bI = el('button', 'btn btn-sm btn-ghost', 'Ignora');
    bI.type = 'button';
    bI.setAttribute('data-azione', 'ignora');
    bI.addEventListener('click', () => { msg.esito = 'ignorata'; renderChat(); });
    riga.appendChild(bI);
    scheda.appendChild(riga);
    return scheda;
  }

  function renderChat() {
    const cont = document.getElementById('ia-chat');
    if (!cont) return;
    cont.textContent = '';
    if (!cronologia.length) {
      cont.appendChild(el('div', 'vuoto', 'Scrivi qualcosa qui sotto per iniziare. Puoi chiedere di aggiungere o cambiare routine, task, obiettivi, diario, pasti e sonno: vedrai un\'anteprima e deciderai tu.'));
      return;
    }
    cronologia.forEach(msg => cont.appendChild(msg.ruolo === 'utente' ? bollaUtente(msg) : bollaAssistente(msg)));
    if (inAttesa) cont.appendChild(el('div', 'elemento-meta', 'L\'IA sta pensando…'));
    cont.scrollTop = cont.scrollHeight;
  }

  // ---- Applica ----

  async function applica(msg) {
    if (inApplicazione.has(msg.idMessaggio) || msg.esito) return;
    inApplicazione.add(msg.idMessaggio);
    msg.avviso = '';
    renderChat();
    try {
      const r = NucleoProposte.applicaProposta(Dati.stato(), msg.proposta, { oggiISO: oggi(), generaId: Dati.generaId });
      if (!r.ok) {
        msg.avviso = 'Non applicabile: ' + (r.motivi || []).join('; ');
        return;
      }
      const salvato = await Dati.sostituisciStato(r.stato);
      if (!salvato) {
        msg.avviso = 'Non sono riuscito a salvare i dati: la modifica NON è stata applicata. Riprova.';
        return;
      }
      msg.esito = 'applicata';
      if (window.App && window.App.aggiornaTutto) window.App.aggiornaTutto();
      if (window.App && window.App.mostraToast) window.App.mostraToast('Modifica applicata.');
    } catch (e) {
      msg.avviso = 'Operazione non riuscita. Riprova.';
    } finally {
      inApplicazione.delete(msg.idMessaggio);
      renderChat();
    }
  }

  // ---- Invio della richiesta ----

  function aggiornaStatoInvio() {
    const b = document.getElementById('btn-ia-invia');
    const i = document.getElementById('ia-input');
    if (b) b.disabled = inAttesa;
    if (i) i.disabled = inAttesa;
  }

  async function inviaRichiesta(testo) {
    if (inAttesa || !testo) return;
    const precedenti = cronologia.slice(); // conversazione prima di questa richiesta
    cronologia.push({ ruolo: 'utente', testo });
    inAttesa = true;
    aggiornaStatoInvio();
    renderChat();
    let esito;
    try {
      esito = await NucleoAssistente.elabora({
        testo, stato: Dati.stato(), oggiISO: oggi(), adessoISO: new Date().toISOString(), generaId: Dati.generaId,
        cronologia: precedenti,
        chiama: (prompt, sistema) => ClienteIA.chiamaIA(prompt, sistema, { json: true, think: false })
      });
    } catch (e) {
      esito = { ok: false, errore: 'Operazione non riuscita. Riprova.' };
    }
    inAttesa = false;
    if (!esito.ok) {
      cronologia.push({ ruolo: 'assistente', testo: 'Errore: ' + esito.errore });
    } else if (esito.errori.length) {
      cronologia.push({ ruolo: 'assistente', testo: esito.messaggio });
    } else {
      const msg = { ruolo: 'assistente', testo: esito.risposta || (esito.proposta ? 'Ecco la proposta.' : 'Fatto.') };
      if (esito.proposta) {
        msg.proposta = esito.proposta;
        msg.anteprima = esito.proposta.anteprima;
        msg.esito = null;
        msg.idMessaggio = 'ia_' + (++sequenza);
      }
      cronologia.push(msg);
    }
    renderChat();
    aggiornaStatoInvio();
    const input = document.getElementById('ia-input');
    if (input) input.focus();
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
          <input type="text" id="ia-input" placeholder="Es. Aggiungi la routine Palestra il lunedì alle 18" style="flex:1;padding:9px 10px;border:1px solid var(--border-strong);border-radius:8px;">
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

    const invia = () => {
      const input = document.getElementById('ia-input');
      const testo = input.value.trim();
      if (!testo || inAttesa) return;
      input.value = '';
      inviaRichiesta(testo);
    };
    document.getElementById('btn-ia-invia').addEventListener('click', invia);
    document.getElementById('ia-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') invia(); });
    aggiornaStatoInvio();
  }

  return { render, estraiJSON: NucleoAssistente.estraiJSON };
})();

window.UiIA = UiIA;
