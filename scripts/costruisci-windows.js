// Costruisce l'installer Windows (desktop/dist). Uso: node scripts/costruisci-windows.js
// Perché non basta `npm run dist`: su Windows senza privilegio per i collegamenti simbolici (modalità sviluppatore)
// electron-builder fallisce nello scompattare winCodeSign. Qui si costruisce la cartella senza quel passo,
// si imposta l'icona dell'eseguibile con rcedit (già scaricato nella cache di electron-builder) e si crea l'installer.
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const DESKTOP = path.join(__dirname, '..', 'desktop');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
const eb = (...a) => { const r = spawnSync('npx', ['electron-builder', ...a], { cwd: DESKTOP, env, stdio: 'inherit', shell: true }); if (r.status !== 0) process.exit(r.status || 1); };

fs.rmSync(path.join(DESKTOP, 'dist'), { recursive: true, force: true });
eb('--win', '--dir', '-c.win.signAndEditExecutable=false');

// rcedit dalla cache di electron-builder
const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache', 'winCodeSign');
let rcedit = null;
if (fs.existsSync(cache)) for (const d of fs.readdirSync(cache)) { const f = path.join(cache, d, 'rcedit-x64.exe'); if (fs.existsSync(f)) { rcedit = f; break; } }
const exe = path.join(DESKTOP, 'dist', 'win-unpacked', 'Assistente Personale.exe');
if (rcedit) {
  const r = spawnSync(rcedit, [exe, '--set-icon', path.join(DESKTOP, 'build', 'icon.ico')], { stdio: 'inherit' });
  console.log(r.status === 0 ? 'Icona dell\'eseguibile impostata.' : 'Icona dell\'eseguibile NON impostata (rcedit ha fallito).');
} else console.log('rcedit non trovato nella cache: l\'eseguibile avrà l\'icona predefinita di Electron.');

eb('--win', 'nsis', '--prepackaged', 'dist/win-unpacked', '-c.win.signAndEditExecutable=false');
console.log('Installer in desktop/dist');
