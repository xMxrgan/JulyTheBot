// ─────────────────────────────────────────────────────────────────────────────
// features/link.ts — mandi un link a July: scarica il contenuto e te lo
// rimanda NEL SUO FORMATO (video, audio, foto, GIF o file) nel topic "Link".
//
// Il viaggio di un link:
//   1. ricevuto      → July mette 👀 sul tuo messaggio
//   2. cartella      → crea il topic "Link" la prima volta, poi riusa sempre quello
//   3. coda          → un download alla volta, così il bot resta reattivo
//   4. scaricamento  → pagina web (YouTube, Instagram, TikTok…)  = yt-dlp
//                      link diretto a un file (pdf, zip, mp4…)   = curl
//   5. invio         → ffprobe capisce cos'è, sendMedia lo spedisce nel formato giusto
//   6. pulizia       → cancella SEMPRE la cartella temporanea e 👀 diventa 👍
//
// La cartella di lavoro è solo di passaggio: dopo l'invio non resta niente sul Pi.
// All'avvio July la svuota anche dagli avanzi di un crash o di uno spegnimento brusco.
//
// Nessun pacchetto npm nuovo: servono yt-dlp, ffmpeg e curl installati sul Pi.
// ─────────────────────────────────────────────────────────────────────────────

import { Composer, type Api } from 'grammy'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { inspect, sendMedia } from './media'
import { forgetTopic, getTopic } from './topics'

// ─── Impostazioni ────────────────────────────────────────────────────────────

// Il tuo ID Telegram: July accetta i link solo da te
const ME = 120075267

// Nome della cartella (topic) in cui arrivano i file
const TOPIC_NAME = 'Link'

// Cartella di lavoro TEMPORANEA sull'SSD (mai sulla microSD).
// Ogni download ha la sua sottocartella, cancellata sempre dopo l'invio.
// Sul Mac, per il bot di sviluppo, la cambi con JULY_WORK_DIR nel .env.
const WORK_DIR = process.env.JULY_WORK_DIR ?? '/mnt/storage/july-downloads'

// Con il Bot API server locale (july-api) Telegram accetta file fino a 2000 MB.
// Oltre questo limite non lo scarichiamo proprio (o lo cancelliamo subito).
const MAX_MB = 2000

// Un download che dura più di 30 minuti viene interrotto
const TIMEOUT_MS = 30 * 60 * 1000

// Opzioni di yt-dlp: ogni opzione e ogni valore sono elementi separati dell'array
const YTDLP_ARGS = [
  '--no-playlist',                // link dentro una playlist → scarica solo quel video
  '-S', 'res:1080,vcodec:h264,ext:mp4:m4a', // ≤1080p, h264 in mp4 / audio m4a: Telegram li riproduce così come sono
  '--merge-output-format', 'mp4', // unisce video e audio in un unico mp4 (lo fa ffmpeg)
  '--embed-metadata',             // scrive titolo e artista dentro il file (poi li legge ffprobe)
  '--max-filesize', `${MAX_MB}M`, // se sa già che è troppo grande, non lo scarica neanche
  '-o', '%(title).80B.%(ext)s',   // nome del file = titolo del video, al massimo 80 caratteri
  '--no-progress',                // niente barra di avanzamento nei log
]

// ─── Tipi ────────────────────────────────────────────────────────────────────

// Il risultato di un download (discriminated union): il campo `kind` dice in
// quale caso siamo, e dentro lo `switch` TypeScript sa quali campi esistono.
type DownloadResult =
  | { kind: 'ok'; path: string; name: string; mb: number }
  | { kind: 'tooBig' }
  | { kind: 'error'; reason: string }

// Dove lavora un download
type Target = {
  chatId: number
  threadId: number | undefined // undefined = topic non disponibili → chat normale
  statusId: number             // il messaggio "⏳ / ⬇️ / 📤" che July aggiorna
  linkMsgId: number            // il tuo messaggio col link, su cui mette le reazioni
}

// ─── Coda: un download alla volta ────────────────────────────────────────────
// Il Pi non si sovraccarica (film e musica restano fluidi) e July continua a
// rispondere agli altri messaggi mentre scarica.
// La coda parte con la pulizia: il primo download aspetta che sia finita.
let queue: Promise<void> = cleanWorkDir().catch((err) => console.error('[link] pulizia iniziale:', err))

function enqueue(job: () => Promise<void>) {
  // Il nuovo lavoro parte solo quando è finito quello prima
  queue = queue.then(job).catch((err) => console.error('[link]', err))
}

// All'avvio nessun download è in corso (la coda vive in memoria), quindi tutto
// quello che c'è in WORK_DIR è un avanzo: lo cancelliamo. Svuotiamo il contenuto
// e non la cartella stessa, perché morgan non ha i permessi per ricrearla.
async function cleanWorkDir() {
  await mkdir(WORK_DIR, { recursive: true })
  for (const entry of await readdir(WORK_DIR)) {
    await rm(join(WORK_DIR, entry), { recursive: true, force: true })
  }
}

