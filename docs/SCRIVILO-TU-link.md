# Scrivilo tu: la feature Link di July

Mandi un link a July e lui ti rimanda il contenuto **nel suo formato**:

| Il link porta a… | July lo rimanda come… |
|---|---|
| un video (YouTube, Instagram, TikTok, X…) | **video** riproducibile in chat, con durata e proporzioni giuste |
| un brano (SoundCloud, Bandcamp, un .mp3…) | **audio** nel player di Telegram, con titolo e artista |
| un'immagine | **foto** |
| una GIF | **animazione** che si ripete da sola |
| qualsiasi altra cosa (pdf, zip, mkv…) | **file**, intatto |

Tutto arriva nella cartella (topic) **Link** della chat.

## Come usare questa guida

Ogni passo aggiunge un pezzo che puoi provare subito. La struttura è sempre la stessa:

- **Obiettivo:** cosa deve fare il codice alla fine del passo.
- **Ti serve:** le API e i concetti da usare.
- **Indizi:** le trappole da evitare.
- **Prova:** come verificare che funzioni.
- **Soluzione:** nascosta dentro *▶ Soluzione*. Aprila solo dopo averci provato.

Alla fine trovi le soluzioni complete nei file `link.ts`, `media.ts` e `topics.ts`. Sono controllate con TypeScript `strict`; la parte che riconosce i file è stata provata su video, audio, immagini, GIF, pdf, zip e altri formati reali.

**File che scriverai:**
- `features/link.ts`: riceve il link, lo scarica, gestisce coda e messaggi.
- `features/media.ts`: capisce che cos'è un file e lo spedisce nel formato giusto. È riusabile da altre feature.
- `features/topics.ts`: ce l'hai già dalla guida precedente, lo riusi così com'è.

### Perché questa versione è più versatile e di qualità

- **Non ricodifichiamo mai.** Già al download chiediamo a yt-dlp i formati che Telegram riproduce così come sono (video h264 in mp4, audio m4a/mp3). Niente conversioni, quindi niente perdita di qualità e niente lavoro extra per il Pi.
- **I metadati fanno la differenza.** Se passi a Telegram larghezza, altezza e durata, il video appare con le proporzioni giuste e la durata visibile. Titolo e artista fanno comparire il brano nel player musicale.
- **Quando un formato non si riproduce in chat** (webm, mkv, ogg), lo mandiamo come file intatto invece di convertirlo.
- **Le foto sono l'unico compromesso:** `sendPhoto` le comprime. Con un interruttore (`PHOTOS_AS_FILES`) scegli tu se preferisci gli originali.

---

## Passo 0 — Prepara il terreno (Mac)

**Obiettivo:** poter provare tutto col **bot di sviluppo**, senza toccare July sul Pi.

**1. Installa yt-dlp e ffmpeg sul Mac.** ffmpeg porta con sé anche `ffprobe`, che userai al passo 5.

```bash
brew install yt-dlp ffmpeg
```

**2. Attiva i topic anche per il bot di sviluppo.** In @BotFather apri il bot di sviluppo → **Bot Settings** → **Threaded Mode**.

**3. Dai al bot di sviluppo cartelle sue.** `/mnt/storage` esiste solo sul Pi. Nel `.env` che usi per il bot di sviluppo aggiungi:

```bash
JULY_WORK_DIR=./tmp/downloads
JULY_DATA_DIR=./tmp/data
```

Poi aggiungi `tmp/` al `.gitignore`, così i file scaricati non finiscono nel repo:

```bash
echo "tmp/" >> .gitignore
```

**4. Crea il file vuoto e registralo.** Crea `features/link.ts`. In `index.ts` montalo prima del gestore dell'LLM, altrimenti i link finiscono a Qwen:

```ts
import { link } from './features/link'
bot.use(link)
```

**5. Avvia il bot di sviluppo** come fai di solito, meglio con `--watch` così si riavvia da solo a ogni salvataggio:

```bash
bun --watch index.ts
```

---

## Passo 1 — Accorgersi dei link

**Obiettivo:** quando mandi un messaggio con un link, il bot risponde "🔍" seguito dal link.

**Ti serve:**
- `new Composer()`: il "pezzo" di bot che esporti da `link.ts`.
- La filter query `'message:entities:url'`: si attiva solo per i messaggi in cui Telegram ha riconosciuto un link.
- `ctx.entities('url')`: restituisce i link del messaggio, ognuno col campo `.text`.

