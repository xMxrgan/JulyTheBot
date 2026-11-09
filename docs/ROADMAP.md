# Roadmap

Tutti i progetti di July in un posto. L'ordine delle fasi è una **proposta**: cambialo quando vuoi, ma tieni d'occhio le dipendenze.

Aggiornato: 9 novembre 2026.

**Legenda:** 💡 idea · 📝 scheda · 📘 guida pronta · 🔨 in sviluppo · ✅ fatto · ⏸ in pausa · ❌ scartato

---

## Visione

July è l'assistente privato di casa: gira sul Pi, risponde da Telegram ovunque tu sia, e non manda i tuoi dati a nessun servizio di intelligenza artificiale esterno. Cresce in tre direzioni:

1. **Il server**: lo tiene d'occhio e ti avvisa prima che qualcosa si rompa.
2. **La casa**: capisce comandi in italiano, sa chi c'è, impara le abitudini, segnala ciò che non va.
3. **La famiglia**: liste, promemoria, turni, spese e scadenze condivise, con una parte privata per ognuno.

## Principi

Valgono per ogni progetto. Il dettaglio è in `ARCHITETTURA.md`.

1. Privacy prima di tutto: i dati restano sul Pi, il modello non ha internet.
2. Il modello capisce, il codice decide.
3. La separazione tra persone la fa il codice, non il modello.
4. Azioni pericolose solo con conferma.
5. Prima osserva (modalità ombra), poi agisci.
6. Il Pi deve restare leggero: film e musica vengono prima.
7. July lo scrive OJ: le guide spiegano, il codice è suo.

---

## Prossimi passi

I tre progetti da cui partire, perché non chiedono hardware e servono a quasi tutti gli altri:

1. **G00 parte A · Telaio**: database, avvisi, orari, conferme.
2. **G09 · Watchdog del Pi**: il primo uso concreto del telaio.
3. **FA02 · Promemoria**: July oggi dice di non saperli mandare. Sono la base di scadenze, turni e manutenzione.

---

## Tutti i progetti

### Base: July oggi

| ID | Progetto | Stato | Dove |
| --- | --- | --- | --- |
| B01 | Caricare film, serie e musica sul Pi | ✅ | `features/upload.ts` |
| B02 | Comandi del server (`/status`, `/disk`, `/import`, `/restart`) | ✅ | `features/admin.ts` |
| B03 | Memoria su richiesta (`/ricorda`, `/memoria`, `/dimentica`) | ✅ | `features/memory.ts` |
| B04 | Assistente con Qwen3 4B in locale | ✅ | `features/ai.ts` |
| B05 | QR code dai link | ✅ | `index.ts` |
| B06 | Lista della spesa | ✅ | menu di `/start` |
| B07 | Persone, ruoli e compartimenti | ✅ | `features/users.ts` |

### Guide pronte (G)

| ID | Progetto | Stato | Fase | Dipende da | Hardware | Documento |
| --- | --- | --- | --- | --- | --- | --- |
| G00 | Fondamenta: A telaio, B casa | 📘 | 1 (A), 3 (B) | — | chiavetta Zigbee (B) | `funzioni/00-fondamenta.md` |
| G01 | Jarvis di casa | 📘 | 3 | G00 | dispositivi | `funzioni/01-jarvis-casa.md` |
| G02 | Presenza | 📘 | 3 | G00 | mmWave, porte | `funzioni/02-presenza.md` |
| G03 | Automazioni che imparano | 📘 | 4 | G00, G01 | — | `funzioni/03-automazioni-che-imparano.md` |
| G04 | Energia e NILM | 📘 | 4 | G00 A | Shelly + elettricista | `funzioni/04-energia.md` |
| G05 | Sensori ESP32 | 📘 | 4 | G00 | ESP32 | `funzioni/05-sensori-esp32.md` |
| G06 | Casa in 3D (Mini App) | 📘 | 4 | G00, G01 | — | `funzioni/06-casa-3d-mini-app.md` |
| G07 | Anomalie | 📘 | 3 | G00 A | sensori (facoltativi) | `funzioni/07-anomalie.md` |
| G08 | Messaggi vocali | 📘 | 1 | G00 A | — | `funzioni/08-messaggi-vocali.md` |
| G09 | Watchdog del Pi | 📘 | 1 | G00 A | — | `funzioni/09-watchdog-pi.md` |
| G10 | Foto Immich | 📘 | 1 | G00 A | — | `funzioni/10-foto-immich.md` |
| G11 | Briefing mattutino | 📘 | 5 | G00 A | — | `funzioni/11-briefing-mattutino.md` |

