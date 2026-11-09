# 11 · Briefing mattutino

## Cosa fa

Ogni mattina, all'ora che scegli:

```
July:  ☀️ Buongiorno! Lunedì 9 novembre
       🌦️ 9–15 °C, pioggia probabile dal pomeriggio (70%): ombrello.
       📅 10:00 Riunione progetto · 18:30 Palestra
       🏠 Notte tranquilla. Ieri 7,4 kWh (circa 2,05 €). Finestra del bagno aperta.
       🖥️ Server ok. SSD all'87%.
       📸 Tre anni fa oggi: 6 foto.   [Apri]
```

È la funzione che mette insieme le altre. Per questo è l'ultima.

## Cosa impari

Comporre moduli indipendenti senza che uno rotto blocchi gli altri, chiamare API esterne pensando alla privacy, CalDAV e le ricorrenze del calendario, preferenze per persona, e il caso in cui un LLM lento va benissimo.

## Prerequisiti

- Guida 00 parte A (`scheduler`, `db`).
- Le sezioni usano le guide che hai fatto: casa (01), energia (04), anomalie (07), watchdog (09), foto (10). Quelle che mancano semplicemente non compaiono.

---

## Architettura

```
scheduler: un lavoro per persona, alla sua ora
     │
     ▼
 raccogli in parallelo (Promise.allSettled, max 10 s ciascuna)
     ├── meteo        → Open-Meteo
     ├── calendario   → Nextcloud CalDAV
     ├── casa         → guide 01, 04, 07
     ├── server       → guida 09 (solo admin)
     └── ricordi      → guida 10
     │
     ▼
 componi il testo (modello di testo; Qwen facoltativo, passo 6)
     │
     ▼
 manda
```

```
funzioni/briefing/
├── sezioni/         un file per sezione, tutti con la stessa interfaccia
├── componi.ts
├── preferenze.ts
└── index.ts         comandi /briefing
```

---

## Passo 1 · L'interfaccia delle sezioni

```ts
interface Sezione {
  nome: string                                   // 'meteo'
  perChi: (u: User) => boolean                   // es. server solo per admin
  raccogli: (u: User) => Promise<string | null>  // null = niente da dire oggi
}
```

Il cuore è `Promise.allSettled`: aspetta tutte le sezioni e ti dice quali sono riuscite e quali no, **senza** fermarsi alla prima che fallisce. Se Open-Meteo non risponde, il briefing arriva lo stesso, senza meteo. Metti a ogni sezione un timeout (`AbortSignal.timeout(10_000)` per le chiamate di rete).

## Passo 2 · Meteo con Open-Meteo

Open-Meteo è gratuito e non vuole registrazione né chiave:

```
https://api.open-meteo.com/v1/forecast?latitude=41.90&longitude=12.50&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&hourly=precipitation_probability&timezone=Europe%2FRome&forecast_days=1
```

**Privacy:** è un servizio esterno, quindi riceve il tuo IP e le coordinate. Arrotonda le coordinate a **due decimali** (circa 1 km): bastano per il meteo e non indicano casa tua. La richiesta parte da July (sul Pi), non da Ollama, che resta senza internet.

**I codici meteo** (`weather_code`) sono i codici WMO: 0 sereno, 1–3 nuvoloso, 45–48 nebbia, 51–67 pioggia, 71–77 neve, 80–82 rovesci, 95–99 temporale. Scrivi una tabella codice → emoji e parola.

**Il consiglio utile:** dalla serie oraria `precipitation_probability`, trova la prima ora sopra il 50% e scrivi "pioggia probabile dalle 15". Un'informazione così vale più delle temperature.

**✅ Verifica.** Apri l'indirizzo nel browser con le tue coordinate e confronta i campi con quello che stampa la sezione.

## Passo 3 · Calendario Nextcloud

Nextcloud espone i calendari con il protocollo **CalDAV**.

1. In Nextcloud, *Impostazioni personali → Sicurezza*, crea una **password per app** dedicata a July. Ognuno crea la propria, per il proprio calendario.
2. Nel `.env`: `NEXTCLOUD_DAV_URL=https://<il-tuo-nextcloud>/remote.php/dav`, e per persona `NEXTCLOUD_USER_<NOME>` e `NEXTCLOUD_APPPASS_<NOME>`, come le chiavi Immich in `users.ts`.
3. Libreria:

    ```bash
    bun add tsdav
    ```

    ```ts
    import { createDAVClient } from 'tsdav'

    const client = await createDAVClient({
      serverUrl: process.env.NEXTCLOUD_DAV_URL!,
      credentials: { username, password },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    })
    const calendari = await client.fetchCalendars()
    const eventi = await client.fetchCalendarObjects({ calendar: calendari[0] /* , filtro per data */ })
    // ogni evento ha .data: il testo iCalendar (BEGIN:VEVENT ... END:VEVENT)
    ```

    Controlla nella documentazione di tsdav come filtrare per intervallo di date (`timeRange`) e se puoi chiedere al server di espandere gli eventi ripetuti.

