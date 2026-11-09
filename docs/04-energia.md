# 04 · Energia

Tre livelli, ognuno utile da solo. Fai il primo, usalo qualche settimana, poi passa al successivo.

| Livello | Cosa fa | Difficoltà |
| --- | --- | --- |
| 1 | Allarme prima che il contatore stacchi | ★★ |
| 2 | Consumi e costi per fascia oraria | ★★★ |
| 3 | Riconoscere quale elettrodomestico è acceso (NILM) | ★★★★★ |

## Cosa fa

```
July:  ⚡ Stai usando 3,4 kW da 40 secondi. Rischi il distacco.
       Accesi probabilmente: forno (2,1 kW), lavatrice (in riscaldamento).

Tu:    /consumi ieri
July:  📊 Ieri 7,4 kWh · circa 2,05 €
       F1 2,1 kWh · F2 2,0 kWh · F3 3,3 kWh
       Più pesanti: lavatrice 1,1 kWh (F1 😬), forno 0,9 kWh, frigo 0,8 kWh

July:  🔎 Ho visto un consumo nuovo: +1.950 W alle 14:03, durato 4 minuti. Cos'era?
       [Bollitore] [Phon] [Forno] [Altro…]
```

## Cosa impari

Interrogare un dispositivo in locale e validarne le risposte, campionamento e aggregazione, calcolo dell'energia, calendari con festività (compreso il calcolo della Pasqua), rilevamento di gradini in un segnale rumoroso, abbinamento di eventi, un classificatore k-NN addestrato dalle tue risposte su Telegram.

## Prerequisiti

- Guida 00 parte A (`db`, `notify`, `scheduler`).
- **Un misuratore Shelly con pinza amperometrica** sulla linea generale. Va installato nel quadro elettrico.

> ⚠️ **Il quadro elettrico lo apre un elettricista**, non tu. È pericoloso e la legge (DM 37/08) richiede un installatore abilitato per lavori sull'impianto. Chiedigli di montare la pinza sulla fase della linea principale, dopo il contatore.

**Scegliere il modello.** Le API cambiano tra i modelli: alcuni espongono il componente `EM1` (una o due linee monofase), altri `EM` (trifase), le prese e i relè `Switch`. Prima di comprare, apri la pagina del modello nella documentazione Gen2 di Shelly e guarda quali componenti ha e se espone anche il fattore di potenza o la potenza apparente (servono al livello 3).

**Privacy.** Nelle impostazioni dello Shelly **disattiva il cloud**: July lo interroga in locale. Dai al dispositivo un IP fisso (prenotazione DHCP nel router).

---

## Architettura

```
Shelly ──(HTTP, ogni secondo)──► lettore ──► buffer in RAM (ultimi 30 minuti, 1 valore/s)
                                     │              │
                                     │              ├─► allarme distacco (livello 1)
                                     │              └─► rilevatore di gradini (livello 3)
                                     ▼
                         ogni minuto: media e massimo ─► SQLite (livello 2)
```

I dati al secondo stanno **solo in RAM**: 1.800 numeri per mezz'ora sono niente. Su disco va un riassunto al minuto, cioè 1.440 righe al giorno invece di 86.400. Il disco ringrazia.

```
funzioni/energia/
├── shelly.ts      lettura e validazione
├── buffer.ts      buffer circolare
├── distacco.ts    livello 1
├── fasce.ts       livello 2: F1/F2/F3 e festività
├── report.ts      livello 2: /consumi
├── gradini.ts     livello 3: eventi
├── abbina.ts      livello 3: accensione ↔ spegnimento
└── knn.ts         livello 3: classificatore
```

---

## Livello 1 · Allarme distacco

### Passo 1.1 · Leggere lo Shelly

Gli Shelly di seconda generazione rispondono a chiamate HTTP del tipo `http://IP/rpc/<Componente>.GetStatus?id=0`. Per esempio, a seconda del modello:

```
http://192.168.1.50/rpc/EM1.GetStatus?id=0      → campo act_power (W)
http://192.168.1.50/rpc/Switch.GetStatus?id=0   → campo apower (W)
```

Prova prima a mano dal Pi e guarda la risposta vera del tuo modello:

```bash
curl -s http://192.168.1.50/rpc/EM1.GetStatus?id=0
```

Scrivi uno **schema Zod** per i campi che usi e valida ogni risposta: se un aggiornamento firmware cambia un campo, te ne accorgi subito invece di salvare `undefined`. Se hai attivato la password sullo Shelly, serve l'autenticazione *digest*: controlla nella documentazione come funziona.

**Il ciclo di lettura.** Un `setTimeout` che si rischedula **dopo** che la lettura è finita (non `setInterval`): se lo Shelly risponde lento, le richieste non si accavallano. Timeout di 2 secondi con `AbortSignal.timeout(2000)`. Dopo 30 errori di fila, `notifica` con chiave `shelly:offline`.

