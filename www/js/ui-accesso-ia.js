/**
 * ui-accesso-ia.js
 * Sezione «Accesso IA esterna» in Altro → Impostazioni (solo versione desktop:
 * richiede window.electronAPI.dati e window.electronAPI.accesso). Permette di
 * accendere il server MCP locale, creare e rimuovere i collegamenti (token) di
 * un'IA esterna (Claude, Hermes, ecc.) senza usare il terminale.
 *
 * SICUREZZA: nomi dei collegamenti e ogni altro testo non fidato entrano nel
 * DOM SOLO con textContent / nodi DOM, mai come HTML. Il token viene mostrato
 * una volta nel foglio di creazione e viene rimosso dal DOM (e dalla memoria)
 * alla chiusura del foglio, comunque venga chiuso.
 */
const UiAccessoIA = (function () {
  const SEZIONI = [
    { id: 'agenda', nome: 'Agenda', desc: 'routine, task, orario', sensibile: false, predef: true },
    { id: 'obiettivi', nome: 'Obiettivi', desc: 'obiettivi e tappe', sensibile: false, predef: true },
    { id: 'diario', nome: 'Diario', desc: 'le tue note serali', sensibile: true, predef: false },
    { id: 'dieta', nome: 'Dieta', desc: 'profilo, piano, pasti', sensibile: true, predef: false },
    { id: 'workout', nome: 'Workout', desc: 'schede e allenamenti', sensibile: true, predef: false },
    { id: 'sonno', nome: 'Sonno', desc: 'ore di sonno', sensibile: true, predef: false }
  ];
  const RE_NOME = /^[a-z0-9-]{1,40}$/;

  let contenitore = null;
  let osservatore = null;

  function api() {
    const e = typeof window !== 'undefined' ? window.electronAPI : null;
    return e && e.dati && e.accesso ? e.accesso : null;
  }

  /** La sezione esiste solo nella versione desktop. */
  function disponibile() { return !!api(); }

  function el(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined && testo !== null) e.textContent = String(testo);
    return e;
  }

  function toast(testo) {
    if (window.App && window.App.mostraToast) window.App.mostraToast(testo, 5000);
  }

  function nomeSezione(id) {
    const s = SEZIONI.find(x => x.id === id);
    return s ? s.nome : String(id);
  }

  async function copia(testo) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(testo); return true; }
    } catch (_) { /* si prova il metodo alternativo */ }
    try {
      const t = document.createElement('textarea');
      t.value = testo;
      t.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand && document.execCommand('copy');
      t.remove();
      return !!ok;
    } catch (_) { return false; }
  }

  // ---- disegno della sezione ----

  async function render(cont) {
    if (cont) contenitore = cont;
    const a = api();
    if (!contenitore || !a) return;
    let r = null;
    try { r = await a.leggi(); } catch (_) { r = null; }
    contenitore.textContent = '';
    const card = el('div', 'card');
    card.setAttribute('data-accesso-ia', '1');
    card.appendChild(el('h3', null, 'Accesso IA esterna'));
    contenitore.appendChild(card);
    if (!r || !r.ok) {
      card.appendChild(el('p', 'elemento-meta', 'Non riesco a leggere le impostazioni dell\'accesso IA. Riprova tra poco.'));
      return;
    }
    disegnaInterruttore(card, r);
    if (r.abilitato) {
      disegnaElenco(card, r);
      disegnaNuovo(card, r);
    }
  }

  function disegnaInterruttore(card, r) {
    const riga = el('label', 'legenda-riga');
    riga.style.cursor = 'pointer';
    const chk = el('input');
    chk.type = 'checkbox';
    chk.id = 'chk-accesso-ia';
    chk.checked = r.abilitato === true;
    riga.appendChild(chk);
    riga.appendChild(el('strong', null, 'Consenti a un\'IA di usare Kyklion'));
    card.appendChild(riga);

    let stato;
    if (!r.abilitato) stato = 'Spento: nessuna IA può collegarsi.';
    else if (r.avviato) stato = 'Attivo: in ascolto su 127.0.0.1, porta ' + r.porta + ' (solo questo computer).';
    else stato = 'Abilitato, ma il server non è partito (la porta ' + r.porta + ' potrebbe essere occupata). Riprova ad attivarlo.';
    const st = el('div', 'elemento-meta', stato);
    st.id = 'accesso-ia-stato';
    st.style.margin = '4px 0 8px 26px';
    card.appendChild(st);

    const info = el('div', 'elemento-meta');
    info.style.marginBottom = '12px';
    [
      'Un\'IA esterna (come Claude o Hermes) può leggere le sezioni che scegli tu e PROPORRE modifiche. Non cambia nulla da sola: le proposte le applichi tu in Altro → Proposte IA.',
      'Il server ascolta solo su questo computer (127.0.0.1): da internet non è raggiungibile. Ogni IA ha un suo token segreto e puoi revocarlo in qualsiasi momento.'
    ].forEach(t => { const p = el('p', null, t); p.style.margin = '0 0 6px'; info.appendChild(p); });
    card.appendChild(info);

    chk.addEventListener('change', async () => {
      const voluto = chk.checked;
      chk.disabled = true;
      let res = null;
      try { res = await api().abilita(voluto); } catch (_) { res = null; }
      if (!res || !res.ok) {
        toast(res && typeof res.errore === 'string' ? res.errore : 'Operazione non riuscita. Riprova.');
      }
      await render();
    });
  }

  function disegnaElenco(card, r) {
    card.appendChild(el('div', 'divisore-testo', 'Collegamenti'));
    const lista = el('div');
    lista.id = 'accesso-ia-elenco';
    if (!r.client.length) {
      lista.appendChild(el('p', 'elemento-meta', 'Nessun collegamento. Creane uno qui sotto.'));
    }
    r.client.forEach(c => {
      const riga = el('div', 'legenda-riga');
      riga.style.cssText = 'padding:6px 0;align-items:flex-start;';
      riga.setAttribute('data-client', c.nome);
      const testo = el('div');
      testo.style.flex = '1';
      testo.appendChild(el('strong', null, c.nome));
      const sez = el('div', 'elemento-meta', 'Può leggere: ' + (c.sezioni || []).map(nomeSezione).join(', '));
      testo.appendChild(sez);
      riga.appendChild(testo);
      const b = el('button', 'btn btn-sm', 'Rimuovi');
      b.type = 'button';
      b.setAttribute('data-azione', 'rimuovi');
      b.addEventListener('click', () => rimuovi(c.nome));
      riga.appendChild(b);
      lista.appendChild(riga);
    });
    card.appendChild(lista);
  }

  async function rimuovi(nome) {
    if (!confirm('Rimuovere il collegamento «' + nome + '»? Quell\'IA non potrà più accedere a Kyklion.')) return;
    let res = null;
    try { res = await api().rimuoviClient(nome); } catch (_) { res = null; }
    toast(res && res.ok ? 'Collegamento rimosso.' : (res && res.errore) || 'Non riesco a rimuovere il collegamento.');
    await render();
  }

  function disegnaNuovo(card, r) {
    card.appendChild(el('div', 'divisore-testo', 'Nuovo collegamento'));
    const form = el('div');
    form.id = 'accesso-ia-nuovo';

    const cN = el('div', 'campo');
    cN.appendChild(el('label', null, 'Nome (minuscole, numeri e trattini)'));
    const inN = el('input');
    inN.type = 'text';
    inN.id = 'f-accesso-nome';
    inN.maxLength = 40;
    inN.placeholder = 'es. claude-code';
    inN.autocomplete = 'off';
    cN.appendChild(inN);
    form.appendChild(cN);

    const cS = el('div', 'campo');
    cS.appendChild(el('label', null, 'Cosa può leggere'));
    SEZIONI.forEach(s => {
      const riga = el('label', 'legenda-riga');
      riga.style.cssText = 'padding:3px 0;cursor:pointer;font-weight:400;';
      const c = el('input');
      c.type = 'checkbox';
      c.className = 'chk-sezione-accesso';
      c.value = s.id;
      c.checked = s.predef;
      riga.appendChild(c);
      riga.appendChild(document.createTextNode(s.nome));
      riga.appendChild(el('span', 'elemento-meta', '— ' + s.desc));
      if (s.sensibile) riga.appendChild(el('span', 'badge badge-warn', 'sensibile'));
      cS.appendChild(riga);
    });
    const av = el('div', 'elemento-meta', 'Le sezioni sensibili sono spente di default. Se l\'IA gira su internet o in cloud (non sul tuo computer), lasciale spente: i dati verrebbero inviati fuori dal tuo PC.');
    av.style.marginTop = '4px';
    cS.appendChild(av);
    form.appendChild(cS);

    const err = el('div', 'elemento-meta');
    err.id = 'accesso-ia-errore';
    err.style.color = 'var(--warn)';
    form.appendChild(err);

    const azioni = el('div', 'riga-btn');
    const crea = el('button', 'btn btn-accent', 'Crea collegamento');
    crea.type = 'button';
    crea.id = 'btn-accesso-crea';
    azioni.appendChild(crea);
    form.appendChild(azioni);
    card.appendChild(form);

    crea.addEventListener('click', async () => {
      err.textContent = '';
      const nome = inN.value.trim();
      const sezioni = [...form.querySelectorAll('.chk-sezione-accesso')].filter(c => c.checked).map(c => c.value);
      if (!RE_NOME.test(nome)) { err.textContent = 'Nome non valido: usa solo lettere minuscole, numeri e trattini (massimo 40).'; return; }
      if (!sezioni.length) { err.textContent = 'Scegli almeno una sezione.'; return; }
      crea.disabled = true;
      let res = null;
      try { res = await api().creaClient(nome, sezioni); } catch (_) { res = null; }
      crea.disabled = false;
      if (!res || !res.ok || typeof res.token !== 'string') {
        err.textContent = res && typeof res.errore === 'string' ? res.errore : 'Non riesco a creare il collegamento.';
        return;
      }
      mostraToken(nome, res.token, r.porta);
      res = null;
      await render();
    });
  }

  // ---- foglio con il token (mostrato UNA volta) ----

  function blocco(titolo, testo, etichettaCopia) {
    const wrap = el('div');
    wrap.style.marginBottom = '12px';
    wrap.appendChild(el('div', 'elemento-meta', titolo));
    const pre = el('pre', null, testo);
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;background:var(--surface-alt);border:1px solid var(--border);border-radius:8px;padding:8px;margin:4px 0;font-size:12px;user-select:all;';
    wrap.appendChild(pre);
    const b = el('button', 'btn btn-sm', etichettaCopia);
    b.type = 'button';
    b.setAttribute('data-copia', '1');
    b.addEventListener('click', async () => {
      const ok = await copia(testo);
      toast(ok ? 'Copiato negli appunti.' : 'Non riesco a copiare: seleziona il testo e copialo a mano.');
    });
    wrap.appendChild(b);
    return wrap;
  }

  function mostraToken(nome, token, porta) {
    const url = 'http://127.0.0.1:' + porta + '/mcp';
    const comandoClaude = 'claude mcp add --transport http kyklion ' + url + ' --header "Authorization: Bearer ' + token + '"';
    const configGenerica = JSON.stringify({ mcpServers: { kyklion: { url, headers: { Authorization: 'Bearer ' + token } } } }, null, 2);

    const f = document.getElementById('foglio-contenuto');
    if (!f || !window.App || !window.App.apriFoglio) return;
    window.App.apriFoglio('<div id="accesso-ia-foglio"></div>');
    const radice = document.getElementById('accesso-ia-foglio');

    const testa = el('div', 'foglio-header');
    testa.appendChild(el('h3', null, 'Collegamento «' + nome + '» creato'));
    const chiudi = el('button', 'btn btn-sm btn-primary', 'Ho copiato, chiudi');
    chiudi.type = 'button';
    chiudi.id = 'btn-accesso-chiudi';
    chiudi.addEventListener('click', () => window.App.chiudiFoglio());
    testa.appendChild(chiudi);
    radice.appendChild(testa);

    const avviso = el('div', 'card-flat', 'Copia il token adesso: per sicurezza non lo vedrai più. Se lo perdi, rimuovi il collegamento e creane uno nuovo.');
    avviso.style.cssText = 'margin-bottom:12px;border-color:var(--warn);';
    radice.appendChild(avviso);

    radice.appendChild(blocco('Token (segreto: non condividerlo)', token, 'Copia token'));
    radice.appendChild(blocco('Per Claude Code (da un terminale)', comandoClaude, 'Copia comando'));
    radice.appendChild(blocco('Per Hermes e altri client MCP (indirizzo + intestazione Authorization: Bearer)', configGenerica, 'Copia configurazione'));

    // il token deve sparire dal DOM comunque si chiuda il foglio (pulsante, clic fuori, altra azione)
    const overlay = document.getElementById('overlay-foglio');
    if (osservatore) osservatore.disconnect();
    if (typeof MutationObserver !== 'undefined' && overlay) {
      osservatore = new MutationObserver(() => {
        if (!overlay.classList.contains('attivo')) pulisciFoglio();
      });
      osservatore.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function pulisciFoglio() {
    if (osservatore) { osservatore.disconnect(); osservatore = null; }
    const radice = document.getElementById('accesso-ia-foglio');
    if (radice) {
      const f = document.getElementById('foglio-contenuto');
      if (f) f.textContent = '';
    }
  }

  return { disponibile, render };
})();

window.UiAccessoIA = UiAccessoIA;
