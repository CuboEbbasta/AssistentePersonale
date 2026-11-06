/**
 * dial.js
 * "Barra del giorno": le 24 ore rappresentate come una riga orizzontale
 * (come un righello), non come un quadrante circolare — più leggibile e
 * meno "clip-art da assistente generico". Per mese/anno si usa invece la
 * torta (vedi renderTortaGenerica), come deciso in precedenza per quelle
 * viste retrospettive.
 */
const Quadrante = (function () {
  const COLORE_LIBERO = 'var(--surface-alt)';
  let contatoreId = 0;

  // Nomi e colori possono arrivare da testo utente/IA: mai inserirli nell'SVG senza escape.
  // (Copia locale: dial.js e' caricato prima di ui-routine.js, dove vive UiRoutine.escapeHtml.)
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function polareACartesiane(cx, cy, r, angoloGradi) {
    const rad = (angoloGradi - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function pathSpicchio(cx, cy, r, angoloIniziale, angoloFinale) {
    if (angoloFinale - angoloIniziale >= 359.99) {
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${(cx - 0.01).toFixed(2)} ${(cy - r).toFixed(2)} Z`;
    }
    const p1 = polareACartesiane(cx, cy, r, angoloIniziale);
    const p2 = polareACartesiane(cx, cy, r, angoloFinale);
    const arcoGrande = (angoloFinale - angoloIniziale) > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${arcoGrande} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z`;
  }

  /** blocchi: [{inizioMin, fineMin, colore, nome, tipo, chiave}] non sovrapposti */
  function calcolaSpicchi(blocchi) {
    const ordinati = blocchi.slice().sort((a, b) => a.inizioMin - b.inizioMin);
    const spicchi = [];
    let cursore = 0;
    ordinati.forEach(b => {
      const inizio = Math.max(0, Math.min(1440, b.inizioMin));
      const fine = Math.max(0, Math.min(1440, b.fineMin));
      if (inizio > cursore) {
        spicchi.push({ inizioMin: cursore, fineMin: inizio, colore: COLORE_LIBERO, nome: 'Tempo libero', tipo: 'libero' });
      }
      if (fine > inizio) {
        spicchi.push({ inizioMin: inizio, fineMin: fine, colore: b.colore, nome: b.nome, tipo: b.tipo, chiave: b.chiave });
      }
      cursore = Math.max(cursore, fine);
    });
    if (cursore < 1440) {
      spicchi.push({ inizioMin: cursore, fineMin: 1440, colore: COLORE_LIBERO, nome: 'Tempo libero', tipo: 'libero' });
    }
    return spicchi;
  }

  /** La barra orizzontale delle 24 ore: segmenti proporzionali, tacche ogni 3h, indicatore "adesso" */
  function renderSVG(spicchi, minutiAdesso, larghezza) {
    larghezza = larghezza || 300;
    const altezzaBarra = 34;
    const clipId = 'barra-clip-' + (contatoreId++);

    const segmenti = spicchi.map(s => {
      const x = (s.inizioMin / 1440) * larghezza;
      const w = Math.max(0, ((s.fineMin - s.inizioMin) / 1440) * larghezza);
      return `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${altezzaBarra}" fill="${esc(s.colore)}"><title>${esc(s.nome)}</title></rect>`;
    }).join('');

    let tacche = '';
    [0, 3, 6, 9, 12, 15, 18, 21].forEach(h => {
      const x = (h / 24) * larghezza;
      tacche += `<line x1="${x.toFixed(1)}" y1="${altezzaBarra}" x2="${x.toFixed(1)}" y2="${altezzaBarra + 4}" stroke="var(--ink-faint)" stroke-width="1"/>`;
      tacche += `<text x="${x.toFixed(1)}" y="${altezzaBarra + 15}" font-size="9" font-family="ui-monospace,monospace" fill="var(--ink-faint)" text-anchor="start">${DataUtils.pad2(h)}</text>`;
    });

    let lancetta = '';
    if (typeof minutiAdesso === 'number') {
      const x = (minutiAdesso / 1440) * larghezza;
      lancetta = `<polygon points="${(x-4).toFixed(1)},-7 ${(x+4).toFixed(1)},-7 ${x.toFixed(1)},-1" fill="var(--ink)"/>
                  <line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${altezzaBarra}" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="2,2"/>`;
    }

    return `<svg class="barra-giorno-svg" viewBox="0 -9 ${larghezza} ${altezzaBarra + 24}" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="${clipId}"><rect x="0" y="0" width="${larghezza}" height="${altezzaBarra}" rx="5"/></clipPath></defs>
      <g clip-path="url(#${clipId})">${segmenti}</g>
      <rect x="0.5" y="0.5" width="${larghezza - 1}" height="${altezzaBarra - 1}" rx="4.5" fill="none" stroke="var(--border)" stroke-width="1"/>
      ${tacche}
      ${lancetta}
    </svg>`;
  }

  /** Versione generica a torta per proporzioni qualsiasi (mese/anno): resta un grafico a torta come deciso in precedenza */
  function renderTortaGenerica(fette, size) {
    size = size || 220;
    const cx = size / 2, cy = size / 2, r = size / 2 - 6;
    const totale = fette.reduce((s, f) => s + f.valore, 0) || 1;
    let cursore = 0;
    const percorsi = fette.filter(f => f.valore > 0).map(f => {
      const a0 = (cursore / totale) * 360;
      cursore += f.valore;
      const a1 = (cursore / totale) * 360;
      return `<path d="${pathSpicchio(cx, cy, r, a0, a1)}" fill="${esc(f.colore)}" stroke="var(--surface)" stroke-width="1.5"><title>${esc(f.nome)}</title></path>`;
    }).join('');
    return `<svg class="quadrante-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r + 1}" fill="var(--surface)" />
      ${percorsi}
    </svg>`;
  }

  return { calcolaSpicchi, renderSVG, renderTortaGenerica, COLORE_LIBERO };
})();

window.Quadrante = Quadrante;