**Indizi:**
- Telegram riconosce come link anche `youtube.com/watch?v=…` senza `https://`. Aggiungilo tu quando manca. Così il link inizia sempre con `http(s)://` e nessuno può farlo passare per un'opzione di un programma (tipo `--exec`).
- Se il messaggio non viene da te, chiama `next()`: lo lasci passare alle altre feature, senza rispondere.

**Prova:** manda `guarda youtube.com/watch?v=abc` → il bot risponde `🔍 https://youtube.com/watch?v=abc`.

<details><summary>▶ Soluzione</summary>

```ts
import { Composer } from 'grammy'

// Il tuo ID Telegram: July accetta i link solo da te
const ME = 120075267

export const link = new Composer()

link.on('message:entities:url', async (ctx, next) => {
  if (ctx.from?.id !== ME) return next()

  // Il primo link del messaggio
  let url = ctx.entities('url')[0]?.text ?? ''

  // Senza https:// davanti? Lo aggiungiamo noi
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  await ctx.reply(`🔍 ${url}`) // TEMPORANEO: lo sostituisci nei prossimi passi
})
```

</details>

---

## Passo 2 — Lanciare programmi in sicurezza

**Obiettivo:** una funzione `run(cmd, args)` che lancia un programma e restituisce il suo output, più una `errorText(err)` che trasforma un errore in una frase leggibile.

**Ti serve:**
- `execFile` da `node:child_process`, reso asincrono con `promisify` da `node:util`.
- Le opzioni `timeout` (per fermare un download bloccato) e `maxBuffer` (lo spazio per l'output).

Questo è il momento giusto per usare **`execFile` invece di `exec`**. Con `execFile` il programma riceve gli argomenti uno per uno, senza passare dalla shell: un link che contiene `; rm -rf ~` resta solo testo. Il link arriva da fuori, quindi questa regola non si discute.

**Indizi:**
- Quando un programma fallisce, l'errore ha un campo `stderr` con il messaggio vero. L'ultima riga di `stderr` è di solito la più utile (per yt-dlp è la riga `ERROR: …`).
- `err` arriva con tipo `unknown`: prima di leggere `stderr` devi dire a TypeScript cosa ti aspetti.

**Prova:** aggiungi un comando temporaneo `/ytv` che risponde con la versione di yt-dlp.

<details><summary>▶ Soluzione</summary>

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Un download che dura più di 30 minuti viene interrotto
const TIMEOUT_MS = 30 * 60 * 1000

const execFileAsync = promisify(execFile)

// execFile (NON exec): argomenti separati, niente shell.
// Restituisce quello che il programma ha scritto in output (stdout).
async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 })
  return stdout
}

// Un messaggio d'errore leggibile: l'ultima riga che il programma ha scritto in stderr
function errorText(err: unknown): string {
  const stderr = (err as { stderr?: string } | null)?.stderr
  const text = stderr?.trim() || String(err)
  return text.split('\n').at(-1) ?? text
}

// TEMPORANEO: per provare run()
link.command('ytv', async (ctx) => ctx.reply(`yt-dlp ${await run('yt-dlp', ['--version'])}`))
```

</details>

---

## Passo 3 — Pagina web o file?

**Obiettivo:** `isWebPage(url)` restituisce `true` se il link è una pagina (da dare a yt-dlp) e `false` se è già un file (da scaricare con curl).

**Ti serve:**
- `fetch(url, { method: 'HEAD', redirect: 'follow' })`: chiede al server solo le intestazioni, senza scaricare niente.
- L'intestazione `content-type`: `text/html` vuol dire pagina web.

**Indizi:**
- Alcuni siti rifiutano le richieste `HEAD` (rispondono 403 o 405), altri non rispondono proprio. In quei casi la scelta più sicura è yt-dlp.
- Mettila in un `try/catch`: un link sbagliato non deve far cadere il bot.

**Prova:** nel gestore, al posto della risposta del passo 1, rispondi "🌐 pagina" o "📄 file". Provalo con un link YouTube e con questo pdf di prova: `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`.

<details><summary>▶ Soluzione</summary>

```ts
// Chiede al server solo le intestazioni e guarda il Content-Type:
// "text/html" = pagina web, qualsiasi altra cosa = file.
async function isWebPage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' })
    if (!res.ok) return true // il server rifiuta la HEAD → lasciamo fare a yt-dlp
    const type = res.headers.get('content-type') ?? ''
    return type.includes('text/html')
  } catch {
    return true // nel dubbio, yt-dlp
  }
}

