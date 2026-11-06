# Usare l'app con un'IA esterna

Un'IA esterna (Claude, Hermes o qualunque client MCP) può **leggere** i tuoi dati
e **proporre** modifiche. Non scrive mai da sola: ogni proposta resta in attesa
finché non la approvi tu.

## Attivazione (dall'app)

Nell'app desktop vai in **Altro → Impostazioni → Accesso IA esterna**:

1. Accendi **Consenti a un'IA di usare Tarvio**. Il server parte subito (e riparte da solo a ogni avvio dell'app finché l'interruttore resta acceso).
2. In **Nuovo collegamento** scrivi un nome (minuscole, numeri, trattini), scegli le sezioni che l'IA può leggere e premi **Crea collegamento**.
3. Si apre un foglio con il **token**, mostrato **una sola volta**, e due blocchi già pronti: il comando per **Claude Code** (`claude mcp add --transport http ...`) e la configurazione per **Hermes** e altri client MCP. Premi **Copia** e incollali nell'IA. Chiuso il foglio il token non si rivede più: se lo perdi, rimuovi il collegamento e creane uno nuovo.
4. Per revocare l'accesso a un'IA, premi **Rimuovi** accanto al suo collegamento: smette di funzionare subito, senza riavviare nulla.

- Il server ascolta solo su `127.0.0.1`, porta predefinita **3040**; indirizzo: `http://127.0.0.1:3040/mcp`. Se la porta è occupata da un altro programma l'interruttore te lo dice.
- Ogni richiesta richiede `Authorization: Bearer <TOKEN>`. Token errato o assente: 401.
- Un esempio di configurazione per Hermes è in `docs/hermes-mcp-block.example.yaml` (il token va tenuto fuori dal repository).

### Dal terminale (facoltativo)

