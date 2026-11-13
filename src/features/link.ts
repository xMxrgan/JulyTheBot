/**
 * link.ts: mandi un link a July e lui ti rimanda la foto o il video. Tutto in un file.
 *
 * In index.ts va registrato PRIMA di authenticate:
 *   bot.use(link);
 *   bot.use(authenticate);
 *   bot.use(upload);
 * Perché prima: nel gruppo ammesso scrivono anche persone che non sono nel tuo
 * database. link.ts fa da solo i suoi controlli e ferma TUTTI gli altri messaggi
 * di quel gruppo, così authenticate non ti manda una notifica per ognuno.
 *
 * Il viaggio di un link:
 *   1. 👀 sul tuo messaggio, "⏳ In coda" nel topic 🔗 Link
 *   2. controlli di sicurezza (vedi sotto)
 *   3. download in una cartella temporanea, dentro una sandbox
 *   4. ogni file viene verificato: passano solo foto, video, GIF e audio veri
 *   5. invio nel formato giusto (foto, video, album…) nel topic 🔗 Link,
 *      più una copia nel topic 🔗 Link del gruppo archivio (se c'è ARCHIVE_GROUP_ID)
 *   6. la cartella temporanea viene cancellata: sul Pi non resta niente
 *
 * SICUREZZA, a strati (se uno cede, c'è il successivo):
 *   1. Solo tu in chat privata, oppure chiunque nei gruppi di ALLOWED_GROUP_IDS.
 *   2. Solo https. Niente IP scritti nel link, porte strane, password nel link,
 *      nomi "di casa" (localhost, mcloud, *.local, *.ts.net…).
 *   3. Anti-SSRF: il dominio deve puntare a Internet. Se il DNS risponde con un
 *      indirizzo della tua rete, della tailnet o del Pi stesso, il link è bloccato.
 *      Lo stesso controllo vale per ogni redirect.
 *   4. Pagine web solo dai siti della lista PLATFORMS. Da tutti gli altri si accettano
 *      solo link diretti a immagini, video e audio. L'estrattore "generico" di yt-dlp è spento.
 *   5. Sandbox (bubblewrap): yt-dlp, gallery-dl e ffmpeg vedono il sistema in sola
 *      lettura, NON vedono /home e /mnt (token, .env, i tuoi file), non ricevono le
 *      variabili d'ambiente di July e possono scrivere solo nella cartella del download.
 *   6. Ogni file scaricato viene controllato: estensione ammessa, "firma" del formato,
 *      ffprobe con una lista bianca di formati (blocca i trucchi con le playlist HLS).
 *      Eseguibili, archivi, pdf… non arrivano mai.
 *   7. Limiti: 10 file per link, ~2 GB per file, 4 GB per link, 20 minuti,
 *      un download alla volta, massimo 5 in coda, spazio libero minimo sull'SSD.
 *   8. Priorità bassa (nice/ionice): film e musica restano fluidi.
 *
 * Programmi sul Pi (li installa il comando della chat):
 *   /opt/july-dl → yt-dlp (video) e gallery-dl (foto), in un ambiente Python separato
 *   ffmpeg/ffprobe e bubblewrap (bwrap) da apt
 */

import {
  Composer,
  GrammyError,
  InputFile,
  InputMediaBuilder,
  type Api,
} from "grammy";
import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ═══════════════════════════════════════════════════════════════════════════
// IMPOSTAZIONI
// ═══════════════════════════════════════════════════════════════════════════

/** Chi può usare i link in chat privata: solo tu. (Gli ID Telegram non sono segreti, il token sì.) */
const ALLOWED_USER_IDS = [120075267];

/**
 * Gruppi in cui CHIUNQUE può mandare link a July.
 * È lo stesso numero (1621094093) nelle due forme che usa il Bot API:
 * supergruppo (-100…) e gruppo semplice (-…). Il tuo gruppo ne usa una sola.
 * In questi gruppi July fa SOLO i link: tutti gli altri messaggi vengono ignorati.
 */
const ALLOWED_GROUP_IDS = [-1001621094093, -1621094093];

/** Nome del topic, uguale nella chat con July e nel gruppo archivio. */
const TOPIC_NAME = "🔗 Link";

/** Copia i risultati anche nel topic 🔗 Link del gruppo archivio (lo stesso di upload.ts). */
const COPY_TO_ARCHIVE = true;
const ARCHIVE_GROUP_ID = Number(process.env.ARCHIVE_GROUP_ID) || undefined; // vuoto/mancante → niente copia

/** Cartella temporanea sull'SSD: ogni link ha la sua sottocartella, cancellata alla fine. */
const WORK_DIR = process.env.JULY_LINK_DIR ?? "/mnt/storage/july-downloads";

/** Dove July ricorda gli ID dei topic 🔗 Link: accanto allo stato di upload.ts. */
const TOPICS_FILE = path.join(
  path.dirname(
    process.env.JULY_STATE_FILE ?? "/mnt/storage/july-data/state.json",
  ),
  "link-topics.json",
);

/** Programmi usati, con il percorso completo: niente sorprese dal PATH. */
const BIN = {
  ytdlp: "/opt/july-dl/bin/yt-dlp",
  gallery: "/opt/july-dl/bin/gallery-dl",
  ffprobe: "/usr/bin/ffprobe",
  ffmpeg: "/usr/bin/ffmpeg",
  // Motore JavaScript per YouTube: una copia di Bun FUORI da /home,
  // perché la sandbox nasconde /home (lo copia il comando per il Pi).
  bun: "/usr/local/bin/bun",
  bwrap: "/usr/bin/bwrap",
  nice: "/usr/bin/nice",
  ionice: "/usr/bin/ionice",
  df: "/usr/bin/df",
};

