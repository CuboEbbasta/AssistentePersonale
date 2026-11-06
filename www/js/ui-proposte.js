/**
 * ui-proposte.js
 * Schermata "Proposte IA" (solo versione desktop): elenca le proposte di
 * modifica create da assistenti esterni (client IA) e lascia a te la
 * decisione: Applica oppure Rifiuta. Nulla cambia nei tuoi dati finche'
 * non premi Applica.
 *
 * SICUREZZA: tutto il testo che arriva dall'IA (client, motivo, anteprima,
 * motivi di non applicabilita') e' trattato come dato non fidato e inserito
 * SOLO con textContent / nodi DOM, mai come HTML.
 */
const UIProposte = (function () {

  let elenco = [];          // proposte "in_attesa" dall'ultimo aggiornamento
  let contenitore = null;   // dove disegnare (impostato da render)
  let avviso = '';          // ultimo messaggio d'errore/stato da mostrare
  let ascoltatoreConteggio = null;
  const inCorso = new Set(); // id delle proposte con un'azione in corso (anti doppio clic)
  const MAX_APPLICATE = 200; // quante proposte applicate ricordare in stato.proposteApplicate

  /** Id delle proposte gia applicate (salvati insieme allo stato, quindi mai persi). */
  function giaApplicate() {
    const l = Dati.stato() && Dati.stato().proposteApplicate;
    return Array.isArray(l) ? l : [];
  }

  function api() {
    return (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.dati) || null;
  }

  /** La voce esiste solo nella versione desktop. */
  function disponibile() { return !!api(); }

  function conteggio() { return elenco.length; }

  function alCambioConteggio(fn) { ascoltatoreConteggio = fn; }

  function el(tag, classe, testo) {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo !== undefined && testo !== null) e.textContent = String(testo);
    return e;
  }

  function formattaData(iso) {
    if (typeof iso !== 'string') return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  }

  function toast(testo) {
    if (window.App && window.App.mostraToast) window.App.mostraToast(testo, 6000);
  }

  // ---- disegno ----

  function schedaProposta(p) {
    const verifica = NucleoProposte.controllaApplicabile(Dati.stato(), p, DataUtils.oggiISO());
    const applicabile = verifica.stato === 'applicabile';
    const occupata = inCorso.has(p.id);

    const card = el('div', 'card');
    card.setAttribute('data-proposta', p.id);

    const testa = el('div', 'timeline-meta');
    testa.appendChild(el('strong', null, p.client));
    const data = formattaData(p.creatoIl);
    if (data) testa.appendChild(document.createTextNode(' · ' + data));
    card.appendChild(testa);

    if (p.motivo) card.appendChild(el('div', 'timeline-titolo', p.motivo));

    const righe = Array.isArray(p.anteprima) ? p.anteprima : [];
    const ul = el('ul', 'anteprima-proposta');
    ul.style.margin = '8px 0 8px 18px';
    righe.forEach(r => ul.appendChild(el('li', null, r)));
    card.appendChild(ul);

    if (!applicabile) {
      const box = el('div', 'timeline-meta');
      box.setAttribute('data-stato', verifica.stato);
      box.appendChild(el('span', 'badge badge-warn', verifica.stato === 'obsoleta' ? 'Obsoleta' : 'Non valida'));
      (verifica.motivi || []).forEach(m => box.appendChild(el('div', null, m)));
      card.appendChild(box);
    }

    const azioni = el('div', 'timeline-azioni');
    if (applicabile) {
      const b = el('button', 'btn btn-sm btn-accent', 'Applica');
      b.type = 'button';
      b.setAttribute('data-azione', 'applica');
      b.disabled = occupata;
      b.addEventListener('click', () => applica(p.id));
      azioni.appendChild(b);
    }
    const r = el('button', 'btn btn-sm', 'Rifiuta');
    r.type = 'button';
    r.setAttribute('data-azione', 'rifiuta');
    r.disabled = occupata;
    r.addEventListener('click', () => rifiuta(p.id));
    azioni.appendChild(r);
    card.appendChild(azioni);
    return card;
  }

  function disegna() {
    if (!contenitore) return;
    contenitore.textContent = '';
    if (avviso) {
      const a = el('div', 'card', avviso);
      a.setAttribute('data-avviso', '1');
      contenitore.appendChild(a);
    }
    if (!elenco.length) {
      contenitore.appendChild(el('div', 'card', 'Nessuna proposta in attesa.'));
      const guida = el('div', 'card');
      [
        'Qui compaiono le modifiche che un\'IA esterna propone ai tuoi dati. Nulla cambia finche\' non premi Applica.',
        'Per collegare un\'IA, da un terminale nella cartella del progetto:',
        '1) node ia/bin/ap-ia.js client add nome-ia   (stampa il token, una volta sola)',
        '2) node ia/bin/ap-ia.js abilita',
        '3) node ia/bin/ap-ia.js serve   (lascialo aperto)',
        'Poi l\'IA usa http://127.0.0.1:3040/mcp con il token. Dettagli in docs/ia-esterna.md.'
      ].forEach(t => guida.appendChild(el('div', 'timeline-meta', t)));
      contenitore.appendChild(guida);
      return;
    }
    elenco.forEach(p => contenitore.appendChild(schedaProposta(p)));
  }

  // ---- dati ----

  async function aggiorna() {
    const a = api();
    if (!a) return;
    let r;
    try { r = await a.proposteElenca(); } catch (e) { r = null; }
    if (!r || !r.ok || !Array.isArray(r.proposte)) {
      avviso = 'Non riesco a leggere le proposte. Riprova tra poco.';
      disegna();
      return;
    }
    if (avviso === 'Non riesco a leggere le proposte. Riprova tra poco.') avviso = '';
    const prima = elenco.length;
    const attese = r.proposte.filter(p => p && typeof p === 'object' && p.stato === 'in_attesa' && typeof p.id === 'string');
    // gia applicate ma rimaste "in_attesa" (segnalazione fallita): non riapplicabili, si ritenta in silenzio
    const registro = giaApplicate();
    const doppie = attese.filter(p => registro.includes(p.id));
    elenco = attese.filter(p => !registro.includes(p.id));
    doppie.forEach(p => { segna(p.id, 'applicata'); });
    disegna();
    if ((elenco.length !== prima || prima === 0) && ascoltatoreConteggio) ascoltatoreConteggio(elenco.length);
  }

  async function segna(id, stato) {
    let r;
    try { r = await api().proposteAggiorna(id, { stato }); } catch (e) { r = null; }
    return !!(r && r.ok);
  }

  async function esegui(id, lavoro) {
    if (inCorso.has(id)) return;
    inCorso.add(id);
    avviso = '';
    disegna();
    try { await lavoro(); } catch (e) {
      avviso = 'Operazione non riuscita. Riprova.';
    } finally {
      inCorso.delete(id);
    }
    await aggiorna();
  }

  function applica(id) {
    return esegui(id, async () => {
      const p = elenco.find(x => x.id === id);
      if (!p) return;
      const r = NucleoProposte.applicaProposta(Dati.stato(), p, { oggiISO: DataUtils.oggiISO(), generaId: Dati.generaId });
      if (!r.ok) {
        avviso = 'Proposta non applicabile: ' + (r.motivi || []).join('; ');
        return;
      }
      // l'id entra nello stato PRIMA del salvataggio: se la segnalazione sotto fallisce, la proposta non e' riapplicabile
      r.stato.proposteApplicate = giaApplicate().filter(x => x !== id).concat([id]).slice(-MAX_APPLICATE);
      const salvato = await Dati.sostituisciStato(r.stato);
      if (!salvato) {
        avviso = 'Non sono riuscito a salvare i dati: la proposta NON è stata applicata. Riprova.';
        toast(avviso);
        return;
      }
      if (window.App && window.App.aggiornaTutto) window.App.aggiornaTutto();
      if (!(await segna(id, 'applicata'))) {
        avviso = 'Modifiche applicate, ma non riesco a segnare la proposta come applicata: non premere di nuovo Applica.';
        toast(avviso);
        return;
      }
      toast('Proposta applicata.');
    });
  }

  function rifiuta(id) {
    return esegui(id, async () => {
      if (!(await segna(id, 'rifiutata'))) {
        avviso = 'Non riesco a rifiutare la proposta. Riprova.';
        return;
      }
      toast('Proposta rifiutata.');
    });
  }

  // ---- interfaccia pubblica ----

  function render(cont) {
    if (cont) contenitore = cont;
    disegna();
    return aggiorna();
  }

  /** Da chiamare all'avvio: aggiorna conteggio ed elenco quando la finestra torna in primo piano. */
  function inizializza() {
    if (!disponibile()) return;
    window.addEventListener('focus', () => { aggiorna(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) aggiorna(); });
    return aggiorna();
  }

  return { disponibile, conteggio, alCambioConteggio, render, aggiorna, inizializza };
})();

window.UIProposte = UIProposte;
