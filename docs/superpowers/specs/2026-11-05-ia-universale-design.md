# Assistente Personale utilizzabile da qualsiasi IA — design

Data: 2026-11-05 · Stato: **bozza da approvare** · Lingua del progetto: italiano

> **Aggiornamento in esecuzione.** Il file dati sta in `percorsoDati()` (vedi `ia/archivio.js`) e **non** si sposta `userData` di Electron, per non perdere il localStorage esistente. CLI e MCP scrivono solo `proposte.json` e `ia-config.json`: l'unico scrittore di `stato.json` è l'app.

## Intento e perché
Assistente Personale è oggi un'app chiusa: tutti i dati (routine, task, dieta, workout, sonno, obiettivi, diario) stanno in un unico JSON (`assistente_stato_v1`) dentro la pagina web, salvato con Capacitor Preferences. Nessun server, nessun file condiviso. L'unica IA prevista è quella integrata (Ollama), che propone e l'utente preme "Applica".

L'obiettivo è che **qualsiasi IA** (un modello locale gestito dal proprietario, ma anche un client come Claude, Codex o altri) possa **leggere e modificare** i dati dell'app, e che la cosa funzioni per **qualunque utente**, non solo per il proprietario. Il proprietario la userà con un'IA locale.

Principio guida, in parole dell'utente: l'app deve essere soprattutto modificabile **tramite l'app**. L'app resta il posto principale dove si vedono e si decidono le modifiche; l'IA non la scavalca.

## Obiettivi
1. Un'IA qualsiasi può leggere i dati (oggi, routine, task, obiettivi, diario, salute…) tramite un'interfaccia standard.
2. Un'IA può **proporre** modifiche; le modifiche si applicano solo dopo approvazione dell'utente nell'app (bottone Applica/Rifiuta, come già promette il README).
3. L'interfaccia non dipende da un solo standard: MCP è un adattatore, non il fondamento.
4. Funziona per chiunque: installazione semplice, nessun riferimento a Jarvis, al vault o al PC del proprietario.
5. I dati e le funzioni esistenti non si rompono (nessuna perdita, migrazione automatica).

## Non-obiettivi (per questa fase)
- Server o sincronizzazione su Android (fase successiva).
- Sincronizzazione cloud o account utente.
- Integrazione con Jarvis/DBVault; Lumetto (altro progetto, altra sessione).
- Un modello IA incorporato nell'app.

## Anti-obiettivi (sarebbe un fallimento anche se "funziona")
- Un'IA che modifica dati senza l'approvazione dell'utente.
- Dati di salute e diario raggiungibili da altri computer o da internet senza consenso esplicito.
- Perdere o corrompere i dati esistenti di un utente.
- Richiedere MCP o un servizio cloud per usare l'app.

## Vincoli (dal codice attuale)
- Il codice è fatto di script a variabili globali (`const Dati = (function(){…})()`), caricati da `www/index.html` senza bundler. `storage.js` è legato a `window.Capacitor.Plugins.Preferences`.
- Electron (`desktop/`) ha `contextIsolation`, `sandbox`, solo 3 canali IPC (`esporta-json`, `chiama-ia`, `elenca-modelli-ia`).
- Node 22+ (già richiesto da Capacitor 8). Test esistente: `test-smoke.js` (jsdom). Nessun test per Electron.
- I dati sono sensibili (salute, sonno, diario): trattarli come privati.

## Approcci considerati
- **A. MCP dentro il processo Electron.** Il più corto, ma solo con app desktop aperta, non su Android, e legato a MCP.
- **B. Nucleo dati indipendente + adattatori (scelto).** Un modulo senza interfaccia (leggere, validare, proporre, applicare) e, sopra, adattatori: MCP, API HTTP locale, riga di comando. Costa di più perché tocca `storage.js`.
- **C. Solo API HTTP locale (OpenAPI), senza MCP.** Semplice, ma i client IA più diffusi parlano MCP e servirebbe comunque un adattatore.

Scelto **B** dall'utente, perché rende l'app utilizzabile da IA diverse senza dipendere da uno standard solo.

## Decisioni dell'utente
- Approccio B.
- L'IA può leggere **e** modificare.
- L'app resta il luogo principale di modifica.
- Il proprietario userà un'IA locale; il progetto deve valere per tutti.

## Decisioni mie (da confermare o correggere)
1. **Le scritture dell'IA sono sempre proposte** in una coda; solo l'utente le applica dall'app. Nessuno strumento scrive direttamente.
2. **Prima fase solo desktop (Electron).** Il file dei dati su disco diventa la fonte di verità lì; Android resta com'è e si aggancia in una fase successiva (es. via file sincronizzato).
3. **Server spento per impostazione predefinita**, attivabile da Impostazioni, in ascolto solo su `127.0.0.1`, con token. Accesso dalla rete locale solo con scelta esplicita.
4. **Permessi per sezione:** l'utente sceglie quali sezioni l'IA vede (es. diario e salute disattivati per un client cloud). Valore predefinito prudente: sezioni sensibili escluse finché non attivate.
5. **Operazioni a insieme chiuso** (aggiungi/modifica/completa su routine, task, obiettivi, pasti, sonno, workout, diario…), validate dal nucleo con le stesse regole dell'app (es. task mai nel passato, pasti non a zero). Nessuna scrittura di JSON grezzo.