// TEMPORANEO, dentro il gestore:
await ctx.reply((await isWebPage(url)) ? '🌐 pagina → yt-dlp' : '📄 file → curl')
```

</details>

---

## Passo 4 — Scaricare con la qualità giusta

**Obiettivo:** `download(url, dir)` scarica il contenuto in una cartella e restituisce un `DownloadResult`:
- `ok`, con percorso, nome e peso in MB;
- `tooBig`, se supera 2000 MB;
- `error`, con il motivo.

**Ti serve:**
- `mkdtemp(join(WORK_DIR, 'job-'))` da `node:fs/promises`: crea una cartella dal nome unico per ogni download.
- Una **discriminated union** per il risultato. Questo è il momento giusto per la lezione TS di oggi: il campo `kind` dice in quale caso sei, e TypeScript ti fa usare `reason` solo nel caso `error`.
- `readdir` e `stat` per trovare il file scaricato e il suo peso.

**Le opzioni di yt-dlp che decidono la qualità:**

| Opzione | Cosa fa |
|---|---|
| `--no-playlist` | Se il link è dentro una playlist, scarica solo quel video. |
| `-S res:1080,vcodec:h264,ext:mp4:m4a` | Ordine di preferenza: risoluzione massima 1080p, poi video h264, poi file mp4 per il video e m4a per l'audio. Sono i formati che Telegram riproduce senza conversioni. |
| `--merge-output-format mp4` | Se video e audio arrivano separati, ffmpeg li unisce in un mp4 senza ricodificarli. |
| `--embed-metadata` | Scrive titolo e artista dentro il file. Al passo 5 li leggerà ffprobe. |
| `--max-filesize 2000M` | Se sa già che il file supera il limite di Telegram, non lo scarica neanche: niente spazio sprecato, niente scritture inutili sull'SSD. |
| `-o %(title).80B.%(ext)s` | Il nome del file è il titolo del contenuto, al massimo 80 caratteri. |
| `-P <cartella>` | Dove salvare. |

**Le opzioni di curl per i file diretti:** `--fail` (errore se il server risponde 404), `--location` (segue i redirect), `--silent --show-error`, `--remote-name --remote-header-name` (usa il nome del file sul server), `--max-filesize 2000M` (si ferma se è troppo grande), `--output-dir <cartella>`.

**Indizi:**
- Ogni download ha una cartella tutta sua, quindi il file scaricato è l'**unico** lì dentro. Non devi indovinare il nome che ha scelto yt-dlp.
- Ogni opzione e ogni valore sono elementi separati dell'array: `['-S', 'res:1080,…']`, non `['-S res:1080,…']`.
- **I due programmi rinunciano in modo diverso** quando il file è troppo grande. curl si ferma con un errore che contiene `(63)`. yt-dlp invece **non dà errore**: scrive `File is larger than max-filesize` nel suo output e non scarica niente. Per questo `run()` restituisce l'output: ti serve per accorgertene.
- Il peso a volte si scopre solo a download finito (per esempio quando video e audio vengono uniti): controllalo comunque alla fine.

**Prova:** nel gestore crea la cartella, chiama `download` e rispondi con `JSON.stringify(result)`.

Mentre scarica un video lungo, prova a scrivere qualcos'altro al bot: **non risponde**. È normale per ora, e lo sistemi al passo 7. Tieni a mente il perché: grammY gestisce un messaggio alla volta, e il gestore è fermo ad aspettare il download.

<details><summary>▶ Soluzione</summary>

```ts
import { mkdir, mkdtemp, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// Cartella di lavoro: sul Pi l'SSD, sul Mac quella del .env di sviluppo
const WORK_DIR = process.env.JULY_WORK_DIR ?? '/mnt/storage/july-downloads'

// Con july-api Telegram accetta file fino a 2000 MB
const MAX_MB = 2000

const YTDLP_ARGS = [
  '--no-playlist',
  '-S', 'res:1080,vcodec:h264,ext:mp4:m4a',
  '--merge-output-format', 'mp4',
  '--embed-metadata',
  '--max-filesize', `${MAX_MB}M`,
  '-o', '%(title).80B.%(ext)s',
  '--no-progress',
]

type DownloadResult =
  | { kind: 'ok'; path: string; name: string; mb: number }
  | { kind: 'tooBig' }
  | { kind: 'error'; reason: string }

async function download(url: string, dir: string): Promise<DownloadResult> {
  let output = '' // quello che il programma scrive: serve per capire se ha rinunciato
  try {
    if (await isWebPage(url)) {
      output = await run('yt-dlp', [...YTDLP_ARGS, '-P', dir, url])
    } else {
      output = await run('curl', [
        '--fail', '--location', '--silent', '--show-error',
        '--remote-name', '--remote-header-name',
        '--max-filesize', `${MAX_MB}M`, '--output-dir', dir, url,
      ])
    }
  } catch (err) {
    const reason = errorText(err)
    if (reason.includes('(63)')) return { kind: 'tooBig' } // curl: file troppo grande
    return { kind: 'error', reason }
  }

  // La cartella è solo di questo download: l'unico file lì dentro è il nostro
  const [name] = await readdir(dir)
  if (!name) {
    // yt-dlp non dà errore: lo scrive nell'output e non scarica niente
    if (output.includes('larger than max-filesize')) return { kind: 'tooBig' }
    return { kind: 'error', reason: 'nessun file scaricato' }
  }

  const path = join(dir, name)
  const mb = Math.ceil((await stat(path)).size / (1024 * 1024))

  if (mb > MAX_MB) return { kind: 'tooBig' } // scoperto solo a download finito
  return { kind: 'ok', path, name, mb }
}

// TEMPORANEO, dentro il gestore:
await mkdir(WORK_DIR, { recursive: true })
const dir = await mkdtemp(join(WORK_DIR, 'job-'))
const result = await download(url, dir)
await ctx.reply(JSON.stringify(result))
```

</details>

---

## Passo 5 — Capire che cos'è il file (`media.ts`)

**Obiettivo:** `inspect(path)` guarda dentro il file e restituisce un `Media`: video, audio, foto, animazione o documento, con i dati che servono a Telegram.

**Prima guarda con i tuoi occhi.** Prendi un file scaricato al passo 4 e fanne la "radiografia":

```bash
ffprobe -v error -print_format json -show_format -show_streams tmp/downloads/job-XXXX/nomefile.mp4
```

Vedrai un JSON con:
- `streams`: le tracce del file. Ognuna ha `codec_type` (`video` o `audio`), `codec_name` (`h264`, `aac`, `mjpeg`…), `width` e `height`.
- `format`: contiene `duration` (in secondi, **come stringa**) e `tags` (titolo, artista…).

Fai lo stesso con un mp3, un jpg e un pdf, e guarda come cambia l'output.

**Ti serve:**

```ts
// Il tipo da restituire: un'altra discriminated union, con dati diversi per ogni caso
export type Media =
  | { kind: 'video'; width: number; height: number; duration: number }
  | { kind: 'audio'; duration: number; title?: string; performer?: string }
  | { kind: 'photo' }
  | { kind: 'animation'; width: number; height: number }
  | { kind: 'document' }
```

**Le regole da implementare, nell'ordine:**

| Se ffprobe dice… | Allora è… |
|---|---|
| ffprobe fallisce (pdf, zip…) | `document` |
| traccia video con codec `mjpeg` o `png`, sotto i 10 MB e con larghezza + altezza ≤ 10000 | `photo` |
| traccia video con codec `gif` | `animation` |
| traccia video ed estensione `.mp4` | `video` |
| nessuna traccia video, una traccia audio, estensione `.mp3` o `.m4a` | `audio` |
| tutto il resto (webm, mkv, ogg…) | `document` |

**Indizi, cioè le trappole vere:**
- **Le copertine ingannano.** Un mp3 con copertina ha una traccia "video" che è solo un'immagine, segnata con `disposition.attached_pic: 1`. Va ignorata, altrimenti l'mp3 non sarà mai riconosciuto come audio.
- **Il jpg si chiama `mjpeg`** per ffprobe.
- **I nomi dei tag cambiano maiuscole** a seconda del formato (`title`, `TITLE`): portali tutti in minuscolo prima di leggerli.
- **La durata è una stringa** (`"212.48"`): `Math.round(Number(...) || 0)`.
- Descrivi con un tipo **solo i campi del JSON che usi**, non tutto l'output di ffprobe.

**Prova senza Telegram:**

```bash
bun -e "import { inspect } from './features/media'; console.log(await inspect('percorso/del/file'))"
```

<details><summary>▶ Soluzione</summary>

```ts
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// true = le foto arrivano come file originali (nessuna compressione)
const PHOTOS_AS_FILES = false

const PHOTO_MAX_MB = 10        // limiti di Telegram per sendPhoto
const PHOTO_MAX_SIDES = 10_000 // larghezza + altezza
const PHOTO_CODECS = ['mjpeg', 'png']

// Solo i campi dell'output di ffprobe che usiamo
type ProbeStream = {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  disposition?: { attached_pic?: number } // 1 = copertina di un mp3, non un video
}
type Probe = {
  streams?: ProbeStream[]
  format?: { duration?: string; tags?: Record<string, string> }
}

export async function inspect(path: string): Promise<Media> {
  let probe: Probe
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path,
    ])
    probe = JSON.parse(stdout)
  } catch {
    return { kind: 'document' } // ffprobe non lo capisce: pdf, zip…
  }

  const streams = probe.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const audio = streams.find((s) => s.codec_type === 'audio')
  const ext = extname(path).toLowerCase()
  const duration = Math.round(Number(probe.format?.duration) || 0)
  const width = video?.width ?? 0
  const height = video?.height ?? 0

  if (video && PHOTO_CODECS.includes(video.codec_name ?? '')) {
    const mb = (await stat(path)).size / (1024 * 1024)
    const fits = mb <= PHOTO_MAX_MB && width + height <= PHOTO_MAX_SIDES
    return fits && !PHOTOS_AS_FILES ? { kind: 'photo' } : { kind: 'document' }
  }

  if (video?.codec_name === 'gif') return { kind: 'animation', width, height }

  if (video && ext === '.mp4') return { kind: 'video', width, height, duration }

  if (!video && audio && (ext === '.mp3' || ext === '.m4a')) {
    const tags = lowerKeys(probe.format?.tags)
    return { kind: 'audio', duration, title: tags.title, performer: tags.artist }
  }

  return { kind: 'document' }
}

