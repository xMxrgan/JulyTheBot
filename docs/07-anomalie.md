# 07 · Anomalie

## Cosa fa

```
July:  🚨 Perdita d'acqua sotto la lavatrice!   (critico, arriva anche di notte)

July:  ⚠️ La finestra della camera è aperta da 20 minuti e il riscaldamento è acceso.
       [Ok, la chiudo] [Va bene così] [Silenzia oggi]

July:  ⚠️ La porta d'ingresso è aperta e non c'è nessuno in casa.

July:  🔎 Il frigo lavora il 40% in più del solito da 3 giorni
       (compressore acceso 18 min/ora invece di 13). Porta chiusa bene? Guarnizione?
       [Controllo] [È normale]

July:  📉 Il sensore "balcone" non manda dati da 3 ore.
```

## Cosa impari

Tre famiglie di rilevatori (regole, statistica robusta, deriva lenta), mediana e MAD, stagionalità per ora della settimana, CUSUM, *feature engineering* (dai watt ai cicli del compressore), e come provare le soglie sul passato (*backtest*) invece di scoprirle a forza di falsi allarmi.

## Prerequisiti

- Guida 00 parte A (`notify`, `db`, `scheduler`); parte B per i sensori di casa.
- Facoltative: 02 (presenza, per "nessuno in casa"), 04 o una presa con misura di potenza sul frigo.
- Sensori: perdita d'acqua Zigbee, contatti su porte e finestre, temperatura.

---

## Le tre famiglie

| Famiglia | Esempi | Quando arriva |
| --- | --- | --- |
| **Regole** | perdita d'acqua, finestra aperta + riscaldamento, porta aperta + nessuno in casa | subito |
| **Fuori dal solito** | 30 °C in camera alle 3 di notte, 900 W di notte quando di solito sono 150 | dopo pochi minuti |
| **Deriva lenta** | il frigo lavora sempre di più, il deumidificatore si accende più spesso | dopo giorni |

```
HA suCambio ──► regole ────────────────┐
                                       │
SQLite (storico) ──► fuori dal solito ─┼──► motore avvisi ──► core/notify.ts
   ogni 5 min                          │   (dedup, conferme,
                                       │    feedback "è normale")
SQLite ──► deriva lenta ───────────────┘
   ogni sera
```

```
funzioni/anomalie/
├── regole.ts
├── robusta.ts        mediana, MAD, punteggio
├── stagioni.ts       baseline per ora della settimana
├── cusum.ts
├── frigo.ts          dai watt ai cicli
├── backtest.ts
└── feedback.ts
```

---

## Passo 1 · Le regole

Ogni regola è un oggetto:

```ts
interface Regola {
  chiave: string                        // 'finestra-riscaldamento:camera'
  gravita: 'info' | 'avviso' | 'critico'
  vera: () => boolean                   // legge dalla cache di core/ha.ts e da presenza
  perAlmeno: number                     // secondi in cui deve restare vera prima di avvisare
  testo: () => string
}
```

`perAlmeno` evita gli allarmi per eventi di un attimo: la finestra aperta 2 minuti per cambiare aria non è un problema, 20 minuti sì. Valuta le regole a ogni `suCambio` delle entità coinvolte e ogni minuto (per far scattare `perAlmeno`). Quando una regola torna falsa, `risolto(chiave)`.

Regole da cui partire:

| Regola | Gravità | perAlmeno |
| --- | --- | --- |
| sensore perdita = bagnato | critico | 0 |
| temperatura interna < 10 °C | critico | 10 min |
| finestra aperta e riscaldamento acceso nella stessa stanza | avviso | 20 min |
| porta d'ingresso aperta e `qualcunoInCasa()` falso | avviso | 2 min |
| sensore senza dati da più di 3 volte il suo intervallo | info | 0 |

Per l'ultima: ogni entità ha un `last_updated` nello stato. Un sensore che di solito si aggiorna ogni 5 minuti e tace da 15 è probabilmente scarico o fuori portata.

**✅ Verifica.** Apri la finestra con il riscaldamento acceso: avviso dopo 20 minuti, `risolto` quando la chiudi.

## Passo 2 · Statistica robusta

**Perché non media e deviazione standard.** Un solo valore assurdo (un sensore che per errore manda 300 °C) sposta la media e gonfia la deviazione, e da lì in poi non vedi più niente. **Mediana** e **MAD** (*median absolute deviation*) ignorano i valori estremi.

```
mediana = valore centrale dei dati ordinati
MAD     = mediana di |xᵢ − mediana|
punteggio(x) = (x − mediana) / (1,4826 × MAD)
```

Il fattore 1,4826 rende il punteggio confrontabile con la classica "quante deviazioni standard": sopra 4 è molto insolito. Se MAD vale 0 (dati tutti uguali), usa un minimo fisso per sensore (es. 0,3 °C), altrimenti dividi per zero.

**✅ Verifica.** `bun test`: con `[20, 21, 20, 22, 21, 300]` la mediana è 21 e il punteggio di 300 è enorme, mentre quello di 22 resta piccolo.

## Passo 3 · "Il solito" dipende dall'ora

