/**
 * core/proposte.js
 * Proposte di modifica (insiemi di operazioni, tutto o niente). Modulo UMD: Node e browser (NucleoProposte).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./operazioni'));
  else root.NucleoProposte = factory(root.NucleoOperazioni);
})(typeof self !== 'undefined' ? self : this, function (NucleoOperazioni) {

  const MAX_OPERAZIONI = 50;
  const O = NucleoOperazioni;

  function clona(v) { return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)); }

  function anteprimaOperazione(op) {
    const d = op.dati || {};
    switch (op.tipo) {
      case 'routine.aggiungi': return 'Aggiungi routine «' + d.nome + '»' + (d.oraInizio ? ' alle ' + d.oraInizio : '');
      case 'routine.modifica': return 'Modifica routine' + (d.nome ? ' «' + d.nome + '»' : '') + ' (' + op.id + ')';
      case 'task.aggiungi': return 'Aggiungi task «' + d.nome + '»' + (d.scadenza ? ' entro ' + d.scadenza : '');
      case 'task.modifica': return 'Modifica task' + (d.nome ? ' «' + d.nome + '»' : '') + ' (' + op.id + ')';
      case 'obiettivo.aggiungi': return 'Aggiungi obiettivo «' + d.titolo + '»';
      case 'obiettivo.modifica': return 'Modifica obiettivo' + (d.titolo ? ' «' + d.titolo + '»' : '') + ' (' + op.id + ')';
      case 'diario.imposta': return 'Scrivi il diario del ' + d.data + (d.voto ? ' (voto ' + d.voto + ')' : '');
      case 'pasto.aggiungi': return 'Aggiungi pasto «' + d.nome + '» il ' + d.data + ' (' + d.kcal + ' kcal)';
      case 'sonno.imposta': return 'Registra il sonno del ' + d.data + ' (' + d.oraInizio + '-' + d.oraFine + ')';
      default: return op.tipo;
    }
  }

  // Valida in sequenza: ogni operazione sullo stato risultante dalle precedenti.
  // Il baseHash viene riallineato allo stato corrente della sequenza (il controllo
  // contro lo stato originale e' fatto a parte).
  function simula(stato, operazioni, ctx, fine) {
    let corrente = stato;
    for (let i = 0; i < operazioni.length; i++) {
      const op = clona(operazioni[i]);
      const bers = O.bersaglio(corrente, op);
      if (bers) op.baseHash = O.hashRecord(bers); else delete op.baseHash;
      const r = O.validaOperazione(corrente, op, ctx.oggiISO);
      if (!r.ok) return { ok: false, motivi: r.errori.map(e => 'operazione ' + (i + 1) + ': ' + e) };
      if (fine) corrente = O.applicaOperazione(corrente, op, ctx);
      else if (i < operazioni.length - 1) corrente = O.applicaOperazione(corrente, op, { oggiISO: ctx.oggiISO, generaId: ctx.generaId || (() => 'tmp') });
    }
    return { ok: true, stato: corrente };
  }

  function creaProposta(dati, stato, oggiISO, adessoISO, generaId) {
    const ops = dati && Array.isArray(dati.operazioni) ? dati.operazioni : null;
    if (!ops || !ops.length) return { ok: false, errori: ['nessuna operazione'] };
    if (ops.length > MAX_OPERAZIONI) return { ok: false, errori: ['troppe operazioni (massimo ' + MAX_OPERAZIONI + ')'] };
    const operazioni = ops.map(o => {
      const op = clona(o);
      const bers = O.bersaglio(stato, op);
      if (bers) op.baseHash = O.hashRecord(bers); else delete op.baseHash;
      return op;
    });
    const r = simula(stato, operazioni, { oggiISO, generaId }, false);
    if (!r.ok) return { ok: false, errori: r.motivi };
    return {
      ok: true,
      proposta: {
        id: generaId('proposta'), client: dati.client, motivo: dati.motivo, creatoIl: adessoISO,
        stato: 'in_attesa', operazioni, anteprima: operazioni.map(anteprimaOperazione)
      }
    };
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
    const ob = motiviObsoleta(stato, proposta);
    if (ob.length) return { stato: 'obsoleta', motivi: ob };
    const r = simula(stato, proposta.operazioni, { oggiISO, generaId: (p) => p + '_tmp' }, false);
    return r.ok ? { stato: 'applicabile', motivi: [] } : { stato: 'non_valida', motivi: r.motivi };
  }

  function applicaProposta(stato, proposta, ctx) {
    const ob = motiviObsoleta(stato, proposta);
    if (ob.length) return { ok: false, stato: 'obsoleta', motivi: ob };
    const r = simula(stato, proposta.operazioni, ctx, true);
    return r.ok ? { ok: true, stato: r.stato } : { ok: false, stato: 'non_valida', motivi: r.motivi };
  }

  return { MAX_OPERAZIONI, creaProposta, controllaApplicabile, applicaProposta };
});
