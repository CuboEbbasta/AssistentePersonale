/**
 * ui-impostazioni.js
 * Backup/ripristino dati (JSON) e gestione permessi di notifica.
 * Il backup è pensato per il flusso "esporta dal telefono -> importa sul PC"
 * e viceversa, dato che le due app non si sincronizzano in automatico.
 */
const UiImpostazioni = (function () {
  let modalitaImportPendente = 'unisci';

  function render() {
    const cont = document.getElementById('view-impostazioni-corpo');
    cont.innerHTML = `
      <div class="card">
        <h3>Backup e sincronizzazione manuale</h3>
        <p class="elemento-meta" style="margin-bottom:12px;">
          Esporta i dati in un file .json da salvare dove preferisci (es. Google Drive) e poi
          importalo sull'altro dispositivo (telefono ⇄ PC) per tenerli allineati.
        </p>
        <div class="riga-btn">
          <button class="btn btn-accent" id="btn-esporta">${Icone.svg('esporta', 15)} Esporta dati (.json)</button>
        </div>
        <div class="divisore-testo">Importa un backup</div>
        <div class="riga-btn">
          <button class="btn" id="btn-importa-unisci">Importa e unisci</button>
          <button class="btn btn-warn" id="btn-importa-sostituisci">Importa e sostituisci tutto</button>
        </div>
        <input type="file" accept="application/json,.json" id="input-file-import" style="display:none;">
      </div>

      <div class="card">
        <h3>Notifiche</h3>
        <p class="elemento-meta" style="margin-bottom:12px;">
          Su Android, la prima volta conferma sia il permesso di notifica sia quello di
          "allarmi esatti" per ricevere i promemoria proprio all'orario previsto.
        </p>
        <div class="riga-btn">
          <button class="btn" id="btn-permessi-notifiche">Verifica permessi notifiche</button>
          <button class="btn" id="btn-riprogramma">Riprogramma notifiche di oggi</button>
        </div>
      </div>

      <div class="card">
        <h3>Aspetto</h3>
        <div class="riga-btn">
          <button class="btn btn-sm ${Dati.stato().impostazioni.tema === 'chiaro' ? 'btn-primary' : ''}" id="btn-tema-chiaro">☀️ Chiaro</button>
          <button class="btn btn-sm ${Dati.stato().impostazioni.tema === 'scuro' ? 'btn-primary' : ''}" id="btn-tema-scuro">🌙 Scuro</button>
        </div>
      </div>

      <div class="card">
        <h3>Tipi di attività</h3>
        <p class="elemento-meta" style="margin-bottom:10px;">
          Condivisi tra Routine e Task. Allenamento, Pasto, Sonno e Diario sono fissi;
          quelli che crei tu si possono eliminare.
        </p>
        <div id="lista-tipi"></div>
      </div>

      <div class="card">
        <h3>Dati</h3>
        <div class="riga-btn">
          <button class="btn btn-warn" id="btn-reset">Cancella tutti i dati</button>
        </div>
      </div>

      <div class="card card-flat">
        <div class="elemento-meta">
          Tarvio — versione dati ${Dati.stato().versione}.<br>
          Moduli attuali: routine (con tipo/descrizione), task con cascata temporale e cartelle,
          orario fisso, obiettivi (1 mese → 10 anni, con tappe/timeline),
          diario serale, dieta (profilo, target, piano settimanale, log pasti),
          workout (scheda veloce, scheda con sbarra, scheda adattiva, personalizzata, log),
          panoramica (vista mese, vista anno, storico/recap), assistente IA (collegabile a Ollama),
          vista di oggi e notifiche offline.<br>
          Tema chiaro/scuro disponibile qui sopra.
        </div>
      </div>
    `;

    renderListaTipi();

    document.getElementById('btn-tema-chiaro').addEventListener('click', () => impostaTema('chiaro'));
    document.getElementById('btn-tema-scuro').addEventListener('click', () => impostaTema('scuro'));

    document.getElementById('btn-esporta').addEventListener('click', async () => {
      window.App.mostraToast('Preparazione del backup…');
      const res = await Dati.esporta();
      window.App.mostraToast(res.ok ? 'Backup pronto.' : ('Errore: ' + res.errore));
    });

    const inputFile = document.getElementById('input-file-import');
    document.getElementById('btn-importa-unisci').addEventListener('click', () => {
      modalitaImportPendente = 'unisci';
      inputFile.click();
    });
    document.getElementById('btn-importa-sostituisci').addEventListener('click', () => {
      if (!confirm('Questo sostituirà TUTTI i dati attuali con quelli del file importato. Continuare?')) return;
      modalitaImportPendente = 'sostituisci';
      inputFile.click();
    });
    inputFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const risultato = Dati.importaDaTesto(String(reader.result), modalitaImportPendente);
        if (!risultato.ok) { window.App.mostraToast('Errore: ' + risultato.errore); return; }
        await Dati.salva();
        window.App.mostraToast('Importazione completata.');
        window.App.aggiornaTutto();
      };
      reader.readAsText(file);
      inputFile.value = '';
    });

    document.getElementById('btn-permessi-notifiche').addEventListener('click', async () => {
      const ok = await Notifiche.richiediPermessi();
      await Notifiche.richiediAllarmeEsatto();
      window.App.mostraToast(ok ? 'Permessi attivi.' : 'Permesso non concesso: le notifiche potrebbero non funzionare.');
    });
    document.getElementById('btn-riprogramma').addEventListener('click', () => {
      UiOggi.renderTutto();
      window.App.mostraToast('Notifiche di oggi riprogrammate.');
    });

    document.getElementById('btn-reset').addEventListener('click', async () => {
      if (!confirm('Cancellare TUTTI i dati (routine, task, storico)? Questa azione non si può annullare.')) return;
      Object.assign(Dati.stato(), Dati.statoDefault());
      await Dati.salva();
      window.App.aggiornaTutto();
      window.App.mostraToast('Dati cancellati.');
    });
  }

  function renderListaTipi() {
    const cont = document.getElementById('lista-tipi');
    const tipi = Dati.stato().tipiAttivita;
    cont.innerHTML = tipi.map(t => `
      <div class="legenda-riga">
        <span class="legenda-swatch" style="background:${UiTipi.coloreTipo(t.id)}"></span>
        <span class="legenda-nome">${UiRoutine.escapeHtml(t.nome)}</span>
        ${t.protetto ? '<span class="badge badge-accent">fisso</span>' : `<button class="icon-btn btn-elimina-tipo" data-id="${t.id}" title="Elimina">${Icone.svg('delete', 16)}</button>`}
      </div>
    `).join('');
    cont.querySelectorAll('.btn-elimina-tipo').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Eliminare questo tipo? Le routine/task che lo usano torneranno a "Altro".')) return;
      const risultato = await Dati.eliminaTipoAttivita(b.dataset.id);
      if (!risultato.ok) { window.App.mostraToast(risultato.errore); return; }
      renderListaTipi();
      window.App.aggiornaTutto();
    }));
  }

  async function impostaTema(tema) {
    Dati.stato().impostazioni.tema = tema;
    await Dati.salva();
    document.documentElement.setAttribute('data-tema', tema);
    render();
  }

  return { render, impostaTema };
})();

window.UiImpostazioni = UiImpostazioni;
