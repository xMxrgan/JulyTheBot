# 10 · Foto Immich

## Cosa fa

```
Tu:    mandami le foto del mare dell'estate scorsa
July:  🔎 "sea, beach" · giugno–settembre 2025 · 37 foto
       1. 14 ago 2025 · Sperlonga         [apri]
       2. 14 ago 2025 · Sperlonga         [apri]
       ...
       [Mostra anteprime] [Altre 10]

Tu:    /accaddeoggi
July:  📅 Il 9 novembre di 1, 3 e 5 anni fa: 12 foto.   [Apri in Immich]

Tu:    foto con NOME a Roma
July:  🔎 persona: NOME · città: Roma · 8 foto ...
```

Ogni persona vede **solo le sue foto**, perché July usa la sua chiave Immich, mai quella dell'admin.

## Cosa impari

Leggere una specifica OpenAPI per capire un'API, la ricerca semantica (CLIP) e i suoi limiti di lingua, estrarre date relative ("l'estate scorsa") con un LLM e controllarle con il codice, paginazione, e una scelta di privacy concreta: link invece di foto.

## Prerequisiti

- Guida 00 parte A.
- In `users.ts` hai già `immichKey` per persona e `IMMICH_URL` nel `.env`: questa guida li usa.
- In Immich, *Amministrazione → Impostazioni → Machine Learning*: **Smart Search attiva**. Il container `immich-machine-learning` deve girare e aver già elaborato le foto (sul Pi può metterci molto, la prima volta).

---

## Architettura

```
testo ─► Qwen con output strutturato (una chiamata)
            { query_en, dal, al, persone[], citta }
                    │
              controllo date con il codice
                    │
         ┌──────────┴───────────┐
   persone → /search/person     │
         └──────────┬───────────┘
                    ▼
       POST /api/search/smart   (header x-api-key = chiave DI CHI SCRIVE)
                    ▼
       elenco con link (predefinito) oppure anteprime (se lo chiedi)
```

```
funzioni/foto/
├── immich.ts      client: smart, persone, miniature
├── capisci.ts     schema Zod + chiamata a Qwen
├── date.ts        controlli sulle date
└── index.ts       comandi e pulsanti
```

---

## Passo 1 · Leggi l'API della tua versione

Le API di Immich cambiano tra le versioni. Scopri la tua:

```bash
curl -s http://127.0.0.1:2283/api/server/version
```

Poi apri la documentazione di quella versione. Nella specifica OpenAPI attuale (che ho controllato) ci sono:

| Endpoint | A cosa serve |
| --- | --- |
| `POST /api/search/smart` | ricerca per significato, con filtri |
| `POST /api/search/metadata` | ricerca per date, luogo, fotocamera |
| `GET /api/search/person?name=...` | trova una persona per nome |
| `GET /api/assets/{id}/thumbnail?size=preview` | immagine ridotta (`thumbnail` o `preview`) |

Autenticazione: header `x-api-key: <chiave>`.

Il corpo di `search/smart` accetta, tra gli altri: `query`, `size` (quanti risultati), `page`, `takenAfter`, `takenBefore`, `personIds`, `city`, `country`, `language`. La risposta ha la forma `{ assets: { items: [...], nextPage | nextCursor } }`: nelle versioni recenti `nextPage` è deprecato a favore di `nextCursor`. Usa quello che c'è nella tua.

**✅ Verifica.** A mano dal Pi, con la tua chiave:

```bash
curl -s -X POST http://127.0.0.1:2283/api/search/smart -H "x-api-key: LA_TUA_CHIAVE" -H "Content-Type: application/json" -d '{"query": "beach at sunset", "size": 3}'
```

Devono tornare 3 risultati con `id`, `originalFileName`, `localDateTime`.

## Passo 2 · Il problema della lingua

Il modello CLIP predefinito di Immich è addestrato in **inglese**. "Mare al tramonto" funziona molto peggio di "sea at sunset". Due strade:

1. **Traduci con Qwen** (questa guida): nessun cambiamento in Immich, e la traduzione la fai nella stessa chiamata in cui estrai le date, quindi non costa niente in più.
2. **Modello multilingue in Immich** (le impostazioni ne propongono alcuni): capisce l'italiano, ma è più pesante sul Pi e va rielaborata tutta la libreria.

Prova la prima; se non ti basta, misura la seconda.

## Passo 3 · Capire la richiesta, una chiamata a Qwen

```ts
const Richiesta = z.object({
  query_en: z.string().describe('cosa cercare, tradotto in inglese, senza date né nomi di persone'),
  dal: z.string().nullable().describe('data iniziale AAAA-MM-GG, se detta'),
  al: z.string().nullable().describe('data finale AAAA-MM-GG, se detta'),
  persone: z.array(z.string()).describe('nomi di persone citate'),
  citta: z.string().nullable(),
})
```

