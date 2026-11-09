# 05 · Sensori ESP32

## Cosa fa

```
Tu:    /sensori
July:  📡 4 sensori
       🟢 studio      fw 1.3.0 · 21,4 °C 51% · Wi‑Fi −58 dBm · visto ora
       🟢 camera      fw 1.3.0 · 19,1 °C 55% · Wi‑Fi −71 dBm · visto 1 min fa
       🟢 bagno       fw 1.2.0 · 23,0 °C 78% · Wi‑Fi −66 dBm · visto ora
       🔴 balcone     fw 1.2.0 · offline da 2 h

Tu:    /aggiorna bagno
July:  ⬆️ Aggiorno "bagno" da 1.2.0 a 1.3.0?   [✅ Conferma] [❌ Annulla]
July:  ✅ "bagno" aggiornato a 1.3.0 e di nuovo online (42 s).

July:  🔴 Il sensore "balcone" è offline da 10 minuti.
```

## Cosa impari

Programmazione embedded in C++ con PlatformIO, Wi‑Fi e MQTT su microcontrollore, il *Last Will* di MQTT per sapere quando un dispositivo muore, l'autodiscovery di Home Assistant, aggiornamenti firmware via rete (OTA) con controllo d'integrità, permessi per dispositivo su Mosquitto.

## Prerequisiti

- Guida 00, parti A e B (Mosquitto con il file ACL).
- Una scheda ESP32 (per esempio ESP32-S3 DevKit o una "ESP32 DevKit" classica) e un sensore di temperatura e umidità I²C (SHT31, SHT4x o BME280).
- PlatformIO sul Mac: l'estensione di VS Code, oppure da terminale `brew install platformio`.

### Due strade

| | ESPHome | Firmware tuo (questa guida) |
| --- | --- | --- |
| Come | file YAML, compila tutto lui | C++ scritto da te |
| Quando | sensori standard, come gli LD2410 della guida 02 | quando vuoi capire e controllare tutto |
| OTA | sì, dai suoi strumenti | sì, da July, lo costruisci tu |

Puoi usarle insieme: ESPHome per i sensori di presenza, firmware tuo per questo progetto.

---

## Architettura

```
ESP32 ──Wi‑Fi──► Mosquitto ◄──► July  (registro sensori, avvisi, OTA)
                    │
                    └──────► Home Assistant (autodiscovery: i sensori compaiono da soli)

OTA:  July ──"aggiorna, scarica qui, MD5 = ..."──► ESP32
      ESP32 ──HTTP GET──► July (file .bin, link usa e getta) ──► scrive, controlla MD5, riavvia
```

### I topic

| Topic | Chi scrive | Contenuto | Retained |
| --- | --- | --- | --- |
| `july/dev/<id>/stato` | ESP32 | `online` / `offline` (il secondo lo scrive Mosquitto, vedi LWT) | sì |
| `july/dev/<id>/dati` | ESP32 | `{"t":21.4,"h":51,"rssi":-58,"fw":"1.3.0","up":3600}` | sì |
| `july/dev/<id>/cmd` | July | `{"azione":"ota","url":"...","md5":"..."}` o `{"azione":"riavvia"}` | no |
| `july/dev/<id>/ack` | ESP32 | `{"azione":"ota","esito":"ok"}` | no |

*Retained* = Mosquitto tiene l'ultimo messaggio e lo dà subito a chi si iscrive dopo. July, appena avviato, conosce già l'ultimo stato di ogni sensore.

---

## Parte ESP32

### Passo 1 · Il progetto

```ini
; platformio.ini
[env:esp32]
platform = espressif32
board = esp32dev                 ; cambialo con la tua scheda
framework = arduino
monitor_speed = 115200
build_flags = -D FW_VERSION=\"1.0.0\"
lib_deps =
  knolleary/PubSubClient
  bblanchon/ArduinoJson
```

Password Wi‑Fi e MQTT in `include/segreti.h`, **aggiunto a `.gitignore`**:

```cpp
// include/segreti.h — NON va in git
#define WIFI_SSID   "..."
#define WIFI_PASS   "..."
#define MQTT_HOST   "192.168.1.10"   // IP del Pi in rete di casa
#define MQTT_USER   "studio"         // = id del dispositivo, per le ACL
#define MQTT_PASS   "..."
```

**L'utente MQTT del sensore.** Ogni sensore ha il suo utente, con lo stesso nome del suo id, così la regola `pattern` dell'ACL (guida 00) gli permette di scrivere solo nei suoi topic. Sul Pi, cambiando `studio` con l'id:

```bash
docker run --rm -it -v /mnt/storage/casa/mosquitto/config:/mosquitto/config eclipse-mosquitto:2 mosquitto_passwd /mosquitto/config/passwd studio && sudo chown 1883:1883 /mnt/storage/casa/mosquitto/config/passwd && docker kill -s HUP mosquitto
```

`docker kill -s HUP` non ferma Mosquitto: gli dice di rileggere password e ACL.

**✅ Verifica.** Un `setup()` che stampa "ciao" e la versione: `pio run -t upload && pio device monitor`.

### Passo 2 · Wi‑Fi e MQTT che si riconnettono da soli

Struttura del `loop()`: **niente `delay()` lunghi**. Ogni giro controlla:

1. Wi‑Fi connesso? Se no, riprova al massimo ogni 5 secondi.
2. MQTT connesso? Se no, riprova al massimo ogni 5 secondi.
3. `client.loop()` per ricevere i messaggi.
4. Sono passati 60 secondi dall'ultimo invio? Leggi il sensore e pubblica.

Per il punto 4 usa `millis()`: `if (millis() - ultimoInvio >= 60000) { ... }`. La sottrazione funziona anche quando `millis()` riparte da zero dopo 49 giorni.

**Il Last Will (LWT).** Quando ti colleghi, lasci a Mosquitto un "testamento": se sparisci senza salutare, pubblica lui `offline` al posto tuo. Con PubSubClient:

```cpp
// connect(id, utente, password, topicTestamento, qos, retained, messaggioTestamento)
bool ok = mqtt.connect(MQTT_USER, MQTT_USER, MQTT_PASS,
                       "july/dev/studio/stato", 1, true, "offline");
if (ok) {
  mqtt.publish("july/dev/studio/stato", "online", true);   // retained
  mqtt.subscribe("july/dev/studio/cmd");
}
```

**⚠️ Trappola nota:** PubSubClient ha un buffer di **256 byte** per messaggio. I messaggi di autodiscovery (passo 4) sono più lunghi e vengono scartati senza errore. Prima di connetterti: `mqtt.setBufferSize(1024);`.

**✅ Verifica.** Dal Pi, guarda i messaggi; poi stacca l'alimentazione all'ESP32: entro una trentina di secondi deve comparire `offline` (il *keepalive* predefinito di PubSubClient è 15 s e Mosquitto aspetta 1,5 volte tanto prima di dichiararlo morto).

```bash
docker exec -it mosquitto mosquitto_sub -u july -P 'PASSWORD_JULY' -t 'july/dev/#' -v
```

### Passo 3 · Il dato

Leggi il sensore con la sua libreria, costruisci il JSON con ArduinoJson e pubblicalo retained su `july/dev/<id>/dati`. Includi `rssi` (`WiFi.RSSI()`), `fw` (`FW_VERSION`) e `up` (secondi da `millis()`).

### Passo 4 · Autodiscovery di Home Assistant

Se pubblichi (retained) una configurazione su `homeassistant/sensor/<id>/<oggetto>/config`, il sensore compare in HA da solo:

```json
{
  "name": "Temperatura",
  "unique_id": "studio_t",
  "state_topic": "july/dev/studio/dati",
  "value_template": "{{ value_json.t }}",
  "device_class": "temperature",
  "unit_of_measurement": "°C",
  "availability_topic": "july/dev/studio/stato",
  "device": { "identifiers": ["july_studio"], "name": "Sensore studio", "sw_version": "1.3.0" }
}
```

Una configurazione per ogni misura (temperatura, umidità, segnale). Il topic contiene l'id del dispositivo, e la regola `pattern write homeassistant/+/%u/#` dell'ACL della guida 00 permette a ogni sensore di scrivere solo le sue.

### Passo 5 · OTA

Quando arriva `{"azione":"ota","url":"...","md5":"..."}` su `cmd`:

1. Pubblica su `ack` `{"azione":"ota","esito":"inizio"}`.
2. Scarica con `HTTPClient` e leggi la lunghezza (`http.getSize()`).
3. Con la libreria `Update` (inclusa nel core Arduino dell'ESP32):
   - `Update.begin(lunghezza)` prepara la partizione libera;
   - `Update.setMD5(md5)` dice qual è l'impronta attesa;
   - `Update.writeStream(*http.getStreamPtr())` scrive;
   - `Update.end()` restituisce `false` se l'MD5 non coincide o la scrittura è incompleta.
4. Se tutto ok, `ack` con `ok` e `ESP.restart()`. Altrimenti `ack` con l'errore (`Update.errorString()`): il firmware vecchio resta al suo posto.

L'ESP32 ha due partizioni per il programma: scrive in quella libera e cambia solo alla fine. Un aggiornamento interrotto non lo "brickka".

**✅ Verifica.** Compila con `FW_VERSION` 1.0.1, aggiorna dal bot, guarda la versione nei `dati`. Poi prova con un MD5 sbagliato: deve rifiutare e restare su 1.0.1.

---

## Parte July

### Passo 6 · `core/mqtt.ts` e il registro

```bash
bun add mqtt
```

```ts
import mqtt from 'mqtt'

const client = await mqtt.connectAsync('mqtt://127.0.0.1:1883', {
  username: 'july',
  password: process.env.MQTT_PASS,
})
await client.subscribeAsync(['july/dev/+/stato', 'july/dev/+/dati', 'july/dev/+/ack'])
client.on('message', (topic, payload) => {
  // topic.split('/') → ['july', 'dev', '<id>', 'stato']; payload è un Buffer: payload.toString()
})
```

Tabella `sensori (id, nome, fw, ultimo_visto, rssi, ip, online)`. Aggiorna `ultimo_visto` in RAM a ogni messaggio e scrivilo su disco al massimo una volta ogni 10 minuti.

**Avviso offline con ritardo:** quando arriva `offline`, aspetta 10 minuti prima di `notifica` (chiave `sensore:<id>`). Se nel frattempo torna `online`, niente avviso: un riavvio non deve svegliarti.

### Passo 7 · Servire il firmware

1. Metti i `.bin` compilati in `/mnt/storage/july/firmware/` (da `.pio/build/esp32/firmware.bin` sul Mac, con rsync).
2. July calcola l'MD5 (`new Bun.CryptoHasher('md5')` oppure `crypto.createHash('md5')`).
3. Un `Bun.serve` su una porta della **rete di casa** (es. 3200) che risponde solo a `/fw/<token>`, dove `token` è casuale, vale **una volta** e scade dopo 5 minuti.
4. Pubblica il comando su `july/dev/<id>/cmd` con `url` e `md5`, poi aspetta l'`ack` e il ritorno `online` con la versione nuova.

Perché il link usa e getta: chiunque in rete potrebbe scaricare il firmware, dentro cui ci sono le password del Wi‑Fi e di MQTT.

### Passo 8 · I comandi

- `/sensori`: elenco come nell'esempio in alto.
- `/aggiorna <id>` e `/aggiorna tutti`: con `chiediConferma`, solo admin. "Tutti" aggiorna **uno alla volta**, e si ferma al primo errore.
- `/riavvia <id>`: comando `riavvia`.

---

## Trappole

- **Buffer di 256 byte** di PubSubClient (passo 2).
- **`delay()` nel loop:** l'ESP32 smette di rispondere a MQTT e il broker lo dichiara morto.
- **Password nel repository:** `segreti.h` nel `.gitignore` *prima* del primo commit.
- **Wi‑Fi a 5 GHz:** l'ESP32 classico va solo a 2,4 GHz.

## Per andare oltre

- **A batteria:** *deep sleep* tra una misura e l'altra, legge la tensione della batteria con l'ADC (serve un partitore di tensione) e avvisa sotto il 20%.
- **Provisioning senza ricompilare:** credenziali Wi‑Fi salvate in memoria (`Preferences`) e inserite da un piccolo access point alla prima accensione.
- **Rollback automatico:** se dopo l'aggiornamento il firmware nuovo non riesce a collegarsi a MQTT entro 2 minuti, torna a quello vecchio. Richiede di abilitare il rollback nel bootloader: cerca "app rollback" nella documentazione ESP-IDF.

## Fonti

- ✔︎ MQTT.js: https://github.com/mqttjs/MQTT.js
- PlatformIO: https://docs.platformio.org (da verificare)
- PubSubClient: https://github.com/knolleary/pubsubclient (da verificare)
- ArduinoJson: https://arduinojson.org (da verificare)
- Core Arduino per ESP32 (librerie `Update`, `HTTPClient`): https://github.com/espressif/arduino-esp32 (da verificare)
- Home Assistant, MQTT discovery: https://www.home-assistant.io/integrations/mqtt/ (da verificare)
- Mosquitto, ACL con `pattern` e `%u`: https://mosquitto.org/man/mosquitto-conf-5.html (da verificare)