/** true = senza sandbox July rifiuta di scaricare. Lascialo true. */
const REQUIRE_SANDBOX = true;

const MAX_ITEMS = 10; // file per link (un album di Telegram)
const MAX_FILE_MB = 1990; // per file: il tuo july-api ne accetta fino a 2000
const MAX_JOB_MB = 4000; // totale di un singolo link
const MAX_PHOTO_MB = 10; // oltre, Telegram non la accetta come foto: arriva come file
const MIN_FREE_GB = 10; // spazio libero minimo sull'SSD prima di scaricare
const MAX_QUEUE = 5; // link in attesa al massimo
const JOB_TIMEOUT_MS = 20 * 60_000; // 20 minuti per ogni programma
const MAX_REDIRECTS = 5;
const MB = 1024 * 1024;

/**
 * Siti da cui si accettano PAGINE (post, reel, video…) e quale programma provare per primo:
 * yt-dlp è il migliore per i video, gallery-dl per le foto e gli album.
 * Se il primo fallisce si prova l'altro. Valgono anche i sottodomini (m.youtube.com…).
 * Per aggiungere un sito basta aggiungere il dominio alla lista giusta.
 */
const PLATFORMS: { first: Tool; domains: string[] }[] = [
  {
    first: "ytdlp",
    domains: [
      "youtube.com",
      "youtu.be",
      "tiktok.com",
      "vimeo.com",
      "dailymotion.com",
      "dai.ly",
      "twitch.tv",
      "facebook.com",
      "fb.watch",
      "streamable.com",
    ],
  },
  {
    first: "gallery",
    domains: [
      "instagram.com",
      "x.com",
      "twitter.com",
      "reddit.com",
      "redd.it",
      "pinterest.com",
      "pinterest.it",
      "pin.it",
      "tumblr.com",
      "bsky.app",
      "imgur.com",
      "flickr.com",
    ],
  },
];

/** Nomi che non sono "Internet": rete di casa, tailnet, il Pi stesso. */
const BLOCKED_SUFFIXES = [
  "localhost",
  "local",
  "lan",
  "home",
  "internal",
  "intranet",
  "corp",
  "private",
  "arpa",
  "ts.net",
  "test",
  "invalid",
  "example",
  "onion",
];

/** Indirizzi IPv4 che NON sono Internet pubblico: [inizio, bit della rete]. */
const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8], // "questa" rete
  ["10.0.0.0", 8], // rete privata
  ["100.64.0.0", 10], // CGNAT, compresa la tua tailnet (100.x)
  ["127.0.0.0", 8], // il Pi stesso (july-api, Nextcloud, Immich…)
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // rete privata, comprese le reti Docker
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24], // riservati
  ["192.168.0.0", 16], // rete di casa (router compreso)
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24], // test e documentazione
  ["224.0.0.0", 4],
  ["240.0.0.0", 4], // multicast e riservati
];

/** Link diretti: tipi di contenuto accettati, con l'estensione da dare al file. */
const DIRECT_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
};

/** Estensioni ammesse per i file scaricati: tutto il resto viene scartato. */
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const GIF_EXT = [".gif"];
const VIDEO_EXT = [".mp4", ".m4v", ".mov", ".webm", ".mkv"];
const AUDIO_EXT = [".m4a", ".mp3", ".aac", ".ogg", ".opus"];
const MEDIA_EXT = [...PHOTO_EXT, ...GIF_EXT, ...VIDEO_EXT, ...AUDIO_EXT];

/** Gli unici "lettori" che ffprobe/ffmpeg possono usare: niente playlist HLS, niente concat. */
const FORMAT_WHITELIST =
  "mov,matroska,image2,png_pipe,jpeg_pipe,webp_pipe,gif,mp3,aac,ogg";

/** Ci presentiamo come un browser normale: alcuni siti rifiutano i bot. */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux aarch64; rv:140.0) Gecko/20100101 Firefox/140.0";

// ═══════════════════════════════════════════════════════════════════════════
// TIPI
// ═══════════════════════════════════════════════════════════════════════════

type Tool = "ytdlp" | "gallery";

/** Un file verificato, pronto per Telegram (discriminated union su `kind`). */
type Media =
  | { kind: "photo"; file: string }
  | { kind: "animation"; file: string; width: number; height: number }
  | {
      kind: "video";
      file: string;
      width: number;
      height: number;
      duration: number;
    }
  | {
      kind: "audio";
      file: string;
      duration: number;
      title?: string;
      performer?: string;
    }
  | { kind: "document"; file: string }; // media vero, ma non adatto al formato nativo

/** Solo foto e video: sono quelli che possono stare insieme in un album. */
type VisualMedia = Extract<Media, { kind: "photo" | "video" }>;

/** Dove July sta lavorando per un link. */
type Job = {
  chatId: number;
  linkMsgId: number; // il tuo messaggio, su cui mette le reazioni
  statusMsgId: number; // il messaggio "⏳ / ⬇️ / 📤" che aggiorna
  threadId: number | undefined; // il topic 🔗 Link (undefined = chat normale)
  raw: string; // il link così come l'hai mandato
  requestedBy?: string; // nei gruppi: il nome di chi l'ha mandato
};

/** Errore "previsto" (link rifiutato, limite superato): il testo è scritto per te. */
class Blocked extends Error {}

// ═══════════════════════════════════════════════════════════════════════════
// IL GESTORE DEI MESSAGGI
// ═══════════════════════════════════════════════════════════════════════════

export const link = new Composer();