La CLI resta disponibile nel repository (non è inclusa nell'app installata) e usa gli stessi dati:

```
node ia/bin/ap-ia.js client add <nome>      # crea il client e stampa il token (una sola volta: conservalo)
node ia/bin/ap-ia.js abilita                # accende l'accesso IA (di default è spento)
node ia/bin/ap-ia.js serve                  # avvia il server MCP (non serve se l'app è aperta: lo avvia lei)
```

Altri comandi: `client list`, `client remove <nome>`, `disabilita`, `proposte`.

## Permessi per sezione

Ogni client ha un elenco di sezioni: `agenda`, `obiettivi`, `diario`, `dieta`, `workout`, `sonno`.
Nell'app, un nuovo collegamento ha preselezionate solo `agenda` e `obiettivi`. Le sezioni sensibili
(`diario`, `dieta`, `workout`, `sonno`) sono spente finché non spunti la casella (marcata «sensibile»). Da terminale:

```
node ia/bin/ap-ia.js client add claude --sezioni agenda,obiettivi,workout
```

Fuori dalle sue sezioni il client non può né leggere né proporre modifiche.

## Gli strumenti

| Strumento | Cosa fa |
|---|---|
| `ap_oggi` | routine di oggi e task di oggi o in ritardo (serve `agenda`) |
| `ap_leggi` | legge una sezione, con filtro opzionale per date `da`/`a` |
| `ap_proponi` | propone una o più operazioni (es. `task.aggiungi`), applicate tutte insieme o per nulla |
| `ap_stato_proposta` | dice se una proposta è in attesa, applicata o rifiutata; se è in attesa e non si può più applicare restituisce `applicabile: false` con i motivi |

## Approvare le proposte

L'IA può solo **proporre**. Apri l'app, **Altro → Proposte IA**, controlla l'anteprima e
tocca **Applica** (o **Rifiuta**). Le proposte si approvano **solo nell'app desktop**. Se nel frattempo il dato è cambiato, la proposta non è più applicabile: l'IA la vede come `applicabile: false` insieme ai motivi, e nell'app compare senza il bottone Applica.

L'IA vede i dati **del PC** (la cartella dati sotto), non quelli del telefono: le due copie non sono sincronizzate.

## Privacy

Dieta, workout, sonno e diario sono dati di salute. Con un'IA **cloud** quei dati
escono dal tuo computer: attiva solo le sezioni che vuoi davvero condividere, e
rimuovi i collegamenti che non usi (**Rimuovi** nelle Impostazioni). Con un'IA locale i dati restano sul PC.

## Dove stanno i file

Cartella dati (o quella indicata da `ASSISTENTE_DATI`): su Windows
`%APPDATA%\Tarvio`, altrove `~/.tarvio`. Contiene
`stato.json` (+ `stato.bak.json`), `proposte.json` e `ia-config.json` (client con
solo l'hash del token, mai il token).

Nella versione impacchettata dell'app la cartella dati può coincidere con quella
dell'app stessa (la cartella `userData` di Electron): in quel caso, per usare la CLI
o il server MCP, imposta `ASSISTENTE_DATI` sulla cartella che l'app usa davvero.

## L'assistente integrato: cosa può fare

La chat in **Altro → Assistente IA** può **creare e modificare** tutto ciò che permettono le operazioni dell'app (le stesse delle proposte MCP):
routine, task, obiettivi (aggiungi e modifica), diario del giorno, pasti e sonno. Non cambia mai nulla da sola: dopo ogni richiesta mostra una
**proposta** con l'anteprima in italiano e due bottoni, **Applica** e **Ignora**. Se nel frattempo i dati sono cambiati, la proposta risulta
«non più applicabile» e il motivo è mostrato. Funziona anche su Android/web: parla direttamente col server IA, senza coda MCP.

Esempi di richieste:
- «potresti aggiungere questo? - 14:00 alle 15:00: Fumetto per Venerdi» → routine Fumetto, ogni venerdì, 14:00, 60 minuti
- «aggiungi la task comprare il latte, scade domani» → task con scadenza domani
- «crea una routine sveglia alle 7 dal lunedì al venerdì»
- «voglio un obiettivo: correre una maratona entro un anno»
- «scrivi il diario di oggi: fatto bene …, da migliorare …, domani …, voto 7+»
- «ho mangiato un panino: 450 kcal, 20 g proteine, 50 g carboidrati, 15 g grassi»
- «stanotte ho dormito dalle 23:30 alle 7:00, qualità 4»
- «sposta la palestra alle 19» (modifica: l'assistente vede id e nome degli elementi esistenti)
- Le domande («come dormo meglio?») ricevono solo una risposta, senza proposte.

Come funziona (utile per capire gli errori): l'app manda al modello la data di oggi, l'elenco delle operazioni con i nomi esatti dei campi, alcuni
esempi, i tuoi routine/task/obiettivi (id e nome) e gli ultimi 6 messaggi; chiede una risposta in JSON (modalità JSON di Ollama o di OpenAI e, su
Ollama, `think: false` per evitare il ragionamento lungo). La risposta viene normalizzata (giorni in italiano, «14» → 14:00, «domani», priorità
«alta», ora di fine → durata…) e validata con le regole dell'app. Se non è valida, l'app fa **una sola** nuova richiesta al modello con l'errore;
se fallisce ancora, ti dice in italiano cosa manca.

**Consiglio sul modello:** con `qwen3:8b` (Ollama) la valutazione automatica (`node scripts/valuta-assistente.js`, 12 richieste in italiano su
Ollama locale) dà 11/12 in circa un secondo a richiesta con GPU libera; `qwen3:14b` è più lento (decine di secondi se la GPU è impegnata) e non
migliora molto. Modelli sotto gli 8B o senza buon italiano sbagliano più spesso i campi: l'anteprima ti permette comunque di ignorare. Le richieste
molto vaghe o ambigue possono dare una proposta diversa da quella che volevi: leggi sempre l'anteprima prima di premere Applica.

## Scegliere il modello dell'assistente integrato

L'assistente IA dentro l'app (sezione **IA**) non usa solo Ollama: dal menu **Tipo di server** puoi scegliere
- **Ollama**: indirizzo di solito `http://localhost:11434`; i modelli vengono da `/api/tags`.
- **Compatibile OpenAI** (LiteLLM, LM Studio, llama.cpp server, vLLM, OpenRouter…): indirizzo ad esempio `http://localhost:4000` (anche con `/v1` finale, non viene duplicato); i modelli vengono da `/v1/models` e le risposte da `/v1/chat/completions`. La **Chiave API** è facoltativa: se la inserisci viene inviata come `Authorization: Bearer …` solo a quel server.

Premi **Verifica connessione** per riempire il menu **Modello** con quelli offerti dal server, poi scegli e premi **Salva**. Se l'elenco non è disponibile, scegli «Altro…» nel menu e scrivi il nome a mano.

La chiave API resta salvata sul dispositivo, in chiaro, nello stesso file dei tuoi dati (e nei backup/export): non usare chiavi con permessi più ampi del necessario.
Le richieste partono dal processo principale dell'app (su PC) con controlli sugli argomenti e timeout di 10 s per l'elenco e 120 s per la generazione; gli errori mostrati non contengono mai la chiave.
