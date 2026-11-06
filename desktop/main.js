/**
 * main.js — processo principale di Electron.
 * Carica la STESSA interfaccia web usata dalla versione Android (../www),
 * cosi' la logica dell'app (routine, task, cascata, quadrante...) è scritta
 * una sola volta. Qui aggiungiamo cio' che ha senso solo su desktop:
 * - una finestra vera con menu di sistema,
 * - il salvataggio del backup su file reale tramite finestra di dialogo nativa,
 * - (in futuro) la chiamata a Ollama in locale per i consigli dell'IA.
 */
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
// Percorso base: nello sviluppo ia/ e www/ stanno accanto a desktop/ (cartella superiore); nel pacchetto installato
// electron-builder li copia accanto a main.js. Si sceglie quello in cui esistono.
const RADICE = fs.existsSync(path.join(__dirname, 'ia')) ? __dirname : path.join(__dirname, '..');
const dalla = (...parti) => path.join(RADICE, ...parti);
const { creaArchivio, percorsoDati } = require(dalla('ia', 'archivio.js'));
const { creaGestoriDati } = require(dalla('ia', 'ipc.js'));
const { creaGestoriIA } = require(dalla('ia', 'ipc-ia.js'));
const { avviaServerMcp } = require(dalla('ia', 'mcp-http.js'));

// Cartella dati (stato.json, proposte.json, ia-config.json): percorsoDati(), la stessa del CLI ap-ia.
// NON si cambia 'userData' di Electron: e' il profilo di Chromium e contiene il vecchio localStorage (Preferences).
const CARTELLA_DATI = percorsoDati();
fs.mkdirSync(CARTELLA_DATI, { recursive: true });
const gestoriDati = creaGestoriDati(creaArchivio(CARTELLA_DATI));
const gestoriIA = creaGestoriIA();

function creaFinestra() {
  const win = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 380,
    minHeight: 640,
    title: 'Assistente Personale',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#eee9e1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadFile(dalla('www', 'index.html'));

  // Rimuove il menu di default (File/Edit/View...) inutile per questa app;
  // resta disponibile con Alt se serve durante lo sviluppo.
  win.setMenuBarVisibility(false);

  return win;
}

// Una sola istanza: due app sullo stesso stato.json si sovrascriverebbero a vicenda.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });
}

let serverMcp = null;

/** Se l'accesso IA è abilitato (ap-ia abilita), il server MCP parte con l'app: solo 127.0.0.1, token obbligatorio. */
async function avviaAccessoIA() {
  try {
    const archivio = creaArchivio(CARTELLA_DATI);
    const cfg = archivio.leggiConfig();
    if (!cfg || cfg.abilitato !== true) return;
    serverMcp = await avviaServerMcp({ archivio, porta: cfg.porta });
    console.log('Accesso IA attivo su 127.0.0.1:' + cfg.porta);
  } catch (e) {
    console.warn(e && e.code === 'EADDRINUSE' ? 'Accesso IA: porta occupata (forse ap-ia serve è già in esecuzione).' : 'Accesso IA non avviato.');
  }
}

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
  Menu.setApplicationMenu(null);
  creaFinestra();
  avviaAccessoIA();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) creaFinestra();
  });
});

app.on('before-quit', () => { if (serverMcp) { try { serverMcp.close(); } catch (_) { /* ignora */ } } });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- Export dati: finestra "Salva con nome" nativa + scrittura file reale ----
ipcMain.handle('esporta-json', async (event, nomeFileSuggerito, contenuto) => {
  const finestra = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(finestra, {
    title: 'Salva backup Assistente Personale',
    defaultPath: nomeFileSuggerito,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, annullato: true };
  try {
    await fs.promises.writeFile(filePath, contenuto, 'utf8');
    return { ok: true, percorso: filePath };
  } catch (e) {
    return { ok: false, errore: e.message };
  }
});

// ---- IA: chiamate al server IA dal processo main (Node ha fetch nativo, nessun problema di CORS) ----
// Validazione, timeout e messaggi di errore sicuri sono in ia/ipc-ia.js.
ipcMain.handle('chiama-ia', (event, arg) => gestoriIA.chiama(arg));
ipcMain.handle('elenca-modelli-ia', (event, arg) => gestoriIA.elencaModelli(arg));

// ---- Dati su file (stato.json, proposte.json): la logica e la validazione sono in ia/ipc.js ----
ipcMain.handle('stato-leggi', () => gestoriDati.statoLeggi());
ipcMain.handle('stato-scrivi', (event, json) => gestoriDati.statoScrivi(json));
ipcMain.handle('stato-migra', (event, valoreGrezzo) => gestoriDati.statoMigra(valoreGrezzo));
ipcMain.handle('proposte-elenca', () => gestoriDati.proposteElenca());
ipcMain.handle('proposte-aggiorna', (event, id, patch) => gestoriDati.proposteAggiorna(id, patch));