// url = link visibile; text_link = testo cliccabile con il link "nascosto" dietro
link.on(
  ["message:entities:url", "message:entities:text_link"],
  async (ctx, next) => {
    // Strato 1: tu in privato, oppure un gruppo ammesso. Tutto il resto prosegue.
    if (!canUseLinks(ctx.chat.id, ctx.chat.type, ctx.from?.id)) return next();

    // Il primo link del messaggio. Per text_link prendiamo l'indirizzo VERO, non il testo che si vede.
    const entity = ctx.entities(["url", "text_link"])[0];
    if (!entity) return next();
    const raw = entity.type === "text_link" ? entity.url : entity.text;

    await ctx.react("👀").catch(() => {}); // "ricevuto" (se fallisce, pazienza)

    if (waiting >= MAX_QUEUE) {
      await ctx.reply(`🚦 Ho già ${waiting} link in coda: rimandalo tra poco.`);
      return;
    }

    // Topic 🔗 Link: nella chat privata sempre, nei gruppi solo se hanno i topic attivi
    const useTopic =
      ctx.chat.type === "private" ||
      (ctx.chat.type === "supergroup" && ctx.chat.is_forum === true);
    // Nei gruppi la didascalia dice chi ha chiesto il link
    const requestedBy =
      ctx.chat.type === "private" ? undefined : ctx.from?.first_name;

    try {
      const job = await openJob(
        ctx.api,
        ctx.chat.id,
        ctx.msg.message_id,
        raw,
        useTopic,
        requestedBy,
      );
      enqueue(() => processJob(ctx.api, job)); // niente await: il gestore finisce subito
    } catch (error) {
      await ctx.reply(
        `❌ Non riesco a preparare il download: ${errorText(error)}`,
      );
    }
  },
);

// Nei gruppi ammessi July fa SOLO i link: ogni altro messaggio del gruppo si ferma
// qui e non arriva ad authenticate, upload o all'LLM.
link.use(async (ctx, next) => {
  if (ctx.chat && ALLOWED_GROUP_IDS.includes(ctx.chat.id)) return;
  await next();
});

/** Strato 1: chi può chiedere un link? */
function canUseLinks(
  chatId: number,
  chatType: string,
  userId: number | undefined,
): boolean {
  if (chatType === "private") return ALLOWED_USER_IDS.includes(userId ?? 0);
  return ALLOWED_GROUP_IDS.includes(chatId); // nei gruppi ammessi: tutti i membri
}

// ─── Coda: un link alla volta ────────────────────────────────────────────────
// Il Pi non si sovraccarica e July continua a rispondere mentre scarica.

let queue: Promise<void> = Promise.resolve();
let waiting = 0;

function enqueue(work: () => Promise<void>) {
  waiting++;
  queue = queue
    .then(work)
    .catch((error) => console.error("[link]", error))
    .finally(() => {
      waiting--;
    });
}

/** Per lo spegnimento gentile: aspetta che i download in coda finiscano. */
export function waitForDownloads(): Promise<void> {
  return queue;
}

/** Scrive "⏳ In coda" nel topic 🔗 Link (lo crea la prima volta) o nella chat. */
async function openJob(
  api: Api,
  chatId: number,
  linkMsgId: number,
  raw: string,
  useTopic: boolean,
  requestedBy: string | undefined,
): Promise<Job> {
  const send = async (threadId: number | undefined): Promise<Job> => {
    const status = await api.sendMessage(
      chatId,
      `⏳ In coda\n${raw.slice(0, 300)}`,
      {
        message_thread_id: threadId,
        link_preview_options: { is_disabled: true }, // niente anteprima del sito
      },
    );
    return {
      chatId,
      linkMsgId,
      statusMsgId: status.message_id,
      threadId,
      raw,
      requestedBy,
    };
  };
  return useTopic ? withTopic(api, chatId, send) : send(undefined);
}

// ─── Un link dall'inizio alla fine ───────────────────────────────────────────

