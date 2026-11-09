# Architettura

Com'è fatto July oggi, come sarà quando i progetti della roadmap saranno pronti, e le regole per farci stare dentro tutto senza confusione.

---

## 1 · Oggi

```
iPhone (Telegram)
   │  passa dai server di Telegram
   ▼
july-api              server Bot API locale (Docker, porta 8081), per i file grandi
   ▼
July                  Bun + grammY, servizio systemd "july", ~/july sul Pi
 ├── upload.ts        file → cartelle inbox → timer beets / mnamer
 ├── admin.ts         /status /disk /import /restart
 ├── memory.ts        ricordi → /mnt/storage/july/memory/<ID>.json
 ├── users.ts         persone, ruoli, chiavi Immich
 └── ai.ts            domande → Ollama (10.89.0.10:11434, rete "llm" senza internet)
```

I gestori sono registrati in `index.ts` in quest'ordine: upload → admin → link e `/start` → memoria → AI. Il primo che gestisce un messaggio si ferma lì.

---

## 2 · Dove si va: cinque strati

```
┌────────────────────────────────────────────────────────────────────────┐
│ INGRESSI   chat privata · gruppo famiglia · vocali · Mini App          │
│            eventi della casa · orari                                   │
├────────────────────────────────────────────────────────────────────────┤
│ ROUTER     gestisciTesto(ctx, testo) : chi è? in quale spazio?         │
│            comandi → memoria → casa → famiglia → AI                    │
├────────────────────────────────────────────────────────────────────────┤
│ FUNZIONI   funzioni/<nome>/   una cartella per progetto                │
├────────────────────────────────────────────────────────────────────────┤
│ CORE       db · notify · scheduler · confirm · spazi · pesante         │
│            ha · mqtt                                                   │
├────────────────────────────────────────────────────────────────────────┤
│ SERVIZI    Ollama · whisper · Home Assistant · Mosquitto · Zigbee2MQTT │
│            Immich · Nextcloud · Open-Meteo (unico esterno)             │
└────────────────────────────────────────────────────────────────────────┘
```

**Regole tra strati:**

- Ogni strato usa solo quello sotto. `core/` non importa mai da `funzioni/`.
- Una funzione non importa da un'altra funzione direttamente. Se G07 deve sapere chi è in casa, usa l'API pubblica di G02 (`funzioni/presenza/index.ts`), mai i suoi file interni.
- Il router è l'unico posto che decide dove va un testo. Vocali, Mini App e chat passano tutti da `gestisciTesto` (vedi G08, passo 3).

### Struttura del repository

```
JulyTheBot/
├── index.ts               avvio, registrazione dei gestori
├── features/              quelle di oggi (upload, admin, memory, ai, users)
├── core/                  pezzi comuni (G00)
├── funzioni/
│   ├── watchdog/          G09
│   ├── promemoria/        FA02
│   ├── famiglia/          FA01 e le funzioni condivise piccole
│   ├── casa/              G01
│   └── ...
├── miniapp/               frontend della Mini App (G06)
├── scripts/               script da lanciare a mano (prove, misure, valutazioni)
├── tests/                 bun test
└── docs/
```

Con il tempo puoi spostare `features/` dentro `funzioni/`. Non è urgente: fallo in un branch a parte, quando non stai lavorando ad altro.

---

## 3 · Persone, ruoli e spazi

Oggi ogni persona ha un compartimento privato (ricordi, conversazione). La famiglia aggiunge uno **spazio comune**.

| Concetto | Cos'è | Dove |
| --- | --- | --- |
| **Persona** | un ID Telegram con nome e ruolo | `users.ts` |
| **Ruolo** | `admin` o `member`: cosa può fare | `users.ts` |
| **Famiglia** | le persone che condividono lo spazio comune | `users.ts`, campo nuovo `famiglia: true` |
| **Spazio** | a chi appartiene un dato: `u:<ID>` (privato) o `famiglia` | colonna `spazio` in ogni tabella |
| **Gruppo** | la chat Telegram di famiglia, collegata allo spazio `famiglia` | tabella `gruppi` |

**Regole:**

1. **Ogni riga di dati ha uno spazio.** Nessuna eccezione: anche le tabelle che oggi sembrano solo personali.
2. **Una sola funzione decide chi vede cosa:** `puoVedere(persona, spazio)` in `core/spazi.ts`. Nessuna funzione scrive i propri controlli.
3. **Nel gruppo, solo lo spazio comune.** Quando July risponde nel gruppo, l'AI **non riceve** i ricordi privati di chi scrive: li leggerebbero tutti.
4. **I dati privati non si spostano da soli nello spazio comune.** Solo se la persona lo chiede.
5. **Le eccezioni sono esplicite.** Le idee regalo (FA14) sono comuni ma nascoste a una persona: una regola scritta e testata, non un caso particolare sparso nel codice.

