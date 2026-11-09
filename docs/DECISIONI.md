# Decisioni

Le scelte importanti di July e il loro perché. Servono a non rifare due volte lo stesso ragionamento, e a capire cosa si rompe se un giorno cambi idea.

**Stati:** ✅ **accettata** (in uso o decisa da te) · 🟡 **proposta** (suggerita da una guida, da confermare) · ♻️ **sostituita** (rimanda a quella nuova)

Quando confermi una proposta, cambia lo stato e la data. Quando cambi idea su una decisione accettata, non cancellarla: segnala ♻️ e scrivine una nuova.

---

## Indice

| N. | Decisione | Stato |
| --- | --- | --- |
| D01 | Telegram come unica interfaccia | ✅ |
| D02 | Bun + grammY, servizio systemd | ✅ |
| D03 | Server Bot API locale per i file grandi | ✅ |
| D04 | Modello locale su una rete senza internet | ✅ |
| D05 | Modello "instruct", non "thinking" | ✅ |
| D06 | Memoria solo su richiesta esplicita | ✅ |
| D07 | Separazione tra persone nel codice, tramite ID Telegram | ✅ |
| D08 | Ricerca web sì, ma il modello resta offline | ✅ |
| D09 | Le funzioni le scrive OJ | ✅ |
| D10 | Home Assistant come strato dei dispositivi | 🟡 |
| D11 | Un solo database SQLite | 🟡 |
| D12 | Output strutturato (`format` + Zod) invece di `tools` | 🟡 |
| D13 | Due utenti Home Assistant per July | 🟡 |
| D14 | Spazio comune di famiglia e gruppo Telegram | 🟡 |
| D15 | Foto da Immich: link invece di immagini | 🟡 |
| D16 | whisper.cpp sulla stessa rete isolata di Ollama | 🟡 |

---

## D01 · Telegram come unica interfaccia ✅

- **Contesto:** July deve essere raggiungibile ovunque, dal telefono, senza un'app da sviluppare.
- **Decisione:** l'interfaccia è Telegram.
- **Conseguenze:** i messaggi passano dai server di Telegram e le chat con i bot non sono cifrate end-to-end. Niente password, documenti o dati delicati nei messaggi. Le azioni pericolose vogliono conferma. Le foto personali si mandano come link (D15).

## D02 · Bun + grammY, servizio systemd ✅

- **Contesto:** un bot in TypeScript sul Pi, che riparta da solo.
- **Decisione:** runtime Bun, libreria grammY, unità systemd `july` con `Restart=always`.
- **Conseguenze:** Bun include SQLite, WebSocket, server HTTP e shell (`$`): poche dipendenze. Deploy con rsync dal Mac (README principale).

## D03 · Server Bot API locale ✅

- **Contesto:** i bot normali non possono ricevere file grandi come i film.
- **Decisione:** container `july-api` con il server Bot API ufficiale, sul Pi.
- **Conseguenze:** i file arrivano direttamente sul disco del Pi. Non cambia la privacy: Telegram vede comunque i messaggi.

## D04 · Modello locale su una rete senza internet ✅

- **Contesto:** privacy prima di tutto; il Pi ha 8 GB di RAM e serve anche per film e musica.
- **Decisione:** Ollama in Docker sulla rete interna `llm`, senza strada verso internet, core 2 e 3, al massimo 5 GB, scaricato dopo 10 minuti di inattività.
- **Conseguenze:** risposte in circa 10 secondi; conoscenze ferme al momento dell'addestramento. Ogni servizio AI futuro (whisper, D16) segue la stessa regola.

## D05 · Modello "instruct" ✅

- **Contesto:** il modello "thinking" scriveva il ragionamento prima della risposta, lento e in inglese.
- **Decisione:** `qwen3:4b-instruct-2507-q4_K_M`.
- **Conseguenze:** risposte dirette. Per i compiti strutturati serve vincolare l'output (D12).

## D06 · Memoria solo su richiesta ✅

- **Contesto:** un 4B non sa distinguere cosa vale la pena ricordare, e proporlo a ogni messaggio era fastidioso.
- **Decisione:** July salva un ricordo solo con un comando o una frase esplicita ("ricorda che…"). Un JSON per persona, massimo 30 ricordi.
- **Conseguenze:** pochi ricordi, tutti voluti. Nessun salvataggio di nascosto.

## D07 · Separazione tra persone nel codice ✅