async function processJob(api: Api, job: Job) {
  // Aggiorna sempre lo stesso messaggio: una notifica sola invece di cinque
  const setStatus = (text: string) =>
    api
      .editMessageText(job.chatId, job.statusMsgId, text.slice(0, 4096), {
        link_preview_options: { is_disabled: true },
      })
      .catch(() => {});

  const react = (emoji: "👍" | "👎") =>
    api
      .setMessageReaction(job.chatId, job.linkMsgId, [{ type: "emoji", emoji }])
      .catch(() => {});

  let jobDir: string | undefined;

  try {
    // Strati 2 e 3: il link è fatto bene e punta davvero a Internet?
    const url = parseLink(job.raw);
    await setStatus(`🔍 Controllo il link…\n${url.href}`);
    await assertPublicHost(url.hostname);
    await ensureFreeSpace();

    jobDir = await createJobDir();
    const outDir = path.join(jobDir, "out");

    await setStatus(`⬇️ Scarico…\n${url.href}`);
    await download(url, jobDir, outDir);

    // Strato 6: ogni file viene verificato prima di arrivare a te
    const { media, rejected } = await collect(outDir, jobDir);
    if (media.length === 0) {
      throw new Blocked(
        rejected > 0
          ? "i file del link non sono foto o video validi"
          : "nel link non ho trovato foto o video",
      );
    }

    await setStatus(`📤 Invio ${media.length} file…`);
    let caption = `🔗 ${url.href}`;
    if (job.requestedBy) caption += `\n👤 ${job.requestedBy}`;
    if (rejected > 0)
      caption += `\n⚠️ ${rejected} file scartati: non erano foto o video validi`;
    const sentIds = await deliver(api, job, media, caption.slice(0, 1024));

    await api.deleteMessage(job.chatId, job.statusMsgId).catch(() => {});
    await react("👍");
    await copyToArchive(api, job.chatId, sentIds);
  } catch (error) {
    const icon = error instanceof Blocked ? "🚫" : "❌";
    await setStatus(`${icon} ${errorText(error)}\n${job.raw.slice(0, 300)}`);
    await react("👎");
  } finally {
    // Sul Pi non resta niente, qualunque cosa sia successa
    if (jobDir) await rm(jobDir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLI SUL LINK (strati 2 e 3)
// ═══════════════════════════════════════════════════════════════════════════

/** Trasforma il testo in un URL sicuro, oppure lancia Blocked con il motivo. */
function parseLink(raw: string): URL {
  let text = raw.trim();
  if (text.length > 2048) throw new Blocked("link troppo lungo");

  // "youtube.com/…" senza schema davanti: aggiungiamo https://
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Blocked("non è un link valido");
  }

  if (url.protocol === "http:") url.protocol = "https:"; // sempre cifrato
  url.hash = ""; // la parte dopo # resta nel browser, ai server non serve
  assertSafeShape(url);
  return url;
}

/** Strato 2: controlli sulla "forma" del link, senza nessuna richiesta di rete. */
function assertSafeShape(url: URL) {
  if (url.protocol !== "https:")
    throw new Blocked(`tipo di link non ammesso (${url.protocol})`);
  if (url.username || url.password)
    throw new Blocked("link con nome utente o password");
  if (url.port !== "") throw new Blocked(`porta non ammessa (${url.port})`);

  const host = url.hostname;
  // Il parser degli URL trasforma già i trucchi tipo "0x7f.1" o "2130706433" in 127.0.0.1
  if (isIP(host) !== 0 || host.startsWith("["))
    throw new Blocked("indirizzi IP nel link non ammessi");

  const labels = host.split(".");
  const tld = labels.at(-1) ?? "";
  if (labels.length < 2 || !/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) {
    throw new Blocked(`dominio non valido (${host})`); // es. "mcloud", nome della tailnet
  }
  if (
    BLOCKED_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  ) {
    throw new Blocked(`dominio della rete locale (${host})`);
  }
}

/** Strato 3 (anti-SSRF): TUTTI gli indirizzi del dominio devono essere Internet pubblico. */
async function assertPublicHost(hostname: string) {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Blocked(`il dominio ${hostname} non esiste`);
  }
  if (addresses.length === 0)
    throw new Blocked(`il dominio ${hostname} non esiste`);

  const bad = addresses.find((entry) => !isPublicIp(entry.address));
  if (bad)
    throw new Blocked(`${hostname} punta a una rete privata (${bad.address})`);
}

/** true solo per indirizzi di Internet pubblico. */
function isPublicIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const value = ipv4ToNumber(ip);
    return !PRIVATE_V4.some(([base, bits]) => {
      // Due indirizzi sono nella stessa rete se, tolti gli ultimi (32 - bits) bit, sono uguali
      const size = 2 ** (32 - bits);
      return Math.floor(value / size) === Math.floor(ipv4ToNumber(base) / size);
    });
  }

  if (version === 6) {
    // Accettiamo solo gli IPv6 "Internet normali" (2000::/3), tranne
    // documentazione (2001:db8::/32), Teredo (2001::/32) e 6to4 (2002::/16).
    // Così ::1, fe80::, fc00:: e i "::ffff:127.0.0.1" sono tutti bloccati.
    const [first = 0, second = 0] = ip
      .toLowerCase()
      .split(":")
      .slice(0, 2)
      .map((part) => parseInt(part || "0", 16));
    if (first < 0x2000 || first > 0x3fff) return false;
    if (first === 0x2001 && (second === 0x0db8 || second === 0)) return false;
    if (first === 0x2002) return false;
    return true;
  }

  return false;
}

/** "192.168.1.10" → 3232235786 */
function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((total, part) => total * 256 + Number(part), 0);
}

