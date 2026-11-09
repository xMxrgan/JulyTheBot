# 00 · Fondamenta

Due parti. La **parte A** aggiunge a July quattro moduli comuni che usano tutte le altre guide. La **parte B** installa la casa: Home Assistant, Mosquitto e Zigbee2MQTT, più il client con cui July parla a Home Assistant.

**Cosa impari:** migrazioni SQLite, scritture a blocchi, anti-spam degli avvisi, lavori a orario con fuso orario, conferme con pulsanti inline, un client WebSocket con richieste e risposte abbinate per id e riconnessione automatica.

---

## Parte A · Il telaio di July

### Struttura delle cartelle

Oggi July ha `index.ts` e `features/` con `upload.ts`, `admin.ts`, `memory.ts`, `ai.ts`, `users.ts`. Aggiungi:

```
JulyTheBot/
├── index.ts
├── core/                 ← nuovo: pezzi comuni a tutte le funzioni
│   ├── db.ts             database SQLite condiviso
│   ├── notify.ts         avvisi con anti-spam
│   ├── scheduler.ts      lavori a orario
│   ├── confirm.ts        pulsanti "Conferma / Annulla"
│   └── ha.ts             client Home Assistant (parte B)
├── features/             ← quelle che hai già
└── funzioni/             ← una cartella per ogni guida
    ├── casa/             guida 01
    ├── watchdog/         guida 09
    └── ...
```

Regola: `core/` non importa mai da `funzioni/`. Le funzioni importano da `core/`. Così eviti dipendenze circolari.

---

### A1 · `core/db.ts`: un solo database

**Obiettivo.** Un file SQLite, `/mnt/storage/july/july.db`, aperto una volta e condiviso da tutte le funzioni.

**Perché SQLite e non i JSON come per i ricordi.** I ricordi sono pochi e li leggi tutti insieme. Eventi, letture di potenza e storico degli avvisi sono migliaia di righe da filtrare per data: serve un database. Bun ha SQLite integrato (`bun:sqlite`), quindi nessuna dipendenza nuova.

**Cosa fare.**

1. Apri il database con `create: true` e attiva la modalità WAL: letture e scritture non si bloccano a vicenda e le scritture sono più leggere per l'SSD.
2. Scrivi un sistema di **migrazioni**: un array di stringhe SQL e una tabella `schema_version` che ricorda fino a quale sei arrivato. All'avvio applichi solo quelle nuove, in una transazione. Ogni guida ti dirà "aggiungi questa migrazione".
3. Scrivi un **buffer di scrittura**: una funzione `bufferedInsert(tabella, riga)` che accumula le righe in RAM e le scrive tutte insieme ogni 30 secondi (o quando sono 500). Lo useranno le funzioni che producono dati spesso, come l'energia (04).

**Esempio** (API di `bun:sqlite`, non il tuo schema):

```ts
import { Database } from 'bun:sqlite'

// create: true crea il file se non esiste
const db = new Database('/mnt/storage/july/july.db', { create: true })
db.run('PRAGMA journal_mode = WAL')

// Statement preparato: SQL compilato una volta, eseguito tante volte
const inserisci = db.prepare('INSERT INTO esempio (ts, valore) VALUES (?, ?)')

// db.transaction restituisce una funzione: tutte le righe in una sola scrittura su disco
const inserisciTutte = db.transaction((righe: { ts: number; valore: number }[]) => {
  for (const r of righe) inserisci.run(r.ts, r.valore)
})

// Lettura: .all() restituisce un array di oggetti
const ultime = db.query('SELECT * FROM esempio WHERE ts > ?').all(Date.now() - 3600_000)
```

Le date salvale come **numeri** (millisecondi da `Date.now()`), non come testo: confronti e ordinamenti sono più semplici e veloci.

**✅ Verifica.** Dopo il primo avvio sul Pi:

```bash
sudo apt install -y sqlite3 && sqlite3 /mnt/storage/july/july.db 'SELECT * FROM schema_version;'
```

Deve stampare il numero dell'ultima migrazione.

> **Se ti blocchi** con le migrazioni: leggi `MAX(versione)` da `schema_version` (0 se vuota), poi per ogni indice `i` maggiore esegui `MIGRAZIONI[i]` e inserisci `i` in `schema_version`, tutto dentro `db.transaction`.

---

### A2 · `core/notify.ts`: avvisi che non diventano spam

