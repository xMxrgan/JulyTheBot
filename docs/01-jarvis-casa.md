# 01 · Jarvis di casa

## Cosa fa

```
Tu:    spegni tutto tranne la camera
July:  ✅ Spente 6 luci (soggiorno, cucina, bagno, corridoio, studio, ingresso). Camera lasciata accesa.

Tu:    che temperatura c'è in salotto?
July:  🌡️ Soggiorno: 20,5 °C, umidità 48%.

Tu:    e in camera?
July:  🌡️ Camera: 19,0 °C, umidità 52%.

Tu:    apri la porta
July:  🔐 Apro la serratura della porta d'ingresso?   [✅ Conferma] [❌ Annulla]
```

## Cosa impari

Output strutturato con JSON Schema, perché con un modello piccolo funziona meglio dei *tools*, ricerca approssimata (*fuzzy matching*) di nomi, progettazione di una pipeline a corsie, permessi, verifica che un comando sia andato a buon fine, e soprattutto **come misurare** la qualità di una funzione con un LLM (*eval*).

## Prerequisiti

- Guida 00, parti A e B: `core/ha.ts`, `core/confirm.ts`.
- Qualche dispositivo in HA, con le **stanze assegnate** (*Impostazioni → Aree*).
- `bun add zod` (versione 4: serve `z.toJSONSchema`).

---

## I quattro principi

1. **Il modello capisce, il codice decide.** Qwen restituisce *cosa* vuoi fare e *con quali parole* hai indicato il dispositivo. Non scrive mai un `entity_id` e non chiama mai servizi. Se lo lasci fare, prima o poi inventa `light.cucina_2`.
2. **`format` invece di `tools`.** Con `tools` il modello *può* rispondere nel formato giusto. Con `format` e un JSON Schema, Ollama vincola la generazione token per token: il JSON è sempre valido e i campi `enum` contengono solo i valori ammessi. Con un 4B la differenza è enorme.
3. **Una sola chiamata al modello per comando.** Sul Pi ogni chiamata costa secondi. La risposta all'utente la scrive il codice da un modello di testo, non una seconda chiamata a Qwen.
4. **Prima le corsie veloci.** Il modello è l'ultima risorsa, non la prima.

## Architettura

```
testo (scritto, o trascritto dalla guida 08)
   │
   ├─ 1. Corsia veloce: frasi fisse con regex ................ ~0 s
   │      "spegni tutto", "accendi tutte le luci"
   │
   ├─ 2. Assist di Home Assistant ............................ ~0,1 s
   │      capisce già molte frasi italiane semplici
   │
   ├─ 3. Qwen con output strutturato ......................... 5–15 s
   │
   ▼
intento validato con Zod
   ▼
risoluzione: "luce della cucina" → light.cucina_soffitto
   ▼
permessi → conferma se pericoloso → chiamaServizio → aspetto il cambio di stato → risposta
```

File:

```
funzioni/casa/
├── index.ts         gestore grammY: decide se un testo è un comando di casa
├── intento.ts       schema Zod + chiamata a Ollama
├── assist.ts        corsia 2
├── veloce.ts        corsia 1
├── risolvi.ts       testo → entità
├── permessi.ts      chi può fare cosa
├── esegui.ts        chiamata a HA + verifica
└── frasi.test.json  il tuo banco di prova (passo 9)
```

---

## Passo 1 · Decidi cosa July può toccare

**Obiettivo.** Una tabella scritta nel codice: per ogni dominio di HA, quali azioni e con quale livello di rischio.

| Dominio | Azioni | Rischio | Regola |
| --- | --- | --- | --- |
| `light` | accendi, spegni, luminosità | basso | subito |
| `switch`, `fan` | accendi, spegni | basso | subito |
| `media_player` | accendi, spegni, volume | basso | subito |
| `climate` | temperatura | medio | subito tra 16 e 24 °C, fuori da lì conferma |
| `cover` | apri, chiudi | medio | conferma |
| `lock` | apri | alto | conferma, solo admin |
| `alarm_control_panel` | disattiva | alto | conferma, solo admin |

