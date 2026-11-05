/**
 * core/schema.js
 * Schema dello stato e migrazione. Modulo UMD: Node (module.exports) e browser (NucleoSchema).
 */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.NucleoSchema = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  function statoDefault() {
    return {
      versione: 1,
      routine: [],   // { id, nome, descrizione:"", tipo:'altro'|<idTipo>, oraInizio:"HH:MM", durataMinuti, priorita:1-10, giorni:[1..7], attiva }
      task: [],      // { id, nome, priorita:1-10, tipo:'altro'|<idTipo>, ambito:'giorno'|'settimana'|'mese'|'anno', scadenza:"YYYY-MM-DD",
                     //   oraPromemoria:"HH:MM"|null, durataStimataMinuti:number|null, note:"", completata:bool }
      tipiAttivita: [ // condiviso tra Routine e Task: i 4 "protetti" non si possono eliminare, quelli creati dall'utente sì
        { id: 'allenamento', nome: 'Allenamento', protetto: true },
        { id: 'pasto', nome: 'Pasto', protetto: true },
        { id: 'sonno', nome: 'Sonno', protetto: true },
        { id: 'diario', nome: 'Diario', protetto: true }
      ],
      paroleChiaveTipi: [ // usate dall'importazione da testo: se il nome contiene la parola, assegna quel tipo
        { parola: 'pranzo', tipoId: 'pasto' },
        { parola: 'cena', tipoId: 'pasto' },
        { parola: 'cenare', tipoId: 'pasto' },
        { parola: 'colazione', tipoId: 'pasto' },
        { parola: 'spuntino', tipoId: 'pasto' },
        { parola: 'palestra', tipoId: 'allenamento' },
        { parola: 'allenamento', tipoId: 'allenamento' },
        { parola: 'sveglia', tipoId: 'sonno' },
        { parola: 'dormire', tipoId: 'sonno' }
      ],
      obiettivi: [], // { id, titolo, tipo:'concreto'|'generale'|'valoriale', ambito:'1mese'|'6mesi'|'1anno'|'5anni'|'10anni',
                     //   scadenza:"YYYY-MM-DD", descrizione:"", completato:bool, attivitaCollegate:["routine:ID"|"task:ID",...], tappe:[...] }
      journal: {},   // "YYYY-MM-DD" -> { fattoBene, daMigliorare, obiettivoDomani, voto:"7+", votoNumerico:7.25 }
      log: {},       // "YYYY-MM-DD" -> { tipo:'abituale'|'viaggio', completamenti:{ "routine:ID":bool, "task:ID":bool } }
      profilo: {     // dati fisici, alla base del calcolo calorico/macro della dieta
        eta: null, sesso: 'M', altezzaCm: null, pesoKg: null,
        livelloAttivita: 'moderato', obiettivo: 'mantenimento', numeroPasti: 5,
        allergie: [], patologie: '', cibiNonGraditi: '',
        percentualeGrassa: null, // % massa grassa, facoltativo
        circonferenze: { vita: null, fianchi: null, torace: null, braccio: null }, // cm, facoltativo
        storicoPeso: [] // [{data:"YYYY-MM-DD", peso:number}]
      },
      dietaPiano: { generatoIl: null, giorni: {} }, // giorni: {1:[pasti],...,7:[pasti]} (1=Lunedi...7=Domenica)
      dietaLog: {},  // "YYYY-MM-DD" -> { pasti: [{nome,kcal,proteine,carboidrati,grassi,fonte}] }
      profiloWorkout: { livello: 'intermedio', giorniDisponibili: 3 },
      schedaAdattiva: { generataIl: null, giorni: [] }, // vedi workout-plan.js
      schedaPersonalizzata: { giorni: [] }, // [{id, etichetta, esercizi:[{nome,serie,ripetizioni,recupero}]}] — tutta scritta dall'utente
      workoutLog: {}, // "YYYY-MM-DD" -> [{schedaTipo, etichetta, completato:true, ora}] — più voci per giorno
      sonnoLog: {},   // "YYYY-MM-DD" -> { oraInizio, oraFine, oreDormite, qualita:1-5|null }
      orarioFisso: [],  // { id, materia, tipo:'universita'|'scuola'|'lavoro'|'altro', giorno:1-7, oraInizio, oraFine, aula, note }
      periodiAnno: [],  // { id, titolo, tipo:'esami'|'studio'|'lavoro'|'altro', dataInizio, dataFine, note }
      impostazioniIA: {
        abilitata: false,
        indirizzoServer: 'http://localhost:11434', // su PC di norma localhost; dal telefono, l'IP del PC in rete locale
        modello: 'qwen3:8b' // cambiabile liberamente dalle impostazioni
      },
      impostazioni: {
        oraPromemoriaDefaultTask: '09:00',
        tema: 'chiaro', // 'chiaro' | 'scuro'
        onboardingCompletato: false
      }
    };
  }

  function migra(grezzo) {
    if (!grezzo) return statoDefault();
    const s = grezzo;
    const def = statoDefault();
      if (s.versione === undefined) s.versione = def.versione;
      if (!s.routine) s.routine = [];
      if (!s.task) s.task = [];
      if (!s.log) s.log = {};
      if (!s.impostazioni) s.impostazioni = def.impostazioni;
      if (!s.impostazioni.tema) s.impostazioni.tema = 'chiaro';
      if (s.impostazioni.onboardingCompletato === undefined) {
        s.impostazioni.onboardingCompletato = true;
      }
      if (!s.obiettivi) s.obiettivi = [];
      if (!s.journal) s.journal = {};
      if (!s.profilo) s.profilo = def.profilo;
      else {
        if (s.profilo.numeroPasti == null) s.profilo.numeroPasti = 5;
        if (s.profilo.percentualeGrassa === undefined) s.profilo.percentualeGrassa = null;
        if (!s.profilo.circonferenze) s.profilo.circonferenze = { vita: null, fianchi: null, torace: null, braccio: null };
      }
      if (!s.dietaPiano) s.dietaPiano = def.dietaPiano;
      if (!s.dietaLog) s.dietaLog = {};
      if (!s.profiloWorkout) s.profiloWorkout = def.profiloWorkout;
      if (!s.schedaAdattiva) s.schedaAdattiva = def.schedaAdattiva;
      if (!s.schedaPersonalizzata) s.schedaPersonalizzata = def.schedaPersonalizzata;
      if (!s.workoutLog) s.workoutLog = {};
      else {
        Object.keys(s.workoutLog).forEach(data => {
          if (!Array.isArray(s.workoutLog[data])) s.workoutLog[data] = [s.workoutLog[data]];
        });
      }
      if (!s.sonnoLog) s.sonnoLog = {};
      if (!s.orarioFisso) s.orarioFisso = [];
      if (!s.periodiAnno) s.periodiAnno = [];
      if (!s.tipiAttivita) s.tipiAttivita = def.tipiAttivita;
      if (!s.paroleChiaveTipi) s.paroleChiaveTipi = def.paroleChiaveTipi;
      {
        // assicura che i 4 protetti esistano sempre, anche su stati salvati prima di questa versione
        def.tipiAttivita.forEach(preset => {
          if (!s.tipiAttivita.find(t => t.id === preset.id)) s.tipiAttivita.unshift(preset);
        });
      }
      if (!s.impostazioniIA) s.impostazioniIA = def.impostazioniIA;
    return s;
  }

  const SEZIONI = {
    agenda: ['routine', 'task', 'tipiAttivita', 'paroleChiaveTipi', 'orarioFisso', 'periodiAnno', 'log'],
    obiettivi: ['obiettivi'],
    diario: ['journal'],
    dieta: ['profilo', 'dietaPiano', 'dietaLog'],
    workout: ['profiloWorkout', 'schedaAdattiva', 'schedaPersonalizzata', 'workoutLog'],
    sonno: ['sonnoLog']
  };
  const SEZIONI_SENSIBILI = ['dieta', 'workout', 'sonno', 'diario'];

  return { statoDefault, migra, SEZIONI, SEZIONI_SENSIBILI };
});