// title, TITLE, Title… → tutto minuscolo
function lowerKeys(tags: Record<string, string> = {}): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]))
}
```

</details>

---

## Passo 6 — Spedire nel formato giusto (`media.ts`)

**Obiettivo:** `sendMedia(api, destinazione, path, media)` sceglie il metodo di Telegram giusto e gli passa i dati per mostrare bene il contenuto.

**Ti serve:**

| `media.kind` | Metodo | Opzioni che migliorano la resa |
|---|---|---|
| `video` | `sendVideo` | `width`, `height`, `duration`, `supports_streaming: true` |
| `audio` | `sendAudio` | `duration`, `title`, `performer` |
| `photo` | `sendPhoto` | — |
| `animation` | `sendAnimation` | `width`, `height` |
| `document` | `sendDocument` | `disable_content_type_detection: true` (resta un file, Telegram non prova a "interpretarlo") |

Tutti i metodi accettano `message_thread_id` (il topic) e `caption` (la didascalia). Il file si passa con `new InputFile(path)`: grammY lo legge direttamente dal disco.

**Il trucco da imparare: il controllo di completezza.** Nel `default` dello `switch` assegna `media` a una variabile di tipo `never`. Se un giorno aggiungi un caso a `Media` (per esempio `voice`) e ti dimentichi di gestirlo qui, TypeScript segna errore. È lo stesso concetto della lezione sulle discriminated unions, applicato a qualcosa di reale.

**Prova:** nel gestore, al posto del `JSON.stringify` del passo 4, spedisci il file. `result` è una union: prima di usare `result.path` devi controllare `result.kind === 'ok'`. TypeScript non ti lascia fare altrimenti, ed è proprio quello che vuoi.

Prova almeno: un video YouTube corto, un brano SoundCloud, un'immagine diretta (`.jpg`), una GIF, il pdf di prova.

<details><summary>▶ Soluzione</summary>

```ts
import { InputFile, type Api } from 'grammy'