### Il gruppo di famiglia

- **Privacy mode attiva** (è il predefinito di @BotFather): nei gruppi July riceve solo comandi, risposte ai suoi messaggi e menzioni. Non legge le chiacchiere.
- **Solo gruppi registrati.** Un admin collega il gruppo con `/collega`. Se July viene aggiunto a un gruppo non registrato, esce (`ctx.leaveChat()`).
- Dopo aver aggiunto July al gruppo, su @BotFather disattiva `/setjoingroups`: nessun altro potrà aggiungerlo ad altri gruppi.
- Le cose personali (promemoria privati, Wi‑Fi ospiti, foto) si mandano **in privato**, anche se la richiesta arriva dal gruppo.

---

## 4 · Dati

| Cosa | Dove | Formato |
| --- | --- | --- |
| Ricordi | `/mnt/storage/july/memory/<ID>.json` | JSON (oggi) |
| Tutto il resto di July | `/mnt/storage/july/july.db` | SQLite, modalità WAL (G00) |
| Alias della casa | `/mnt/storage/july/casa-alias.json` | JSON (G01) |
| Firmware dei sensori | `/mnt/storage/july/firmware/` | file `.bin` (G05) |
| Home Assistant, Mosquitto, Zigbee2MQTT | `/mnt/storage/casa/…` | configurazioni loro (G00 B) |
| Stati temporanei (battito, code) | `/run/july/` | RAM, sparisce al riavvio (G09) |

**Convenzioni:**

- Date e ore come **numeri in millisecondi** (`Date.now()`). Si convertono in ora italiana solo per mostrarle o per i calcoli sul calendario (fasce, abitudini), sempre con il fuso `Europe/Rome`.
- **Soldi in centesimi, come numeri interi.** Mai decimali: `0.1 + 0.2` in JavaScript non fa `0.3`.
- **Migrazioni numerate** in `core/db.ts`. Una tabella si cambia solo con una migrazione nuova, mai modificando una vecchia.
- **Dati frequenti a blocchi** (buffer di G00), per l'SSD.
- **Conservazione:** ogni tabella ha una regola di pulizia scritta accanto alla migrazione (es. "eventi presenza: 14 giorni").

---

## 5 · Servizi, rete e risorse

| Servizio | Dove | Indirizzo | Internet | CPU | RAM max | Stato |
| --- | --- | --- | --- | --- | --- | --- |
| July | systemd | — | sì (Telegram) | tutti | — | ✅ |
| july-api | Docker | `localhost:8081` | sì | — | 512 MB | ✅ |
| Ollama | Docker, rete `llm` | `10.89.0.10:11434` | **no** | core 2–3 | 5 GB | ✅ |
| whisper | Docker, rete `llm` | `10.89.0.11:8080` | **no** | core 2–3 | 1 GB | G08 |
| Home Assistant | Docker, rete host | `:8123` | solo LAN | — | 1 GB | G00 B |
| Mosquitto | Docker | `:1883` | solo LAN | — | 128 MB | G00 B |
| Zigbee2MQTT | Docker, rete host | `:8099` | no | — | 256 MB | G00 B |
| Mini App | dentro July | `127.0.0.1:3100` → Tailscale `:8443` | — | — | — | G06 |
| Firmware ESP32 | dentro July | LAN `:3200`, link usa e getta | — | — | — | G05 |
| Immich | Docker | `:2283` | — | — | — | ✅ |

**La rete `llm`** è la regola per tutto ciò che elabora i tuoi dati con modelli AI: nessuna strada verso internet. Chi ha bisogno di internet (meteo, Telegram) è July, mai il modello.

**I core 2 e 3** sono per i lavori pesanti, uno alla volta, tramite la coda `core/pesante.ts` (G08). I core 0 e 1 restano per film e musica.

**La RAM** finisce prima della CPU. Prima di aggiungere un servizio, guarda `docker stats --no-stream` e dagli un limite con `--memory`.

---

## 6 · Registri

Un posto solo dove vedere cosa è già usato, così due progetti non si pestano i piedi. **Aggiungi una riga prima di usare un nome nuovo.**

