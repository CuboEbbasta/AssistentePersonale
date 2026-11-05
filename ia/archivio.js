'use strict';
/**
 * Archivio su file dell'assistente (CommonJS, solo libreria standard).
 * File: stato.json, stato.bak.json, proposte.json, ia-config.json.
 * Unico scrittore previsto di stato.json: l'app (via scriviStato).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Schema = require('../www/js/core/schema.js');

const BLOCCO_VECCHIO_MS = 10000;
const BLOCCO_ATTESA_MAX_MS = 2000;
const BLOCCO_RIPROVA_MS = 50;

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

function scriviAtomico(file, testo) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, testo);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignora */ }
    throw e;
  }
}

function leggiJson(file, descr) {
  const testo = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(testo);
  } catch (e) {
    throw new ErroreArchivio('STATO_CORROTTO', `${descr} non è un JSON valido: ${e.message}`);
  }
}

function creaArchivio(dir) {
  const f = (n) => path.join(dir, n);
  const assicuraDir = () => fs.mkdirSync(dir, { recursive: true });

  function conBlocco(fn) {
    assicuraDir();
    const lock = f('proposte.lock');
    const inizio = Date.now();
    for (;;) {
      try {
        fs.closeSync(fs.openSync(lock, 'wx'));
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        try {
          if (Date.now() - fs.statSync(lock).mtimeMs > BLOCCO_VECCHIO_MS) {
            fs.unlinkSync(lock);
            continue;
          }
        } catch (_) { continue; /* sparito nel frattempo */ }
        if (Date.now() - inizio >= BLOCCO_ATTESA_MAX_MS) {
          throw new ErroreArchivio('BLOCCO_SCADUTO', 'proposte.lock occupato');
        }
        dormi(BLOCCO_RIPROVA_MS);
      }
    }
    try {
      return fn();
    } finally {
      try { fs.unlinkSync(lock); } catch (_) { /* ignora */ }
    }
  }

  function leggiProposteGrezze() {
    if (!fs.existsSync(f('proposte.json'))) return [];
    const v = leggiJson(f('proposte.json'), 'proposte.json');
    return Array.isArray(v) ? v : [];
  }
  const scriviProposte = (lista) => scriviAtomico(f('proposte.json'), JSON.stringify(lista, null, 2));

  return {
    dir,
    leggiStato() {
      if (!fs.existsSync(f('stato.json'))) return Schema.statoDefault();
      return Schema.migra(leggiJson(f('stato.json'), 'stato.json'));
    },
    leggiStatoDaBackup() {
      if (!fs.existsSync(f('stato.bak.json'))) return Schema.statoDefault();
      return Schema.migra(leggiJson(f('stato.bak.json'), 'stato.bak.json'));
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
        lista[i] = Object.assign({}, lista[i], patch);
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