/** Rifiuta il download se sull'SSD resta poco spazio. */
async function ensureFreeSpace() {
  await mkdir(WORK_DIR, { recursive: true, mode: 0o700 });
  const { stdout } = await execFileAsync(BIN.df, ["-Pk", WORK_DIR]);
  // Ultima riga di df, quarta colonna = KB liberi
  const freeKb = Number(stdout.trim().split("\n").at(-1)?.split(/\s+/)[3]);
  if (Number.isFinite(freeKb) && freeKb < MIN_FREE_GB * 1024 * 1024) {
    throw new Blocked(
      `poco spazio sull'SSD (${(freeKb / 1024 / 1024).toFixed(1)} GB liberi)`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOAD (strati 4, 5 e 7)
// ═══════════════════════════════════════════════════════════════════════════

/** Sceglie come scaricare: pagina di un sito della lista, oppure link diretto. */
async function download(url: URL, jobDir: string, outDir: string) {
  const platform = findPlatform(url.hostname);

  // Pagina di un sito della lista (post, reel, video…) → yt-dlp / gallery-dl
  if (
    platform &&
    !MEDIA_EXT.includes(path.extname(url.pathname).toLowerCase())
  ) {
    return downloadWithTools(url, platform.first, jobDir, outDir);
  }

  // Tutto il resto lo scarichiamo noi, solo se è davvero un'immagine, un video o un audio
  const result = await downloadDirect(url, outDir);
  if (result.kind === "page") {
    return downloadWithTools(result.url, result.first, jobDir, outDir);
  }
}

function findPlatform(hostname: string) {
  return PLATFORMS.find((platform) =>
    platform.domains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    ),
  );
}

// ─── yt-dlp e gallery-dl ─────────────────────────────────────────────────────

/** Prova il programma consigliato, poi l'altro. */
async function downloadWithTools(
  url: URL,
  first: Tool,
  jobDir: string,
  outDir: string,
) {
  const order: Tool[] =
    first === "ytdlp" ? ["ytdlp", "gallery"] : ["gallery", "ytdlp"];
  let lastError: unknown;

  for (const tool of order) {
    try {
      const args = tool === "ytdlp" ? ytdlpArgs(outDir) : galleryArgs(outDir);
      // "--" = fine delle opzioni: il link non può mai essere scambiato per un'opzione
      await runSandboxed(BIN[tool], [...args, "--", url.href], jobDir, outDir);
      if ((await readdir(outDir)).length > 0) return; // ha scaricato qualcosa
    } catch (error) {
      if (error instanceof Blocked) throw error; // limite superato: inutile riprovare
      lastError = error;
    }
    // Via i pezzi del tentativo fallito, prima di provare l'altro programma
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir);
  }

  throw lastError ?? new Blocked("nel link non ho trovato foto o video");
}

function ytdlpArgs(outDir: string): string[] {
  return [
    "--ignore-config", // nessun file di configurazione: decide solo questo codice
    "--no-cache-dir",
    "--use-extractors",
    "default,-generic", // niente estrattore "generico" per pagine sconosciute
    "--js-runtimes",
    `bun:${BIN.bun}`, // YouTube vuole un motore JS: usa Bun
    "--no-playlist",
    "--playlist-items",
    `1:${MAX_ITEMS}`,
    "--max-filesize",
    `${MAX_FILE_MB}M`,
    "-S",
    "res:1080,vcodec:h264,ext:mp4:m4a", // ≤1080p, formati che Telegram riproduce così come sono
    "--merge-output-format",
    "mp4",
    "--embed-metadata", // titolo e artista dentro il file (servono agli audio)
    "--restrict-filenames",
    "--no-mtime",
    "--socket-timeout",
    "30",
    "--retries",
    "3",
    "--no-progress",
    "-P",
    outDir,
    "-o",
    "%(autonumber)02d.%(ext)s",
  ];
}

function galleryArgs(outDir: string): string[] {
  return [
    "--config-ignore", // nessun file di configurazione
    "--no-input", // non chiede mai password
    "--no-colors",
    "--no-mtime",
    "--range",
    `1-${MAX_ITEMS}`,
    "--filesize-max",
    `${MAX_FILE_MB}M`,
    "--http-timeout",
    "30",
    "--retries",
    "3",
    "-D",
    outDir, // tutti i file direttamente qui, senza sottocartelle
  ];
}

// ─── Link diretti: li scarichiamo noi, controllando ogni passo ──────────────

type DirectResult =
  | { kind: "saved" } // era un'immagine/video/audio: salvato
  | { kind: "page"; url: URL; first: Tool }; // link accorciato che porta a un sito della lista

async function downloadDirect(url: URL, outDir: string): Promise<DirectResult> {
  const signal = AbortSignal.timeout(JOB_TIMEOUT_MS);
  const { response, finalUrl } = await safeFetch(url, signal);

  // "image/jpeg; charset=…" → "image/jpeg"
  const type =
    (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";
  const extension = DIRECT_TYPES[type];

  if (extension) {
    await saveBody(response, path.join(outDir, `01${extension}`));
    return { kind: "saved" };
  }

  await response.body?.cancel(); // non ci interessa: chiudiamo la connessione

  // bit.ly & co. che portano a un sito della lista: è una pagina per yt-dlp/gallery-dl
  const platform = findPlatform(finalUrl.hostname);
  if (platform && type === "text/html")
    return { kind: "page", url: finalUrl, first: platform.first };

  throw new Blocked(
    type === "text/html"
      ? `${finalUrl.hostname} non è nella lista dei siti (PLATFORMS in link.ts)`
      : `tipo di file non ammesso (${type || "sconosciuto"})`,
  );
}

/** fetch che segue i redirect UNO PER UNO, ricontrollando ogni tappa (anti-SSRF). */
async function safeFetch(
  start: URL,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertSafeShape(current);
    await assertPublicHost(current.hostname);

    const response = await fetch(current, {
      redirect: "manual", // i redirect li gestiamo noi
      signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "image/*,video/*,audio/*,text/html;q=0.5",
      },
    });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current); // il redirect può essere relativo
      if (current.protocol === "http:") current.protocol = "https:";
      continue; // il giro successivo ricontrolla il nuovo indirizzo
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Blocked(`il sito risponde con errore ${response.status}`);
    }
    return { response, finalUrl: current };
  }

  throw new Blocked("troppi redirect");
}

/** Salva la risposta su disco contando i byte: il server può mentire sulla dimensione. */
async function saveBody(response: Response, file: string) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_MB * MB) {
    await response.body?.cancel();
    throw new Blocked(`file troppo grande (${Math.ceil(declared / MB)} MB)`);
  }
  if (!response.body) throw new Blocked("il sito ha risposto senza contenuto");

  const handle = await open(file, "wx", 0o600); // "wx" = crea, non sovrascrivere mai
  const reader = response.body.getReader();
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FILE_MB * MB) {
        await reader.cancel();
        throw new Blocked(`file troppo grande (oltre ${MAX_FILE_MB} MB)`);
      }
      await handle.write(value);
    }
  } finally {
    await handle.close();
  }
}

// ─── Sandbox (strato 5) ──────────────────────────────────────────────────────

