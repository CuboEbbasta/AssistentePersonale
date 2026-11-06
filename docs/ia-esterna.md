# Usare l'app con un'IA esterna

Un'IA esterna (Claude, Hermes o qualunque client MCP) può **leggere** i tuoi dati
e **proporre** modifiche. Non scrive mai da sola: ogni proposta resta in attesa
finché non la approvi tu.

## Attivazione

Dalla cartella del progetto:

```
node ia/bin/ap-ia.js client add <nome>      # crea il client e stampa il token (una sola volta: conservalo)
node ia/bin/ap-ia.js abilita                # accende l'accesso IA (di default è spento)
node ia/bin/ap-ia.js serve                  # avvia il server MCP
```

- Il server ascolta solo su `127.0.0.1`, porta predefinita **3040**; indirizzo: `http://127.0.0.1:3040/mcp`.
- Ogni richiesta richiede `Authorization: Bearer <TOKEN>`. Token errato o assente: 401.
- Altri comandi: `client list`, `client remove <nome>`, `disabilita`, `proposte`.
- Un esempio di configurazione per Hermes è in `docs/hermes-mcp-block.example.yaml` (il token va tenuto fuori dal repository).

## Permessi per sezione

Ogni client ha un elenco di sezioni: `agenda`, `obiettivi`, `diario`, `dieta`, `workout`, `sonno`.
Di default un nuovo client ha solo `agenda` e `obiettivi`. Le sezioni sensibili
(`diario`, `dieta`, `workout`, `sonno`) sono spente finché non le aggiungi esplicitamente:

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
rimuovi i client che non usi (`client remove <nome>`). Con un'IA locale i dati restano sul PC.

## Dove stanno i file

Cartella dati (o quella indicata da `ASSISTENTE_DATI`): su Windows
`%APPDATA%\Assistente Personale`, altrove `~/.assistente-personale`. Contiene
`stato.json` (+ `stato.bak.json`), `proposte.json` e `ia-config.json` (client con
solo l'hash del token, mai il token).

Nella versione impacchettata dell'app la cartella dati può coincidere con quella
dell'app stessa (la cartella `userData` di Electron): in quel caso, per usare la CLI
o il server MCP, imposta `ASSISTENTE_DATI` sulla cartella che l'app usa davvero.

## Scegliere il modello dell'assistente integrato

L'assistente IA dentro l'app (sezione **IA**) non usa solo Ollama: dal menu **Tipo di server** puoi scegliere
- **Ollama**: indirizzo di solito `http://localhost:11434`; i modelli vengono da `/api/tags`.
- **Compatibile OpenAI** (LiteLLM, LM Studio, llama.cpp server, vLLM, OpenRouter…): indirizzo ad esempio `http://localhost:4000` (anche con `/v1` finale, non viene duplicato); i modelli vengono da `/v1/models` e le risposte da `/v1/chat/completions`. La **Chiave API** è facoltativa: se la inserisci viene inviata come `Authorization: Bearer …` solo a quel server.

Premi **Verifica connessione** per riempire il menu **Modello** con quelli offerti dal server, poi scegli e premi **Salva**. Se l'elenco non è disponibile, scegli «Altro…» nel menu e scrivi il nome a mano.

La chiave API resta salvata sul dispositivo, in chiaro, nello stesso file dei tuoi dati (e nei backup/export): non usare chiavi con permessi più ampi del necessario.
Le richieste partono dal processo principale dell'app (su PC) con controlli sugli argomenti e timeout di 10 s per l'elenco e 120 s per la generazione; gli errori mostrati non contengono mai la chiave.
