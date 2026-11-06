'use strict';
/**
 * Migrazione una tantum: dal vecchio salvataggio (Capacitor Preferences,
 * stringa JSON) al file stato.json. Gira nel processo main di Electron.
 */
const fs = require('node:fs');
const path = require('node:path');
const Schema = require('../www/js/core/schema.js');

function migraDaPreferences(archivio, valoreGrezzo) {
  if (fs.existsSync(path.join(archivio.dir, 'stato.json'))) return 'gia_presente';
  if (typeof valoreGrezzo !== 'string' || valoreGrezzo === '') return 'nessun_dato';
  const parsed = JSON.parse(valoreGrezzo); // lancia se non è JSON: nessun file creato
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Il valore da migrare non è un oggetto di stato');
  }
  fs.mkdirSync(archivio.dir, { recursive: true });
  // copia originale prima, poi lo stato migrato (se la scrittura fallisce resta la copia)
  fs.writeFileSync(path.join(archivio.dir, 'stato.import-backup.json'), valoreGrezzo);
  archivio.scriviStato(Schema.migra(parsed));
  return 'importato';
}

module.exports = { migraDaPreferences };
