# Tarvio

App di produttività personale completa: routine e task, dieta, workout,
obiettivi, diario, panoramica mese/anno/storico, e un assistente IA
opzionale collegato a Ollama. Gira su Android (vera app installabile) e su
PC (Electron, finestra vera senza browser), sempre **offline**: nessun dato
lascia il dispositivo a meno che tu non attivi l'IA.

## Moduli inclusi
- **Oggi**: barra orizzontale delle 24 ore (non più un "orologio" circolare)
  + timeline della giornata (routine, orario fisso, task in scadenza), con
  notifiche puntuali e un popup contestuale quando tocchi una voce.
- **Fare**: Routine (con tipo — Allenamento/Pasto/Sonno/Diario fissi, o
  creane altri tu — e descrizione visibile toccando la voce; si possono
  anche **importare da testo libero**: scrivi un giorno per riga e le attività
  come righe puntate con "-", tipo `- 6:00 alle 7:00: Prepararsi` oppure
  `- Alle 11:00 Nome`; le attività con stesso nome e orario su più giorni si
  uniscono da sole, e delle **parole chiave** assegnano il tipo in automatico,
  es. "pranzo" → Pasto, "palestra" → Allenamento, modificabili dall'utente),
  Task (ambito
  giorno/settimana con intervallo di date/mese/anno, mai nel passato,
  organizzabili in "cartelle" tramite lo stesso sistema di tipi, con
  notifiche automatiche ad ogni cambio di ambito), Orario fisso
  (lezioni/lavoro, importabile da JSON).
- **Salute**: Dieta (profilo fisico, calorie/macro, piano settimanale a
  scelta tra 3-6 pasti, log di cosa mangi con voto automatico di quanto
  hai mangiato bene, peso e misure opzionali, validazione contro pasti a
  zero), Workout (scheda veloce, scheda con sbarra, scheda adattiva sui tuoi
  giorni, o una scheda tutta personalizzata con giorni duplicabili — tutte
  calibrate sul tuo obiettivo, richiede prima il profilo Dieta compilato;
  puoi registrare più allenamenti nello stesso giorno), e Sonno (ore
  dormite calcolate da sola, qualità opzionale, media settimanale).
- **Crescita**: Obiettivi (1 mese → 10 anni, 3 tipi, tappe/timeline interne,
  collegabili a routine e task) e Diario (statistiche automatiche incluso
  allenamento/sonno/voto dieta della giornata, voto in stile pagella, non
  modificabile per il futuro).
- **Altro**: Panoramica (vista mese, vista anno con periodi tipo sessioni
  d'esame, storico/recap con confronto sul periodo precedente), Assistente
  IA (vedi sotto), Impostazioni (tema chiaro/scuro — bug di contrasto
  risolto —, backup, tipi di attività, permessi notifiche).

Alla primissima apertura, un breve giro di 6 schermate spiega cosa fa ogni
sezione, prima di chiedere i permessi.

## Notifiche
Ogni voce della giornata (routine, orario fisso) ha la sua notifica, con
azioni rapide "Fatto/Non ora" per i tipi semplici. Le routine di tipo Pasto
e Allenamento invece, quando tocchi la notifica, aprono un piccolo modulo
per registrare subito cosa hai mangiato o quale scheda hai fatto; il tipo
Diario apre direttamente il diario. Le task non hanno una notifica
giornaliera: ricevono un avviso automatico ogni volta che "scendono" di
ambito (es. da mese a settimana, da settimana a giorno), calcolato in
anticipo, più un eventuale promemoria extra a scelta tua.

**Importante sui permessi**: la prima apertura chiede sia il permesso di
notifica sia quello di "allarmi esatti" — servono entrambi, altrimenti
Android fa arrivare solo la prima notifica e blocca le successive (era
esattamente il problema riscontrato nel test precedente).

## Assistente IA (opzionale)
Non gira mai un modello sul telefono: Ollama non è pensato per Android
senza installazioni aggiuntive (Termux), quindi l'app si collega sempre a
un server Ollama esterno — di norma quello del tuo PC, raggiunto dal
telefono via IP di rete locale quando siete sulla stessa WiFi.

**Sul PC**:
1. Installa Ollama da https://ollama.com
2. In un terminale: `ollama pull qwen3:8b` (il modello di default scelto
   qui — un buon compromesso tra qualità e requisiti hardware; se hai una
   scheda video potente puoi provare un modello più grande, es.
   `qwen3:30b`, altrimenti uno più leggero come `llama3.2:3b`)
3. In Tarvio → Altro → Assistente IA: abilita, lascia
   "http://localhost:11434" come indirizzo, scrivi il nome del modello
   scelto, "Verifica connessione".

**Dal telefono** (stessa WiFi del PC): nell'indirizzo server, invece di
"localhost" metti l'IP del PC nella rete locale (su Windows: `ipconfig`,
cerca "Indirizzo IPv4"; su Mac/Linux: `ifconfig` o Impostazioni di Rete),
es. `http://192.168.1.50:11434`. Su Ollama potrebbe servire impostare la
variabile d'ambiente `OLLAMA_HOST=0.0.0.0` prima di avviarlo, per accettare
connessioni da altri dispositivi della rete (di default risponde solo a
"localhost").

Nella chat puoi chiedere di **creare o modificare** routine, task, obiettivi, diario,
pasti e sonno (es. «aggiungi la routine Fumetto il venerdì dalle 14 alle 15»).
L'IA prepara una proposta con anteprima — **non applica mai nulla da sola**:
tocchi tu «Applica» o «Ignora». Funziona anche da telefono (nessun programma
aggiuntivo sul PC). Dettagli e consigli sul modello in
[docs/ia-esterna.md](docs/ia-esterna.md). Se preferisci un'IA interamente sul telefono, l'unica strada è
installare tu Termux + Ollama con un modello minuscolo e puntare l'app a
"http://localhost:11434" anche da telefono — funziona con lo stesso
meccanismo, ma è una configurazione manuale che esula dall'app.

## Usare l'app con un'IA
Un'IA esterna (Claude, Hermes, qualunque client MCP) può leggere i dati che
scegli tu e *proporre* modifiche, che applichi solo tu da Altro → Proposte IA.
Si fa tutto dall'app desktop: **Altro → Impostazioni → Accesso IA esterna**
(interruttore, collegamenti, token da copiare); il terminale non serve più.
L'accesso è spento di default e il server ascolta solo su 127.0.0.1.
Istruzioni e avvertenze sulla privacy: [docs/ia-esterna.md](docs/ia-esterna.md).

## Nota sulla UI
Secondo giro di design, per allontanarsi dall'aspetto "generico da IA"
segnalato: palette nuova (blu inchiostro su carta fredda, non più
crema/terracotta), niente serif decorativo, tutte le emoji sostituite con
un set di icone lineari coerenti (`www/js/icons.js`), il quadrante 24h
ridisegnato come barra orizzontale invece di un cerchio stile orologio, e
le "pillole" di priorità diventate tab di colore a bordo riga invece di
cerchi con un numero dentro. Risolto anche il bug per cui in tema scuro
alcuni bottoni risultavano bianco su bianco. Navigazione a 5 tab principali
con sotto-sezioni a pillole. Non è stato possibile generare un'anteprima
visiva da questo ambiente (gli strumenti di rendering disponibili qui non
eseguono JavaScript moderno): la resa reale si vede solo con la build.

## Prima di iniziare
Serve **Node.js** (versione 22 o superiore — richiesta da Capacitor 8) installato sul PC:
https://nodejs.org

---

## 1. Installazione dei pacchetti (una volta sola)

Apri un terminale nella cartella del progetto:

```
npm install
```

Questo comando scarica Capacitor e, in automatico, copia anche i file
necessari al funzionamento offline (vedi `scripts/copy-vendor.js`, si attiva da
solo — non serve lanciarlo a mano).

---

## 2. App Android (.apk)

### Opzione A — hai un PC (più semplice, consigliata)

Serve **Android Studio** (gratuito): https://developer.android.com/studio
(la prima volta, all'apertura, ti farà scaricare l'SDK Android: segui la
procedura guidata, richiede una decina di minuti).

1. Ogni volta che modifichi qualcosa dentro `www/`, esegui:
   ```
   npm run sync:android
   ```
   (copia le modifiche dentro il progetto Android). La primissima volta è già
   stato fatto, quindi puoi saltare questo passo e andare al punto 2.

2. Apri la cartella `android/` con Android Studio
   (oppure lancia `npm run open:android`).

3. Aspetta che Android Studio finisca di scaricare le dipendenze la prima volta
   (barra in basso). Poi collega il telefono via USB (con il **debug USB**
   attivo nelle opzioni sviluppatore) oppure usa un emulatore, e premi ▶ Run.

   In alternativa, per generare il file .apk da installare manualmente:
   **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. Il file compare in
   `android/app/build/outputs/apk/debug/app-debug.apk`: copialo sul telefono e
   installalo (Android chiederà di autorizzare "sorgenti sconosciute" la prima
   volta).

### Opzione B — solo da telefono, nessun PC (build in cloud gratuita)

Il file `.github/workflows/build-apk.yml`, già incluso, fa compilare l'APK ai
server gratuiti di GitHub. Tutto da browser sul telefono:

1. Crea un account su https://github.com (gratuito) se non ne hai già uno.
2. Crea un nuovo repository (in alto a destra → "New repository"), anche
   privato. Non serve spuntare nulla, basta dargli un nome.
3. Estrai lo zip di questo progetto con un file manager del telefono
   (es. "File" / "Files by Google", tasto destro/menu → Estrai).
4. Nella pagina del repository su github.com, tocca **"Add file" → "Upload
   files"** e seleziona/trascina tutti i file e le cartelle estratte (alcuni
   browser mobile permettono di scegliere un'intera cartella dalla galleria
   file; se il tuo non lo fa, carica prima le cartelle principali una alla
   volta: `www`, `android`, `.github`, poi i file singoli nella radice).
