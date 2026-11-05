'use strict';
/**
 * Archivio su file dell'assistente (CommonJS, solo libreria standard).
 * File: stato.json, stato.bak.json, proposte.json, ia-config.json.
 * Unico scrittore previsto di stato.json: l'app (via scriviStato).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Schema = require('../www/js/core/schema.js');

const BLOCCO_VECCHIO_MS = 10000;
const BLOCCO_ATTESA_MAX_MS = 2000;
const BLOCCO_RIPROVA_MS = 50;
const ERRORI_TRANSITORI = ['EPERM', 'EBUSY', 'EACCES'];

class ErroreArchivio extends Error {
  constructor(code, messaggio) {
    super(messaggio);
    this.name = 'ErroreArchivio';
    this.code = code;
  }
}

function percorsoDati(env = process.env) {
  if (env.ASSISTENTE_DATI) return env.ASSISTENTE_DATI;
  if (process.platform === 'win32') {
    const base = env.APPDATA || path.join(env.USERPROFILE || os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'Assistente Personale');
  }
  return path.join(env.HOME || os.homedir(), '.assistente-personale');
}

function dormi(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Riprova (max 10 tentativi, attesa 20-50 ms) su errori tipici di Windows (antivirus, file aperto).
function conRetry(fn) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (!ERRORI_TRANSITORI.includes(e.code) || i >= 10) throw e;
      dormi(20 + Math.floor(Math.random() * 31));
    }
  }
}

function scriviAtomico(file, testo) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, testo);
    conRetry(() => fs.renameSync(tmp, file));
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignora */ }
    throw e;
  }
}

function leggiJson(file, descr, code = 'FILE_CORROTTO') {
  const testo = conRetry(() => fs.readFileSync(file, 'utf8'));
  try {
    return JSON.parse(testo);
  } catch (e) {
    throw new ErroreArchivio(code, `${descr} non è un JSON valido: ${e.message}`);
  }
}

function creaArchivio(dir) {
  const f = (n) => path.join(dir, n);
  const assicuraDir = () => fs.mkdirSync(dir, { recursive: true });

  function conBlocco(fn) {
    assicuraDir();
    const lock = f('proposte.lock');
    const token = `${process.pid}-${crypto.randomUUID()}`;
    const inizio = Date.now();
    for (;;) {
      try {
        const fd = fs.openSync(lock, 'wx');
        try { fs.writeSync(fd, token); } finally { fs.closeSync(fd); }
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        let riprova = false;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > BLOCCO_VECCHIO_MS) {
            // rimozione atomica: chi perde la corsa riceve ENOENT e riprova
            const stale = `${lock}.stale.${token}`;
            fs.renameSync(lock, stale);
            try {
              // se in realtà era un blocco appena preso da altri, ripristinalo
              if (Date.now() - fs.statSync(stale).mtimeMs <= BLOCCO_VECCHIO_MS) {
                try { fs.linkSync(stale, lock); } catch (_) { /* ignora */ }
              }
            } catch (_) { /* ignora */ }
            try { fs.unlinkSync(stale); } catch (_) { /* ignora */ }
            riprova = true;
          }
        } catch (e2) {
          if (e2.code === 'ENOENT') riprova = true; // sparito nel frattempo
        }
        if (riprova) continue;
        if (Date.now() - inizio >= BLOCCO_ATTESA_MAX_MS) {
          throw new ErroreArchivio('BLOCCO_SCADUTO', 'proposte.lock occupato');
        }
        dormi(BLOCCO_RIPROVA_MS);
      }
    }
    try {
      return fn();
    } finally {
      try {
        if (fs.readFileSync(lock, 'utf8') === token) fs.unlinkSync(lock);
      } catch (_) { /* ignora */ }
    }
  }

  function leggiProposteGrezze() {
    if (!fs.existsSync(f('proposte.json'))) return [];
    const v = leggiJson(f('proposte.json'), 'proposte.json');
    if (!Array.isArray(v)) throw new ErroreArchivio('PROPOSTE_CORROTTE', 'proposte.json non contiene un array');
    return v;
  }
  const scriviProposte = (lista) => scriviAtomico(f('proposte.json'), JSON.stringify(lista, null, 2));

  return {
    dir,
    conBlocco, // interno: usato dai test
    leggiStato() {
      if (!fs.existsSync(f('stato.json'))) return Schema.statoDefault();
      return Schema.migra(leggiJson(f('stato.json'), 'stato.json', 'STATO_CORROTTO'));
    },
    leggiStatoDaBackup() {
      if (!fs.existsSync(f('stato.bak.json'))) return Schema.statoDefault();
      return Schema.migra(leggiJson(f('stato.bak.json'), 'stato.bak.json', 'STATO_CORROTTO'));
    },
    scriviStato(stato) {
      assicuraDir();
      if (fs.existsSync(f('stato.json'))) {
        try {
          JSON.parse(fs.readFileSync(f('stato.json'), 'utf8')); // backup solo di uno stato valido
          fs.copyFileSync(f('stato.json'), f('stato.bak.json'));
        } catch (_) { /* attuale corrotto: non sovrascrivere il backup */ }
      }
      scriviAtomico(f('stato.json'), JSON.stringify(stato));
    },
    elencaProposte() {
      return leggiProposteGrezze();
    },
    aggiungiProposta(p) {
      conBlocco(() => scriviProposte(leggiProposteGrezze().concat([p])));
    },
    aggiornaProposta(id, patch) {
      return conBlocco(() => {
        const lista = leggiProposteGrezze();
        const i = lista.findIndex((p) => p.id === id);
        if (i < 0) throw new ErroreArchivio('PROPOSTA_INESISTENTE', `Proposta non trovata: ${id}`);
        lista[i] = Object.assign({}, lista[i], patch, { id: lista[i].id });
        scriviProposte(lista);
        return lista[i];
      });
    },
    leggiConfig() {
      const def = { abilitato: false, porta: 3040, client: [] };
      if (!fs.existsSync(f('ia-config.json'))) return def;
      return Object.assign(def, leggiJson(f('ia-config.json'), 'ia-config.json'));
    },
    scriviConfig(c) {
      assicuraDir();
      scriviAtomico(f('ia-config.json'), JSON.stringify(c, null, 2));
    },
  };
}

module.exports = { percorsoDati, ErroreArchivio, creaArchivio };