**Obiettivo.** Una funzione che tutte le guide usano per avvisarti, con regole comuni: niente doppioni, niente notifiche notturne non urgenti, pulsante per silenziare.

**Interfaccia da implementare:**

```ts
type Gravita = 'info' | 'avviso' | 'critico'

interface Avviso {
  chiave: string            // identifica il problema, es. 'disco:/mnt/storage'
  gravita: Gravita
  testo: string
  a: 'admin' | 'tutti' | number[]   // a chi mandarlo (ID Telegram)
  attesaMinuti?: number     // non ripetere prima di questi minuti (predefinito 60)
}

function initNotify(bot: Bot): void          // salva il bot per usare bot.api
function notifica(a: Avviso): Promise<void>
function risolto(chiave: string, testo?: string): Promise<void>
```

**Regole:**

1. **Stessa chiave, niente doppioni.** Se un avviso con quella chiave è già stato mandato da meno di `attesaMinuti`, non rimandarlo.
2. **`risolto()`** manda "✅ risolto" solo se prima era partito un avviso con quella chiave. Così ricevi l'inizio e la fine di un problema, non i passaggi intermedi.
3. **Ore di silenzio**, 23–7: `info` e `avviso` aspettano la mattina e arrivano tutti insieme in un messaggio solo. `critico` arriva sempre.
4. **Pulsanti** sotto ogni avviso: "Silenzia 1 h" e "Silenzia 1 giorno", con callback data `mute:<chiave>:<minuti>`.
5. **Stato su SQLite**, tabella `avvisi (chiave, gravita, primo_invio, ultimo_invio, silenziato_fino)`, così un riavvio di July non rimanda tutto.

**Esempio** (grammY, invio con pulsanti):

```ts
import { InlineKeyboard } from 'grammy'

const pulsanti = new InlineKeyboard()
  .text('Silenzia 1 h', `mute:${chiave}:60`)
  .text('Silenzia 1 giorno', `mute:${chiave}:1440`)

await bot.api.sendMessage(idTelegram, testo, { reply_markup: pulsanti })
```

Attenzione: la callback data può essere lunga **al massimo 64 byte**. Se le chiavi possono essere lunghe, salva la chiave in una mappa e metti nel pulsante un id corto.

**✅ Verifica.** Un comando di prova `/provaavviso` che chiama `notifica` due volte di fila con la stessa chiave: deve arrivare un solo messaggio. Poi premi "Silenzia 1 h" e richiamalo: niente messaggio.

---

### A3 · `core/scheduler.ts`: lavori a orario

**Obiettivo.** Un posto unico dove registrare i lavori periodici ("ogni 5 minuti", "ogni giorno alle 7:30").

**Perché croner e non `setInterval`.** `setInterval` non sa cos'è "le 7:30 di ogni lunedì", non gestisce l'ora legale e, se un lavoro dura più del suo intervallo, ne fa partire un secondo in parallelo. croner fa tutte e tre le cose, e con `protect: true` salta l'esecuzione se la precedente è ancora in corso.

```bash
bun add croner
```

**Interfaccia:**

```ts
function ogni(nome: string, cron: string, lavoro: () => Promise<void>): void
function elencoLavori(): { nome: string; prossima: Date | null }[]
```

**Esempio** (API di croner):

```ts
import { Cron } from 'croner'

// '30 7 * * *' = minuto 30, ora 7, ogni giorno
const job = new Cron('30 7 * * *', { timezone: 'Europe/Rome', protect: true }, async () => {
  // il tuo lavoro; avvolgilo in try/catch: un errore qui non deve fermare July
})

job.nextRun() // Date della prossima esecuzione
```

Dentro `ogni()` metti il `try/catch` una volta sola, così nessun lavoro può far cadere il bot, e registra nel log solo nome del lavoro ed errore.

**✅ Verifica.** Un comando admin `/lavori` che mostra l'elenco con la prossima esecuzione di ciascuno.

---

### A4 · `core/confirm.ts`: "Sei sicuro?"

**Obiettivo.** Prima di un'azione pericolosa, July chiede conferma con due pulsanti. L'azione parte solo se la conferma arriva **dalla stessa persona**, **entro 60 secondi**, **una sola volta**.

**Interfaccia:**

```ts
function chiediConferma(
  ctx: Context,
  domanda: string,                 // es. "Apro la serratura della porta d'ingresso?"
  azione: () => Promise<string>,   // restituisce il testo da mostrare dopo
): Promise<void>
```

**Come funziona:**