- **Contesto:** più persone useranno July.
- **Decisione:** ogni persona è un ID Telegram in `users.ts`. Il codice dà al modello solo i dati di chi scrive; le chiavi Immich sono per persona.
- **Conseguenze:** il modello non può rivelare dati di altri perché non li riceve. Lo spazio comune della famiglia (D14) estende questa regola, non la sostituisce.

## D08 · Ricerca web, ma il modello resta offline ✅

- **Contesto:** le conoscenze del modello sono ferme; serve qualche informazione attuale.
- **Decisione:** la ricerca la fa il codice di July (che ha internet) e passa i risultati al modello, che resta senza internet. La privacy viene prima della comodità.
- **Conseguenze:** da progettare (X01): quale motore di ricerca, quanto testo passare al modello, cosa tenere nei log.

## D09 · Le funzioni le scrive OJ ✅

- **Contesto:** l'obiettivo è imparare e saper mantenere July da solo.
- **Decisione:** le guide spiegano architettura, interfacce e passi con verifica; il codice lo scrive OJ.
- **Conseguenze:** più tempo per ogni funzione, ma nessun pezzo che non sai spiegare.

---

## D10 · Home Assistant come strato dei dispositivi 🟡

- **Contesto:** i dispositivi di casa parlano protocolli diversi (Zigbee, Wi‑Fi, Shelly).
- **Proposta:** Home Assistant in Docker traduce tutto in una sola API; July parla solo con HA (WebSocket), più MQTT diretto per i sensori ESP32.
- **Alternativa scartata:** July che parla direttamente con Zigbee2MQTT e con ogni dispositivo. Più codice, e ogni marca nuova è un lavoro.
- **Conseguenze:** 300–600 MB di RAM in più. HA va aggiornato e configurato. Guida: G00 B.

## D11 · Un solo database SQLite 🟡

- **Contesto:** eventi, avvisi, promemoria, consumi: migliaia di righe da filtrare per data.
- **Proposta:** `/mnt/storage/july/july.db` con `bun:sqlite`, modalità WAL, migrazioni numerate. I ricordi restano in JSON.
- **Alternativa scartata:** un database server (PostgreSQL): troppo per un utente e un processo solo.
- **Conseguenze:** un file da includere nel backup. Scritture a blocchi per l'SSD. Guida: G00 A.

## D12 · `format` + Zod invece di `tools` 🟡

- **Contesto:** un modello da 4B sbaglia spesso il formato quando usa i *tools*.
- **Proposta:** schema scritto con Zod, convertito con `z.toJSONSchema` e passato a Ollama come `format`; la generazione è vincolata allo schema. Zod rivalida la risposta. Il codice, non il modello, sceglie dispositivi e azioni.
- **Conseguenze:** JSON sempre valido; una chiamata al modello per richiesta. Guida: G01.

## D13 · Due utenti Home Assistant per July 🟡

- **Contesto:** le automazioni che imparano (G03) non devono imparare dalle azioni di July stesso.
- **Proposta:** utente `july` per i comandi dati dalle persone, `july-auto` per quelli che July decide da solo. Nessuno dei due è amministratore.
- **Conseguenze:** HA scrive in ogni cambio di stato quale utente l'ha causato, e G03 lo usa come filtro. Guide: G00 B, G03.

## D14 · Spazio comune di famiglia e gruppo Telegram 🟡

- **Contesto:** liste, turni, spese e scadenze sono di tutti, i ricordi no.
- **Proposta:** colonna `spazio` (`u:<ID>` o `famiglia`) in ogni tabella, una sola funzione `puoVedere`, un gruppo Telegram registrato con privacy mode attiva; nel gruppo l'AI non riceve i ricordi privati.
- **Conseguenze:** tutte le funzioni di famiglia dipendono da FA01. Dettagli in `ARCHITETTURA.md`, sezione 3.

## D15 · Foto da Immich: link invece di immagini 🟡

- **Contesto:** una foto mandata su Telegram resta sui suoi server (D01).
- **Proposta:** July manda link che aprono Immich tramite Tailscale; le anteprime solo se la persona lo sceglie.
- **Conseguenze:** serve Tailscale acceso sul telefono per vedere le foto. Guida: G10.

## D16 · whisper.cpp sulla rete isolata 🟡

- **Contesto:** trascrivere i vocali senza servizi esterni.
- **Proposta:** container `whisper` sulla rete `llm` (`10.89.0.11`), core 2 e 3, un lavoro pesante alla volta con Ollama (coda in `core/pesante.ts`).
- **Conseguenze:** 200–400 MB di RAM. Modello `base` o `small` da scegliere misurando. Guida: G08.
