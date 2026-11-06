/**
 * app.js
 * Avvio dell'app, navigazione a tab (con gruppi e sotto-sezioni), foglio
 * (bottom sheet) per i form, toast.
 */
const App = (function () {

  // Le 5 tab principali; alcune raggruppano più viste con una sotto-nav a pillole.
  const GRUPPI = {
    fare: { figli: ['routine', 'task', 'orario'], etichette: { routine: 'Routine', task: 'Task', orario: 'Orario fisso' } },
    salute: { figli: ['dieta', 'workout', 'sonno'], etichette: { dieta: 'Dieta', workout: 'Workout', sonno: 'Sonno' } },
    crescita: { figli: ['obiettivi', 'diario'], etichette: { obiettivi: 'Obiettivi', diario: 'Diario' } },
    altro: { figli: ['panoramica', 'ia', 'proposte', 'impostazioni'], etichette: { panoramica: 'Panoramica', ia: 'Assistente IA', proposte: 'Proposte IA', impostazioni: 'Impostazioni' } }
  };
  const FIGLIO_A_GRUPPO = {};
  Object.entries(GRUPPI).forEach(([g, def]) => def.figli.forEach(f => { FIGLIO_A_GRUPPO[f] = g; }));
  const ultimoFiglio = { fare: 'routine', salute: 'dieta', crescita: 'obiettivi', altro: 'panoramica' };

  let vistaCorrente = 'oggi';

  // La voce "Proposte IA" esiste solo nella versione desktop (electronAPI.dati).
  function figliVisibili(gruppo) {
    return GRUPPI[gruppo].figli.filter(f => f !== 'proposte' || UIProposte.disponibile());
  }

  function mostraToast(msg, ms) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('mostra');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('mostra'), ms || 2200);
  }

  function apriFoglio(html) {
    document.getElementById('foglio-contenuto').innerHTML = html;
    document.getElementById('overlay-foglio').classList.add('attivo');
  }
  function chiudiFoglio() {
    document.getElementById('overlay-foglio').classList.remove('attivo');
  }

  function renderVista(nome) {
    if (nome === 'oggi') UiOggi.renderTutto();
    else if (nome === 'dieta') UiDieta.render();
    else if (nome === 'workout') UiWorkout.render();
    else if (nome === 'sonno') UiSonno.render();
    else if (nome === 'routine') UiRoutine.renderLista();
    else if (nome === 'task') UiTask.renderLista();
    else if (nome === 'orario') UiOrario.render();
    else if (nome === 'obiettivi') UiObiettivi.renderLista();
    else if (nome === 'diario') UiJournal.renderForm(DataUtils.oggiISO());
    else if (nome === 'panoramica') UiPanoramica.render();
    else if (nome === 'ia') UiIA.render();
    else if (nome === 'proposte') UIProposte.render(document.getElementById('proposte-corpo'));
    else if (nome === 'impostazioni') UiImpostazioni.render();
  }

  function aggiornaSubNav(vista) {
    const gruppo = FIGLIO_A_GRUPPO[vista];
    if (!gruppo) return; // "oggi" non appartiene a un gruppo, niente sotto-nav
    const def = GRUPPI[gruppo];
    const placeholder = document.getElementById('subnav-' + vista);
    if (!placeholder) return;
    placeholder.innerHTML = figliVisibili(gruppo).map(f =>
      `<button type="button" class="btn btn-sm ${f === vista ? 'btn-primary' : ''}" data-figlio="${f}">${def.etichette[f]}</button>`
    ).join('');
    // badge col numero di proposte in attesa (solo numero, creato come nodo)
    const voceProposte = placeholder.querySelector('[data-figlio="proposte"]');
    if (voceProposte && UIProposte.conteggio() > 0) {
      const b = document.createElement('span');
      b.className = 'badge badge-accent';
      b.textContent = String(UIProposte.conteggio());
      voceProposte.appendChild(b);
    }
    placeholder.querySelectorAll('[data-figlio]').forEach(b => b.addEventListener('click', () => mostraTab(b.dataset.figlio)));
  }

  /** Accetta sia il nome di un gruppo ("fare") sia di una vista diretta ("routine") */
  function mostraTab(nome) {
    const vista = GRUPPI[nome] ? (ultimoFiglio[nome] || GRUPPI[nome].figli[0]) : nome;
    const gruppo = FIGLIO_A_GRUPPO[vista];
    if (gruppo) ultimoFiglio[gruppo] = vista;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('attiva'));
    document.getElementById('view-' + vista).classList.add('attiva');

    const tabPrincipaleAttiva = gruppo || vista; // "oggi" e' tab principale di se stessa
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('attivo', b.dataset.tab === tabPrincipaleAttiva));

    vistaCorrente = vista;
    aggiornaSubNav(vista);
    renderVista(vista);
  }

  function aggiornaOggi() { UiOggi.renderTutto(); }

  function aggiornaTutto() {
    UiRoutine.renderLista();
    UiTask.renderLista();
    UiOrario.render();
    UiObiettivi.renderLista();
    UiJournal.renderStorico();
    UiOggi.renderTutto();
    UiDieta.render();
    UiWorkout.render();
    UiSonno.render();
    UiPanoramica.render();
    UiImpostazioni.render();
  }

  async function onAzioneNotifica(extra, actionId) {
    if (!extra || !extra.chiave || !extra.dataISO) return;
    if (actionId === 'fatto' || actionId === 'non_fatto') {
      const valore = actionId === 'fatto';
      await Dati.impostaCompletamento(extra.chiave, extra.dataISO, valore);
      if (extra.chiave.startsWith('task:') && valore) {
        const taskId = extra.chiave.split(':')[1];
        const t = Dati.stato().task.find(x => x.id === taskId);
        if (t) { t.completata = true; await Dati.salva(); await Notifiche.cancellaCascataTask(taskId); }
      }
      UiOggi.renderTutto();
    } else {
      // Tap sul corpo della notifica (non su un'azione rapida): apre il
      // dettaglio, utile soprattutto per pasto/allenamento/diario che hanno
      // bisogno di un'interazione più ricca di un semplice fatto/non fatto.
      mostraTab('oggi');
      UiOggi.apriDettaglioAttivita(extra.chiave, extra.dataISO);
    }
  }

  async function completaAvvio() {
    await Notifiche.inizializza(onAzioneNotifica);

    document.querySelectorAll('.tab-btn').forEach(b => {
      b.addEventListener('click', () => mostraTab(b.dataset.tab));
    });
    document.getElementById('btn-nuova-routine').addEventListener('click', () => UiRoutine.apriForm(null));
    document.getElementById('btn-importa-testo-routine').addEventListener('click', () => UiRoutine.apriImportoTesto());
    document.getElementById('btn-nuova-task').addEventListener('click', () => UiTask.apriForm(null));
    document.getElementById('btn-nuovo-obiettivo').addEventListener('click', () => UiObiettivi.apriForm(null));
    document.getElementById('overlay-foglio').addEventListener('click', (e) => {
      if (e.target.id === 'overlay-foglio') chiudiFoglio();
    });

    UiJournal.inizializza();
    UIProposte.alCambioConteggio((n) => {
      aggiornaSubNav(vistaCorrente);
      const bAltro = document.getElementById('badge-altro');
      if (bAltro) { bAltro.textContent = String(n); bAltro.hidden = n === 0; }
    });
    UIProposte.inizializza();
    mostraTab('oggi');

    // Ricontrolla la vista "oggi" quando l'app torna in primo piano
    // (utile se e' passata la mezzanotte o e' passato del tempo da ultimo controllo)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) UiOggi.renderTutto();
    });
  }

  async function init() {
    await Dati.carica();
    document.documentElement.setAttribute('data-tema', Dati.stato().impostazioni.tema || 'chiaro');

    if (!Dati.stato().impostazioni.onboardingCompletato) {
      UiOnboarding.avvia(completaAvvio);
    } else {
      await completaAvvio();
    }
  }

  return { init, apriFoglio, chiudiFoglio, mostraToast, mostraTab, aggiornaOggi, aggiornaTutto };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', () => { App.init(); });