export type Destination = { chatId: number; threadId?: number; caption?: string }

export async function sendMedia(api: Api, to: Destination, path: string, media: Media) {
  const file = new InputFile(path)
  const common = { message_thread_id: to.threadId, caption: to.caption }

  switch (media.kind) {
    case 'video':
      return api.sendVideo(to.chatId, file, {
        ...common,
        width: media.width,
        height: media.height,
        duration: media.duration,
        supports_streaming: true,
      })
    case 'audio':
      return api.sendAudio(to.chatId, file, {
        ...common,
        duration: media.duration,
        title: media.title,
        performer: media.performer,
      })
    case 'photo':
      return api.sendPhoto(to.chatId, file, common)
    case 'animation':
      return api.sendAnimation(to.chatId, file, { ...common, width: media.width, height: media.height })
    case 'document':
      return api.sendDocument(to.chatId, file, { ...common, disable_content_type_detection: true })
    default: {
      const unhandled: never = media // errore di TypeScript se manca un caso
      throw new Error(`Tipo non gestito: ${JSON.stringify(unhandled)}`)
    }
  }
}

// TEMPORANEO, nel gestore di link.ts:
if (result.kind === 'ok') {
  await sendMedia(ctx.api, { chatId: ctx.chat.id, caption: url }, result.path, await inspect(result.path))
}
```

</details>

---

## Passo 7 — Cartella Link, coda e messaggi di stato

**Obiettivo:** trasformare il prototipo nella feature vera:
1. 👀 sul tuo messaggio quando arriva il link.
2. "⏳ In coda" nel topic Link, che si aggiorna in "⬇️ Scarico…" e "📤 Invio…".
3. Il bot resta reattivo mentre scarica (il problema che hai visto al passo 4).
4. Alla fine il messaggio di stato sparisce e 👀 diventa 👍.
5. Sul server non resta niente: la cartella del download viene **sempre** cancellata, e all'avvio July svuota anche gli avanzi di un crash.

**Ti serve:**
- `getTopic(api, chatId, 'Link')` da `topics.ts`, che hai già.
- `ctx.react('👀')` e `api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji: '👍' }])`.
- `api.sendMessage` per lo stato iniziale e `api.editMessageText` per aggiornarlo.
- **Una coda fatta con le Promise.** Una variabile `queue` che parte da `Promise.resolve()`. Ogni nuovo lavoro si aggancia con `queue = queue.then(job)`, così parte solo quando è finito quello prima.
- `try / catch / finally`: `finally` gira **sempre**, anche dopo un errore. È il posto giusto per la pulizia.
- Una funzione `cleanWorkDir()` che all'avvio svuota `WORK_DIR`. `finally` non basta: se July viene spento di colpo (crash, corrente, riavvio forzato), non arriva mai a eseguirlo.

**Indizi:**
- La chiave per un bot reattivo: nel gestore **non** fai `await` del download. Lo metti in coda e il gestore finisce subito, così grammY può passare al messaggio successivo.
- Aggiungi `.catch` alla coda: se un lavoro fallisce, la catena non deve rompersi per quelli dopo.
- Un tipo `Target` (`chatId`, `threadId`, `statusId`, `linkMsgId`) evita di passare quattro parametri sciolti in giro.
- Se hai cancellato a mano il topic Link, Telegram risponde con un errore che contiene `thread not found`. Allora `forgetTopic` e riprova **una volta sola**.
- Esporta una `waitForDownloads()` che restituisce la coda: lo spegnimento gentile potrà aspettarla.
- **Pulizia all'avvio senza rischi:** la coda vive in memoria, quindi quando July parte nessun download è in corso e tutto quello che trovi in `WORK_DIR` è un avanzo. Il trucco più semplice è far *partire* la coda con la pulizia: il primo download aspetterà che sia finita.
- **Trappola dei permessi:** svuota il *contenuto* di `WORK_DIR`, non cancellare la cartella stessa. `/mnt/storage` è di root, quindi morgan non riuscirebbe a ricrearla.

**Prova:**
- Manda due link uno dopo l'altro: il secondo resta "⏳ In coda" finché il primo non è finito.
- Mentre scarica, scrivi qualcos'altro: il bot risponde.
- Cancella il topic Link e manda un link: il topic viene ricreato.
- Manda un link rotto: lo stato diventa ❌ con il motivo.
- Crea un file a caso in `WORK_DIR`, riavvia il bot: il file sparisce. Dopo ogni invio, `WORK_DIR` è vuota.

<details><summary>▶ Soluzione</summary>

```ts
import { Composer, type Api } from 'grammy'
import { rm } from 'node:fs/promises'
import { inspect, sendMedia } from './media'
import { forgetTopic, getTopic } from './topics'

