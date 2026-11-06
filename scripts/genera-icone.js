// Genera TUTTE le icone dell'app dal marchio originale definito qui sotto (nessun asset di terzi).
// Uso: node scripts/genera-icone.js   (richiede `npm install` in desktop/: usa Electron per disegnare gli SVG)
// Scrive: icone Android (mipmap + splash), icona Windows/Electron (desktop/build/icon.png e icon.ico).
//
// Il marchio: un anello (il ciclo di una giornata) riempito per una parte, e un punto ambra che segna
// «adesso» alla fine del tratto. Colori: blu inchiostro dell'app, bianco, ambra.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const RES = path.join(REPO, 'android', 'app', 'src', 'main', 'res');
const BLU = '#1E3A61', AMBRA = '#F2B134';

/** Marchio su una tela quadrata 512x512, centrato e scalato (scala 1 = anello grande 344px). */
function marchio(scala = 1) {
  const r = 150, cx = 256, cy = 256, sw = 44;
  const fine = (160 * Math.PI) / 180; // 250° in senso orario dall'alto => punto a 160° nel piano SVG
  const px = cx + r * Math.cos(fine), py = cy + r * Math.sin(fine);
  const grande = 1; // l'arco è > 180°
  const arco = `M ${cx} ${cy - r} A ${r} ${r} 0 ${grande} 1 ${px.toFixed(2)} ${py.toFixed(2)}`;
  return `<g transform="translate(256 256) scale(${scala}) translate(-256 -256)">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#fff" stroke-opacity=".24" stroke-width="${sw}"/>
    <path d="${arco}" fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round"/>
    <circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="34" fill="${AMBRA}"/>
  </g>`;
}
const svg = (corpo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${corpo}</svg>`;
const iconaQuadrata = svg(`<rect width="512" height="512" rx="112" fill="${BLU}"/>${marchio(1)}`);
const iconaTonda = svg(`<circle cx="256" cy="256" r="256" fill="${BLU}"/>${marchio(0.9)}`);
const primoPiano = svg(marchio(0.6)); // area sicura del launcher adattivo: ~66% centrale, sfondo trasparente
const soloMarchio = svg(marchio(1));

// ---- elenco di ciò che va prodotto: [percorso, larghezza, altezza, svg, sfondo-pieno?] ----
function elenco() {
  const L = [];
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    L.push([`${RES}/mipmap-${d}/ic_launcher.png`, 48 * k, 48 * k, iconaQuadrata]);
    L.push([`${RES}/mipmap-${d}/ic_launcher_round.png`, 48 * k, 48 * k, iconaTonda]);
    L.push([`${RES}/mipmap-${d}/ic_launcher_foreground.png`, 108 * k, 108 * k, primoPiano]);
  }
  // splash: stesse dimensioni dei file esistenti, sfondo blu inchiostro, marchio al centro (~26% del lato corto)
  const splash = { 'drawable': [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
    'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800],
    'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920] };
  for (const [cart, [w, h]] of Object.entries(splash)) {
    const lato = Math.round(Math.min(w, h) * 0.34);
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${BLU}"/><svg x="${(w - lato) / 2}" y="${(h - lato) / 2}" width="${lato}" height="${lato}" viewBox="0 0 512 512">${marchio(1)}</svg></svg>`;
    L.push([`${RES}/${cart}/splash.png`, w, h, s]);
  }
  const B = path.join(REPO, 'desktop', 'build');
  L.push([`${B}/icon.png`, 512, 512, iconaQuadrata]);
  for (const n of [16, 24, 32, 48, 64, 128, 256]) L.push([`${B}/ico-${n}.png`, n, n, iconaQuadrata]);
  return L;
}

// ---- parte Electron: disegna ogni SVG e salva il PNG ----
async function dentroElectron() {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => { /* niente uscita automatica: si esce a fine lavoro */ });
  await app.whenReady();
  const lavori = JSON.parse(fs.readFileSync(process.env.AP_LAVORI, 'utf8'));
  for (const [file, w, h, s] of lavori) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const win = new BrowserWindow({ show: false, width: w, height: h, useContentSize: true, frame: false, transparent: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent;overflow:hidden"><div style="width:${w}px;height:${h}px">${s.replace('<svg ', `<svg style="width:${w}px;height:${h}px" `)}</div></body></html>`));
    await new Promise(r => setTimeout(r, 150));
    let img = await win.webContents.capturePage();
    const t = img.getSize();
    if (t.width !== w || t.height !== h) img = img.resize({ width: w, height: h, quality: 'best' });
    fs.writeFileSync(file, img.toPNG());
    win.destroy();
    console.log('ok', path.basename(path.dirname(file)) + '/' + path.basename(file), w + 'x' + h);
  }
  app.quit();
}

function creaIco(dimensioni, dest) {
  const png = dimensioni.map(n => fs.readFileSync(path.join(REPO, 'desktop', 'build', `ico-${n}.png`)));
  const head = Buffer.alloc(6 + 16 * png.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(png.length, 4);
  let off = head.length;
  png.forEach((p, i) => {
    const n = dimensioni[i], o = 6 + 16 * i;
    head.writeUInt8(n >= 256 ? 0 : n, o); head.writeUInt8(n >= 256 ? 0 : n, o + 1); head.writeUInt8(0, o + 2); head.writeUInt8(0, o + 3);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(p.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += p.length;
  });
  fs.writeFileSync(dest, Buffer.concat([head, ...png]));
  dimensioni.forEach(n => fs.rmSync(path.join(REPO, 'desktop', 'build', `ico-${n}.png`)));
}

if (process.versions.electron) {
  dentroElectron().catch(e => { console.error(e); process.exit(1); });
} else {
  const electron = require(path.join(REPO, 'desktop', 'node_modules', 'electron'));
  const tmp = path.join(require('node:os').tmpdir(), 'ap-lavori-icone.json');
  fs.writeFileSync(tmp, JSON.stringify(elenco()));
  const r = spawnSync(electron, [__filename], { env: { ...process.env, AP_LAVORI: tmp }, stdio: 'inherit' });
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) process.exit(r.status || 1);
  creaIco([16, 24, 32, 48, 64, 128, 256], path.join(REPO, 'desktop', 'build', 'icon.ico'));
  fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BLU}</color>\n</resources>\n`);
  fs.writeFileSync(path.join(REPO, 'desktop', 'build', 'marchio.svg'), soloMarchio);
  console.log('Icone generate.');
}