### Famiglia (FA)

| ID | Progetto | Stato | Fase | Dipende da | Hardware | Difficoltà |
| --- | --- | --- | --- | --- | --- | --- |
| FA01 | Spazio comune e gruppo di famiglia | 📝 | 1 | G00 A | — | ★★★ |
| FA02 | Promemoria in linguaggio naturale | 📝 | 1 | G00 A | — | ★★★ |
| FA03 | Promemoria all'arrivo a casa | 📝 | 3 | FA02, G02 | come G02 | ★★★ |
| FA04 | Scadenze di casa | 📝 | 2 | FA01, FA02 | — | ★★ |
| FA05 | Faccende a turni | 📝 | 2 | FA01, FA02 | — | ★★★ |
| FA06 | "Chi c'è a cena?" | 📝 | 2 | FA01 | — | ★★ |
| FA07 | Lista della spesa evoluta | 📝 | 2 | FA01, B06 | — | ★★★ |
| FA08 | Dispensa e frigo | 📝 | 4 | FA01, FA07 | — | ★★★ |
| FA09 | Spese condivise | 📝 | 2 | FA01 | — | ★★★ |
| FA10 | "La lavatrice ha finito" | 📝 | 3 | G00 | presa con misura | ★★★ |
| FA11 | Allarmi con "Ci penso io" | 📝 | 3 | FA01, G07 | come G07 | ★★★ |
| FA12 | Wi‑Fi per gli ospiti | 📝 | 2 | B05 | — | ★ |
| FA13 | Registro manutenzione | 📝 | 2 | FA01, FA02 | — | ★★ |
| FA14 | Idee regalo nascoste | 📝 | 2 | FA01, FA02 | — | ★★★ |
| FA15 | Foto della settimana | 📝 | 2 | FA01, G10 | — | ★★ |
| FA16 | "Tutto bene?" per chi vive da solo | 📝 | 4 | G00, G07 | sensori a casa sua | ★★★★ |

Le schede sono in `idee/famiglia.md`.

### Altre (X)

| ID | Progetto | Stato | Note |
| --- | --- | --- | --- |
| X01 | Ricerca web privata | 💡 | Requisiti già decisi: il modello resta offline, privacy al primo posto, Telegram come interfaccia. Vedi `idee/inbox.md` |

---

## Fasi

```
FASE 1 · telaio, nessun hardware
  G00 A ─► G09 Watchdog
        ├► FA02 Promemoria
        ├► FA01 Spazio comune
        ├► G08 Vocali
        └► G10 Foto

FASE 2 · famiglia, nessun hardware
  FA12 Wi‑Fi ospiti (vittoria facile)
  FA07 Spesa · FA06 Cena · FA09 Spese
  FA04 Scadenze · FA13 Manutenzione · FA05 Turni
  FA14 Regali · FA15 Foto della settimana

FASE 3 · la casa
  G00 B ─► G01 Jarvis ─► G07 Anomalie ─► FA11 "Ci penso io"
        ├► G02 Presenza ─► FA03 Promemoria all'arrivo
        └► FA10 Lavatrice

FASE 4 · le più difficili
  G04 Energia · G03 Automazioni · G05 ESP32 · G06 Casa in 3D
  FA08 Dispensa · FA16 "Tutto bene?"

FASE 5 · tutto insieme
  G11 Briefing (con le sezioni di famiglia: promemoria, turni, scadenze di oggi)
```

### Come scegliere quando sei indeciso

| | Facile | Difficile |
| --- | --- | --- |
| **Lo useresti ogni settimana** | fallo subito (FA12, G09, FA02) | pianificalo bene (G01, FA07, FA09) |
| **Lo useresti ogni tanto** | quando hai un'ora libera (FA06, FA13) | per imparare, non per bisogno (G04 NILM, G06) |

---

## Domande aperte

Da chiarire prima delle fasi indicate:

- **Fase 1:** chi della famiglia userà July, e ciascuno ha Telegram?
- **Fase 2:** la famiglia è una sola casa, o anche parenti che vivono altrove (per FA16)?
- **Fase 3:** quali dispositivi ci sono già in casa? Zigbee, Wi‑Fi, Shelly?
- **Fase 4:** l'impianto elettrico è monofase? C'è un elettricista di fiducia per la pinza di G04?

---

## Storico

| Data | Cosa |
| --- | --- |
| 2026-11-09 | Prime 12 guide (G00–G11), schede di famiglia (FA01–FA16), questa roadmap |