/** Lancia un programma dentro la sandbox, a bassa priorità, con un tempo massimo. */
async function runSandboxed(
  command: string,
  args: string[],
  jobDir: string,
  watchDir?: string,
): Promise<string> {
  const sandbox = await sandboxWorks();
  if (!sandbox && REQUIRE_SANDBOX) {
    throw new Blocked(
      "sandbox non disponibile: sul Pi lancia `bwrap --ro-bind / / true` per vedere perché",
    );
  }

  const inner = sandbox
    ? [BIN.bwrap, ...sandboxArgs(jobDir), command, ...args]
    : [command, ...args];
  // nice + ionice: il download usa CPU e disco solo quando film e musica non ne hanno bisogno
  const full = ["-n", "10", BIN.ionice, "-c", "2", "-n", "7", ...inner];

  // Strato 7: se la cartella supera MAX_JOB_MB, il controller ferma il programma
  const controller = new AbortController();
  const watchdog = watchDir ? watchSize(watchDir, controller) : undefined;

  try {
    // execFile (NON exec): gli argomenti arrivano uno per uno, senza passare dalla shell
    const { stdout } = await execFileAsync(BIN.nice, full, {
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: path.join(jobDir, "home"),
        LANG: "C.UTF-8",
      },
      cwd: jobDir,
      timeout: JOB_TIMEOUT_MS,
      killSignal: "SIGKILL",
      signal: controller.signal,
      maxBuffer: 20 * MB,
    });
    return stdout;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Blocked(`download oltre ${MAX_JOB_MB} MB: interrotto`);
    if ((error as { killed?: boolean }).killed)
      throw new Blocked("tempo scaduto (20 minuti)");
    throw error;
  } finally {
    if (watchdog) clearInterval(watchdog);
  }
}

/** Le regole della sandbox: cosa il programma può vedere e dove può scrivere. */
function sandboxArgs(jobDir: string): string[] {
  const args = ["--ro-bind", "/", "/"]; // tutto il sistema, in SOLA LETTURA

  // Cartelle nascoste (al loro posto, una cartella vuota):
  // /home = chiavi SSH, .env e token di July; /mnt = l'SSD con i tuoi file
  for (const dir of ["/home", "/root", "/mnt", "/media", "/srv"]) {
    if (existsSync(dir)) args.push("--tmpfs", dir);
  }
  // Prese di servizi locali che potrebbero dare poteri in più: coperte
  for (const dir of ["/run/user", "/run/tailscale"]) {
    if (existsSync(dir)) args.push("--tmpfs", dir);
  }
  if (existsSync("/run/docker.sock"))
    args.push("--ro-bind", "/dev/null", "/run/docker.sock");

  args.push(
    "--tmpfs",
    "/tmp",
    "--bind",
    jobDir,
    jobDir, // l'UNICA cartella dove si può scrivere
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--unshare-all",
    "--share-net", // processi, utenti e IPC isolati; la rete serve
    "--die-with-parent", // se July si ferma, la sandbox muore con lui
    "--new-session",
    "--clearenv", // nessuna variabile di July (token compreso)
    "--setenv",
    "PATH",
    "/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "HOME",
    path.join(jobDir, "home"),
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--chdir",
    jobDir,
  );
  return args;
}

/** Controlla una volta sola (la prima volta che serve) se bubblewrap funziona. */
let sandboxStatus: Promise<boolean> | undefined;

function sandboxWorks(): Promise<boolean> {
  sandboxStatus ??= execFileAsync(
    BIN.bwrap,
    [
      "--ro-bind",
      "/",
      "/",
      "--unshare-all",
      "--share-net",
      "--die-with-parent",
      "/usr/bin/true",
    ],
    { timeout: 10_000 },
  )
    .then(() => true)
    .catch((error) => {
      console.warn("[link] sandbox bwrap non disponibile:", errorText(error));
      return false;
    });
  return sandboxStatus;
}

/** Ogni 3 secondi misura la cartella: oltre MAX_JOB_MB ferma tutto. */
function watchSize(dir: string, controller: AbortController) {
  return setInterval(async () => {
    let total = 0;
    for (const name of await readdir(dir).catch(() => [])) {
      total += (await lstat(path.join(dir, name)).catch(() => null))?.size ?? 0;
    }
    if (total > MAX_JOB_MB * MB) controller.abort();
  }, 3000);
}

/** Una cartella nuova per ogni link: out/ per i file, home/ per i programmi. */
let leftoversCleaned = false;

async function createJobDir(): Promise<string> {
  await mkdir(WORK_DIR, { recursive: true, mode: 0o700 });

  // Al primo download dopo un avvio: via gli avanzi di un crash o di un riavvio a metà
  if (!leftoversCleaned) {
    for (const name of await readdir(WORK_DIR)) {
      if (name.startsWith("job-"))
        await rm(path.join(WORK_DIR, name), { recursive: true, force: true });
    }
    leftoversCleaned = true;
  }

  const jobDir = await mkdtemp(path.join(WORK_DIR, "job-"));
  await mkdir(path.join(jobDir, "out"));
  await mkdir(path.join(jobDir, "home"));
  return jobDir;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICA DEI FILE (strato 6)
// ═══════════════════════════════════════════════════════════════════════════

/** Verifica ogni file scaricato: tiene i media veri, conta quelli scartati. */
async function collect(
  outDir: string,
  jobDir: string,
): Promise<{ media: Media[]; rejected: number }> {
  const media: Media[] = [];
  let rejected = 0;

  for (const name of (await readdir(outDir)).sort()) {
    if (name.startsWith(".") || /\.(part|ytdl|temp|tmp)$/i.test(name)) continue; // avanzi dei programmi
    const item = await inspectFile(path.join(outDir, name), jobDir);
    if (item) media.push(item);
    else rejected++;
    if (media.length >= MAX_ITEMS) break;
  }
  return { media, rejected };
}

/** Che cos'è davvero questo file? undefined = da scartare. */
async function inspectFile(
  file: string,
  jobDir: string,
): Promise<Media | undefined> {
  const ext = path.extname(file).toLowerCase();
  if (!MEDIA_EXT.includes(ext)) return undefined; // .exe, .zip, .pdf, .html… mai

  // lstat NON segue i link simbolici: un symlink verso /etc/… viene scartato
  const info = await lstat(file);
  if (!info.isFile() || info.size === 0 || info.size > MAX_FILE_MB * MB)
    return undefined;

  const probe = await runProbe(file, jobDir);
  if (!probe) return undefined; // ffprobe non lo riconosce: non è un media

  const streams = probe.streams ?? [];
  // attached_pic = la copertina dentro un mp3: non è un video
  const video = streams.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const audio = streams.find((s) => s.codec_type === "audio");
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const duration = Math.round(Number(probe.format?.duration) || 0);

  if (PHOTO_EXT.includes(ext) || GIF_EXT.includes(ext)) {
    // Un'immagine vera ha la "firma" giusta nei primi byte e dimensioni reali
    if (!(await hasImageSignature(file, ext)) || width === 0 || height === 0)
      return undefined;
    if (GIF_EXT.includes(ext))
      return { kind: "animation", file, width, height };
    return photoOrDocument(file, ext, info.size, width, height, jobDir);
  }

  if (VIDEO_EXT.includes(ext) && video && width > 0 && height > 0) {
    // Telegram riproduce in chat mp4 e mov; webm e mkv arrivano come file
    return [".mp4", ".m4v", ".mov"].includes(ext)
      ? { kind: "video", file, width, height, duration }
      : { kind: "document", file };
  }

  if (audio && !video) {
    const tags = lowerKeys(probe.format?.tags);
    return {
      kind: "audio",
      file,
      duration,
      title: tags.title,
      performer: tags.artist,
    };
  }

  return undefined;
}

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  disposition?: { attached_pic?: number };
};
type Probe = {
  streams?: ProbeStream[];
  format?: { duration?: string; tags?: Record<string, string> };
};

