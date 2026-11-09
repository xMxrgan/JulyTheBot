# July · Guide alle nuove funzioni

Queste guide spiegano come costruire ogni funzione nuova di July, passo per passo. **Il codice lo scrivi tu.** In ogni guida trovi l'architettura, le interfacce da implementare, esempi delle chiamate alle API esterne (presi dalla documentazione ufficiale), un controllo per verificare ogni passo e un suggerimento da leggere solo se ti blocchi.

Mettile nel repository, in `JulyTheBot/docs/funzioni/`, così viaggiano con il codice.

---

## Le guide

| N. | Funzione | Cosa farà July | Difficoltà | Hardware nuovo |
| --- | --- | --- | --- | --- |
| 00 | [Fondamenta](00-fondamenta.md) | Database, avvisi, orari, conferme; Home Assistant, MQTT, Zigbee | ★★★ | chiavetta Zigbee (solo parte B) |
| 01 | [Jarvis di casa](01-jarvis-casa.md) | "Spegni tutto tranne la camera" | ★★★★ | dispositivi Zigbee o Wi‑Fi |
| 02 | [Presenza](02-presenza.md) | Chi è in casa, quali stanze sono occupate | ★★★★ | sensori mmWave e porte |
| 03 | [Automazioni che imparano](03-automazioni-che-imparano.md) | "Spegni sempre le luci alle 23:30, la creo?" | ★★★★★ | nessuno oltre la 01 |
| 04 | [Energia](04-energia.md) | Allarme distacco contatore, costi per fascia, riconoscere gli elettrodomestici | ★★★★★ | misuratore Shelly + elettricista |
| 05 | [Sensori ESP32](05-sensori-esp32.md) | Firmware tuo, stato dei sensori, aggiornamenti dal bot | ★★★★ | schede ESP32 |
| 06 | [Casa in 3D](06-casa-3d-mini-app.md) | Planimetria live dentro Telegram | ★★★★ | nessuno |
| 07 | [Anomalie](07-anomalie.md) | "Il frigo lavora il 40% in più da 3 giorni" | ★★★★ | presa con misura di potenza (facoltativa) |
| 08 | [Messaggi vocali](08-messaggi-vocali.md) | Gli parli e lui esegue | ★★★ | nessuno |
| 09 | [Watchdog del Pi](09-watchdog-pi.md) | Ti avvisa prima che il Pi si rompa | ★★ | nessuno |
| 10 | [Foto Immich](10-foto-immich.md) | "Le foto del mare dell'estate scorsa" | ★★★ | nessuno |
| 11 | [Briefing mattutino](11-briefing-mattutino.md) | Meteo, impegni, casa e server ogni mattina | ★★★ | nessuno |

---

## Ordine consigliato

Le prime funzioni non chiedono hardware nuovo: servono a costruire le basi che poi usano tutte le altre.

```
FASE 1 · senza hardware
  00 parte A ──► 09 Watchdog ──► 08 Vocali ──► 10 Foto Immich

FASE 2 · la casa
  00 parte B ──► 01 Jarvis ──► 07 Anomalie ──► 02 Presenza

FASE 3 · le più difficili
  04 Energia      03 Automazioni (vuole 01, meglio con 02)
  05 ESP32        06 Casa in 3D (vuole 01)

ALLA FINE
  11 Briefing (mette insieme 04, 07, 09, 10)
```

Chi dipende da chi:

| Guida | Ha bisogno di | Funziona meglio con |
| --- | --- | --- |
| 01 | 00 A + B | 08 |
| 02 | 00 A + B | 05 |
| 03 | 00 A + B, 01 | 02 |
| 04 | 00 A | 07 |
| 05 | 00 A + B (Mosquitto) | 02 |
| 06 | 00 A + B, 01 | 02, 04 |
| 07 | 00 A | 02, 04 |
| 08 | 00 A | 01 |
| 09 | 00 A | — |
| 10 | 00 A | — |
| 11 | 00 A | 04, 07, 09, 10 |

---

## Come sono fatte le guide

Ogni guida ha la stessa struttura:

1. **Cosa fa**: esempi di conversazione con July.
2. **Cosa impari**: i concetti tecnici che porti a casa.
3. **Prerequisiti**: guide precedenti, hardware, variabili nel `.env`.
4. **Architettura**: schema e file da creare.
5. **Passi**: ognuno con *Obiettivo*, *Cosa fare*, *Perché*, un *Esempio*, una **✅ Verifica** e, quando serve, un **Se ti blocchi**.
6. **Trappole**: gli errori che quasi tutti fanno.
7. **Per andare oltre**: estensioni per quando la base funziona.
8. **Fonti**: documentazione ufficiale.

Consiglio: leggi tutta la guida una volta prima di scrivere codice. Poi fai un passo alla volta e non passare al successivo finché la verifica non è verde.

---

## Regole che valgono per tutte le funzioni

1. **Il modello capisce, il codice decide.** Qwen trasforma frasi in dati strutturati. Non sceglie mai da solo un dispositivo, un servizio o un comando di shell: questo lo fa il codice, con elenchi chiusi.
2. **Azioni pericolose solo con conferma.** Serrature, allarmi, riavvii, aggiornamenti firmware: pulsante "Conferma" e solo per l'admin (vedi `core/confirm.ts` nella 00).
3. **La separazione tra persone la fa il codice.** Ogni funzione usa le credenziali di chi scrive (la sua chiave Immich, le sue preferenze), mai quelle dell'admin. Il modello vede solo i dati di quella persona.
4. **Niente testo dei messaggi nei log**, come già fa July: solo errori, tempi e azioni eseguite.
5. **Telegram non è cifrato end-to-end.** I server di Telegram vedono quello che scrivi e quello che July risponde, foto comprese. Ogni guida dice cosa passa da Telegram.
6. **Il Pi deve restare leggero.** Ogni guida dice quanta RAM e CPU usa. I lavori pesanti vanno sui core 2 e 3 con priorità bassa, come Ollama, o di notte.
7. **Meno scritture sull'SSD.** I dati frequenti si accumulano in RAM e si scrivono a blocchi (vedi `core/db.ts`).

### RAM: il vero limite

Con 8 GB, Ollama (fino a 5 GB), Immich, Nextcloud e Jellyfin, la RAM finisce prima della CPU. Queste sono stime a spanne dei servizi nuovi: misura sempre con `docker stats --no-stream` dopo averli accesi.

| Servizio nuovo | RAM tipica | Guida |
| --- | --- | --- |
| Home Assistant | 300–600 MB | 00 |
| Mosquitto | sotto i 20 MB | 00 |
| Zigbee2MQTT | 100–200 MB | 00 |
| whisper-server con modello base | 200–400 MB | 08 |

---

## Fonti

Queste fonti le ho controllate sui sorgenti ufficiali (GitHub) il 9 novembre 2026, e gli esempi delle guide vengono da lì:

- Ollama, API (chat, `format` con JSON schema, `tools`): https://github.com/ollama/ollama/blob/main/docs/api.md
- Home Assistant, WebSocket API: https://developers.home-assistant.io/docs/api/websocket
- Home Assistant, REST API: https://developers.home-assistant.io/docs/api/rest
- Home Assistant, Conversation API (Assist): https://developers.home-assistant.io/docs/intent_conversation_api
- grammY, tastiere (pulsanti inline e Mini App): https://grammy.dev/plugins/keyboard
- whisper.cpp e whisper-server: https://github.com/ggml-org/whisper.cpp
- Immich, specifica OpenAPI: https://github.com/immich-app/immich/blob/main/open-api/immich-openapi-specs.json
- Zigbee2MQTT, topic MQTT: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
- MQTT.js: https://github.com/mqttjs/MQTT.js
- ESPHome, sensore LD2410: https://esphome.io/components/sensor/ld2410/
- croner (lavori a orario): https://github.com/Hexagon/croner
- Zod, conversione in JSON Schema: https://zod.dev/json-schema

Le altre fonti citate nelle guide (Telegram Mini Apps, Shelly, three.js, React Three Fiber, Open-Meteo, tsdav, Tailscale, Bun, PlatformIO) **non le ho potute aprire**: i link potrebbero essere cambiati o imprecisi. Controllali prima di fidarti.