5. Conferma il commit ("Commit changes").
6. Vai nella scheda **"Actions"** del repository: la build parte da sola
   (oppure, se non parte, tocca il workflow "Build APK" → "Run workflow").
   Impiega 3-5 minuti.
7. A build finita, vai nella scheda **"Releases"** (o nella pagina principale
   del repository, colonna destra) e scarica il file `app-debug.apk` allegato:
   è l'APK vero e proprio, pronto da installare (Android chiederà di
   autorizzare "sorgenti sconosciute" la prima volta).

Se qualche passaggio si incastra (upload di cartelle da mobile può essere
scomodo secondo il browser), dimmelo e troviamo un'alternativa insieme.

### Dopo l'installazione (entrambe le opzioni)

Alla prima apertura dell'app sul telefono ti verranno chiesti subito
entrambi i permessi (notifica + allarmi esatti): concedili entrambi, altrimenti
i promemoria arriveranno solo saltuariamente.

---

## 3. App PC (Electron)

```
cd desktop
npm install
npm start
```

Si apre una vera finestra dell'app (niente barra degli indirizzi, niente
Chrome). Per creare un file di installazione standalone (.exe su Windows,
.AppImage su Linux, .dmg su Mac) si può provare `npm run dist`: non l'ho
potuto testare in questo ambiente, quindi se qualcosa nella build non va,
dimmelo e sistemiamo insieme.

