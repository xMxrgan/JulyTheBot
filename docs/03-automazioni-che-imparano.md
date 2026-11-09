# 03 · Automazioni che imparano

## Cosa fa

```
July:  💡 Ho notato un'abitudine.
       Nei giorni feriali spegni la luce del soggiorno verso le 23:31
       (19 volte su 20 nelle ultime 4 settimane, quasi sempre tra 23:10 e 23:50).
       La creo come automazione?   [✅ Crea] [🕒 Cambia orario] [Ignora] [Non chiedere più]

July:  💡 Quando apri la porta d'ingresso dopo il tramonto, accendi la luce dell'ingresso
       entro 2 minuti (14 volte su 16). Lo faccio io?   [✅ Crea] [Ignora]

Tu:    /automazioni
July:  1. ✅ Luce soggiorno off · feriali 23:31 · eseguita 12 volte, annullata 0
       2. ⏸ Ingresso on · porta aperta + buio · in pausa
```

## Cosa impari

Statistica circolare (le medie sugli orari), raggruppamento, regole di associazione (supporto e confidenza), un piccolo motore di automazioni con trigger, condizioni e azioni, e un ciclo di apprendimento dal feedback. In più, come **testare un algoritmo con dati finti** che hai generato tu.

## Prerequisiti

- Guide 00 (A + B, con i due utenti `july` e `july-auto`) e 01.
- Facoltativa ma utile: 02 (per le condizioni "qualcuno in casa").
- Almeno 3–4 settimane di eventi registrati prima che le proposte abbiano senso. **Inizia a registrare (passo 1) subito**, anche prima di scrivere il resto.

---

## Architettura

```
HA state_changed ─► filtro "è stata una persona?" ─► tabella eventi (SQLite)
                                                        │
                       ogni sera ◄──────────────────────┘
                           │
              ┌────────────┴────────────┐
        abitudini a orario       sequenze A → B
              └────────────┬────────────┘
                     proposte (max 1 al giorno) ─► tu: Crea / Ignora / Mai
                           │
                     motore automazioni ─► chiamaServizio con HA_TOKEN_AUTO
                           │
                  la annulli entro 5 min? ─► feedback ─► pausa o nuovo orario
```

```
funzioni/automazioni/
├── registro.ts     passo 1
├── circolare.ts    passo 2 (funzioni pure, facili da testare)
├── abitudini.ts    passo 3
├── sequenze.ts     passo 4
├── proposte.ts     passo 5
├── motore.ts       passo 6
└── finti.ts        passo 8, generatore di dati di prova
```

---

## Passo 1 · Registrare solo le azioni delle persone

**Il problema.** Se July registra tutto, impara anche dalle automazioni, comprese le sue: crea un'automazione, la vede eseguire ogni sera e ne propone una identica. Un circolo vizioso.

**La soluzione: il `context` di Home Assistant.** Ogni cambio di stato porta con sé chi l'ha causato:

| `context.user_id` | `context.parent_id` | Chi è stato |
| --- | --- | --- |
| id di una persona o dell'utente `july` | `null` | una persona, dall'app, da HA o dicendolo a July → **registra** |
| `null` | `null` | un interruttore fisico o il dispositivo stesso → **registra** |
| qualsiasi | non `null` | un'automazione o uno script di HA → **ignora** |
| id dell'utente `july-auto` | qualsiasi | le automazioni di July → **ignora** |

Per questo nella guida 00 hai creato due utenti: i comandi che dai a July (utente `july`) sono intenzioni tue e contano, quelli che July esegue da solo (utente `july-auto`) no. Ricava gli id dei due utenti all'avvio, per esempio dalla prima azione di ciascuno, oppure con il comando WebSocket `auth/current_user` usando i loro token (lo usa l'interfaccia di HA ma non è nella documentazione pubblica: provalo e guarda la risposta).

Registra solo i domini utili (`light`, `switch`, `cover`, `climate`, `media_player`, `fan`) e solo i cambi veri (`old_state.state !== new_state.state`).

**Migrazione:**