Tutto ciò che non è in tabella, July non lo tocca. Non esporre mai servizi come `homeassistant.restart` o `shell_command`.

**✅ Verifica.** La tabella è un oggetto TypeScript con tipi stretti: provare a usare un dominio non elencato deve dare errore di compilazione.

## Passo 2 · L'indice dei dispositivi

**Obiettivo.** All'avvio, e ogni volta che i registri di HA cambiano, costruisci un elenco:

```ts
interface Dispositivo {
  entityId: string      // light.cucina_soffitto
  dominio: string       // light
  nome: string          // friendly_name: "Luce soffitto"
  stanza: string | null // "Cucina", con stanzaDi() della guida 00
  alias: string[]       // nomi alternativi, passo 3
  paroleChiave: string[] // nome + stanza + alias, normalizzati (vedi sotto)
}
```

Escludi le entità nascoste e quelle di configurazione o diagnostica (nel registro hanno `hb` = nascosta, `ec` = categoria).

**La normalizzazione** è metà del lavoro. Una funzione `normalizza(testo): string[]` che:

1. mette tutto in minuscolo;
2. toglie gli accenti: `testo.normalize('NFD').replace(/\p{Diacritic}/gu, '')`;
3. toglie punteggiatura e parole vuote: `il, lo, la, i, gli, le, del, della, dei, delle, nel, nella, in, di, a, da, su, per, e`;
4. riduce i plurali più comuni: confronta le parole sui primi 4–5 caratteri, così `luci` e `luce` coincidono.

**✅ Verifica.** `normalizza("Accendi le Luci della Cucina!")` → `['accendi', 'luci', 'cucina']`.

## Passo 3 · Alias

Le persone non usano i nomi di HA. Tu dici "salotto", HA ha "Soggiorno"; tu dici "la lampada", HA ha "Luce ambiente IKEA". Un file `/mnt/storage/july/casa-alias.json`:

```json
{
  "stanze":      { "salotto": "Soggiorno", "sala": "Soggiorno", "camera": "Camera da letto" },
  "dispositivi": { "lampada": "light.soggiorno_ambiente", "abat jour": "light.camera_comodino" }
}
```

Al passo 5 vedrai come July impara alias nuovi da solo.

## Passo 4 · Corsie 1 e 2

**Corsia 1, frasi fisse.** Poche regex per i comandi che usi ogni giorno. Esempio: `/^(accendi|spegni) (tutto|tutte le luci)$/`. Risposta in pochi millisecondi.

**Corsia 2, Assist di Home Assistant.** HA ha un motore di frasi in italiano che non usa modelli AI:

```http
POST http://127.0.0.1:8123/api/conversation/process
Authorization: Bearer HA_TOKEN
Content-Type: application/json

{ "text": "spegni la luce in cucina", "language": "it" }
```

Risposta (forma dalla documentazione):

```json
{
  "response": {
    "response_type": "action_done",
    "data": { "success": [{ "name": "Cucina", "type": "area", "id": "cucina" }], "failed": [] },
    "speech": { "plain": { "speech": "..." } }
  }
}
```

Regola: se `response_type` è `action_done` e `success` non è vuoto, hai finito. Se è `error`, passa alla corsia 3.

**⚠️ Attenzione: Assist esegue subito, senza le tue conferme.** In HA, *Impostazioni → Assistenti vocali → Esponi*, esponi ad Assist **solo** i dispositivi a rischio basso. Serrature, tapparelle e allarme passano solo dalla tua pipeline, con conferma.

**✅ Verifica.** Prova 10 frasi semplici: misura quante ne capisce Assist. Ti servirà come confronto al passo 9.

## Passo 5 · Corsia 3, Qwen

**Lo schema, scritto una volta sola con Zod:**

```ts
import { z } from 'zod'

const Intento = z.object({
  azione: z.enum(['accendi', 'spegni', 'luminosita', 'temperatura', 'apri', 'chiudi', 'stato', 'nessuna']),
  bersaglio: z.string().describe('dispositivo o stanza, con le parole esatte della persona'),
  esclusi: z.array(z.string()).describe('cose da escludere quando la persona dice "tranne"'),
  valore: z.number().nullable().describe('percentuale o gradi, se detti'),
})
type Intento = z.infer<typeof Intento>

// Lo stesso schema diventa JSON Schema per Ollama e serve anche per validare la risposta
const schemaJSON = z.toJSONSchema(Intento)
```

