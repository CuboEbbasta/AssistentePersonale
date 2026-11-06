'use strict';
/**
 * Gestori dei canali IPC dei dati (stato e proposte). Logica pura, senza
 * Electron: main.js li collega ai canali. Ogni gestore valida gli argomenti
 * e restituisce { ok, ... }; in caso di errore al renderer arrivano solo
 * un codice e un messaggio generico (mai stack trace né percorsi).
 */
const fs = require('node:fs');
const path = require('node:path');
const { ErroreArchivio } = require('./archivio.js');
const { migraDaPreferences } = require('./migrazione.js');

const LIMITE_STATO = 50 * 1024 * 1024; // 50 MB
const LIMITE_ID = 200;
const STATI_PROPOSTA = ['applicata', 'rifiutata'];

function errore(codice, messaggio) {
  return { ok: false, codice, errore: messaggio };
}

// Traduce qualunque eccezione in un errore sicuro per il renderer.
function sicuro(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ErroreArchivio) {
      return errore(e.code, e.code === 'STATO_CORROTTO' ? 'Il file dei dati non è leggibile.' : 'Operazione sui dati non riuscita.');
    }
    return errore('ERRORE_INTERNO', 'Operazione sui dati non riuscita.');
  }
}

function statoComeOggetto(testo) {
  if (typeof testo !== 'string' || testo.length === 0 || testo.length > LIMITE_STATO) return null;
  let v;
  try { v = JSON.parse(testo); } catch (_) { return null; }
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function creaGestoriDati(archivio) {
  const esiste = (n) => fs.existsSync(path.join(archivio.dir, n));

  return {
    statoLeggi() {
      return sicuro(() => {
        if (!esiste('stato.json')) {
          // senza stato.json ma con un backup valido: usa il backup (non reimportare le Preferences)
          if (esiste('stato.bak.json')) {
            try {
              return { ok: true, json: JSON.stringify(archivio.leggiStatoDaBackup()), daBackup: true };
            } catch (e) {
              if (!(e instanceof ErroreArchivio) || e.code !== 'STATO_CORROTTO') throw e;
            }
          }
          return { ok: true, json: null, daBackup: false };
        }
        try {
          return { ok: true, json: JSON.stringify(archivio.leggiStato()), daBackup: false };
        } catch (e) {
          if (!(e instanceof ErroreArchivio) || e.code !== 'STATO_CORROTTO') throw e;
          if (!esiste('stato.bak.json')) throw e;
          return { ok: true, json: JSON.stringify(archivio.leggiStatoDaBackup()), daBackup: true };
        }
      });
    },
    statoScrivi(testo) {
      const oggetto = statoComeOggetto(testo);
      if (!oggetto) return errore('ARGOMENTO_NON_VALIDO', 'Dati non validi.');
      return sicuro(() => { archivio.scriviStato(oggetto); return { ok: true }; });
    },
    statoMigra(valoreGrezzo) {
      if (valoreGrezzo !== null && (typeof valoreGrezzo !== 'string' || valoreGrezzo.length > LIMITE_STATO)) {
        return errore('ARGOMENTO_NON_VALIDO', 'Dati non validi.');
      }
      return sicuro(() => ({ ok: true, esito: migraDaPreferences(archivio, valoreGrezzo) }));
    },
    proposteElenca() {
      return sicuro(() => ({ ok: true, proposte: archivio.elencaProposte() }));
    },
    proposteAggiorna(id, patch) {
      if (typeof id !== 'string' || id.length === 0 || id.length > LIMITE_ID) {
        return errore('ARGOMENTO_NON_VALIDO', 'Identificativo non valido.');
      }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
          || Object.keys(patch).length !== 1 || !STATI_PROPOSTA.includes(patch.stato)) {
        return errore('ARGOMENTO_NON_VALIDO', 'Modifica non valida.');
      }
      return sicuro(() => ({ ok: true, proposta: archivio.aggiornaProposta(id, { stato: patch.stato }) }));
    }
  };
}

module.exports = { creaGestoriDati, LIMITE_STATO };