### Passo 1.2 · Il buffer circolare

Un array di dimensione fissa (1.800) e un indice che gira: quando arrivi in fondo riparti da zero e sovrascrivi il più vecchio. Metodi: `aggiungi(ts, watt)`, `ultimi(secondi)`, `tutti()`.

**✅ Verifica.** Test: inserisci 2.000 valori, `tutti()` deve restituire gli ultimi 1.800 in ordine.

### Passo 1.3 · La regola

In `.env`:

```
POTENZA_SOGLIA_W=3000
POTENZA_DURATA_S=30
```

Se la media degli ultimi `POTENZA_DURATA_S` secondi supera la soglia, `notifica` con gravità `critico` e chiave `energia:distacco`. Quando torna sotto per un minuto, `risolto`.

Il comportamento del contatore dipende dal contratto: molti hanno 3 kW di potenza impegnata e 3,3 kW disponibili, con una tolleranza per qualche minuto oltre. **Verifica le soglie e i tempi del tuo contratto** con il fornitore e scegli la soglia un po' sotto.

---

## Livello 2 · Consumi e costi

### Passo 2.1 · L'energia: meglio il contatore dello Shelly

Puoi calcolare l'energia sommando potenza × tempo (`Σ watt × secondi / 3.600.000` = kWh), ma se perdi delle letture sbagli. Lo Shelly ha un **contatore di energia interno** che non perde niente: leggi quello (a seconda del modello è in un componente `...Data`, per esempio `EM1Data.GetStatus` con `total_act_energy` in Wh, oppure nel campo `aenergy` di `Switch`) e salva la **differenza** tra un minuto e l'altro.

**Migrazione:**

```sql
CREATE TABLE energia_minuto (
  ts INTEGER PRIMARY KEY,    -- inizio del minuto, ms
  wh REAL NOT NULL,          -- energia nel minuto
  w_medi REAL NOT NULL,
  w_max REAL NOT NULL
);
```

Scrivi con il buffer di `core/db.ts`: una transazione ogni 30 minuti.

### Passo 2.2 · Le fasce F1, F2, F3

| Fascia | Quando |
| --- | --- |
| F1 | lunedì–venerdì, 8:00–19:00 |
| F2 | lunedì–venerdì, 7:00–8:00 e 19:00–23:00; sabato 7:00–23:00 |
| F3 | lunedì–sabato, 23:00–7:00; domenica e festivi tutto il giorno |

```ts
function fascia(data: Date): 'F1' | 'F2' | 'F3'   // con il fuso Europe/Rome
function festivo(data: Date): boolean
```

**Festività nazionali:** 1 gennaio, 6 gennaio, Lunedì dell'Angelo, 25 aprile, 1 maggio, 2 giugno, 15 agosto, 1 novembre, 8 dicembre, 25 e 26 dicembre. Dal 2026 è tornato festa nazionale anche il **4 ottobre**: verifica se il tuo fornitore lo conta come F3.

**La Pasqua** si calcola con l'algoritmo di Gauss nella versione "anonima gregoriana" (Meeus/Jones/Butcher): una dozzina di righe di divisioni intere. Test: Pasqua 2026 = 5 aprile, 2027 = 28 marzo, 2028 = 16 aprile. Il Lunedì dell'Angelo è il giorno dopo.

**Prezzi** nel `.env` (€/kWh, con o senza oneri: decidi tu e scrivilo nel report):

```
PREZZO_F1=0.30
PREZZO_F2=0.28
PREZZO_F3=0.25
```

### Passo 2.3 · `/consumi`

`/consumi` (oggi), `/consumi ieri`, `/consumi settimana`. Per ogni minuto della tabella: fascia → somma kWh per fascia → costo. Formatta in italiano (`toLocaleString('it-IT', { maximumFractionDigits: 2 })`).

**✅ Verifica.** Confronta il totale di una settimana con quello che dice l'app o la pagina dello Shelly: devono coincidere.

---

## Livello 3 · Riconoscere gli elettrodomestici (NILM)

NILM significa *Non-Intrusive Load Monitoring*: capire cosa è acceso guardando **un solo** misuratore. L'idea, del 1992 (George Hart), è semplice: ogni elettrodomestico, quando si accende, fa fare un **gradino** alla potenza totale, e ogni elettrodomestico ha il suo gradino.

```
W
3000 │                 ┌────┐ ← bollitore +1950 W
     │                 │    │
1000 │      ┌──────────┘    └────────  ← forno acceso prima, +900 W
 100 │──────┘ ← frigo e standby
     └──────────────────────────────── t
```

### Passo 3.1 · Trovare i gradini

