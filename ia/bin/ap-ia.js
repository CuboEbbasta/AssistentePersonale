#!/usr/bin/env node
'use strict';
/**
 * CLI dell'accesso IA all'assistente personale.
 * Cartella dati: ASSISTENTE_DATI oppure il percorso predefinito (percorsoDati()).
 */
const { creaArchivio, percorsoDati } = require('../archivio.js');
const Permessi = require('../permessi.js');
const { creaServerMcp } = require('../mcp-http.js');

const USO = [
  'Uso: ap-ia <comando>',
  '  serve                              avvia il server MCP (serve "abilita")',
  '  client add <nome> [--sezioni a,b]  crea un client e stampa il token (una sola volta)',
  '  client list                        elenca i client (senza token)',
  '  client remove <nome>               rimuove un client',
  '  abilita | disabilita               attiva o disattiva l\'accesso IA',
  '  proposte                           elenca le proposte',
].join('\n');

class ErroreCli extends Error {}

function testoAnteprima(p) {
  const a = p.anteprima;
  if (Array.isArray(a)) return a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  if (typeof a === 'string') return [a];
  return [];
}

function comandoProposte(archivio, out) {
  const lista = archivio.elencaProposte();
  if (lista.length === 0) { out('Nessuna proposta.'); return; }
  for (const p of lista) {
    out(`${p.id}  [${p.stato}]  client: ${p.client}${p.creataIl ? '  ' + p.creataIl : ''}`);
    if (p.motivo) out('  Motivo: ' + p.motivo);
    for (const r of testoAnteprima(p)) out('  - ' + r);
  }
}

function comandoClient(archivio, args, out) {
  const [sotto, ...resto] = args;
  const config = archivio.leggiConfig();
  if (sotto === 'add') {
    const nome = resto[0];
    if (!nome) throw new ErroreCli('Manca il nome del client.');
    let sezioni;
    const i = resto.indexOf('--sezioni');
    if (i !== -1) {
      if (!resto[i + 1]) throw new ErroreCli('Manca l\'elenco delle sezioni dopo --sezioni.');
      sezioni = resto[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
    }
    let r;
    try { r = Permessi.creaClient(config, nome, sezioni); } catch (e) { throw new ErroreCli(e.message); }
    archivio.scriviConfig(r.config);
    out('Client «' + nome + '» creato. Token (mostrato una sola volta, conservalo):');
    out(r.token);
    return;
  }
  if (sotto === 'list') {
    if (config.client.length === 0) { out('Nessun client.'); return; }
    for (const c of config.client) out(c.nome + '  sezioni: ' + c.sezioni.join(', '));
    return;
  }
  if (sotto === 'remove') {
    const nome = resto[0];
    if (!nome) throw new ErroreCli('Manca il nome del client.');
    if (!config.client.some((c) => c.nome === nome)) throw new ErroreCli('Client non trovato: ' + nome);
    archivio.scriviConfig(Permessi.rimuoviClient(config, nome));
    out('Client «' + nome + '» rimosso.');
    return;
  }
  throw new ErroreCli('Sottocomando client sconosciuto.\n' + USO);
}

function comandoServe(archivio, out) {
  const config = archivio.leggiConfig();
  if (config.abilitato !== true) {
    throw new ErroreCli('L\'accesso IA è disabilitato. Eseguilo prima: ap-ia abilita');
  }
  const server = creaServerMcp({ archivio, host: '127.0.0.1', porta: config.porta });
  server.on('error', (e) => {
    process.stderr.write('Impossibile avviare il server: ' + (e && e.code ? e.code : 'errore') + '\n');
    process.exit(1);
  });
  server.listen(config.porta, '127.0.0.1', () => {
    out('Server MCP in ascolto su http://127.0.0.1:' + server.address().port + '/mcp (solo questo computer)');
  });
}

function main(argv, out = (t) => process.stdout.write(t + '\n')) {
  const [cmd, ...args] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') { out(USO); return; }
  const archivio = creaArchivio(percorsoDati());
  switch (cmd) {
    case 'serve': return comandoServe(archivio, out);
    case 'client': return comandoClient(archivio, args, out);
    case 'abilita':
    case 'disabilita': {
      const abilitato = cmd === 'abilita';
      archivio.scriviConfig({ ...archivio.leggiConfig(), abilitato });
      out(abilitato ? 'Accesso IA abilitato.' : 'Accesso IA disabilitato.');
      return;
    }
    case 'proposte': return comandoProposte(archivio, out);
    default: throw new ErroreCli('Comando sconosciuto: ' + String(cmd).slice(0, 40) + '\n' + USO);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write((e instanceof ErroreCli ? e.message : 'Operazione non riuscita: ' + (e && e.code ? e.code : 'errore')) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { main };