/** ffprobe nella sandbox, con la lista bianca dei formati e niente rete. */
async function runProbe(
  file: string,
  jobDir: string,
): Promise<Probe | undefined> {
  try {
    const stdout = await runSandboxed(
      BIN.ffprobe,
      [
        "-v",
        "error",
        "-format_whitelist",
        FORMAT_WHITELIST, // solo formati multimediali "semplici"
        "-protocol_whitelist",
        "file", // solo file locali: niente rete
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        file,
      ],
      jobDir,
    );
    return JSON.parse(stdout) as Probe;
  } catch {
    return undefined;
  }
}

/** I primi byte di ogni formato immagine sono sempre gli stessi: la sua "firma". */
async function hasImageSignature(file: string, ext: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(12), 0, 12, 0);
    const head = buffer.subarray(0, bytesRead);
    const ascii = (from: number, to: number) =>
      head.subarray(from, to).toString("latin1");

    if (ext === ".jpg" || ext === ".jpeg")
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (ext === ".png") return ascii(1, 4) === "PNG" && head[0] === 0x89;
    if (ext === ".gif") return ascii(0, 4) === "GIF8";
    if (ext === ".webp")
      return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    return false;
  } finally {
    await handle.close();
  }
}

/** Foto se Telegram la accetta come foto, altrimenti file. Le WebP diventano JPG. */
async function photoOrDocument(
  file: string,
  ext: string,
  size: number,
  width: number,
  height: number,
  jobDir: string,
): Promise<Media> {
  // Limiti di Telegram per le foto: 10 MB, larghezza + altezza ≤ 10000, proporzioni ≤ 20:1
  const fits =
    size <= MAX_PHOTO_MB * MB &&
    width + height <= 10_000 &&
    Math.max(width, height) / Math.min(width, height) <= 20;
  if (!fits) return { kind: "document", file };
  if (ext !== ".webp") return { kind: "photo", file };

  const jpg = `${file}.jpg`;
  try {
    await runSandboxed(
      BIN.ffmpeg,
      [
        "-v",
        "error",
        "-format_whitelist",
        "webp_pipe",
        "-protocol_whitelist",
        "file",
        "-i",
        file,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        jpg,
      ],
      jobDir,
    );
    return { kind: "photo", file: jpg };
  } catch {
    return { kind: "document", file }; // WebP animata o strana: arriva come file
  }
}

