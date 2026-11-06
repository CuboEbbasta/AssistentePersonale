/**
 * preload.js — unico ponte, sicuro, tra la pagina web (www/) e il processo
 * principale di Electron. Espone solo cio' che serve (esportare un file),
 * niente accesso libero a Node dentro la pagina (contextIsolation attiva).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  esportaJSON: (nomeFile, contenuto) => ipcRenderer.invoke('esporta-json', nomeFile, contenuto),
  chiamaIA: (payload) => ipcRenderer.invoke('chiama-ia', payload),
  elencaModelliIA: (cfg) => ipcRenderer.invoke('elenca-modelli-ia', cfg),
  dati: {
    statoLeggi: () => ipcRenderer.invoke('stato-leggi'),
    statoScrivi: (json) => ipcRenderer.invoke('stato-scrivi', json),
    statoMigra: (valoreGrezzo) => ipcRenderer.invoke('stato-migra', valoreGrezzo),
    proposteElenca: () => ipcRenderer.invoke('proposte-elenca'),
    proposteAggiorna: (id, patch) => ipcRenderer.invoke('proposte-aggiorna', id, patch)
  },
  accesso: {
    leggi: () => ipcRenderer.invoke('accesso-leggi'),
    abilita: (on) => ipcRenderer.invoke('accesso-abilita', on),
    creaClient: (nome, sezioni) => ipcRenderer.invoke('accesso-crea-client', nome, sezioni),
    rimuoviClient: (nome) => ipcRenderer.invoke('accesso-rimuovi-client', nome)
  }
});
