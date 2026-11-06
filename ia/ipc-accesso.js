'use strict';
/**
 * Gestori dei canali IPC dell'«Accesso IA esterna» (interruttore, collegamenti,
 * token). Logica senza Electron: main.js li collega ai canali. Possiede il
 * server MCP (lo avvia e lo ferma). Valida gli argomenti; al renderer arrivano
 * solo codici e messaggi generici (mai percorsi, stack, tokenHash). Il token
 * compare solo nella risposta di creaClient e non viene mai scritto nei log.
 */
const Schema = require('../www/js/core/schema.js');
const Permessi = require('./permessi.js');
const { avviaServerMcp: avviaPredefinito } = require('./mcp-http.js');

const RE_NOME = /^[a-z0-9-]{1,40}$/;
const SEZIONI_VALIDE = Object.keys(Schema.SEZIONI);

const errore = (codice, messaggio) => ({ ok: false, codice, errore: messaggio });

function creaGestoriAccesso(archivio, opzioni = {}) {
  const avviaServer = opzioni.avviaServerMcp || avviaPredefinito;
  let server = null;
  let portaReale = null;
  let inCorso = Promise.resolve(); // serializza avvio/arresto

  function leggiConfig() {
    const c = archivio.leggiConfig();
    if (!c || typeof c !== 'object') throw new Error('config');
    return { ...c, client: Array.isArray(c.client) ? c.client : [] };
  }

  async function avvia(porta) {
    if (server) return;
    const s = await avviaServer({ archivio, porta });
    server = s;
    const ind = s.address && s.address();
    portaReale = ind && typeof ind === 'object' ? ind.port : porta;
  }

  function ferma() {
    const s = server;
    server = null;
    portaReale = null;
    if (!s) return Promise.resolve();
    return new Promise((ok) => {
      try {
        s.close(() => ok());
        if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
      } catch (_) { ok(); }
    });
  }

  const inSerie = (fn) => {
    const p = inCorso.then(fn, fn);
    inCorso = p.then(() => undefined, () => undefined);
    return p;
  };

  return {
    /** All'avvio dell'app: se l'accesso è abilitato il server parte. Non lancia mai. */
    avviaSeAbilitato() {
      return inSerie(async () => {
        try {
          const c = leggiConfig();
          if (c.abilitato !== true) return { ok: true, avviato: false };
          await avvia(c.porta);
          return { ok: true, avviato: true };
        } catch (e) {
          return errore(e && e.code === 'EADDRINUSE' ? 'PORTA_OCCUPATA' : 'ERRORE_INTERNO', 'Accesso IA non avviato.');
        }
      });
    },
    chiudi() { return inSerie(ferma); },

    accessoLeggi() {
      try {
        const c = leggiConfig();
        return {
          ok: true,
          abilitato: c.abilitato === true,
          porta: portaReale !== null ? portaReale : c.porta,
          avviato: server !== null,
          client: c.client.map((x) => ({ nome: String(x.nome), sezioni: Array.isArray(x.sezioni) ? x.sezioni.map(String) : [] }))
        };
      } catch (_) {
        return errore('ERRORE_INTERNO', 'Impossibile leggere le impostazioni dell\'accesso IA.');
      }
    },

    accessoAbilita(on) {
      if (typeof on !== 'boolean') return Promise.resolve(errore('ARGOMENTO_NON_VALIDO', 'Valore non valido.'));
      return inSerie(async () => {
        try {
          const c = leggiConfig();
          if (on) {
            try {
              await avvia(c.porta);
            } catch (e) {
              if (e && e.code === 'EADDRINUSE') return errore('PORTA_OCCUPATA', 'La porta ' + c.porta + ' è già usata da un altro programma. Chiudilo e riprova.');
              return errore('AVVIO_NON_RIUSCITO', 'Non riesco ad attivare l\'accesso IA.');
            }
            try {
              archivio.scriviConfig({ ...c, abilitato: true });
            } catch (_) {
              await ferma();
              return errore('ERRORE_INTERNO', 'Non riesco a salvare l\'impostazione.');
            }
          } else {
            archivio.scriviConfig({ ...c, abilitato: false });
            await ferma();
          }
          return { ok: true, abilitato: on, avviato: server !== null };
        } catch (_) {
          return errore('ERRORE_INTERNO', 'Operazione non riuscita.');
        }
      });
    },

    accessoCreaClient(nome, sezioni) {
      if (typeof nome !== 'string' || !RE_NOME.test(nome)) {
        return errore('ARGOMENTO_NON_VALIDO', 'Nome non valido: usa lettere minuscole, numeri e trattini (1-40 caratteri).');
      }
      if (!Array.isArray(sezioni) || sezioni.length === 0 || sezioni.length > SEZIONI_VALIDE.length
          || sezioni.some((s) => typeof s !== 'string' || !SEZIONI_VALIDE.includes(s))
          || new Set(sezioni).size !== sezioni.length) {
        return errore('ARGOMENTO_NON_VALIDO', 'Scegli almeno una sezione valida.');
      }
      try {
        const c = leggiConfig();
        if (c.client.some((x) => x.nome === nome)) return errore('NOME_ESISTENTE', 'Esiste già un collegamento con questo nome.');
        const r = Permessi.creaClient(c, nome, sezioni);
        archivio.scriviConfig(r.config);
        return { ok: true, token: r.token };
      } catch (_) {
        return errore('ERRORE_INTERNO', 'Non riesco a creare il collegamento.');
      }
    },

    accessoRimuoviClient(nome) {
      if (typeof nome !== 'string' || !RE_NOME.test(nome)) return errore('ARGOMENTO_NON_VALIDO', 'Nome non valido.');
      try {
        const c = leggiConfig();
        if (!c.client.some((x) => x.nome === nome)) return errore('NON_TROVATO', 'Collegamento non trovato.');
        archivio.scriviConfig(Permessi.rimuoviClient(c, nome));
        return { ok: true };
      } catch (_) {
        return errore('ERRORE_INTERNO', 'Non riesco a rimuovere il collegamento.');
      }
    }
  };
}

module.exports = { creaGestoriAccesso, SEZIONI_VALIDE };
