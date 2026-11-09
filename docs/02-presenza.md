# 02 · Presenza

## Cosa fa

```
Tu:    /chi
July:  🏠 In casa: tu. Fuori: NOME (ha scelto di condividere la presenza).
       Stanze occupate: studio.

Tu:    c'è qualcuno in cucina?
July:  No, la cucina è vuota da 25 minuti.
```

E soprattutto dà alle altre funzioni tre informazioni: chi è in casa, chi è appena arrivato o uscito, quali stanze sono occupate. La guida 07 la usa per "porta aperta e nessuno in casa", la 03 per "quando arrivi accendi la luce", la 11 per non mandarti il briefing di casa quando sei in viaggio.

## Cosa impari

Combinare segnali incerti con la regola di Bayes in forma di *log-odds*, decadimento nel tempo, isteresi, macchine a stati, e una regola d'oro per le funzioni che decidono da sole: la **modalità ombra**.

## Prerequisiti

- Guida 00, parti A e B.
- Per le stanze: un sensore di presenza **mmWave** per stanza (radar che vede anche una persona ferma, a differenza dei PIR) e sensori di apertura sulle porte. Due strade per l'mmWave:
  - **LD2410C + ESP32 con ESPHome** (economico, configuri tu le distanze: vedi guida 05);
  - un sensore mmWave **Zigbee** che compaia nella lista dei dispositivi supportati da Zigbee2MQTT.

---

## Due livelli, onestamente

| Livello | Domanda | Con cosa |
| --- | --- | --- |
| **Casa** | *Chi* è in casa? | segnali del telefono di ciascuno |
| **Stanza** | *Qualcuno* è in questa stanza? | sensori mmWave, porte |

Sapere **chi** è in **quale** stanza senza telecamere e senza far portare a ognuno un dispositivo dedicato è molto difficile. Una scorciatoia valida: se in casa c'è una persona sola, le stanze occupate sono sue. Negli altri casi July dice "qualcuno".

## Architettura

```
segnali telefono ─┐                       ┌─► isHome(utente), qualcunoInCasa()
                  ├─► fusione per persona ─┤
porte d'ingresso ─┘                       └─► eventi 'arrivo' / 'uscita'

mmWave, porte interne ─► macchina a stati per stanza ─► stanzeOccupate(), eventi 'stanza'
```

```
funzioni/presenza/
├── segnali.ts    legge Tailscale e Home Assistant
├── bayes.ts      la fusione
├── stanze.ts     le macchine a stati
├── index.ts      API per le altre funzioni + comandi /chi
└── privacy.ts    chi ha dato il consenso
```

---

## Passo 1 · I segnali "è in casa"

**A. Tailscale (trucco interessante).** Quando il tuo iPhone è sulla Wi‑Fi di casa, Tailscale lo collega al Pi **direttamente in rete locale**. Il comando:

```bash
tailscale status --json
```

per ogni dispositivo (`Peer`) mostra, tra gli altri, `Online` e `CurAddr`. Se `CurAddr` contiene un indirizzo della tua rete di casa (es. `192.168.1.23:41641`), il telefono è in casa. Se è vuoto o passa da un relay, non lo sai.

Lancialo una volta sul Pi e guarda i campi veri: i nomi qui sopra vanno controllati sulla tua versione. Da July lo esegui con lo `$` di Bun, come i comandi di `admin.ts`.

Limite: se il telefono dorme, la connessione diretta può non esserci. È un segnale **forte quando c'è** e **debole quando manca**.

**B. App Home Assistant sull'iPhone.** L'app Companion manda la posizione a HA, che crea un'entità `device_tracker` con stato `home` o `not_home`. Per funzionare fuori casa l'app deve raggiungere HA: tramite Tailscale, che hai già. È il segnale più forte, ma con qualche minuto di ritardo.

**C. Porta d'ingresso.** Un'apertura non dice chi, ma dice che *qualcosa* è cambiato: subito dopo, gli altri segnali contano di più.

**✅ Verifica.** Un comando admin `/segnali` che stampa i segnali grezzi di ogni persona. Esci di casa e rientra guardandoli.

## Passo 2 · La fusione bayesiana

**L'idea.** Ogni segnale non dice "sì" o "no", ma *quanto è più probabile* vederlo se sei in casa rispetto a se sei fuori. Questo rapporto si chiama *rapporto di verosimiglianza* (LR).

| Segnale | P(segnale \| in casa) | P(segnale \| fuori) | LR |
| --- | --- | --- | --- |
| Tailscale diretto in LAN, ultimi 10 min | 0,60 | 0,02 | 30 |
| App HA dice `home` | 0,95 | 0,05 | 19 |
| App HA dice `not_home` | 0,05 | 0,90 | 0,056 |

I numeri sono un punto di partenza: li correggerai con i dati della modalità ombra (passo 4).

**I log-odds rendono tutto una somma.** Invece della probabilità `p` usi `logit(p) = ln(p / (1 − p))`. Ogni segnale aggiunge `ln(LR)`:

```
logit(dopo) = logit(prima) + ln(LR₁) + ln(LR₂) + ...
p = 1 / (1 + e^(−logit))
```

Esempio. Prima 50% (logit 0). Tailscale in LAN: +ln(30) = +3,40. App HA `home`: +ln(19) = +2,94. Totale 6,34 → p = 99,8%.