1. Genera un id corto (`crypto.randomUUID().slice(0, 8)`) e salva in una `Map` `{ idUtente, scadenza, azione }`.
2. Manda la domanda con i pulsanti `ok:<id>` e `no:<id>`.
3. Il gestore `bot.callbackQuery(/^(ok|no):(\w+)$/, ...)` cerca l'id, controlla utente e scadenza, **cancella subito l'id dalla mappa** (così un doppio tocco non esegue due volte) e poi esegue o annulla.
4. Modifica il messaggio originale con il risultato (`ctx.editMessageText`), così non restano pulsanti attivi.

La mappa sta in RAM di proposito: se July si riavvia, le conferme in sospeso spariscono. Per un'azione pericolosa è il comportamento giusto.

**✅ Verifica.** Un comando di prova che chiede conferma per mandare "fatto". Prova: conferma normale; tocco doppio veloce (deve eseguire una volta); attesa di 61 secondi (deve dire "scaduta").

---

### A5 · Collegare tutto in `index.ts`

1. All'avvio: apri il database (che applica le migrazioni), chiama `initNotify(bot)`.
2. Registra il gestore delle callback (`mute:`, `ok:`, `no:`) **prima** degli altri gestori.
3. I comandi delle nuove funzioni vanno **prima** di `ai`, come quelli di `admin`: altrimenti il testo finisce al modello.

---

## Parte B · La casa

### Perché Home Assistant

Home Assistant (HA) traduce centinaia di marche e protocolli diversi in un'unica API. July parla solo con HA, quindi non deve sapere se una lampadina è Zigbee, Wi‑Fi o Shelly. Gira tutto in locale, senza cloud.

```
dispositivi Zigbee ──► chiavetta USB ──► Zigbee2MQTT ──┐
                                                       ├──► Mosquitto (MQTT) ──► Home Assistant ◄──► July
sensori ESP32 (guida 05) ──────────────────────────────┘                                      (WebSocket)
```

### B1 · Hardware

- **Una chiavetta Zigbee** (coordinatore). Prima di comprarla controlla che sia nella lista degli adattatori consigliati di Zigbee2MQTT: https://www.zigbee2mqtt.io/guide/adapters/
- **Una prolunga USB di 50 cm–1 m.** Le porte USB 3 e l'SSD disturbano i 2,4 GHz e quindi lo Zigbee. Allontana la chiavetta dal Pi e collegala a una porta USB 2 (quelle nere).

### B2 · Cartelle sull'SSD

```bash
sudo mkdir -p /mnt/storage/casa/homeassistant /mnt/storage/casa/mosquitto/config /mnt/storage/casa/mosquitto/data /mnt/storage/casa/zigbee2mqtt && sudo chown -R morgan:morgan /mnt/storage/casa
```

### B3 · Mosquitto, il "postino" MQTT

MQTT è un protocollo a messaggi: chi pubblica su un *topic* (tipo `zigbee2mqtt/luce_soggiorno`) non sa chi ascolta, e chi si iscrive riceve tutto quello che arriva su quel topic. Mosquitto è il server che smista i messaggi.

**1. Il file di configurazione:**

```bash
cat > /mnt/storage/casa/mosquitto/config/mosquitto.conf << 'EOF'
listener 1883
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl
persistence true
persistence_location /mosquitto/data/
autosave_interval 1800
EOF
```

| Riga | Significato |
| --- | --- |
| `allow_anonymous false` | Senza utente e password non entra nessuno |
| `acl_file` | Chi può leggere e scrivere quali topic |
| `autosave_interval 1800` | Salva su disco ogni 30 minuti, non a ogni messaggio: meno usura dell'SSD |

**2. Chi può fare cosa (ACL):**

```bash
cat > /mnt/storage/casa/mosquitto/config/acl << 'EOF'
user july
topic readwrite #

user ha
topic readwrite #

user z2m
topic readwrite zigbee2mqtt/#
topic readwrite homeassistant/#

# Ogni sensore ESP32 (guida 05) ha un utente uguale al suo nome
# e può scrivere solo nei suoi topic: %u viene sostituito con il nome utente
pattern readwrite july/dev/%u/#
pattern write homeassistant/+/%u/#
EOF
```

**3. Le password**, una alla volta. Il comando te la chiede due volte e non resta nella cronologia della shell. Il primo comando usa `-c`, che crea il file:

```bash
docker run --rm -it -v /mnt/storage/casa/mosquitto/config:/mosquitto/config eclipse-mosquitto:2 mosquitto_passwd -c /mosquitto/config/passwd july
```

