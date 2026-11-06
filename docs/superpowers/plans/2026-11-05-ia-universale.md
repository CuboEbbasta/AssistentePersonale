# Assistente Personale usabile da qualsiasi IA — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Aggiornamento in esecuzione.** Il file dati sta in `percorsoDati()` (vedi `ia/archivio.js`) e **non** si sposta `userData` di Electron, per non perdere il localStorage esistente. CLI e MCP scrivono solo `proposte.json` e `ia-config.json`: l'unico scrittore di `stato.json` è l'app.

**Goal:** Un'IA qualsiasi (a partire da Hermes) legge i dati dell'app e ne **propone** modifiche tramite MCP su HTTP, API/CLI e stdio; l'utente applica o rifiuta ogni proposta dentro l'app.

**Architecture:** Un nucleo puro (schema, operazioni, proposte) in `www/js/core/`, caricabile sia dalla pagina sia da Node. Sopra, in `ia/`, un archivio su file (dati in `userData`), i permessi per client e un unico insieme di strumenti usato da tre adattatori (MCP HTTP, MCP stdio, CLI). **Un solo scrittore dello stato: l'app.** Gli adattatori leggono `stato.json` e scrivono solo `proposte.json`, quindi non c'è conflitto sullo stato.

**Tech Stack:** JavaScript, Node ≥ 22 (`node:test`, `http`, `crypto`, `fs`), nessuna dipendenza nuova a runtime; Electron/Capacitor già presenti.

**Spec:** `docs/superpowers/specs/2026-11-05-ia-universale-design.md` (decisioni 1–13). Decisione di piano: la "revisione" della spec è realizzata con un **hash del record bersaglio** (`baseHash`) invece di un contatore globale: una proposta è obsoleta solo se il *suo* record è cambiato.