**La parte difficile: le ricorrenze.** Un evento "ogni martedì" è salvato **una volta** con una regola (`RRULE:FREQ=WEEKLY;BYDAY=TU`). Per sapere se c'è oggi devi espandere la regola. Due strade: chiedere al server di farlo (CalDAV lo prevede), oppure una libreria che legge iCalendar e sa espandere le regole, come `ical.js`. Prova prima la prima.

Attenzione al fuso: gli eventi possono avere orari in UTC (`Z` finale) o con `TZID`. Mostra tutto in `Europe/Rome`.

**✅ Verifica.** Crea in Nextcloud un evento singolo per domani e uno ripetuto ogni giorno: un comando `/domani` deve mostrare tutti e due.

## Passo 4 · Le altre sezioni

Ogni guida precedente espone già quello che serve:

| Sezione | Fonte | Esempio |
| --- | --- | --- |
| Casa | 07: avvisi della notte non ancora risolti; 01: finestre aperte dalla cache di HA | "Finestra del bagno aperta" |
| Energia | 04: consumi e costo di ieri | "Ieri 7,4 kWh (circa 2,05 €)" |
| Server | 09: stato attuale, solo per l'admin | "SSD all'87%" |
| Ricordi | 10: accadde oggi, con la chiave della persona | "Tre anni fa oggi: 6 foto" |

Regola: se tutto è normale, una riga sola ("Notte tranquilla"). Il briefing deve stare in uno schermo.

## Passo 5 · Preferenze per persona

```
/briefing            mostra le tue impostazioni
/briefing ora 7:15
/briefing via meteo  (togli una sezione)
/briefing con meteo  (rimettila)
/briefing luogo 41.90 12.50
/briefing stop
```

Tabella `briefing (utente, ora, sezioni, lat, lon, attivo)`. Quando una persona cambia ora, ferma il suo lavoro nello scheduler e creane uno nuovo. Al riavvio di July, ricrea i lavori di tutti dalla tabella.

Con la guida 02: se sei fuori casa da più di un giorno, togli la sezione casa e usa il meteo del posto in cui sei (se la persona lo condivide).

## Passo 6 · Qwen per il tono (facoltativo)

Di solito il modello sul Pi è un problema perché è lento. Qui no: il briefing lo prepari **alle 6:50** per mandarlo alle 7:00, e 30 secondi di generazione non li nota nessuno.

Dai a Qwen i dati **già raccolti e strutturati** e chiedigli due righe d'apertura in tono amichevole ("Giornata da ombrello, e hai la riunione alle 10"). Le regole:

- il modello scrive solo l'apertura; i dati veri restano sotto, dal modello di testo;
- se la chiamata fallisce o va oltre 60 secondi, il briefing parte senza apertura;
- usa `core/pesante.ts` (guida 08), così non si sovrappone ad altro.

---

## Trappole

- **Una sezione lenta blocca tutto:** timeout per ogni sezione.
- **Ora legale:** lo scheduler con `timezone: 'Europe/Rome'` la gestisce; `setTimeout` calcolato a mano no.
- **Il briefing alle 7 della domenica.** Aggiungi "solo giorni feriali" alle preferenze.

## Per andare oltre

- **Briefing serale:** cosa c'è domani, la lavatrice da far partire in F3 (guida 04), le finestre da chiudere.
- **Viaggio:** se il calendario ha un evento in un'altra città, meteo di quella città.

## Fonti

- Open-Meteo, API e parametri: https://open-meteo.com/en/docs (da verificare)
- Codici meteo WMO: nella stessa pagina, sezione "WMO Weather interpretation codes" (da verificare)
- tsdav: https://github.com/natelindev/tsdav (da verificare)
- Nextcloud, CalDAV e password per app: https://docs.nextcloud.com/server/latest/user_manual/en/groupware/sync_ios.html (da verificare)
- ical.js: https://github.com/kewisch/ical.js (da verificare)