900 W alle 19 di un giovedì (cena) è normale; alle 3 di notte no. Dividi la settimana in **168 caselle** (7 giorni × 24 ore) e per ogni sensore calcola mediana e MAD **per casella** usando le ultime 4–6 settimane. Per avere abbastanza dati, una casella può prendere anche le ore vicine (±1 ora).

**Dati:** per i consumi c'è già `energia_minuto` della guida 04. Per le temperature, una tabella `serie (entita, ts, valore)` con **un valore ogni 5 minuti** (media), non ogni cambio.

**La regola:** anomalia se il punteggio supera 4 **per 3 controlli di fila** (15 minuti). Un picco isolato non basta.

## Passo 4 · Il frigo: dai watt ai cicli

Il consumo istantaneo del frigo dice poco. Quello che conta è come lavora il compressore. Con una presa con misura di potenza sul frigo (o i cicli riconosciuti dalla guida 04):

1. **Cicli:** il compressore è "acceso" sopra una soglia (es. 50 W). Ogni passaggio spento → acceso → spento è un ciclo.
2. **Per ogni giorno:** numero di cicli, durata media, **duty cycle** (percentuale del tempo acceso).
3. Queste tre serie giornaliere sono quelle da sorvegliare.

Quando un frigo invecchia, la guarnizione cede o la porta resta socchiusa, il duty cycle sale. Lentamente: il passo 3 non se ne accorge, perché ogni giorno è solo un po' peggio del precedente. Per questo serve il passo 5.

## Passo 5 · CUSUM, per le derive lente

CUSUM (*cumulative sum*) accumula le piccole deviazioni nella stessa direzione:

```
μ₀ = valore normale (mediana delle ultime 4 settimane, calcolata una volta e poi tenuta ferma)
σ  = variabilità normale (1,4826 × MAD)
k  = 0,5 σ        → tolleranza: deviazioni più piccole di così non contano
h  = 5 σ          → soglia di allarme

S₀ = 0
Sₜ = max(0, Sₜ₋₁ + (xₜ − μ₀ − k))
allarme se Sₜ > h
```

Se il frigo un giorno lavora un po' di più e il giorno dopo un po' di meno, S torna verso zero. Se lavora di più per tanti giorni, S cresce finché supera `h`. Dopo un allarme gestito, riparti da S = 0 e ricalcola μ₀.

**✅ Verifica.** Una serie finta: 30 giorni intorno a 13 min/ora, poi aumento di 0,3 al giorno. CUSUM deve dare l'allarme dopo qualche giorno, il passo 3 no.

## Passo 6 · Il backtest

Prima di accendere un rilevatore, **fallo girare sul passato** e conta quanti avvisi avrebbe mandato. Le ultime 2 settimane le hai nel database di HA, che puoi leggere con la REST API:

```
GET http://127.0.0.1:8123/api/history/period/2026-10-26T00:00:00+01:00?filter_entity_id=sensor.camera_temperatura&minimal_response
Authorization: Bearer HA_TOKEN
```

`backtest.ts` scorre i dati in ordine come se arrivassero dal vivo e stampa ogni avviso che sarebbe partito. Se in 2 settimane ne escono 15, le soglie sono troppo basse: alzale e riprova. L'obiettivo è **meno di un avviso a settimana** che non sia vero.

## Passo 7 · Il feedback

Ogni avviso dei passi 3 e 5 ha il pulsante **[È normale]**. Quando lo premi:

1. salva in `feedback (chiave, ts)`;
2. per quel sensore e quella casella oraria, alza la soglia (es. da 4 a 5);
3. dopo 3 "è normale" sulla stessa cosa in un mese, July ti chiede: "Disattivo questo controllo?".

Gli avvisi che nessuno ascolta sono peggio di nessun avviso: abituano a ignorarli tutti.

---

## Trappole

- **Troppi allarmi la prima settimana.** Backtest (passo 6) e partenza in modalità ombra, come nella guida 02: per una settimana gli avvisi dei passi 3–5 finiscono solo nel log.
- **Cambi di stagione.** Ottobre non è luglio: la finestra di 4–6 settimane si adatta da sola, ma nelle settimane di passaggio aspettati qualche falso allarme.
- **Ospiti, vacanze, feste.** Con la 02, sospendi i controlli "fuori dal solito" quando nessuno è in casa da più di un giorno (o tienili, per le vacanze: dipende da cosa vuoi sapere).
- **Lo stesso problema da tre rilevatori.** Usa chiavi che descrivono il *problema*, non il rilevatore, così `notify` li raggruppa.

## Per andare oltre

- **Spiegazioni con Qwen:** dato l'avviso in forma strutturata (sensore, valore, solito, da quando), il modello scrive due righe di possibili cause. È un buon uso del modello: non decide niente e la lentezza non conta.
- **Correlazioni:** l'umidità del bagno sale e non scende entro un'ora → ventola rotta o finestra chiusa?

## Fonti

- ✔︎ Home Assistant, REST `/api/history/period`: https://developers.home-assistant.io/docs/api/rest
- MAD: https://en.wikipedia.org/wiki/Median_absolute_deviation (da verificare)
- CUSUM: https://en.wikipedia.org/wiki/CUSUM (da verificare)