Le formule valgono se i segnali sono indipendenti, cosa vera solo in parte: non spingere troppo i numeri.

**Il decadimento.** Un segnale di due ore fa conta meno di uno di adesso. Moltiplica il suo `ln(LR)` per `e^(−età / τ)`, con τ diverso per segnale (Tailscale 15 minuti, app HA 60 minuti). Quando non hai segnali freschi, la probabilità torna da sola verso il valore di partenza.

**L'isteresi.** Non decidere a 50%: con valori vicini, lo stato cambierebbe in continuazione. Diventa **in casa** sopra 85%, **fuori** sotto 20%, e nel mezzo resta com'era.

**✅ Verifica.** Test con `bun test`: dati i segnali di un esempio scritto a mano, la probabilità deve essere quella calcolata con la calcolatrice.

> **Se ti blocchi:** tieni per ogni persona un array di `{ tipo, valore, ts }`. A ogni calcolo parti da `logit(prior)`, sommi i contributi decaduti dei segnali non troppo vecchi, converti in probabilità e applichi l'isteresi rispetto allo stato precedente. Quando lo stato cambia, emetti l'evento.

## Passo 3 · Le stanze: una macchina a stati

Per ogni stanza:

```
            presenza vista
   VUOTA ───────────────────► OCCUPATA
     ▲                          │  nessuna presenza
     │  passati 90 s            ▼
     └─────────────────── IN_USCITA ──── presenza di nuovo ──► OCCUPATA

   Caso speciale, "scatola chiusa" (bagno, studio):
   porta chiusa + presenza vista DOPO la chiusura ──► SIGILLATA
   SIGILLATA resta occupata, anche senza movimento, finché la porta non si riapre
```

La "scatola chiusa" risolve il problema classico: sei fermo sotto la doccia, il sensore non ti vede più, e la luce si spegne. Se la porta è chiusa e qualcuno è entrato, è ancora lì.

**Regolare l'mmWave.** Gli LD2410 vedono anche attraverso le pareti sottili e reagiscono a ventilatori e tende. In ESPHome puoi limitare la distanza massima (`max_move_distance_gate`, `max_still_distance_gate`) e la sensibilità per ogni fascia di distanza. Regola una stanza alla volta guardando `has_target` mentre ti muovi e mentre esci.

**✅ Verifica.** Per ogni stanza, entra, stai fermo 5 minuti, esci. Il log degli stati deve essere: VUOTA → OCCUPATA → (ferma: OCCUPATA) → IN_USCITA → VUOTA.

## Passo 4 · Modalità ombra

Per una settimana la funzione calcola tutto e **scrive nel database**, ma nessun'altra funzione la usa. Ogni sera July ti manda un riassunto: "Oggi ti ho visto uscire alle 8:12 e rientrare alle 18:40. Giusto? [Sì] [No]". Con le risposte:

- correggi le probabilità della tabella del passo 2;
- trovi i buchi (per esempio: il telefono non si collega in LAN quando dorme).

Applica la stessa regola a ogni funzione che decide da sola: prima osserva, poi agisce.

## Passo 5 · L'API per le altre funzioni

```ts
function inCasa(idTelegram: number): boolean | null   // null = non sappiamo
function qualcunoInCasa(): boolean
function stanzeOccupate(): string[]
function suPresenza(cb: (e: EventoPresenza) => void): () => void

type EventoPresenza =
  | { tipo: 'arrivo' | 'uscita'; utente: number; ts: number }
  | { tipo: 'stanza'; stanza: string; occupata: boolean; ts: number }
```

## Passo 6 · Privacy e consenso

La presenza è un dato delicato: dice dove sono le persone.

- **Consenso per persona.** `/presenza condividi sì|no`. Senza consenso, gli altri vedono solo "qualcuno è in casa", mai il nome.
- **Il codice filtra, non il modello**: `/chi` costruisce la risposta in base al consenso di ognuno, e la funzione AI non riceve mai la presenza degli altri.
- **Storico breve.** Tieni gli eventi dettagliati al massimo 14 giorni; oltre, solo statistiche aggregate per la guida 03.
- Nella tabella dei consensi salva anche **quando** è stato dato.

---

## Trappole

- **Telefono scarico o in modalità aereo** = "fuori". Per questo il decadimento riporta verso l'incertezza, non verso "fuori", e le altre funzioni devono gestire `null`.
- **Un solo sensore mmWave per un open space**: vede tutto come una stanza. Dividi le zone con le distanze.
- **Ospiti**: i sensori delle stanze li vedono, i telefoni no. "Nessuno in casa" ma stanze occupate è un caso da gestire (e la guida 07 lo può segnalare).

## Per andare oltre

- **Arrivo previsto:** quando l'app HA vede che ti avvicini (zona "vicino a casa"), July accende il riscaldamento.
- **Bluetooth per stanza** con proxy ESP32 (integrazione *Bermuda* di HA). Verifica prima se il tuo telefono è tracciabile: gli iPhone cambiano spesso l'indirizzo Bluetooth.

## Fonti

- ✔︎ ESPHome LD2410: https://esphome.io/components/sensor/ld2410/
- Tailscale, `tailscale status`: https://tailscale.com/kb/1080/cli (da verificare)
- App Companion di Home Assistant: https://companion.home-assistant.io/ (da verificare)
- Sensore bayesiano di HA, per confronto con il tuo: https://www.home-assistant.io/integrations/bayesian/ (da verificare)