### Comandi Telegram

| Comando | Progetto | Chi | Stato |
| --- | --- | --- | --- |
| `/start` | B | tutti | ✅ |
| `/status` `/disk` `/import` `/restart` | B02 | admin | ✅ |
| `/memoria` `/ricorda` `/dimentica` `/reset` | B03, B04 | persone | ✅ |
| `/lavori` | G00 | admin | 📘 |
| `/salute` `/controlli` | G09 | admin | 📘 |
| `/chi` `/presenza` `/segnali` | G02 | persone (`/segnali` admin) | 📘 |
| `/automazioni` | G03 | admin | 📘 |
| `/consumi` | G04 | persone | 📘 |
| `/sensori` `/aggiorna` `/riavviasensore` | G05 | admin | 📘 |
| `/casa` | G06 | persone | 📘 |
| `/foto` `/accaddeoggi` | G10 | persone | 📘 |
| `/briefing` | G11 | persone | 📘 |
| `/collega` | FA01 | admin, nel gruppo | 📝 |
| `/promemoria` | FA02 | persone | 📝 |
| `/scadenze` | FA04 | famiglia | 📝 |
| `/turni` | FA05 | famiglia | 📝 |
| `/cena` | FA06 | famiglia | 📝 |
| `/spesa` | FA07 | famiglia | 📝 |
| `/dispensa` | FA08 | famiglia | 📝 |
| `/spese` `/pareggia` | FA09 | famiglia | 📝 |
| `/wifi` | FA12 | famiglia | 📝 |
| `/manutenzione` | FA13 | famiglia | 📝 |
| `/regali` | FA14 | famiglia, solo in privato | 📝 |

Esempio di a cosa serve il registro: per i sensori ESP32 il comando si chiama `/riavviasensore` e non `/riavvia`, che sarebbe stato troppo simile a `/restart` dei container.

### Prefissi delle callback (pulsanti)

Al massimo 64 byte in tutto: prefisso corto, poi un id.

| Prefisso | Progetto | Significato |
| --- | --- | --- |
| `mute:` | G00 notify | silenzia un avviso |
| `ok:` `no:` | G00 confirm | conferma / annulla |
| `sc:` | G01 | scelta tra più dispositivi |
| `pag:` | G10 | pagina successiva |
| `prop:` | G03 | risposta a una proposta |
| `nilm:` | G04 | etichetta di un consumo |
| `pr:` | FA02 | fatto / rimanda un promemoria |
| `cena:` | FA06 | risposta al sondaggio |
| `sp:` | FA07 | spunta un prodotto |
| `allarme:` | FA11 | "ci penso io" |

### Variabili del `.env`

| Variabile | Progetto | Stato |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN`, `AI_MODEL`, `OLLAMA_URL`, `MEMORY_DIR` | B | ✅ |
| `IMMICH_URL`, `IMMICH_KEY_<NOME>` | B07, G10 | ✅ |
| `IMMICH_PUBLIC_URL` | G10 | 📘 |
| `HA_URL`, `HA_TOKEN`, `HA_TOKEN_AUTO` | G00 B | 📘 |
| `MQTT_PASS` | G05 | 📘 |
| `WHISPER_URL` | G08 | 📘 |
| `POTENZA_SOGLIA_W`, `POTENZA_DURATA_S`, `PREZZO_F1`, `PREZZO_F2`, `PREZZO_F3` | G04 | 📘 |
| `MINIAPP_URL` | G06 | 📘 |
| `NEXTCLOUD_DAV_URL`, `NEXTCLOUD_USER_<NOME>`, `NEXTCLOUD_APPPASS_<NOME>` | G11 | 📘 |
| `WIFI_OSPITI_SSID`, `WIFI_OSPITI_PASS` | FA12 | 📝 |

---

## 7 · Convenzioni di codice

- **Nomi in italiano** per funzioni, variabili e tabelle del dominio (`promemoria`, `chiediConferma`); in inglese solo quello che viene da librerie e API.
- **Commenti che spiegano il perché**, non il cosa.
- **Una funzione, un compito.** I controlli e i calcoli sono funzioni pure, senza Telegram né rete dentro: si testano con `bun test`.
- **Niente testo dei messaggi nei log.** Solo errori, tempi, azioni eseguite.
- **Mai testo della chat dentro un comando di shell.** I comandi sono sempre fissi.
- **Ogni funzione nuova ha:** una guida o una scheda in `docs/`, una riga nei registri qui sopra, almeno un test.