`'nessuna'` è importante: dà al modello una via d'uscita quando la frase non è un comando di casa. Senza, ne inventa uno.

**La chiamata a Ollama** (stessa forma di `askModel` in `ai.ts`, con in più `format`):

```ts
const risposta = await fetch(`${OLLAMA_URL}/api/chat`, {
  method: 'POST',
  body: JSON.stringify({
    model: AI_MODEL,
    stream: false,
    think: false,
    format: schemaJSON,              // il vincolo
    options: { temperature: 0 },     // stessa frase → stessa risposta
    messages: [
      { role: 'system', content: PROMPT_CASA },   // fisso: Ollama riusa la parte già elaborata
      { role: 'user', content: testo },
    ],
  }),
})
const dati = await risposta.json()
const grezzo = JSON.parse(dati.message.content)   // con format, content è JSON
const intento = Intento.safeParse(grezzo)          // e Zod controlla comunque
```

**Il prompt di sistema** resta identico tra un messaggio e l'altro, così Ollama riusa il lavoro già fatto (lo stesso principio dei ricordi in `ai.ts`). Mettici: cosa deve fare in una frase, il significato di ogni campo e 5–6 esempi completi frase → JSON, compresi un "tranne" e un "nessuna". **Non** metterci l'elenco dei dispositivi: allunga il prompt, rallenta e invita il modello a inventare. La risoluzione la fa il codice.

**Se `safeParse` fallisce:** riprova una volta, poi rispondi "Non ho capito" con 2–3 esempi di frasi che funzionano.

Se Ollama rifiuta lo schema per il campo `nullable` (che diventa un `anyOf`), usa `valore: z.number()` e scrivi nel prompt "metti -1 se non c'è un valore".

**✅ Verifica.** Uno script che manda 10 frasi e stampa intento e tempo. Ogni risposta deve passare la validazione.

## Passo 6 · Risoluzione: dalle parole all'entità

**Obiettivo.** `risolvi(bersaglio, esclusi, azione): Dispositivo[]`.

1. **Filtra per dominio compatibile** con l'azione (`temperatura` → `climate` e sensori; `apri` → `cover`, `lock`).
2. **Bersagli speciali:** "tutto", "tutte le luci", "casa" → tutto il dominio; una stanza da sola ("la cucina") → tutti i dispositivi compatibili di quella stanza.
3. **Punteggio** per ogni dispositivo: quante parole del bersaglio compaiono tra le sue `paroleChiave` (con gli alias). Per gli errori di battitura, conta come uguali due parole a distanza di Levenshtein 1 (una lettera diversa). Bonus se la stanza coincide.
4. **Decisione:** se il primo ha punteggio ≥ 0,6 e supera il secondo di almeno 0,15, prendilo. Altrimenti **chiedi**, con al massimo 4 pulsanti: "Quale luce? [Soffitto] [Sotto pensile] [Tutte e due]".
5. **Impara:** quando scegli un pulsante, salva l'alias (`"luce grande"` → `light.cucina_soffitto`) in `casa-alias.json`. La volta dopo non chiede più.
6. Togli gli `esclusi` risolti con la stessa funzione.

**✅ Verifica.** Una tabella di 15 bersagli con l'entità attesa, eseguita come test (`bun test`).

> **Se ti blocchi** con Levenshtein: è la tabella classica di programmazione dinamica, `d[i][j] = min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i] === b[j] ? 0 : 1))`. Ti basta sapere se è ≤ 1, quindi puoi anche fermarti appena tutta una riga supera 1.

## Passo 7 · Permessi e conferme

```ts
function puo(utente: User, d: Dispositivo, azione: Intento['azione']): 'si' | 'conferma' | 'no'
```