```bash
docker run --rm -it -v /mnt/storage/casa/mosquitto/config:/mosquitto/config eclipse-mosquitto:2 mosquitto_passwd /mosquitto/config/passwd ha
```

```bash
docker run --rm -it -v /mnt/storage/casa/mosquitto/config:/mosquitto/config eclipse-mosquitto:2 mosquitto_passwd /mosquitto/config/passwd z2m
```

**4. Permessi e avvio.** Il container gira con l'utente `mosquitto` (id 1883), che deve poter leggere i file:

```bash
sudo chown -R 1883:1883 /mnt/storage/casa/mosquitto && sudo chmod 0700 /mnt/storage/casa/mosquitto/config/passwd /mnt/storage/casa/mosquitto/config/acl
```

```bash
docker run -d --name mosquitto --restart unless-stopped -p 1883:1883 -v /mnt/storage/casa/mosquitto/config:/mosquitto/config -v /mnt/storage/casa/mosquitto/data:/mosquitto/data --memory=128m eclipse-mosquitto:2
```

**✅ Verifica.** Nel log non devono esserci errori di permessi:

```bash
docker logs mosquitto --tail 20
```

### B4 · Zigbee2MQTT

**1. Trova il percorso stabile della chiavetta.** Quello in `/dev/serial/by-id/` non cambia tra un riavvio e l'altro, a differenza di `/dev/ttyACM0`:

```bash
ls -l /dev/serial/by-id/
```

**2. La configurazione.** Sostituisci `PASSWORD_Z2M` e `TOKEN_LUNGO_A_CASO`, e scegli `adapter` in base alla chiavetta (la pagina degli adattatori te lo dice: `ember` per i chip Silicon Labs, `zstack` per quelli Texas Instruments):

```bash
cat > /mnt/storage/casa/zigbee2mqtt/configuration.yaml << 'EOF'
homeassistant:
  enabled: true
mqtt:
  server: mqtt://127.0.0.1:1883
  user: z2m
  password: PASSWORD_Z2M
serial:
  port: /dev/ttyACM0
  adapter: ember
frontend:
  enabled: true
  port: 8099
  auth_token: TOKEN_LUNGO_A_CASO
advanced:
  log_level: warning
EOF
```

`auth_token` protegge la pagina web di Zigbee2MQTT. È importante: hai condiviso il Pi con un amico tramite Tailscale, quindi anche lui può raggiungere le sue porte. Vedi "Sicurezza" più sotto.

**3. Avvio.** Sostituisci `usb-XXXX` con il nome trovato al punto 1:

```bash
docker run -d --name zigbee2mqtt --restart unless-stopped --network host --device /dev/serial/by-id/usb-XXXX:/dev/ttyACM0 -v /mnt/storage/casa/zigbee2mqtt:/app/data -v /run/udev:/run/udev:ro -e TZ=Europe/Rome --memory=256m ghcr.io/koenkk/zigbee2mqtt
```

**✅ Verifica.** Apri `http://mcloud:8099`, inserisci il token, premi "Permit join" e accoppia un dispositivo. Poi guarda i messaggi che arrivano:

```bash
docker exec -it mosquitto mosquitto_sub -u july -P 'PASSWORD_JULY' -t 'zigbee2mqtt/#' -v
```

### B5 · Home Assistant

**1. Avvio** (rete `host`, così vede i dispositivi della rete di casa):

```bash
docker run -d --name homeassistant --restart unless-stopped --network host -e TZ=Europe/Rome -v /mnt/storage/casa/homeassistant:/config -v /run/dbus:/run/dbus:ro --memory=1g ghcr.io/home-assistant/home-assistant:stable
```

La documentazione di HA aggiunge `--privileged`, che serve per Bluetooth e USB diretti. Qui lo Zigbee passa da Zigbee2MQTT, quindi puoi farne a meno e il container ha meno poteri sul Pi.

**2. Prima configurazione.** Apri `http://mcloud:8123` e crea il tuo account. Poi *Impostazioni → Dispositivi e servizi → Aggiungi integrazione → MQTT*: broker `127.0.0.1`, porta `1883`, utente `ha`.

**3. Meno scritture sull'SSD.** HA salva ogni cambio di stato nel suo database. Aggiungi in fondo a `configuration.yaml`:

```bash
nano /mnt/storage/casa/homeassistant/configuration.yaml
```