// Per lo spegnimento "gentile": restituisce la coda, così puoi aspettarla
export function waitForDownloads() {
  return queue
}

// ─── Il gestore dei messaggi ─────────────────────────────────────────────────
export const link = new Composer()

// 'message:entities:url' = messaggi di testo in cui Telegram ha riconosciuto un link
link.on('message:entities:url', async (ctx, next) => {
  if (ctx.from?.id !== ME) return next()

  // Prendiamo il primo link del messaggio
  let url = ctx.entities('url')[0]?.text ?? ''

  // Telegram riconosce come link anche "youtube.com/..." senza https:// davanti.
  // Lo aggiungiamo noi: così il link inizia SEMPRE con http(s):// e non può
  // essere scambiato per un'opzione dei programmi (tipo "--exec").
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  try {
    await ctx.react('👀').catch(() => {}) // "ricevuto" (se fallisce, pazienza)
    const target = await openStatus(ctx.api, ctx.chat.id, ctx.msg.message_id, url)

    // Niente await qui: il download va in coda e questo gestore finisce subito
    enqueue(() => handleLink(ctx.api, target, url))
  } catch (err) {
    await ctx.reply(`❌ Non riesco a preparare il download: ${errorText(err)}`)
  }
})

// ─── Messaggio di stato nel topic "Link" ─────────────────────────────────────
// Se hai cancellato il topic a mano, Telegram risponde "message thread not
// found": lo dimentichiamo, lo ricreiamo e riproviamo una volta sola.
async function openStatus(api: Api, chatId: number, linkMsgId: number, url: string): Promise<Target> {
  const attempt = async (): Promise<Target> => {
    const threadId = await getTopic(api, chatId, TOPIC_NAME)
    const status = await api.sendMessage(chatId, `⏳ In coda\n${url}`, {
      message_thread_id: threadId,
      link_preview_options: { is_disabled: true }, // niente anteprima del sito
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

// ─── Un download completo: scarica, invia, pulisci ───────────────────────────
async function handleLink(api: Api, t: Target, url: string) {
  // Aggiorna il messaggio di stato (se non ci riesce, pazienza)
  const setStatus = (text: string) =>
    api
      .editMessageText(t.chatId, t.statusId, text, { link_preview_options: { is_disabled: true } })
      .catch(() => {})

  await setStatus(`⬇️ Scarico…\n${url}`)

  // Cartella tutta per questo download, es. /mnt/storage/july-downloads/job-a1B2c3
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
    // Errori imprevisti, per esempio l'invio a Telegram che fallisce
    await setStatus(`❌ Errore: ${errorText(err)}`)
  } finally {
    // Pulizia: la cartella del download sparisce SEMPRE, qualunque cosa sia successa
    await rm(dir, { recursive: true, force: true })
  }
}

// ─── Scarica il link dentro `dir` ────────────────────────────────────────────
async function download(url: string, dir: string): Promise<DownloadResult> {
  let output = '' // quello che il programma scrive: serve per capire se ha rinunciato
  try {
    if (await isWebPage(url)) {
      // -P = cartella in cui salvare
      output = await run('yt-dlp', [...YTDLP_ARGS, '-P', dir, url])
    } else {
      output = await run('curl', [
        '--fail',                   // errore se il server risponde 404, 403…
        '--location',               // segue i redirect
        '--silent', '--show-error', // non scrive niente, tranne gli errori
        '--remote-name',            // salva col nome del file sul server…
        '--remote-header-name',     // …o con quello che il server suggerisce
        '--max-filesize', `${MAX_MB}M`, // si ferma se il file è troppo grande
        '--output-dir', dir,
        url,
      ])
    }
  } catch (err) {
    const reason = errorText(err)
    // curl, quando il file supera --max-filesize, si ferma con l'errore 63
    if (reason.includes('(63)')) return { kind: 'tooBig' }
    return { kind: 'error', reason }
  }

  // La cartella è solo di questo download, quindi l'unico file lì dentro è il nostro
  const [name] = await readdir(dir)
  if (!name) {
    // yt-dlp invece non dà errore: scrive "File is larger than max-filesize" e non scarica niente
    if (output.includes('larger than max-filesize')) return { kind: 'tooBig' }
    return { kind: 'error', reason: 'nessun file scaricato' }
  }

  const path = join(dir, name)
  const mb = Math.ceil((await stat(path)).size / (1024 * 1024))

  // Ultimo controllo: a volte il peso si scopre solo a download finito (video + audio uniti)
  if (mb > MAX_MB) return { kind: 'tooBig' }
  return { kind: 'ok', path, name, mb }
}

// ─── Pagina web o file? ──────────────────────────────────────────────────────
// Chiede al server solo le intestazioni (richiesta HEAD, non scarica niente)
// e guarda il Content-Type: "text/html" = pagina web, qualsiasi altra cosa = file.
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

// ─── Lancia un programma esterno in modo sicuro ──────────────────────────────
const execFileAsync = promisify(execFile)

// execFile (NON exec): il programma riceve gli argomenti uno per uno, senza
// passare dalla shell. Un link che contiene "; rm -rf ~" resta solo testo.
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