Stessa tecnica della guida 01: `format: z.toJSONSchema(Richiesta)`, temperatura 0, prompt di sistema fisso con esempi.

**La data di oggi** il modello non la sa. Mettila **nel messaggio dell'utente**, non nel prompt di sistema (che deve restare identico per sfruttare la cache di Ollama):

```
Oggi è lunedì 9 novembre 2026.
Richiesta: le foto del mare dell'estate scorsa
```

Esempi utili nel prompt: "l'estate scorsa" → 21 giugno–22 settembre dell'anno prima; "a Natale" → 24–26 dicembre; "ad agosto" → agosto più recente già passato.

## Passo 4 · Non fidarti delle date

Il modello può sbagliare un anno o scambiare i giorni. In `date.ts`:

- le date devono essere valide (`new Date(...)` non `Invalid Date`);
- `dal` ≤ `al` (altrimenti scambiale);
- niente date nel futuro;
- se c'è solo `dal`, `al` = fine di quel giorno.

Poi convertile nel formato che vuole Immich (ISO con orario) per `takenAfter` e `takenBefore`.

Mostra sempre **cosa hai capito** in testa ai risultati ("sea, beach · giugno–settembre 2025"): se è sbagliato, lo vedi subito.

## Passo 5 · Persone

Per ogni nome in `persone`, `GET /api/search/person?name=<nome>` **con la chiave di chi scrive**, e usa gli `id` trovati in `personIds`. Se non trova nessuno, dillo: "Non trovo NOME tra le tue persone in Immich" (magari non le ha dato un nome).

## Passo 6 · Link o anteprime: la scelta di privacy

Le chat con i bot **non sono cifrate end-to-end**: una foto mandata da July resta sui server di Telegram.

- **Predefinito: link.** July manda un elenco con data e luogo e un pulsante per ogni foto che apre Immich (`IMMICH_PUBLIC_URL/photos/<id>`, raggiungibile tramite Tailscale). La foto non passa da Telegram.
- **Su richiesta: anteprime.** Il pulsante [Mostra anteprime] scarica le miniature `preview` (con la chiave di chi scrive) e le manda come album:

```ts
import { InputFile, InputMediaBuilder } from 'grammy'

// immagini: array di Uint8Array scaricati da /api/assets/{id}/thumbnail?size=preview
await ctx.replyWithMediaGroup(
  immagini.slice(0, 10).map((byte) => InputMediaBuilder.photo(new InputFile(byte))),
)
```

Un album ha al massimo 10 elementi. Salva la scelta di ogni persona (`/foto modalita link|anteprime`).

## Passo 7 · Paginazione

Il pulsante [Altre 10] deve sapere da dove ripartire. La callback data è limitata a 64 byte, quindi non ci sta la richiesta intera: salva in una `Map` in RAM `{ richiesta, pagina o cursore, idUtente, scadenza: 30 minuti }` e metti nel pulsante solo un id corto, come per le conferme della guida 00.

Controlla che chi preme il pulsante sia la stessa persona che ha fatto la ricerca.

## Passo 8 · Accadde oggi

`/accaddeoggi`: per ogni anno passato, una `search/metadata` con `takenAfter` e `takenBefore` sull'inizio e la fine dello stesso giorno. Raccogli i conteggi e mostra un riassunto con un pulsante per anno. Più avanti lo usa anche la guida 11, nel briefing.

---

## Trappole

- **Chiave sbagliata.** Usare la chiave dell'admin per tutti è la cosa più facile e la più sbagliata: tutti vedrebbero le foto di tutti.
- **Smart search vuota** con la libreria appena importata: il machine learning non ha ancora finito. In Immich, *Amministrazione → Lavori* mostra la coda.
- **Query in italiano** che non trovano niente: controlla `query_en`.

## Per andare oltre

- **Cerca per foto:** mandi una foto a July, lui la carica in un posto temporaneo e cerca le simili con `queryAssetId` (il campo esiste in `search/smart`; verifica come usarlo nella tua versione).
- **Album al volo:** "fai un album con queste" crea un album in Immich con i risultati.

## Fonti

- ✔︎ Immich, specifica OpenAPI (endpoint e campi citati qui): https://github.com/immich-app/immich/blob/main/open-api/immich-openapi-specs.json
- Immich, documentazione API: https://api.immich.app (da verificare)
- Immich, ricerca smart e modelli CLIP: https://immich.app/docs/features/searching (da verificare)
- grammY, `InputMediaBuilder` e album: https://grammy.dev/guide/files (da verificare)