## Perimetro ridotto (decisione dell'utente, 05/11: "importa solo che l'IA funzioni con l'applicazione, il resto vedremo")
Si eseguono **solo** i Task 1–7, 9, 10 e 12 (senza la documentazione estesa: basta un breve `docs/ia-esterna.md`). **Rimandati:** Task 8 tranne il comando `ap-ia client add` e `ap-ia abilita` (servono per creare il token e accendere il server; niente stdio), Task 11 (interfaccia delle impostazioni: per ora il server si avvia con `ap-ia serve`). Esecuzione: subagent-driven (scelta dell'utente: "procedi con il consigliato"). Lavoro sul branch locale `ia-universale`.

## Global Constraints
- Node ≥ 22; test con `node --test test/` (niente framework nuovi). `test-smoke.js` deve continuare a passare (`node test-smoke.js`).
- Zero dipendenze runtime nuove: server MCP scritto a mano (JSON-RPC su POST, protocollo `2025-06-18`), come `agents/jarvis_mcp/server.py` del progetto Jarvis.
- Server in ascolto **solo su `127.0.0.1`**, **spento di default**, porta predefinita `3040`, token `Authorization: Bearer <token>`; token salvati solo come hash SHA-256.
- Nessuno strumento scrive lo stato: le scritture dell'IA sono solo proposte; applica/rifiuta solo dall'app. Proposte: massimo 50 operazioni, richieste massimo 100 000 byte.
- Sezioni sensibili spente di default per ogni nuovo client: `dieta`, `workout`, `sonno`, `diario`. Default di un nuovo client: `['agenda','obiettivi']`.
- Nessun contenuto dei dati nei log. Testi dell'interfaccia in italiano.
- I moduli di `www/js/core/` sono UMD (nessun bundler): in Node `module.exports`, nel browser variabile globale.
- Web e Android continuano a usare Capacitor Preferences; il file su disco vale solo in Electron.
- Commit: solo con il consenso dell'utente (regola del workspace). Nessun `git push`.

## Review Focus
1. **`stato.json` corrotto o troncato:** gli adattatori falliscono con errore chiaro e non sovrascrivono mai; l'app ripristina da `stato.bak.json`. (Task 4, 9)
2. **Due proposte sullo stesso record:** dopo aver applicato la prima, la seconda diventa `obsoleta`, non viene applicata. (Task 3)
3. **Campi sconosciuti e `__proto__`/`constructor` nelle operazioni:** rifiutate, nessuna alterazione dei prototipi. (Task 2)
4. **Primo avvio senza file né proposte:** le letture restituiscono dati vuoti validi, non errori. (Task 4, 6)
5. **Token assente/errato e `Origin`/`Host` non locali (DNS rebinding):** 401/403 senza dettagli. (Task 7)

## File Structure
| File | Responsabilità |
|---|---|
| `www/js/core/schema.js` | stato predefinito, migrazione, elenco sezioni (UMD) |
| `www/js/core/operazioni.js` | validazione, applicazione e hash delle operazioni (UMD) |
| `www/js/core/proposte.js` | creazione, controllo di applicabilità e applicazione delle proposte (UMD) |
| `ia/archivio.js` | file su disco: stato, proposte, config; scrittura atomica e blocco |
| `ia/permessi.js` | client, token, sezioni, viste filtrate dello stato |
| `ia/strumenti.js` | i 4 strumenti, condivisi dagli adattatori |
| `ia/mcp-http.js`, `ia/mcp-stdio.js` | adattatori MCP |
| `ia/bin/ap-ia.js` | CLI (`serve`, `stdio`, `client`, `proposte`, `leggi`) |
| `desktop/main.js`, `desktop/preload.js` | persistenza su file, IPC, avvio del server |
| `www/js/storage.js` | backend file (Electron) oltre a Preferences; usa `core/schema.js` |
| `www/js/ui-proposte.js`, `ui-impostazioni.js` | schermata Proposte IA, impostazioni IA esterna |
| `test/*.test.js` | test di nucleo, archivio, permessi, strumenti, server |

---

### Task 1: Struttura di test e nucleo `schema`
**Files:** Create `www/js/core/schema.js`, `test/schema.test.js`; Modify `www/js/storage.js:16-130` (usa il nucleo), `www/index.html` (script `core/schema.js` prima di `storage.js`), `package.json` (script `test`: `node --test test/`, `test:smoke`: `node test-smoke.js`).

**Interfaces:** Produces `NucleoSchema.statoDefault(): Stato`, `NucleoSchema.migra(grezzo: object|null): Stato` (idempotente, conserva chiavi sconosciute), `NucleoSchema.SEZIONI: { agenda: string[], obiettivi: string[], diario: string[], dieta: string[], workout: string[], sonno: string[] }` (agenda = `routine,task,tipiAttivita,paroleChiaveTipi,orarioFisso,periodiAnno,log`; obiettivi = `obiettivi`; diario = `journal`; dieta = `profilo,dietaPiano,dietaLog`; workout = `profiloWorkout,schedaAdattiva,schedaPersonalizzata,workoutLog`; sonno = `sonnoLog`), `NucleoSchema.SEZIONI_SENSIBILI = ['dieta','workout','sonno','diario']`.

- [ ] **Step 1: test** `migra({})` ha tutte le chiavi di `statoDefault()`; `migra(migra(x))` deep-equal `migra(x)`; i 4 tipi protetti tornano se mancano; `workoutLog` con valori non-array diventa array (regola già in `carica()`); una chiave sconosciuta `{extra:1}` sopravvive; `migra(null)` = `statoDefault()`.
- [ ] **Step 2:** `node --test test/schema.test.js` → FALLISCE (modulo mancante).
- [ ] **Step 3:** estrai in `schema.js` il corpo di `statoDefault()` e tutte le correzioni di `carica()` (righe 83-130) in `migra`; `storage.js` le richiama. Nessun cambio di comportamento.
- [ ] **Step 4:** `node --test test/` PASS e `node test-smoke.js` PASS.
- [ ] **Step 5: Commit** (con OK) `refactor: schema e migrazione in core/schema.js`.

### Task 2: Operazioni (validazione e applicazione)
**Files:** Create `www/js/core/operazioni.js`, `test/operazioni.test.js`; Modify `www/index.html`.

**Interfaces:** Consumes `NucleoSchema`. Produces:
- Operazione: `{ tipo, id?, baseHash?, dati }`. Tipi ammessi (insieme chiuso, spec decisione 12): `routine.aggiungi|modifica`, `task.aggiungi|modifica`, `obiettivo.aggiungi|modifica`, `diario.imposta` (`dati: {data, fattoBene, daMigliorare, obiettivoDomani, voto}`), `pasto.aggiungi` (`dati: {data, nome, kcal, proteine, carboidrati, grassi}`), `sonno.imposta` (`dati: {data, oraInizio, oraFine, qualita?}`).
- `sezioneDi(tipo: string): 'agenda'|'obiettivi'|'diario'|'dieta'|'sonno'|null`
- `hashRecord(valore: any): string` (JSON con chiavi ordinate → FNV-1a 32 bit in esadecimale; senza `crypto`, funziona nel browser)
- `bersaglio(stato, op): any|null` (record puntato da `op.id`, o dato esistente per `diario.imposta`/`sonno.imposta` alla `data`)
- `validaOperazione(stato, op, oggiISO: string): { ok: boolean, errori: string[] }`
- `applicaOperazione(stato, op, ctx: { oggiISO: string, generaId(prefisso): string }): Stato` (restituisce una copia, mai muta l'input; lancia se non valida)

- [ ] **Step 1: test** (con i valori reali dell'app): task con `scadenza` < `oggiISO` → errore; `priorita` fuori 1–10 → errore; `oraInizio` "25:00" → errore; `giorni` fuori 1–7 → errore; `tipo` inesistente → errore; pasto con `kcal` 0 → errore (regola "pasti a zero" di `ui-dieta.js`); campo non ammesso `{evil:1}` → errore; **`dati` con chiave `__proto__` o `constructor` → errore e `({}).evil` resta `undefined`**; `task.aggiungi` valido → `stato.task` +1 con `completata:false`; `routine.modifica` cambia solo i campi dati; `applicaOperazione` non muta l'input.
- [ ] **Step 2:** i test FALLISCONO.
- [ ] **Step 3:** implementa con una tabella `OPERAZIONI` (campi ammessi e regole per tipo). Le regole replicano quelle dei form esistenti: leggi `ui-task.js`, `ui-routine.js`, `ui-obiettivi.js`, `ui-dieta.js`, `ui-sonno.js`, `ui-journal.js` e riusa le stesse costanti, senza cambiarle.
- [ ] **Step 4:** PASS (`node --test test/operazioni.test.js`).
- [ ] **Step 5: Commit** (con OK).

### Task 3: Proposte
**Files:** Create `www/js/core/proposte.js`, `test/proposte.test.js`; Modify `www/index.html`.

**Interfaces:** Consumes `NucleoOperazioni`. Produces:
- `Proposta = { id, client, motivo, creatoIl (ISO), stato: 'in_attesa'|'applicata'|'rifiutata', operazioni: Operazione[] (con baseHash), anteprima: string[] }`
- `MAX_OPERAZIONI = 50`
- `creaProposta({ client, motivo, operazioni }, stato, oggiISO, adessoISO, generaId): { ok: true, proposta } | { ok: false, errori: string[] }` (valida tutte le operazioni; compila `baseHash` = `hashRecord(bersaglio)`; `anteprima` in italiano, una riga per operazione)
- `controllaApplicabile(stato, proposta, oggiISO): { stato: 'applicabile'|'obsoleta'|'non_valida', motivi: string[] }`
- `applicaProposta(stato, proposta, ctx): { ok: true, stato } | { ok: false, stato: 'obsoleta'|'non_valida', motivi }` (tutto o niente)

- [ ] **Step 1: test** proposta valida → `in_attesa` con anteprima non vuota; 51 operazioni → errore; una operazione invalida → nessuna proposta; `applicaProposta` applica tutte le operazioni; se la 2ª fallisce lo stato restituito è l'originale (atomicità); **due proposte `task.modifica` sullo stesso id: applicata la prima, la seconda è `obsoleta`**; record cancellato nel frattempo → `obsoleta`.
- [ ] **Step 2:** FALLISCONO. **Step 3:** implementa. **Step 4:** PASS. **Step 5: Commit** (con OK).

### Task 4: Archivio su file
**Files:** Create `ia/archivio.js`, `test/archivio.test.js`.

**Interfaces:** Consumes `NucleoSchema`. Produces:
- `percorsoDati(env = process.env): string` (`ASSISTENTE_DATI` se impostata, altrimenti `%APPDATA%/Assistente Personale` su Windows, `~/.assistente-personale` altrove)
- `class ErroreArchivio extends Error { code: 'STATO_CORROTTO'|'BLOCCO_SCADUTO' }`
- `creaArchivio(dir): { dir, leggiStato(): Stato, scriviStato(stato): void, elencaProposte(): Proposta[], aggiungiProposta(p): void, aggiornaProposta(id, patch): Proposta, leggiConfig(): Config, scriviConfig(c): void }`
- File: `stato.json`, `stato.bak.json` (copia dell'ultimo stato valido prima di ogni scrittura), `proposte.json`, `ia-config.json`.

- [ ] **Step 1: test** (cartelle temporanee): **cartella vuota → `leggiStato()` = `statoDefault()` e `elencaProposte()` = `[]`**; scrivi→leggi ritorna lo stesso stato migrato; **`stato.json` con JSON troncato → `leggiStato()` lancia `STATO_CORROTTO` e il file non viene toccato**; la scrittura è atomica (non resta mai un file parziale con il nome definitivo: si verifica che esista `stato.bak.json` dopo la 2ª scrittura); **2 processi figli (`child_process.fork`) aggiungono 20 proposte ciascuno → in `proposte.json` ce ne sono 40**; un file di blocco più vecchio di 10 s viene rimosso, uno recente fa riprovare ogni 50 ms fino a 2 s poi `BLOCCO_SCADUTO`.
- [ ] **Step 2:** FALLISCONO. **Step 3:** scrittura = file temporaneo + `fs.renameSync`; blocco = creazione esclusiva (`wx`) di `proposte.lock`. **Step 4:** PASS. **Step 5: Commit** (con OK).

### Task 5: Permessi e client
**Files:** Create `ia/permessi.js`, `test/permessi.test.js`.

**Interfaces:** Consumes `NucleoSchema.SEZIONI`, `NucleoOperazioni.sezioneDi`. Produces:
- `Config = { abilitato: boolean, porta: number, client: { nome, tokenHash, sezioni: string[] }[] }`, predefinito `{abilitato:false, porta:3040, client:[]}`
- `creaClient(config, nome, sezioni = ['agenda','obiettivi']): { config, token }` (token = 32 byte casuali in esadecimale, mostrato una volta; nome unico, 1–40 caratteri `[a-z0-9-]`)
- `rimuoviClient(config, nome): Config`
- `autentica(config, token): Client|null` (confronto a tempo costante dell'hash SHA-256)
- `vistaStato(stato, sezioni): object` (solo le chiavi delle sezioni permesse)
- `puoProporre(client, op): boolean`

- [ ] **Step 1: test** il token non compare in `config`, solo il suo hash; `autentica` con token giusto/sbagliato/vuoto/`undefined`; `vistaStato(stato, ['agenda'])` non contiene `journal`, `profilo`, `sonnoLog`; `puoProporre` falso per `sonno.imposta` se manca la sezione `sonno`; nome duplicato o non valido → errore; sezione inesistente → errore.
- [ ] **Step 2–5:** FAIL → implementa → PASS → Commit (con OK).

### Task 6: Strumenti condivisi
**Files:** Create `ia/strumenti.js`, `test/strumenti.test.js`.

**Interfaces:** Consumes Task 3, 4, 5. Produces `STRUMENTI` (descrizioni in italiano, schema JSON) e `eseguiStrumento(nome, args, ctx: { archivio, client, oggiISO, adessoISO }): object` che lancia `ErroreStrumento(messaggio)` per input non valido. Quattro strumenti (pochi, per modelli piccoli):
- `ap_oggi {}` → routine e task del giorno (solo sezione `agenda`).
- `ap_leggi { sezione: string, da?: 'YYYY-MM-DD', a?: 'YYYY-MM-DD' }` → dati della sezione; errore se non permessa.
- `ap_proponi { motivo: string, operazioni: Operazione[] }` → `{ id, stato: 'in_attesa', anteprima }`; scrive solo in `proposte.json`.
- `ap_stato_proposta { id }` → `{ stato, motivi? }` (solo proposte create dallo stesso client).

- [ ] **Step 1: test** `ap_leggi` su sezione non permessa → errore e nessun dato; `ap_proponi` con operazione di sezione non permessa → errore; `ap_proponi` valido → una riga in `proposte.json` e **`stato.json` identico byte per byte**; `ap_stato_proposta` di un altro client → errore; **archivio vuoto → `ap_oggi` ritorna liste vuote**; `ap_leggi` con intervallo date filtra `journal`/`dietaLog`.
- [ ] **Step 2–5:** FAIL → implementa → PASS → Commit (con OK).

### Task 7: Server MCP su HTTP
**Files:** Create `ia/mcp-http.js`, `test/mcp-http.test.js`.

**Interfaces:** Consumes Task 5, 6. Produces `creaServerMcp({ archivio, host = '127.0.0.1', porta }): http.Server` (non avvia da solo l'ascolto). Percorso `POST /mcp`; metodi `initialize` (versione `2025-06-18`, nome `assistente-personale`), `notifications/initialized` (202 senza corpo), `ping`, `tools/list`, `tools/call`; risposte JSON-RPC; errori di strumento come `isError:true`.

- [ ] **Step 1: test** (porta 0, client `http`): senza `Authorization` → 401; token errato → 401; token giusto → `tools/list` con i 4 strumenti; **`Origin: http://evil.example` → 403; `Host: evil.example` → 403** (accettati solo `127.0.0.1`, `localhost` e il relativo `:porta`); corpo oltre 100 000 byte → 413; JSON non valido → errore JSON-RPC `-32700`; con `abilitato:false` nella config → 503; `tools/call ap_proponi` end-to-end crea la proposta; **nessuna risposta contiene `tokenHash` né il percorso dei file**.
- [ ] **Step 2–5:** FAIL → implementa (modello: `agents/jarvis_mcp/server.py` del progetto Jarvis, sola libreria standard) → PASS → Commit (con OK).

### Task 8: stdio e CLI
**Files:** Create `ia/mcp-stdio.js`, `ia/bin/ap-ia.js`, `test/cli.test.js`; Modify `package.json` (`"bin": {"ap-ia": "ia/bin/ap-ia.js"}`).

**Interfaces:** Consumes Task 4–6. Produces `avviaStdio({ archivio, token, input = process.stdin, output = process.stdout }): void` (JSON-RPC una riga per messaggio, stessi metodi del Task 7, autenticazione con il token da `AP_TOKEN`). Comandi CLI: `ap-ia serve` (richiede `abilitato:true`), `ap-ia stdio`, `ap-ia client add <nome> [--sezioni a,b]` (stampa il token una volta), `ap-ia client list|remove <nome>`, `ap-ia proposte` (elenco leggibile), `ap-ia leggi <sezione>` (richiede `AP_TOKEN`), `ap-ia abilita|disabilita`. Cartella dati da `ASSISTENTE_DATI`.

- [ ] **Step 1: test** (processo figlio con `ASSISTENTE_DATI` temporanea): `client add` poi `client list` non mostra il token; `stdio` con `AP_TOKEN` sbagliato esce con codice ≠ 0; con token giusto risponde a `tools/list`; `serve` con server disabilitato esce con messaggio chiaro.
- [ ] **Step 2–5:** FAIL → implementa → PASS → Commit (con OK).

### Task 9: Electron — persistenza su file e migrazione
**Files:** Modify `desktop/main.js`, `desktop/preload.js`, `www/js/storage.js:131-143`; Create `ia/migrazione.js`, `test/migrazione.test.js`; Modify `desktop/package.json` (includere `ia/` e `www/js/core/` nei file pacchettizzati, verificando la configurazione di `electron-builder` già presente).

**Interfaces:** Produces `migraDaPreferences(archivio, valoreGrezzo: string|null): 'importato'|'gia_presente'|'nessun_dato'` (se `stato.json` non esiste e c'è un valore: scrive lo stato migrato e una copia `stato.import-backup.json`). IPC (renderer→main): `stato-leggi(): string|null`, `stato-scrivi(json: string): boolean`, `proposte-elenca(): Proposta[]`, `proposte-aggiorna(id, patch): Proposta`. `preload.js` li espone in `window.electronAPI.dati`. In `main.js`: `app.setPath('userData', percorsoDati())` **prima** di `whenReady`, così app e `ap-ia` usano la stessa cartella. `storage.js`: se `window.electronAPI?.dati` esiste, `carica()`/`salva()` usano il file (la prima volta passano da `migraDaPreferences`, leggendo il valore di Preferences); altrimenti Preferences, come oggi. `stato.json` corrotto → `carica()` prova `stato.bak.json` e mostra un avviso, non parte da vuoto.

- [ ] **Step 1: test** `migraDaPreferences`: valore valido e nessun file → `importato`, il file esiste, esiste la copia; file già presente → `gia_presente` e nessuna sovrascrittura; `null` → `nessun_dato`; valore non JSON → lancia, nessun file creato.
- [ ] **Step 2–4:** FAIL → implementa `migrazione.js`, IPC, backend in `storage.js` → PASS; `node test-smoke.js` PASS (senza `electronAPI`, percorso Preferences invariato).
- [ ] **Step 5: verifica manuale (Electron):** `npx electron desktop` con `ASSISTENTE_DATI` temporanea: crea una routine, chiudi, riapri → presente; `stato.json` esiste nella cartella; blocca `stato.json` a metà (tronca il file) → l'app ripristina da `stato.bak.json` con avviso.
- [ ] **Step 6: Commit** (con OK).

### Task 10: Schermata "Proposte IA" nell'app
**Files:** Create `www/js/ui-proposte.js`; Modify `www/index.html`, `www/js/app.js` (voce in Altro), `test-smoke.js` (nuovo caso).

**Interfaces:** Consumes `NucleoProposte`, `window.electronAPI.dati.proposteElenca/proposteAggiorna`, `Dati.stato()/salva()`. `UIProposte.render(contenitore)`: elenco delle proposte `in_attesa` con client, motivo, anteprima, stato di applicabilità (`obsoleta` evidenziata e senza bottone Applica) e bottoni **Applica** / **Rifiuta**; Applica = `applicaProposta` → `Dati.salva()` → segna `applicata`; Rifiuta = segna `rifiutata`. Si aggiorna al rientro in primo piano della finestra. Un badge con il numero di proposte in attesa sulla voce "Altro". Senza `electronAPI` la voce non compare.

- [ ] **Step 1: test smoke (jsdom, `electronAPI` finto con 2 proposte, una obsoleta):** la voce compare; la proposta applicabile mostra Applica/Rifiuta; premere Applica aggiunge il task in `Dati.stato().task` e chiama `proposteAggiorna(id, {stato:'applicata'})`; la proposta obsoleta non ha Applica.
- [ ] **Step 2–4:** FAIL → implementa → `node test-smoke.js` PASS.
- [ ] **Step 5: verifica manuale:** da `ap-ia` crea una proposta (Task 8), vedila nell'app e applicala. **Step 6: Commit** (con OK).

### Task 11: Impostazioni "IA esterna" e avvio del server
**Files:** Modify `www/js/ui-impostazioni.js`, `desktop/main.js`, `desktop/preload.js`; Create `ia/avvio.js`, `test/avvio.test.js`.

**Interfaces:** Produces `avviaServer(archivio): { chiudi(): Promise<void>, porta: number }|null` (null se `abilitato:false`). IPC: `ia-config-leggi(): { abilitato, porta, client: {nome, sezioni}[] }` (senza hash), `ia-abilita(on: boolean)`, `ia-client-crea(nome, sezioni): { token }`, `ia-client-elimina(nome)`. UI in Impostazioni: interruttore "Consenti a un'IA di leggere i miei dati", elenco client con sezioni (caselle; salute/sonno/diario/dieta marcate "sensibile" e spente), "Crea collegamento" che mostra il token **una sola volta** con avviso. Electron avvia/ferma il server quando l'interruttore cambia e all'avvio se `abilitato`.

- [ ] **Step 1: test** `avviaServer` con config disabilitata → `null`; abilitata → risponde su `127.0.0.1` e `chiudi()` libera la porta; porta occupata → errore chiaro senza crash.
- [ ] **Step 2–4:** FAIL → implementa → PASS; smoke test: con `electronAPI` finto l'interruttore e la creazione client chiamano i canali giusti e il token non resta nel DOM dopo la chiusura del dialogo.
- [ ] **Step 5: verifica manuale:** attiva dall'app, `curl` con il token su `http://127.0.0.1:3040/mcp` elenca gli strumenti; senza token 401. **Step 6: Commit** (con OK).

### Task 12: Prova end-to-end e documentazione
**Files:** Create `test/e2e.test.js`, `docs/ia-esterna.md`, `docs/hermes-mcp-block.example.yaml`; Modify `README.md` (sezione "Usare l'app con un'IA").

- [ ] **Step 1: test e2e** (server reale su porta 0, cartella temporanea, client MCP minimale scritto nel test): un client con sezione `agenda` legge `ap_oggi`, propone un `task.aggiungi`, `stato.json` invariato; il test applica la proposta con `NucleoProposte.applicaProposta` e riscrive lo stato; il task compare in `ap_oggi`; un secondo client con solo `obiettivi` non vede i task.
- [ ] **Step 2:** PASS con `node --test test/`. **Step 3:** documenta in `docs/ia-esterna.md`: attivazione, creazione token, permessi, esempi per un client HTTP e uno stdio, privacy (dati sensibili; per IA cloud attivare solo le sezioni volute); l'esempio YAML mostra `mcp_servers: assistente: url: "http://127.0.0.1:3040/mcp"` con `headers: Authorization` e `tools.include` sui 4 strumenti, **senza token reali**.
- [ ] **Step 4: verifica finale:** `node --test test/` e `node test-smoke.js` PASS; prova manuale completa con un vero client MCP o con Hermes (vedi sotto). **Step 5: Commit** (con OK).

---

## Fuori da questo piano (richiede l'OK dell'utente)
- Collegare Hermes: aggiungere il blocco `assistente` a `%LOCALAPPDATA%\hermes\config.yaml` (stesso schema di `hermes-data/osiris-mcp-block.yaml` nel progetto Jarvis, con il token in un posto non versionato) e provare con il modello 8B che `ap_proponi` produca operazioni valide. Poi aggiornare ADR-0009 e la scheda del progetto nel vault.
- Android e web: server e sincronizzazione (fase successiva).
- Cambiare il flusso dell'IA integrata (Ollama).

## Self-review
- **Copertura della spec:** nucleo + adattatori (1–5, 7–8), sola proposta (3, 6), app chiusa (4, 7–8), file in `userData` e migrazione (9), proposte obsolete (3), permessi per client e sezione (5, 11), proposte multi-operazione atomiche (3), IA integrata non toccata, perimetro fase 1 = 9 operazioni (2), HTTP prima di stdio (7, 8), server spento di default e solo locale (7, 11), Android rimandato.
- **Coerenza dei tipi:** `Operazione`, `Proposta`, `Config`, `Client`, `creaArchivio` e `eseguiStrumento` hanno la stessa forma in tutti i task; `sezioneDi` del Task 2 è usata dal Task 5.
- **Proporzione:** il piano contiene firme, test e valori fissati dalla spec; i corpi delle funzioni sono lasciati a chi costruisce.