const TOPIC_NAME = 'Link'

type Target = {
  chatId: number
  threadId: number | undefined // undefined = topic non disponibili → chat normale
  statusId: number             // il messaggio "⏳ / ⬇️ / 📤" che July aggiorna
  linkMsgId: number            // il tuo messaggio col link, per le reazioni
}

// ─── Coda: un download alla volta. Parte con la pulizia degli avanzi ───
let queue: Promise<void> = cleanWorkDir().catch((err) => console.error('[link] pulizia iniziale:', err))

// All'avvio nessun download è in corso: tutto quello che c'è in WORK_DIR è un avanzo.
// Svuotiamo il contenuto, non la cartella (morgan non potrebbe ricrearla).
async function cleanWorkDir() {
  await mkdir(WORK_DIR, { recursive: true })
  for (const entry of await readdir(WORK_DIR)) {
    await rm(join(WORK_DIR, entry), { recursive: true, force: true })
  }
}

function enqueue(job: () => Promise<void>) {
  queue = queue.then(job).catch((err) => console.error('[link]', err))
}

export function waitForDownloads() {
  return queue
}

// ─── Il gestore (versione finale) ───
link.on('message:entities:url', async (ctx, next) => {
  if (ctx.from?.id !== ME) return next()

  let url = ctx.entities('url')[0]?.text ?? ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  try {
    await ctx.react('👀').catch(() => {})
    const target = await openStatus(ctx.api, ctx.chat.id, ctx.msg.message_id, url)
    enqueue(() => handleLink(ctx.api, target, url)) // niente await: il gestore finisce subito
  } catch (err) {
    await ctx.reply(`❌ Non riesco a preparare il download: ${errorText(err)}`)
  }
})