Usa la tabella del passo 1 e il ruolo di `users.ts`. `'conferma'` passa da `chiediConferma` della guida 00. Ricontrolla i permessi **anche dentro** l'azione confermata: tra la domanda e il tocco qualcosa può cambiare.

## Passo 8 · Esegui e verifica

`call_service` risponde "fatto" quando HA ha **mandato** il comando, non quando il dispositivo l'ha eseguito. Una lampadina Zigbee spenta dall'interruttore non risponde, e HA dice comunque "ok".

1. Prima di chiamare, registra un `suCambio` per le entità coinvolte.
2. Chiama il servizio.
3. Aspetta fino a 5 secondi che lo stato diventi quello atteso.
4. Rispondi `✅` per quelle confermate e `⚠️ comando inviato ma non ha risposto` per le altre.

Per le domande (`stato`), leggi dalla cache e formatta in italiano: `(20.5).toLocaleString('it-IT')` → `20,5`.

## Passo 9 · Il banco di prova

È il passo che distingue un giocattolo da una funzione affidabile.

**`frasi.test.json`:** 40 frasi vere, come le diresti tu, con il risultato atteso:

```json
[
  { "frase": "spegni la luce in cucina", "azione": "spegni", "entita": ["light.cucina_soffitto"] },
  { "frase": "metti 21 gradi", "azione": "temperatura", "entita": ["climate.soggiorno"], "valore": 21 },
  { "frase": "che ore sono a tokyo", "azione": "nessuna" }
]
```

Uno script `scripts/valuta-casa.ts` le passa tutte nella pipeline **senza eseguire niente** e stampa: percentuale di azioni giuste, percentuale di entità giuste, quale corsia ha risposto, tempo medio. Ogni volta che cambi il prompt, gli alias o la normalizzazione, lo rilanci. Quando July sbaglia una frase nella vita vera, aggiungila al file.

**✅ Verifica.** Almeno il 90% di entità giuste prima di usarlo tutti i giorni.

## Passo 10 · Collegalo a July

In `index.ts`, prima di `ai`: un gestore che, per i messaggi di testo, prova le corsie 1 e 2 sempre e la 3 solo se il testo contiene un verbo o una parola di casa (una lista come `SERVER_WORDS`: accendi, spegni, luce, luci, temperatura, gradi, tapparella, porta...). Se l'intento è `nessuna`, chiama `next()` e il messaggio arriva ad `ai` come oggi.

---

## Trappole

- **Il modello inventa entità.** Succede solo se gliele lasci scrivere. Non farlo.
- **Assist scavalca le conferme.** Esponi ad Assist solo i dispositivi sicuri (passo 4).
- **Doppia esecuzione.** Se Assist ha già agito, non passare anche alla corsia 3.
- **"Accendi la luce"** in una casa con 12 luci: chiedi, non indovinare.
- **Telegram vede i comandi.** "Apri la porta" passa dai server di Telegram. Per questo serrature e allarme vogliono conferma e ruolo admin.

## Per andare oltre

- **Frasi di seguito:** salva per 2 minuti l'ultimo intento di ogni persona. "E in camera?" diventa lo stesso intento con un bersaglio nuovo.
- **Scene di July:** `scene.json` con "modalità film" = luci al 10%, TV accesa. Un'azione in più nello schema.
- **"Spegni tra 10 minuti":** un campo `ritardoMinuti` nello schema e un lavoro una tantum (croner accetta anche una data al posto del cron).

## Fonti

- ✔︎ Ollama, structured outputs e tools: https://github.com/ollama/ollama/blob/main/docs/api.md
- ✔︎ Zod, `z.toJSONSchema`: https://zod.dev/json-schema
- ✔︎ Home Assistant, Conversation API: https://developers.home-assistant.io/docs/intent_conversation_api
- ✔︎ Home Assistant, WebSocket (`call_service`, registro entità): https://developers.home-assistant.io/docs/api/websocket
- Home Assistant, esporre entità ad Assist: https://www.home-assistant.io/voice_control/voice_remote_expose_devices/ (da verificare)
- Distanza di Levenshtein: https://it.wikipedia.org/wiki/Distanza_di_Levenshtein (da verificare)
