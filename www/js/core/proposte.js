/**
 * core/proposte.js
 * Proposte di modifica (insiemi di operazioni, tutto o niente). Modulo UMD: Node e browser (NucleoProposte).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./operazioni'));
  else root.NucleoProposte = factory(root.NucleoOperazioni);
})(typeof self !== 'undefined' ? self : this, function (NucleoOperazioni) {

  const MAX_OPERAZIONI = 50;
  const MAX_CLIENT = 200, MAX_MOTIVO = 2000;
  const O = NucleoOperazioni;

  function clona(v) { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }
  const GIORNI_BREVI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const idFinto = () => { let n = 0; return (p) => p + '_sim' + (++n); };

  function sintetico(v) {
    const t = typeof v === 'string' ? v : JSON.stringify(v === undefined ? null : v);
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }
  function dettaglioModifica(op, bers) {
    if (!bers) return '';
    const cambi = Object.keys(op.dati).filter(k => JSON.stringify(bers[k]) !== JSON.stringify(op.dati[k]))
      .map(k => k + ' ' + sintetico(bers[k]) + '→' + sintetico(op.dati[k]));
    return cambi.length ? ': ' + cambi.join(', ') : '';
  }

  function anteprimaOperazione(op, bers) {
    const d = op.dati || {};
    const det = /\.modifica$/.test(op.tipo) ? dettaglioModifica(op, bers) : '';
    switch (op.tipo) {
      case 'routine.aggiungi': return 'Aggiungi routine «' + d.nome + '»' + (d.oraInizio ? ' alle ' + d.oraInizio : '') + (d.durataMinuti ? ' per ' + d.durataMinuti + ' min' : '') + (Array.isArray(d.giorni) ? ', ' + (d.giorni.length === 7 ? 'ogni giorno' : d.giorni.map(g => GIORNI_BREVI[g - 1] || g).join(' ')) : '') + (d.priorita ? ', priorità ' + d.priorita : '');
      case 'routine.modifica': return 'Modifica routine «' + ((bers && bers.nome) || d.nome || op.id) + '»' + det;
      case 'task.aggiungi': return 'Aggiungi task «' + d.nome + '»' + (d.scadenza ? ' entro ' + d.scadenza : '') + (d.priorita ? ', priorità ' + d.priorita : '') + (d.ambito ? ', ambito ' + d.ambito : '');
      case 'task.modifica': return 'Modifica task «' + ((bers && bers.nome) || d.nome || op.id) + '»' + det;
      case 'obiettivo.aggiungi': return 'Aggiungi obiettivo «' + d.titolo + '»';
      case 'obiettivo.modifica': return 'Modifica obiettivo «' + ((bers && bers.titolo) || d.titolo || op.id) + '»' + det;
      case 'diario.imposta': return 'Scrivi il diario del ' + d.data + (d.voto ? ' (voto ' + d.voto + ')' : '');
      case 'pasto.aggiungi': return 'Aggiungi pasto «' + d.nome + '» il ' + d.data + ' (' + d.kcal + ' kcal)';
      case 'sonno.imposta': return 'Registra il sonno del ' + d.data + ' (' + d.oraInizio + '-' + d.oraFine + ')';
      default: return op.tipo;
    }
  }

  // Valida e applica in sequenza: ogni operazione sullo stato risultante dalle precedenti.
  // Il baseHash viene riallineato allo stato corrente della sequenza (il controllo
  // contro lo stato originale e' fatto a parte, in motiviObsoleta).
  function simula(stato, operazioni, ctx) {
    let corrente = stato;
    for (let i = 0; i < operazioni.length; i++) {
      const op = clona(operazioni[i]);
      const bers = O.bersaglio(corrente, op);
      if (bers) op.baseHash = O.hashRecord(bers); else delete op.baseHash;
      const r = O.validaOperazione(corrente, op, ctx.oggiISO);
      if (!r.ok) return { ok: false, motivi: r.errori.map(e => 'operazione ' + (i + 1) + ': ' + e) };
      corrente = O.applicaOperazione(corrente, op, ctx);
    }
    return { ok: true, stato: corrente };
  }

  function creaProposta(dati, stato, oggiISO, adessoISO, generaId) {
    try {
      if (!dati || typeof dati !== 'object') return { ok: false, errori: ['dati proposta mancanti'] };
      const errori = [];
      if (typeof dati.client !== 'string' || !dati.client.trim()) errori.push('client obbligatorio');
      else if (dati.client.length > MAX_CLIENT) errori.push('client troppo lungo (massimo ' + MAX_CLIENT + ' caratteri)');
      if (typeof dati.motivo !== 'string') errori.push('motivo deve essere testo');
      else if (dati.motivo.length > MAX_MOTIVO) errori.push('motivo troppo lungo (massimo ' + MAX_MOTIVO + ' caratteri)');
      const ops = Array.isArray(dati.operazioni) ? dati.operazioni : null;
      if (!ops || !ops.length) errori.push('nessuna operazione');
      else if (ops.length > MAX_OPERAZIONI) errori.push('troppe operazioni (massimo ' + MAX_OPERAZIONI + ')');
      if (errori.length) return { ok: false, errori };

      const bersagli = [];
      const operazioni = ops.map(o => {
        const op = clona(o);
        const bers = O.bersaglio(stato, op);
        bersagli.push(bers);
        if (bers) op.baseHash = O.hashRecord(bers); else delete op.baseHash;
        return op;
      });
      const r = simula(stato, operazioni, { oggiISO, generaId: idFinto() });
      if (!r.ok) return { ok: false, errori: r.motivi };
      return {
        ok: true,
        proposta: {
          id: generaId('proposta'), client: dati.client, motivo: dati.motivo, creatoIl: adessoISO,
          stato: 'in_attesa', operazioni, anteprima: operazioni.map((op, i) => anteprimaOperazione(op, bersagli[i]))
        }
      };
    } catch (e) {
      return { ok: false, errori: ['proposta non valida: ' + (e && e.message ? e.message : e)] };
    }
  }

  // Struttura di una proposta (anche ricaricata dal disco).
  function erroriStruttura(proposta) {
    if (!proposta || typeof proposta !== 'object') return ['proposta mancante'];
    if (proposta.stato !== 'in_attesa') return ['proposta già applicata/rifiutata'];
    const ops = proposta.operazioni;
    if (!Array.isArray(ops)) return ['operazioni mancanti'];
    if (ops.length < 1 || ops.length > MAX_OPERAZIONI) return ['numero di operazioni non valido (1-' + MAX_OPERAZIONI + ')'];
    if (!ops.every(o => o && typeof o === 'object' && typeof o.tipo === 'string')) return ['operazione senza tipo'];
    return [];
  }

  // Obsoleta: il bersaglio e' sparito o cambiato rispetto allo stato originale.
  function motiviObsoleta(stato, proposta) {
    const motivi = [];
    proposta.operazioni.forEach((op, i) => {
      const bers = O.bersaglio(stato, op);
      if (op.baseHash !== undefined) {
        if (!bers) motivi.push('operazione ' + (i + 1) + ': elemento non trovato (cancellato dopo la proposta)');
        else if (O.hashRecord(bers) !== op.baseHash) motivi.push('operazione ' + (i + 1) + ': elemento modificato dopo la proposta');
      } else if (bers) {
        motivi.push('operazione ' + (i + 1) + ': esiste ora una voce che non c\'era alla proposta');
      }
    });
    return motivi;
  }

  function controllaApplicabile(stato, proposta, oggiISO) {
    try {
      const st = erroriStruttura(proposta);
      if (st.length) return { stato: 'non_valida', motivi: st };
      const ob = motiviObsoleta(stato, proposta);
      if (ob.length) return { stato: 'obsoleta', motivi: ob };
      const r = simula(stato, proposta.operazioni, { oggiISO, generaId: idFinto() });
      return r.ok ? { stato: 'applicabile', motivi: [] } : { stato: 'non_valida', motivi: r.motivi };
    } catch (e) {
      return { stato: 'non_valida', motivi: ['proposta non valida: ' + (e && e.message ? e.message : e)] };
    }
  }

  function applicaProposta(stato, proposta, ctx) {
    try {
      const st = erroriStruttura(proposta);
      if (st.length) return { ok: false, stato: 'non_valida', motivi: st };
      const ob = motiviObsoleta(stato, proposta);
      if (ob.length) return { ok: false, stato: 'obsoleta', motivi: ob };
      const r = simula(stato, proposta.operazioni, ctx);
      return r.ok ? { ok: true, stato: r.stato } : { ok: false, stato: 'non_valida', motivi: r.motivi };
    } catch (e) {
      return { ok: false, stato: 'non_valida', motivi: ['proposta non valida: ' + (e && e.message ? e.message : e)] };
    }
  }

  return { MAX_OPERAZIONI, creaProposta, controllaApplicabile, applicaProposta };
});