```sql
CREATE TABLE eventi (
  ts INTEGER NOT NULL,          -- millisecondi
  entita TEXT NOT NULL,
  stato TEXT NOT NULL,          -- 'on', 'off', 'open'...
  minuto INTEGER NOT NULL,      -- minuto del giorno 0..1439, ora italiana
  giorno INTEGER NOT NULL       -- 0 = domenica ... 6 = sabato
);
CREATE INDEX eventi_entita_ts ON eventi (entita, ts);
```

Salvare `minuto` e `giorno` già calcolati (con il fuso `Europe/Rome`) evita errori con l'ora legale dopo.

**✅ Verifica.** Accendi una luce dall'interruttore, una dall'app, una con una automazione di HA. Nella tabella devono comparire le prime due, non la terza.

## Passo 2 · Statistica circolare

**Perché la media normale sbaglia sugli orari.** Spegni la luce alle 23:50, 00:05, 23:40 e 00:15. In minuti: 1430, 5, 1420, 15. La media è 717,5, cioè **11:57**. Assurdo: la risposta giusta è circa mezzanotte.

**La soluzione.** Metti ogni orario su un cerchio, come le lancette:

```
angolo θ = minuto / 1440 × 2π
C = Σ cos θ        S = Σ sin θ
media  = atan2(S, C)               → riconvertila in minuti (e aggiungi 1440 se negativa)
R      = √(C² + S²) / n            → tra 0 e 1: vicino a 1 = orari molto concentrati
devStd = √(−2 · ln R)              → in radianti; × 1440 / 2π per averla in minuti
```

Con l'esempio: media **23:57**, R = 0,998, deviazione standard **13,5 minuti**. Usalo come primo test.

**✅ Verifica.** `bun test` su `circolare.ts` con quell'esempio e con due casi limite: tutti gli orari uguali (deviazione 0) e orari sparsi su tutta la giornata (R vicino a 0).

## Passo 3 · Abitudini a orario

Per ogni coppia (entità, stato), negli ultimi 28 giorni, separando **feriali** e **weekend**:

1. **Raggruppa.** Puoi spegnere la luce sia alle 7:30 sia alle 23:30: sono due abitudini. Ordina i minuti, e dove c'è un salto di più di 60 minuti (ricordandoti del salto tra 23:59 e 00:00) separa i gruppi.
2. **Per ogni gruppo** calcola media e deviazione circolare, e in quanti **giorni diversi** è successo (non quante volte: tre accensioni in un giorno solo non sono un'abitudine).
3. **È un'abitudine se:** giorni ≥ 50% dei giorni possibili (es. 10 feriali su 20) e deviazione ≤ 20 minuti.
4. **Punteggio** per ordinare le proposte: più giorni e meno deviazione = punteggio più alto.

**✅ Verifica.** Con i dati finti del passo 8 deve trovare esattamente le abitudini che hai nascosto, e nessun'altra.

## Passo 4 · Sequenze "quando A, allora B"

Per ogni evento A (es. porta ingresso `on`), cerca se entro 120 secondi arriva un evento B (es. luce ingresso `on`).

- **Supporto** = quante volte A è stato seguito da B.
- **Confidenza** = supporto / quante volte è successo A.

Proponi se supporto ≥ 8 e confidenza ≥ 0,7. Escludi le coppie dello stesso dispositivo e quelle in cui B succede quasi sempre comunque (se accendi la luce dell'ingresso 50 volte al giorno, non c'entra la porta).

**Le condizioni.** "Dopo il tramonto" rende la regola molto più precisa. HA ha l'entità `sun.sun` con l'attributo `elevation`: al momento di A, salva anche se il sole era sotto l'orizzonte e cerca regole separate per giorno e buio. Con la guida 02 puoi aggiungere "qualcuno in casa".

## Passo 5 · Le proposte

- Al massimo **una al giorno**, la sera, la migliore per punteggio.
- Il messaggio **mostra le prove**: quante volte, in quale intervallo. Un'automazione che non sai spiegare non va proposta.
- **Arrotonda in modo umano**: 23:31 resta 23:31, ma il pulsante "Cambia orario" ti propone 23:30 e 23:45.
- Tabella `proposte (id, tipo, firma, stato, ts)`, dove `firma` identifica la regola (es. `orario:light.soggiorno:off:feriali:1411`). "Ignora" la ripropone non prima di 30 giorni, "Non chiedere più" mai.

## Passo 6 · Il motore

```ts
interface Automazione {
  id: number
  attiva: boolean
  trigger:
    | { tipo: 'orario'; cron: string }                              // '31 23 * * 1-5'
    | { tipo: 'evento'; entita: string; stato: string }
  condizioni: Array<
    | { tipo: 'buio' }
    | { tipo: 'qualcunoInCasa' }
    | { tipo: 'statoDiverso'; entita: string; stato: string }       // non spegnere se è già spenta
  >
  azione: { dominio: string; servizio: string; entita: string; dati?: Record<string, unknown> }
}
```

- Trigger `orario` → `core/scheduler.ts`. Trigger `evento` → `suCambio` di `core/ha.ts`.
- Prima di eseguire, valuta tutte le condizioni. Poi chiama il servizio **con il token `HA_TOKEN_AUTO`**: così il passo 1 riconosce l'azione come "non umana".
- Ogni esecuzione va in una tabella `esecuzioni (automazione, ts, esito)`.
- `/automazioni` mostra l'elenco con pulsanti Pausa / Riprendi / Elimina.
- Le azioni dell'automazione seguono la tabella dei rischi della guida 01: **niente serrature o allarmi automatici**, mai.

## Passo 7 · Imparare dagli errori

Se entro 5 minuti da un'esecuzione una persona riporta il dispositivo allo stato precedente (riaccende la luce appena spenta), è un **rifiuto**. Dopo 3 rifiuti in 14 giorni, July mette l'automazione in pausa e ti chiede: "Spengo la luce del soggiorno alle 23:31, ma la riaccendi spesso. La sposto alle 23:45 o la tolgo?".

## Passo 8 · Dati finti per i test

Scrivi `finti.ts`, che genera 4 settimane di eventi con abitudini che conosci:

- luce soggiorno off nei feriali alle 23:30 ± 15 minuti (distribuzione normale), saltando a caso il 10% dei giorni;
- luce cucina on alle 7:15 ± 10 nei feriali;
- porta → luce ingresso entro 60 s, solo se è buio, nell'80% dei casi;
- rumore: 30 eventi al giorno su dispositivi a caso, a orari a caso.

Gli algoritmi dei passi 3 e 4 devono trovare le tre abitudini e **nient'altro**. Cambia la deviazione da 15 a 40 minuti: l'abitudine della sera deve sparire. Così regoli le soglie con dati di cui conosci la verità, invece di aspettare settimane.

> **Se ti blocchi** con i numeri normali: JavaScript non ha `Math.randomNormal`. Il metodo di Box-Muller: `Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)` con `u1` e `u2` uniformi in (0, 1) dà un numero con media 0 e deviazione 1; moltiplicalo per 15 e aggiungi 1410.

---

## Trappole

- **Imparare dalle proprie automazioni.** Passo 1, sempre.
- **Ora legale.** L'ultima domenica di ottobre l'ora tra le 2 e le 3 c'è due volte, l'ultima domenica di marzo non c'è proprio. Calcola `minuto` con il fuso `Europe/Rome`, non con UTC, e non stupirti di quei due giorni strani nei dati.
- **Vacanze.** Due settimane fuori cancellano le abitudini dalla finestra di 28 giorni. Con la 02, conta solo i giorni in cui qualcuno era in casa.
- **Troppe proposte** e l'utente smette di leggerle. Una al giorno al massimo.

## Per andare oltre

- **Abitudini con valori:** non solo "accendi" ma "al 30% di luminosità" (media dei valori, non circolare).
- **Stagioni:** le abitudini legate al buio si spostano con il tramonto. Prova a misurare l'orario rispetto al tramonto invece che rispetto alla mezzanotte.

## Fonti

- ✔︎ Home Assistant, eventi `state_changed` e contesto: https://developers.home-assistant.io/docs/api/websocket
- Contesto degli eventi in HA (user_id, parent_id): https://data.home-assistant.io/docs/context/ (da verificare)
- Statistica circolare: https://en.wikipedia.org/wiki/Circular_mean (da verificare)
- Regole di associazione (supporto, confidenza): https://it.wikipedia.org/wiki/Regole_di_associazione (da verificare)
- Box-Muller: https://it.wikipedia.org/wiki/Trasformata_di_Box-Muller (da verificare)