## Chiarimenti dopo la rilettura (scelte mie, da correggere se non vanno)
6. **Processi e app chiusa.** Il nucleo è un modulo Node senza dipendenze, caricabile anche nel browser con un normale `<script>`. Su desktop il file dei dati è la fonte di verità. CLI e MCP (stdio) sono processi separati che leggono e scrivono quel file direttamente, anche con l'app chiusa. Per evitare corruzioni: scrittura atomica (file temporaneo + rinomina) e file di blocco. L'app controlla il file e si aggiorna da sola. Il server HTTP dentro Electron è facoltativo e fa le stesse cose.
7. **Persistenza in Electron.** Il file sta in `userData` di Electron (cartella dell'utente, nota nelle Impostazioni). Al primo avvio i dati già presenti nella pagina (localStorage/Preferences) vengono importati una sola volta, con un backup. Web e Android restano sul loro salvataggio attuale: il nucleo ha due "backend" (file e Preferences).
8. **Proposte obsolete.** Lo stato ha un numero di revisione, e ogni proposta ricorda la revisione su cui si basa. Se nel frattempo il dato è cambiato, la proposta è segnata "obsoleta" e non si applica da sola: l'utente la vede e decide.
9. **Permessi.** Valgono sia in lettura sia per le proposte: una sezione non permessa non si legge né si modifica. Ogni client ha un proprio token con le sue sezioni. Sezioni sensibili (spente di default): profilo/dieta, workout, sonno, diario.
10. **Proposte con più operazioni.** Ammesse; l'utente le applica tutte insieme o le rifiuta (nessuna applicazione a metà). La scelta riga per riga resta per dopo.
11. **IA integrata (Ollama).** Nella prima fase non si tocca. In seguito può usare la stessa coda.
12. **Perimetro minimo della prima fase.** Lettura di tutte le sezioni permesse. Proposte di scrittura per: routine, task, obiettivi, diario, pasti registrati, sonno. Il resto (schede workout, profilo, piano dieta, orario fisso, periodi dell'anno) dopo.

13. **Trasporto MCP (chiude la domanda sul client).** Il modello locale del proprietario passa da Hermes, che collega i server MCP tramite URL HTTP (`mcp_servers` con `url:`). Quindi il primo trasporto è **MCP su HTTP, solo 127.0.0.1, con token** (JSON-RPC su POST, come il server MCP già esistente di Jarvis), da eseguire come processo autonomo che funziona anche con l'app chiusa. **stdio** viene dopo, per client di terzi. Hermes si collega con un blocco `assistente` e un filtro sugli strumenti, dopo approvazione e prova. Decisione registrata come proposta in ADR-0009 del vault Jarvis.

## Architettura (a grandi linee)
```
App (UI)  ─┐
MCP       ─┼─▶ nucleo dati ─▶ file JSON su disco + coda delle proposte
API HTTP  ─┤     (leggi · valida · proponi · applica)
CLI       ─┘
```
- **Nucleo:** modulo Node/browser senza dipendenze, che contiene lo schema dello stato, la migrazione, la validazione e le operazioni. L'app lo carica al posto della logica oggi dentro `storage.js`.
- **Coda di proposte:** ogni proposta ha id, autore (nome del client), operazione, anteprima leggibile, data, stato (in attesa/applicata/rifiutata). L'app mostra la coda con Applica/Rifiuta.
- **Adattatori:** MCP (strumenti di lettura e `proponi_*`), API HTTP locale, CLI. Stessa semantica.
- **Sicurezza:** token obbligatorio, solo 127.0.0.1, controllo di Host/Origin, nessun dato nei log, dimensione massima delle richieste, rifiuto di campi sconosciuti.

## Verifica (come capire che è finito)
- Test del nucleo: lettura per sezione, validazioni, proposta → applica/rifiuta, migrazione di uno stato vecchio senza perdite.
- Test degli adattatori: MCP e API restituiscono gli stessi risultati; nessuna scrittura senza approvazione; token errato rifiutato; sezione non permessa non leggibile.
- `test-smoke.js` esistente continua a passare.
- Prova reale: un client MCP (anche solo uno script) legge i task di oggi e propone un task; l'app lo mostra e lo applica.

## Lasciato a chi costruisce
Elenco esatto degli strumenti, formato delle operazioni e delle proposte, scelta tra SDK MCP ufficiale e implementazione minima, struttura delle cartelle, come caricare il nucleo nel browser senza bundler, aspetto della schermata delle proposte, strategia di migrazione dalle Preferences al file.