```yaml
recorder:
  purge_keep_days: 14     # tiene 14 giorni di storico invece di 10, ma vedi sotto
  commit_interval: 30     # scrive su disco ogni 30 secondi invece che ogni 5
```

`commit_interval` è quello che conta per l'usura: tante piccole scritture diventano una ogni 30 secondi. 14 giorni di storico servono alla guida 07 per confrontare i valori.

```bash
docker restart homeassistant
```

**4. Due utenti per July.** In *Impostazioni → Persone → Utenti* crea due utenti **non amministratori**: `july` e `july-auto`. Entra con ciascuno, vai nel profilo → *Sicurezza* → *Token di accesso a lunga durata* e creane uno. Mettili nel `.env` di July con nano:

```
HA_URL=http://127.0.0.1:8123
HA_TOKEN=token_dell_utente_july
HA_TOKEN_AUTO=token_dell_utente_july-auto
```

Perché due: `july` esegue i comandi che dai tu, `july-auto` quelli che July decide da solo (automazioni, guida 03). Home Assistant scrive in ogni cambio di stato quale utente l'ha causato, e la guida 03 lo usa per non "imparare" dalle proprie azioni.

### B6 · `core/ha.ts`: July parla con Home Assistant

È il pezzo più delicato della parte B: tutte le guide della casa lo usano.

**Perché WebSocket e non solo REST.** Con la REST API puoi chiedere lo stato e comandare, ma per sapere quando qualcosa cambia dovresti chiedere di continuo. Con la WebSocket API resti collegato e HA ti avvisa a ogni cambio.

**Il protocollo** (dalla documentazione ufficiale):

```jsonc
// 1. Ti colleghi a ws://127.0.0.1:8123/api/websocket e HA scrive:
{ "type": "auth_required" }
// 2. Rispondi con il token:
{ "type": "auth", "access_token": "IL_TOKEN" }
// 3. HA conferma:
{ "type": "auth_ok" }

// Da qui ogni tua richiesta ha un "id" numerico crescente, e la risposta ha lo stesso id:
{ "id": 1, "type": "get_states" }
{ "id": 1, "type": "result", "success": true, "result": [ /* tutti gli stati */ ] }

{ "id": 2, "type": "subscribe_events", "event_type": "state_changed" }
// Poi, a ogni cambio, arriva un messaggio con lo stesso id 2:
{ "id": 2, "type": "event", "event": { "data": { "entity_id": "...", "old_state": {}, "new_state": {} } } }

{ "id": 3, "type": "call_service", "domain": "light", "service": "turn_off",
  "target": { "entity_id": "light.soggiorno" } }
```

**Interfaccia da implementare:**

```ts
interface StatoHA {
  entity_id: string
  state: string                          // sempre testo: 'on', 'off', '21.5', 'unavailable'
  attributes: Record<string, unknown>    // friendly_name, unit_of_measurement, brightness...
  last_changed: string
  context: { id: string; user_id: string | null; parent_id: string | null }
}

function connettiHA(): Promise<void>
function stato(entityId: string): StatoHA | undefined          // dalla cache, istantaneo
function tuttiGliStati(): StatoHA[]
function chiamaServizio(dominio: string, servizio: string,
                        target: { entity_id: string | string[] },
                        dati?: Record<string, unknown>): Promise<void>
function suCambio(cb: (vecchio: StatoHA | null, nuovo: StatoHA) => void): () => void  // restituisce la funzione per disiscriversi
function richiesta<T>(msg: Record<string, unknown>): Promise<T>  // per tutto il resto
```

**Come costruirlo, in ordine:**

1. **Le richieste abbinate per id.** Un contatore `prossimoId` e una `Map<number, { resolve, reject, timer }>`. `richiesta()` assegna l'id, salva le due funzioni della Promise e manda il messaggio. Quando arriva un `result` con quell'id, chiami `resolve` (o `reject` se `success` è falso) e cancelli la voce. Un timer di 10 secondi rifiuta la Promise se la risposta non arriva mai.
2. **La cache degli stati.** All'avvio `get_states` riempie una `Map<entity_id, StatoHA>`. Ogni evento `state_changed` la aggiorna e chiama le funzioni registrate con `suCambio`.
3. **La riconnessione.** Quando la connessione si chiude, rifiuta tutte le richieste in attesa e riprova dopo 1 s, poi 2, 4, 8... fino a 60 s (*backoff esponenziale*). Dopo ogni riconnessione **rifai** `get_states` e la sottoscrizione: gli eventi persi mentre eri scollegato non tornano.
4. **Il battito.** Ogni 30 secondi manda `{ "type": "ping" }` con un id; se il `pong` non arriva entro 10 secondi, chiudi e riconnetti. Serve per accorgersi delle connessioni "morte" che non si chiudono da sole.