/** title, TITLE, Title… → tutto minuscolo */
function lowerKeys(
  tags: Record<string, string> = {},
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// INVIO A TELEGRAM
// ═══════════════════════════════════════════════════════════════════════════

/** Custom type guard: dopo questo controllo TypeScript sa che è una foto o un video. */
function isVisual(item: Media): item is VisualMedia {
  return item.kind === "photo" || item.kind === "video";
}

/** Manda tutto nel topic 🔗 Link. Restituisce gli ID dei messaggi inviati. */
async function deliver(
  api: Api,
  job: Job,
  items: Media[],
  caption: string,
): Promise<number[]> {
  const sent: number[] = [];

  // La didascalia va solo sul primo messaggio
  let captionLeft: string | undefined = caption;
  const takeCaption = () => {
    const text = captionLeft;
    captionLeft = undefined;
    return text;
  };

  const visual = items.filter(isVisual);
  const others: Media[] = items.filter((item) => !isVisual(item));

  if (visual.length >= 2) {
    // Più foto/video: un album, come su Instagram (massimo 10 per album)
    for (let i = 0; i < visual.length; i += 10) {
      const album = visual
        .slice(i, i + 10)
        .map((item) => toAlbumItem(item, takeCaption()));
      const messages = await api.sendMediaGroup(job.chatId, album, {
        message_thread_id: job.threadId,
      });
      sent.push(...messages.map((message) => message.message_id));
    }
  } else {
    others.unshift(...visual); // una sola foto o un solo video: messaggio normale
  }

  for (const item of others)
    sent.push(await sendOne(api, job, item, takeCaption()));
  return sent;
}

function toAlbumItem(item: VisualMedia, caption: string | undefined) {
  const file = new InputFile(item.file);
  if (item.kind === "photo") return InputMediaBuilder.photo(file, { caption });
  return InputMediaBuilder.video(file, {
    caption,
    width: item.width,
    height: item.height,
    duration: item.duration,
    supports_streaming: true,
  });
}

/** Un file, con il metodo di Telegram giusto per il suo tipo. */
async function sendOne(
  api: Api,
  job: Job,
  item: Media,
  caption: string | undefined,
): Promise<number> {
  const file = new InputFile(item.file);
  const base = { message_thread_id: job.threadId, caption };

  switch (item.kind) {
    case "photo":
      return (await api.sendPhoto(job.chatId, file, base)).message_id;
    case "video":
      return (
        await api.sendVideo(job.chatId, file, {
          ...base,
          width: item.width,
          height: item.height,
          duration: item.duration,
          supports_streaming: true, // si guarda mentre scarica
        })
      ).message_id;
    case "animation":
      return (
        await api.sendAnimation(job.chatId, file, {
          ...base,
          width: item.width,
          height: item.height,
        })
      ).message_id;
    case "audio":
      return (
        await api.sendAudio(job.chatId, file, {
          ...base,
          duration: item.duration,
          title: item.title,
          performer: item.performer,
        })
      ).message_id;
    case "document":
      // disable_content_type_detection: resta un file, Telegram non prova a "interpretarlo"
      return (
        await api.sendDocument(job.chatId, file, {
          ...base,
          disable_content_type_detection: true,
        })
      ).message_id;
    default: {
      // Se aggiungi un tipo a Media e lo dimentichi qui, TypeScript segna questa riga
      const unhandled: never = item;
      throw new Error(`Tipo non gestito: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** Copia i messaggi nel topic 🔗 Link del gruppo archivio. Gli album restano album. */
async function copyToArchive(
  api: Api,
  fromChatId: number,
  messageIds: number[],
) {
  const groupId = ARCHIVE_GROUP_ID;
  if (!COPY_TO_ARCHIVE || groupId === undefined || messageIds.length === 0)
    return;
  if (fromChatId === groupId) return; // il link arriva già dal gruppo archivio

  try {
    const ids = [...messageIds].sort((a, b) => a - b); // Telegram li vuole in ordine crescente
    await withTopic(api, groupId, (threadId) =>
      api.copyMessages(groupId, fromChatId, ids, {
        message_thread_id: threadId,
      }),
    );
  } catch (error) {
    // L'archivio è un extra: il file l'hai già ricevuto
    console.warn(
      "[link] copia nel gruppo archivio non riuscita:",
      errorText(error),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOPIC 🔗 Link
// ═══════════════════════════════════════════════════════════════════════════
// Il Bot API non sa elencare i topic: se perdiamo l'ID non lo ritroviamo più,
// per questo lo salviamo su file ({ "id chat": id topic }).

type TopicMap = Record<string, number>;

let topics: TopicMap | undefined;
const creating = new Map<number, Promise<number | undefined>>();

async function loadTopics(): Promise<TopicMap> {
  if (!topics) {
    try {
      topics = JSON.parse(await readFile(TOPICS_FILE, "utf8")) as TopicMap;
    } catch {
      topics = {}; // primo avvio: il file non c'è ancora
    }
  }
  return topics;
}

async function saveTopics(map: TopicMap) {
  await mkdir(path.dirname(TOPICS_FILE), { recursive: true });
  // Prima un file temporaneo, poi rename: il JSON non resta mai scritto a metà
  const temp = `${TOPICS_FILE}.tmp`;
  await writeFile(temp, JSON.stringify(map, null, 2));
  await rename(temp, TOPICS_FILE);
}

/** L'ID del topic 🔗 Link in questa chat: lo crea la prima volta. */
async function getTopic(api: Api, chatId: number): Promise<number | undefined> {
  const map = await loadTopics();
  const known = map[chatId];
  if (known !== undefined) return known;

  // Due richieste insieme non devono creare due topic: la seconda aspetta la prima
  let pending = creating.get(chatId);
  if (!pending) {
    pending = createTopic(api, chatId, map).finally(() =>
      creating.delete(chatId),
    );
    creating.set(chatId, pending);
  }
  return pending;
}

async function createTopic(
  api: Api,
  chatId: number,
  map: TopicMap,
): Promise<number | undefined> {
  try {
    const topic = await api.createForumTopic(chatId, TOPIC_NAME);
    map[chatId] = topic.message_thread_id;
    await saveTopics(map);
    return topic.message_thread_id;
  } catch (error) {
    console.warn(
      `[link] non riesco a creare il topic in ${chatId}:`,
      errorText(error),
    );
    return undefined; // niente topic: il messaggio va nella chat normale
  }
}

/**
 * Esegue `action` dentro il topic. Se l'hai cancellato a mano, Telegram risponde
 * "thread not found": lo dimentichiamo, lo ricreiamo e riproviamo una volta sola.
 */
async function withTopic<T>(
  api: Api,
  chatId: number,
  action: (threadId: number | undefined) => Promise<T>,
): Promise<T> {
  try {
    return await action(await getTopic(api, chatId));
  } catch (error) {
    const missing =
      error instanceof GrammyError &&
      /thread not found|topic_deleted|topic_closed/i.test(error.description);
    if (!missing) throw error;

    const map = await loadTopics();
    delete map[chatId];
    await saveTopics(map);
    return action(await getTopic(api, chatId));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITÀ
// ═══════════════════════════════════════════════════════════════════════════

/** Un messaggio d'errore corto e leggibile. */
function errorText(error: unknown): string {
  if (error instanceof GrammyError) return error.description;

  // Dai programmi esterni l'informazione utile è in stderr
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  const text =
    typeof stderr === "string" && stderr.trim() !== ""
      ? stderr
      : error instanceof Error
        ? error.message
        : String(error);

  // Di solito la riga utile è l'ultima che contiene "error"
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const errorLine =
    [...lines].reverse().find((line) => /error/i.test(line)) ??
    lines.at(-1) ??
    "errore sconosciuto";
  return errorLine.replace(/^ERROR:\s*/i, "").slice(0, 300);
}