1. **Togli il rumore** con un filtro mediano su 3 campioni (la mediana ignora i picchi isolati, la media no).
2. **Riconosci i tratti stabili:** una finestra di 5 secondi è "stabile" se massimo − minimo < 15 W + 2% del valore.
3. **Un evento** è il passaggio da un tratto stabile al successivo con differenza ≥ 30 W. Salva `{ ts, deltaW }`, e anche `deltaQ` se il tuo Shelly dà la potenza reattiva (passo 3.4).

**✅ Verifica.** Accendi e spegni il bollitore 5 volte: devi vedere 5 eventi positivi e 5 negativi di circa ±2.000 W, e nient'altro nello stesso momento.

### Passo 3.2 · Abbinare accensione e spegnimento

Per ogni gradino negativo cerca, tra i positivi ancora "aperti", quello di ampiezza simile (±10%) più recente. La coppia diventa un **ciclo**: inizio, fine, durata, potenza, energia. Il ciclo è molto più informativo del gradino: un bollitore dura 3–4 minuti, un forno un'ora.

### Passo 3.3 · Le etichette, da Telegram

Quando un ciclo nuovo supera i 300 W e il classificatore non è sicuro, July chiede:

```
🔎 +1.950 W alle 14:03, durato 4 minuti. Cos'era?   [Bollitore] [Phon] [Forno] [Altro…]
```

"Altro…" ti chiede il nome a testo. Tabella `elettrodomestici (id, nome)` e `etichette (ciclo_id, elettrodomestico_id)`. Al massimo 5 domande al giorno: all'inizio sono tante, poi calano da sole.

### Passo 3.4 · Il classificatore k-NN

*k-nearest neighbours*: per un ciclo nuovo, trova i `k` cicli etichettati più simili e prendi l'etichetta più frequente tra loro.

**Le caratteristiche** (le dividi per una scala, così pesano in modo simile):

```
[ deltaW / 1000, deltaQ / 500, log(durata in secondi) / 5 ]
```

`deltaQ` è la variazione di potenza **reattiva**: quasi zero per le resistenze (bollitore, forno, phon), alta per i motori (frigo, lavatrice in centrifuga). Se lo Shelly dà potenza attiva `P` e apparente `S`, la reattiva è `Q = √(S² − P²)`. È la caratteristica che separa due apparecchi con lo stesso consumo.

**La decisione:** con `k = 3`, se almeno 2 vicini su 3 concordano **e** il più vicino è entro una distanza massima, rispondi con quell'etichetta. Altrimenti "non so" (e chiedi, passo 3.3). La durata la conosci solo alla fine del ciclo: all'accensione usa solo le prime due caratteristiche.

**✅ Verifica.** Tieni da parte il 20% delle etichette, addestra sul resto e misura quante ne indovina (*accuratezza*). Stampa anche la **matrice di confusione** (quale confonde con quale): ti dice quali caratteristiche mancano.

### Passo 3.5 · Usarlo

- Nell'allarme distacco: "Accesi probabilmente: forno, lavatrice".
- In `/consumi`: energia per elettrodomestico, con la fascia (la lavatrice in F1 costa di più che in F3).
- "Cosa sta andando?" → potenza attuale e cicli aperti.

---

## Trappole

- **Elettrodomestici a più stati.** La lavatrice non è un gradino: è riscaldamento (2 kW a intermittenza), motore, pompa. Il NILM a gradini la vede come tanti apparecchi diversi. Accettalo all'inizio; vedi "Per andare oltre".
- **Due cose accese nello stesso secondo** fanno un gradino solo, somma dei due. Succede raramente: non complicarti la vita.
- **Fasce e ora legale:** le fasce sono in ora italiana. Calcola sempre con il fuso.

## Per andare oltre

- **Firme a sequenza:** descrivi la lavatrice come una sequenza di gradini tipici in una finestra di tempo, e riconosci la sequenza.
- **Prese con misura** su 2–3 apparecchi: ti danno la verità per controllare il NILM.
- **Fotovoltaico,** se un giorno lo avrai: la potenza può diventare negativa. Progetta già ora i tipi senza dare per scontato che sia sempre positiva.

## Fonti

- Shelly, API di seconda generazione: https://shelly-api-docs.shelly.cloud/gen2/ (da verificare; controlla la pagina del tuo modello)
- G. W. Hart, *Nonintrusive appliance load monitoring*, Proceedings of the IEEE, 1992 (cercalo per titolo; non ho potuto verificare il riferimento)
- NILMTK, libreria Python di riferimento per il NILM: https://github.com/nilmtk/nilmtk (da verificare)
- ARERA, fasce orarie: https://www.arera.it (da verificare)
- Calcolo della Pasqua: https://it.wikipedia.org/wiki/Computus (da verificare)
