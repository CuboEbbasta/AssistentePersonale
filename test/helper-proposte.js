// Helper per test/archivio.test.js: aggiunge N proposte da un processo figlio.
const { creaArchivio } = require('../ia/archivio.js');
const [dir, prefisso, n] = process.argv.slice(2);
const a = creaArchivio(dir);
for (let i = 0; i < Number(n); i++) a.aggiungiProposta({ id: `${prefisso}-${i}`, stato: 'in_attesa' });