---

## 4. Sincronizzare telefono e PC

In **Impostazioni**:
- **"Esporta dati"**: salva un file `assistente-backup-AAAA-MM-GG.json`
  (su Android si apre il menu di condivisione — es. Google Drive, email;
  su PC compare una finestra di salvataggio normale).
- **"Importa e unisci"**: aggiunge i dati del file importato a quelli già
  presenti, senza cancellare nulla.
- **"Importa e sostituisci tutto"**: cancella i dati attuali e li rimpiazza
  con quelli del file (chiede conferma prima di procedere).

---

## 5. Cosa provare e segnalarmi

Dato che non ho un telefono/PC su cui testare, sono cose che si vedono solo
sull'uso reale:
- se le notifiche arrivano puntuali anche a schermo spento/app chiusa, ora
  che chiediamo subito entrambi i permessi;
- se la connessione al PC funziona bene dal telefono per l'IA (dipende
  dalla configurazione di rete di casa tua, `OLLAMA_HOST` incluso);
- l'aspetto grafico su schermi di dimensioni diverse, e il tema scuro.

## Struttura del progetto
```
tarvio/
  www/                  interfaccia + logica (usata sia da Android che da PC)
  android/              progetto nativo Android (generato da Capacitor)
  desktop/              wrapper Electron per PC (+ ponte IPC per l'IA)
  scripts/copy-vendor.js
  test-smoke.js         test automatico interno (facoltativo, vedi sotto)
```

### (Facoltativo) Ri-eseguire il test automatico
Ho validato tutta la logica (cascata task/obiettivi, notifiche, dieta,
workout, IA, tema, ecc.) con un test automatico in un browser simulato. Se
in futuro modifichi il codice e vuoi verificare che non si sia rotto nulla:
```
npm install --no-save jsdom
node test-smoke.js
```