// ─── Messaggio di stato nel topic, con un nuovo tentativo se il topic è stato cancellato ───
async function openStatus(api: Api, chatId: number, linkMsgId: number, url: string): Promise<Target> {
  const attempt = async (): Promise<Target> => {
    const threadId = await getTopic(api, chatId, TOPIC_NAME)
    const status = await api.sendMessage(chatId, `⏳ In coda\n${url}`, {
      message_thread_id: threadId,
      link_preview_options: { is_disabled: true },
    })
    return { chatId, threadId, statusId: status.message_id, linkMsgId }
  }

  try {
    return await attempt()
  } catch (err) {
    if (!/thread not found/i.test(String(err))) throw err
    await forgetTopic(chatId, TOPIC_NAME)
    return attempt()
  }
}

// ─── Un download completo: scarica, invia, pulisci ───
async function handleLink(api: Api, t: Target, url: string) {
  const setStatus = (text: string) =>
    api
      .editMessageText(t.chatId, t.statusId, text, { link_preview_options: { is_disabled: true } })
      .catch(() => {})

  await setStatus(`⬇️ Scarico…\n${url}`)
  await mkdir(WORK_DIR, { recursive: true })
  const dir = await mkdtemp(join(WORK_DIR, 'job-'))

  try {
    const result = await download(url, dir)

    switch (result.kind) {
      case 'ok':
        await setStatus(`📤 Invio ${result.name} (${result.mb} MB)…`)
        await sendMedia(api, { chatId: t.chatId, threadId: t.threadId, caption: `🔗 ${url}`.slice(0, 1024) },
          result.path, await inspect(result.path))
        await api.deleteMessage(t.chatId, t.statusId).catch(() => {})
        await api
          .setMessageReaction(t.chatId, t.linkMsgId, [{ type: 'emoji', emoji: '👍' }])
          .catch(() => {})
        break

      case 'tooBig':
        await setStatus(`📦 Troppo grande per Telegram (oltre ${MAX_MB} MB): non lo tengo sul server.`)
        break

      case 'error':
        await setStatus(`❌ Non sono riuscito a scaricarlo:\n${result.reason}`)
        break
    }
  } catch (err) {
    await setStatus(`❌ Errore: ${errorText(err)}`)
  } finally {
    await rm(dir, { recursive: true, force: true }) // SEMPRE, qualunque cosa sia successa
  }
}
```

Ricordati di togliere il comando `/ytv` e le risposte temporanee dei passi precedenti.

</details>

---

## Passo 8 — Su July vero (Pi)

**1. Prerequisiti sul Pi.** Se non li hai ancora fatti, segui i passi 1–4 della sezione 2 di `GUIDA-JULY.md`: topic attivi, july-api aggiornato, yt-dlp, ffmpeg e cartelle. ffmpeg porta con sé anche `ffprobe`.

**2. Controlla che ffprobe ci sia:**

```bash
ffprobe -version | head -1
```

**3. Deploy dal Mac.** `git add` aggiunge i tre file, `git commit` li salva nella storia, `git push pi main` li manda al Pi, che compila, controlla i tipi e riavvia July:

```bash
git add features/link.ts features/media.ts features/topics.ts index.ts && git commit -m "feat: link nel formato originale, nel topic Link" && git push pi main
```

**4. Collaudo finale:**

| Manda | Deve arrivare |
|---|---|
| un video YouTube corto | video con durata visibile, proporzioni giuste, si avvia subito |
| un brano SoundCloud | audio con titolo e artista nel player |
| un link diretto a un `.jpg` | foto |
| un link diretto a una `.gif` | animazione |
| il pdf di prova | file |
| un link rotto | ❌ con il motivo |

---

## Esercizi bonus: ancora più versatilità

Ognuno è indipendente. Scegli quello che ti incuriosisce di più.

### A. Anteprima per i video

Con un'anteprima il video in chat ha una copertina vera invece del primo fotogramma.
- Aggiungi a yt-dlp `--write-thumbnail --convert-thumbnails jpg`.
- Telegram vuole un JPEG di massimo 320 px e meno di 200 kB. Riducilo con ffmpeg: `ffmpeg -i in.jpg -vf scale=320:-1 out.jpg`. È l'occasione per riusare `run()`.
- Passalo a `sendVideo` con `thumbnail: new InputFile(percorso)`.
- **Trappola:** ora nella cartella ci sono due file, quindi `readdir()[0]` non basta più. Scegli il file giusto in base all'estensione.

### B. Post con più contenuti (caroselli)

Un post Instagram o X può contenere più foto e video. yt-dlp li scarica tutti nella stessa cartella.
- Gestisci più file in `download()`: il risultato `ok` potrebbe avere una lista di percorsi.
- Spediscili insieme con `sendMediaGroup`, da 2 a 10 elementi per volta.
- **Regola di Telegram:** foto e video si possono mischiare nello stesso gruppo; audio solo con audio, documenti solo con documenti.

### C. Foto dai social: lo strumento giusto è gallery-dl

yt-dlp è fatto per i video: sui post fatti solo di immagini (Instagram, X, Reddit, Pinterest…) risponde che non c'è nessun video. Per quelli lo strumento migliore è **gallery-dl**.
- Usalo come seconda scelta: se yt-dlp fallisce con un errore tipo "No video formats found" / "There is no video in this post", riprova con `gallery-dl -D <cartella> <url>`.
- Sul Pi si installa con pipx (`sudo apt install -y pipx && pipx install gallery-dl`). Nel codice usa il percorso completo, `/home/morgan/.local/bin/gallery-dl`, perché il servizio systemd non vede `~/.local/bin`.

### D. Scegli tu il formato con i bottoni

Dopo il download July chiede "🎬 Video / 🎵 Solo audio / 📄 File" con una tastiera inline (sezione 3.5 di `GUIDA-JULY.md`).
- "Solo audio" estrae la traccia **senza ricodificarla**: `ffmpeg -i video.mp4 -vn -c:a copy audio.m4a`.
- **Trappola:** `callback_data` ha al massimo 64 byte, quindi non ci sta un percorso. Salva i dati in una `Map` con una chiave corta e metti nel bottone solo quella chiave.

### E. Barra di avanzamento

yt-dlp può scrivere i progressi riga per riga: `--newline --progress-template "%(progress._percent_str)s"`.
- Per leggerli **mentre** scarica ti serve `spawn` invece di `execFile`, ascoltando `stdout`.
- Aggiorna il messaggio di stato al massimo ogni 3–5 secondi, per restare dentro i limiti di Telegram (sezione 3.12 di `GUIDA-JULY.md`).