**Esempio** (WebSocket di Bun, che è lo stesso del browser):

```ts
const ws = new WebSocket('ws://127.0.0.1:8123/api/websocket')

ws.addEventListener('message', (evento) => {
  const msg = JSON.parse(String(evento.data))
  // msg.type: 'auth_required' | 'auth_ok' | 'auth_invalid' | 'result' | 'event' | 'pong'
})

ws.addEventListener('close', () => {
  // qui parte la riconnessione
})
```

**Le stanze.** Il nome della stanza di un'entità non sta nello stato. Si legge dai registri di HA:

- `config/entity_registry/list_for_display` (documentata): per ogni entità `ei` = entity_id e `ai` = id della stanza, se assegnata direttamente all'entità.
- Se `ai` manca, la stanza è quella del **dispositivo** a cui appartiene l'entità (`di`). Per questo servono anche `config/device_registry/list` e `config/area_registry/list`. Queste due non sono nella documentazione pubblica (le usa l'interfaccia di HA): provale e guarda la forma della risposta prima di fidarti.

Scrivi una funzione `stanzaDi(entityId): string | null` che segue questa regola. La guida 01 la usa per capire "la luce della cucina".

**✅ Verifica.** Uno script `scripts/prova-ha.ts`:

```bash
bun run scripts/prova-ha.ts
```

Deve stampare quante entità ci sono, poi ogni cambio di stato per un minuto: accendi e spegni una luce e controlla che compaia. Poi `docker restart homeassistant` mentre lo script gira: deve riconnettersi da solo e ricominciare a stampare.

> **Se ti blocchi** con le Promise abbinate per id:
> ```ts
> function richiesta<T>(msg: Record<string, unknown>): Promise<T> {
>   const id = ++prossimoId
>   return new Promise<T>((resolve, reject) => {
>     const timer = setTimeout(() => { inAttesa.delete(id); reject(new Error('timeout')) }, 10_000)
>     inAttesa.set(id, { resolve, reject, timer })
>     ws.send(JSON.stringify({ ...msg, id }))
>   })
> }
> // nel gestore dei messaggi, per i 'result': trova inAttesa.get(msg.id), clearTimeout, resolve o reject, delete
> ```

Esiste una libreria ufficiale, `home-assistant-js-websocket`, che fa tutto questo. Scriverlo da te ti insegna come funzionano davvero richieste asincrone e riconnessioni; se un giorno vuoi meno codice da mantenere, puoi passare a quella.

### Sicurezza

- **L'amico con cui condividi il Pi su Tailscale** raggiunge tutte le porte di `mcloud`, non solo Immich: anche 8123 (HA), 8099 (Zigbee2MQTT) e 1883 (Mosquitto). Tutti e tre chiedono una password o un token, ma la soluzione pulita è limitare con le regole di accesso di Tailscale (ACL o *grants*) cosa può raggiungere il suo account: solo la porta di Immich. Cerca "sharing" e "ACL" nella documentazione di Tailscale.
- **Il token di HA è potente quanto l'utente** a cui appartiene. Per questo `july` e `july-auto` non sono amministratori.
- **Niente cloud dei dispositivi.** Molti prodotti Wi‑Fi funzionano solo con l'app del produttore. Prima di comprare, controlla che abbiano un'integrazione locale in HA.

---

## Fonti

- ✔︎ Home Assistant WebSocket API: https://developers.home-assistant.io/docs/api/websocket
- ✔︎ Home Assistant REST API: https://developers.home-assistant.io/docs/api/rest
- ✔︎ Zigbee2MQTT, topic e messaggi: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
- ✔︎ croner: https://github.com/Hexagon/croner
- Home Assistant in Docker: https://www.home-assistant.io/installation/linux (da verificare)
- Zigbee2MQTT in Docker e adattatori: https://www.zigbee2mqtt.io/guide/installation/02_docker.html (da verificare)
- Mosquitto, configurazione e ACL: https://mosquitto.org/man/mosquitto-conf-5.html (da verificare)
- SQLite in Bun: https://bun.sh/docs/api/sqlite (da verificare)
- grammY, callback query: https://grammy.dev/plugins/keyboard (✔︎)
