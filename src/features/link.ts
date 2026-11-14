/**
 * link.ts: mandi un link a July e lui ti rimanda la foto o il video. Tutto in un file.
 *
 * Novità per Instagram e X (Twitter):
 * 1. X / Twitter (post foto, caroselli, video, GIF):
 *    usa prima l'API di FxTwitter (`api.fxtwitter.com`) che estrae direttamente
 *    i media originali da `pbs.twimg.com` e `video.twimg.com` senza bisogno di cookie/login,
 *    con fallback automatico a yt-dlp / gallery-dl.
 * 2. Instagram (Reel, video, post singoli e caroselli):
 *    - risolve i link `/share/...` di Instagram
 *    - prova prima yt-dlp (ottimo per Reel e video), poi gallery-dl, e infine
 *      l'endpoint pubblico `/embed/captioned/` per estrarre foto e video anche senza login
 *    - se sul Pi metti `/mnt/storage/apps/july/cookies.txt` (opzionale), lo copia
 *      automaticamente nella sandbox per scaricare anche post/storie sotto login.
 */

import {
  Composer,
  GrammyError,
  InputFile,
  InputMediaBuilder,
  type Api,
} from "grammy";
import type { ReactionTypeEmoji } from "grammy/types";
import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import {
  copyFile,
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

const ME = Number(process.env.MORGAN_ID) || 120075267;

/** Chi può usare i link in chat privata: tu + l'altro utente autorizzato. */
const ALLOWED_USER_IDS = [ME, 120075267, 858705722, 858705722858705722];

/**
 * Gruppi in cui CHIUNQUE può mandare link a July.
 * In questi gruppi July fa SOLO i link: tutti gli altri messaggi vengono ignorati.
 */
const ALLOWED_GROUP_IDS = [-1001621094093, -1621094093];

/** Nome del topic nel gruppo (e nel gruppo archivio). */
const TOPIC_NAME = "🔗 Link";

/** Copia i risultati anche nel topic 🔗 Link del gruppo archivio (solo per i tuoi link). */
const COPY_TO_ARCHIVE = true;
const ARCHIVE_GROUP_ID = Number(process.env.ARCHIVE_GROUP_ID) || undefined;

/** Cartella temporanea sull'SSD: ogni link ha la sua sottocartella, cancellata alla fine. */
const WORK_DIR = process.env.JULY_LINK_DIR ?? "/mnt/storage/july-downloads";

/**
 * File cookies.txt opzionale (formato Netscape) per Instagram/X/YouTube.
 * Se esiste sul Pi, viene copiato dentro la cartella temporanea della sandbox
 * così yt-dlp e gallery-dl possono leggerlo senza mai esporre /mnt o /home.
 */
const COOKIES_FILE =
  process.env.JULY_COOKIES_FILE ?? "/mnt/storage/apps/july/cookies.txt";

/** Dove July ricorda gli ID dei topic 🔗 Link. */
const TOPICS_FILE = path.join(
  path.dirname(
    process.env.JULY_STATE_FILE ?? "/mnt/storage/apps/july/upload-state.json",
  ),
  "link-topics.json",
);

/** Programmi usati, con il percorso completo. */
const BIN = {
  ytdlp: "/opt/july-dl/bin/yt-dlp",
  gallery: "/opt/july-dl/bin/gallery-dl",
  ffprobe: "/usr/bin/ffprobe",
  ffmpeg: "/usr/bin/ffmpeg",
  bun: "/usr/local/bin/bun",
  bwrap: "/usr/bin/bwrap",
  nice: "/usr/bin/nice",
  ionice: "/usr/bin/ionice",
  df: "/usr/bin/df",
  setpriv: "/usr/bin/setpriv",
  chown: "/usr/bin/chown",
};

const SANDBOX_USER = "july-dl";
const RUNNING_AS_ROOT = process.getuid?.() === 0;
const REQUIRE_SANDBOX = true;

const MAX_ITEMS = 10;
const MAX_FILE_MB = 1990;
const MAX_JOB_MB = 4000;
const MAX_PHOTO_MB = 10;
const MIN_FREE_GB = 10;
const MAX_QUEUE = 5;
const JOB_TIMEOUT_MS = 20 * 60_000;
const MAX_REDIRECTS = 5;
const MB = 1024 * 1024;

/**
 * Siti da cui si accettano PAGINE (post, reel, video…) e quale programma provare per primo.
 * Nota: Instagram e X sono ora su "ytdlp" come primo tool per i video, più gli estrattori
 * dedicati (FxTwitter e Instagram Embed) che gestiscono post foto, caroselli e video.
 */
const PLATFORMS: { first: Tool; domains: string[] }[] = [
  {
    first: "ytdlp",
    domains: [
      "youtube.com",
      "youtu.be",
      "tiktok.com",
      "instagram.com",
      "ddinstagram.com",
      "x.com",
      "twitter.com",
      "fxtwitter.com",
      "vxtwitter.com",
      "fixupx.com",
      "vimeo.com",
      "dailymotion.com",
      "dai.ly",
      "twitch.tv",
      "facebook.com",
      "fb.watch",
      "streamable.com",
      "reddit.com",
      "redd.it",
    ],
  },
  {
    first: "gallery",
    domains: [
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

const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const DIRECT_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
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

const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const GIF_EXT = [".gif"];
const VIDEO_EXT = [".mp4", ".m4v", ".mov", ".webm", ".mkv"];
const AUDIO_EXT = [".m4a", ".mp3", ".aac", ".ogg", ".opus"];
const MEDIA_EXT = [...PHOTO_EXT, ...GIF_EXT, ...VIDEO_EXT, ...AUDIO_EXT];

const FORMAT_WHITELIST =
  "mov,matroska,image2,png_pipe,jpeg_pipe,webp_pipe,gif,mp3,aac,ogg";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// ═══════════════════════════════════════════════════════════════════════════
// TIPI
// ═══════════════════════════════════════════════════════════════════════════

type Tool = "ytdlp" | "gallery";

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
  | { kind: "document"; file: string };

type VisualMedia = Extract<Media, { kind: "photo" | "video" }>;

type Job = {
  chatId: number;
  senderId: number | undefined;
  linkMsgId: number;
  statusMsgId: number;
  threadId: number | undefined;
  raw: string;
  requestedBy?: string;
};

class Blocked extends Error {}

// ═══════════════════════════════════════════════════════════════════════════
// IL GESTORE DEI MESSAGGI
// ═══════════════════════════════════════════════════════════════════════════

export const link = new Composer();

link.on(
  ["message:entities:url", "message:entities:text_link"],
  async (ctx, next) => {
    if (!canUseLinks(ctx.chat.id, ctx.chat.type, ctx.from?.id)) return next();

    const entity = ctx.entities(["url", "text_link"])[0];
    if (!entity) return next();
    const raw = entity.type === "text_link" ? entity.url : entity.text;

    await ctx.react("👀").catch(() => {});

    if (waiting >= MAX_QUEUE) {
      await ctx.reply(`🚦 Ho già ${waiting} link in coda: rimandalo tra poco.`);
      return;
    }

    // Nella chat privata NON usiamo più i topic (come in upload.ts);
    // nei supergruppi li usiamo solo se il gruppo ha i topic attivi.
    const useTopic =
      ctx.chat.type === "supergroup" && ctx.chat.is_forum === true;
    const requestedBy =
      ctx.chat.type === "private" ? undefined : ctx.from?.first_name;

    try {
      const job = await openJob(
        ctx.api,
        ctx.chat.id,
        ctx.from?.id,
        ctx.msg.message_id,
        raw,
        useTopic,
        requestedBy,
      );
      enqueue(() => processJob(ctx.api, job));
    } catch (error) {
      await ctx.reply(
        `❌ Non riesco a preparare il download: ${errorText(error)}`,
      );
    }
  },
);

link.use(async (ctx, next) => {
  if (ctx.chat && ALLOWED_GROUP_IDS.includes(ctx.chat.id)) return;
  await next();
});

function canUseLinks(
  chatId: number,
  chatType: string,
  userId: number | undefined,
): boolean {
  if (chatType === "private") return ALLOWED_USER_IDS.includes(userId ?? 0);
  return ALLOWED_GROUP_IDS.includes(chatId);
}

// ─── Coda: un link alla volta ────────────────────────────────────────────────

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

export function waitForDownloads(): Promise<void> {
  return queue;
}

async function openJob(
  api: Api,
  chatId: number,
  senderId: number | undefined,
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
        link_preview_options: { is_disabled: true },
      },
    );
    return {
      chatId,
      senderId,
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

async function setReaction(
  api: Api,
  chatId: number,
  messageId: number,
  status: "done" | "failed",
) {
  const emojis: ReactionTypeEmoji["emoji"][] =
    status === "done" ? ["☑️", "👍"] : ["👎"];
  for (const emoji of emojis) {
    try {
      await api.setMessageReaction(chatId, messageId, [
        { type: "emoji", emoji },
      ]);
      return;
    } catch {
      // fallback alla successiva
    }
  }
}

async function processJob(api: Api, job: Job) {
  const setStatus = (text: string) =>
    api
      .editMessageText(job.chatId, job.statusMsgId, text.slice(0, 4096), {
        link_preview_options: { is_disabled: true },
      })
      .catch(() => {});

  let jobDir: string | undefined;

  try {
    const url = parseLink(job.raw);
    await setStatus(`🔍 Controllo il link…\n${url.href}`);
    await assertPublicHost(url.hostname);
    await ensureFreeSpace();

    jobDir = await createJobDir();
    const outDir = path.join(jobDir, "out");

    await setStatus(`⬇️ Scarico…\n${url.href}`);
    await download(url, jobDir, outDir);

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
    await setReaction(api, job.chatId, job.linkMsgId, "done");

    // Copia nel gruppo archivio solo se il link l'hai mandato tu (ME) o viene dal gruppo
    if (!job.senderId || job.senderId === ME) {
      await copyToArchive(api, job.chatId, sentIds);
    }
  } catch (error) {
    const icon = error instanceof Blocked ? "🚫" : "❌";
    await setStatus(`${icon} ${errorText(error)}\n${job.raw.slice(0, 300)}`);
    await setReaction(api, job.chatId, job.linkMsgId, "failed");
  } finally {
    if (jobDir) await rm(jobDir, { recursive: true, force: true });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLLI SUL LINK (strati 2 e 3)
// ═══════════════════════════════════════════════════════════════════════════

function parseLink(raw: string): URL {
  let text = raw.trim();
  if (text.length > 2048) throw new Blocked("link troppo lungo");

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Blocked("non è un link valido");
  }

  if (url.protocol === "http:") url.protocol = "https:";
  url.hash = "";

  // Pulizia e normalizzazione per X e Instagram:
  // 1. vxtwitter / fxtwitter / fixupx → x.com
  if (/^(?:www\.)?(?:fxtwitter|vxtwitter|fixupx)\.com$/i.test(url.hostname)) {
    url.hostname = "x.com";
  }
  // 2. ddinstagram → instagram.com
  if (/^(?:www\.)?ddinstagram\.com$/i.test(url.hostname)) {
    url.hostname = "www.instagram.com";
  }
  // 3. Via i parametri di tracking che danno fastidio agli estrattori (igsh, igshid, s, t)
  if (isDomain(url.hostname, ["instagram.com", "x.com", "twitter.com"])) {
    for (const param of [
      "igsh",
      "igshid",
      "utm_source",
      "utm_medium",
      "s",
      "t",
    ]) {
      url.searchParams.delete(param);
    }
  }

  assertSafeShape(url);
  return url;
}

function isDomain(hostname: string, domains: string[]): boolean {
  const h = hostname.toLowerCase();
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

function assertSafeShape(url: URL) {
  if (url.protocol !== "https:")
    throw new Blocked(`tipo di link non ammesso (${url.protocol})`);
  if (url.username || url.password)
    throw new Blocked("link con nome utente o password");
  if (url.port !== "") throw new Blocked(`porta non ammessa (${url.port})`);

  const host = url.hostname;
  if (isIP(host) !== 0 || host.startsWith("["))
    throw new Blocked("indirizzi IP nel link non ammessi");

  const labels = host.split(".");
  const tld = labels.at(-1) ?? "";
  if (labels.length < 2 || !/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) {
    throw new Blocked(`dominio non valido (${host})`);
  }
  if (
    BLOCKED_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  ) {
    throw new Blocked(`dominio della rete locale (${host})`);
  }
}

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

function isPublicIp(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const value = ipv4ToNumber(ip);
    return !PRIVATE_V4.some(([base, bits]) => {
      const size = 2 ** (32 - bits);
      return Math.floor(value / size) === Math.floor(ipv4ToNumber(base) / size);
    });
  }

  if (version === 6) {
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

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((total, part) => total * 256 + Number(part), 0);
}

async function ensureFreeSpace() {
  await mkdir(WORK_DIR, { recursive: true, mode: 0o700 });
  const { stdout } = await execFileAsync(BIN.df, ["-Pk", WORK_DIR]);
  const freeKb = Number(stdout.trim().split("\n").at(-1)?.split(/\s+/)[3]);
  if (Number.isFinite(freeKb) && freeKb < MIN_FREE_GB * 1024 * 1024) {
    throw new Blocked(
      `poco spazio sull'SSD (${(freeKb / 1024 / 1024).toFixed(1)} GB liberi)`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DOWNLOAD (strati 4, 5 e 7) + ESTRATTORI X E INSTAGRAM
// ═══════════════════════════════════════════════════════════════════════════

async function download(url: URL, jobDir: string, outDir: string) {
  // 1. Se è un link di X / Twitter, proviamo prima l'API di FxTwitter:
  //    funziona senza login sia per le foto/album che per i video/GIF.
  if (isDomain(url.hostname, ["x.com", "twitter.com"])) {
    const ok = await tryDownloadX(url, outDir);
    if (ok) return;
  }

  // 2. Se è un link di Instagram (inclusi /share/reel/... o /share/p/...),
  //    risolviamo eventuali redirect /share/ prima di passarlo agli strumenti.
  let targetUrl = url;
  if (isDomain(url.hostname, ["instagram.com"])) {
    targetUrl = await resolveInstagramShareUrl(url);
  }

  const platform = findPlatform(targetUrl.hostname);

  if (
    platform &&
    !MEDIA_EXT.includes(path.extname(targetUrl.pathname).toLowerCase())
  ) {
    // Su Instagram: se è un post/carosello (/p/), proviamo prima gallery-dl o l'embed;
    // se è un Reel (/reel/ o /reels/ o /tv/), proviamo prima yt-dlp.
    const firstTool: Tool =
      isDomain(targetUrl.hostname, ["instagram.com"]) &&
      /^\/p\//i.test(targetUrl.pathname)
        ? "gallery"
        : platform.first;

    try {
      await downloadWithTools(targetUrl, firstTool, jobDir, outDir);
      return;
    } catch (toolError) {
      // Fallback speciale per Instagram senza cookie: estrazione da /embed/captioned/ o VxInstagram
      if (isDomain(targetUrl.hostname, ["instagram.com"])) {
        const ok = await tryDownloadInstagramFallback(targetUrl, outDir);
        if (ok) return;
      }
      throw toolError;
    }
  }

  const result = await downloadDirect(targetUrl, outDir);
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

// ─── Estrattore dedicato X / Twitter (via api.fxtwitter.com) ─────────────────

type FxMediaItem = {
  type?: string; // "photo" | "video" | "gif"
  url?: string;
};

type FxResponse = {
  code?: number;
  tweet?: {
    media?: {
      all?: FxMediaItem[];
      photos?: FxMediaItem[];
      videos?: FxMediaItem[];
    };
  };
};

/**
 * Scarica foto, caroselli e video da X/Twitter interrogando api.fxtwitter.com.
 * Non richiede cookie né login e supporta tweet con foto singole, multi-foto e video MP4.
 */
async function tryDownloadX(url: URL, outDir: string): Promise<boolean> {
  const match = /^\/(?:([^/]+)\/status|i\/web\/status|i\/status)\/(\d+)/i.exec(
    url.pathname,
  );
  if (!match) return false;

  const user = match[1] ?? "i";
  const statusId = match[2];
  if (!statusId) return false;

  try {
    const signal = AbortSignal.timeout(30_000);
    const apiUrl = new URL(
      `https://api.fxtwitter.com/${encodeURIComponent(user)}/status/${statusId}`,
    );
    const { response } = await safeFetch(apiUrl, signal);
    const data = (await response.json()) as FxResponse;

    const items = data.tweet?.media?.all ?? [
      ...(data.tweet?.media?.photos ?? []),
      ...(data.tweet?.media?.videos ?? []),
    ];
    if (!items || items.length === 0) return false;

    let savedCount = 0;
    for (const item of items.slice(0, MAX_ITEMS)) {
      if (!item.url) continue;
      const mediaUrl = new URL(item.url);
      // Per le foto di Twitter, chiediamo la qualità originale se possibile
      if (
        mediaUrl.hostname.endsWith("twimg.com") &&
        /\.(?:jpg|jpeg|png)$/i.test(mediaUrl.pathname)
      ) {
        mediaUrl.searchParams.set("name", "orig");
      }

      const dlSignal = AbortSignal.timeout(JOB_TIMEOUT_MS);
      const { response: mediaResp } = await safeFetch(mediaUrl, dlSignal);
      const contentType =
        (mediaResp.headers.get("content-type") ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase() ?? "";

      const ext =
        DIRECT_TYPES[contentType] ??
        (item.type === "video" || item.type === "gif" ? ".mp4" : ".jpg");

      savedCount++;
      const fileName = `${String(savedCount).padStart(2, "0")}${ext}`;
      await saveBody(mediaResp, path.join(outDir, fileName));
    }

    return savedCount > 0;
  } catch (error) {
    console.warn("[link] fallback FxTwitter non riuscito:", errorText(error));
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    return false;
  }
}

// ─── Estrattore e Resolver per Instagram ─────────────────────────────────────

/**
 * I nuovi link condivisi dall'app Instagram hanno la forma:
 * https://www.instagram.com/share/reel/XXXX/ o /share/p/XXXX/
 * Seguiamo il redirect per ottenere il vero link /reel/XXXX/ o /p/XXXX/.
 */
async function resolveInstagramShareUrl(url: URL): Promise<URL> {
  if (!/^\/share\//i.test(url.pathname)) return url;
  try {
    const signal = AbortSignal.timeout(15_000);
    const { response, finalUrl } = await safeFetch(url, signal);
    await response.body?.cancel();
    finalUrl.search = "";
    return finalUrl;
  } catch {
    return url;
  }
}

/**
 * Fallback per Instagram quando yt-dlp e gallery-dl vengono bloccati senza login:
 * 1. Prova la pagina pubblica `/p/<shortcode>/embed/captioned/` che contiene nel JSON/HTML
 *    gli URL CDN (`scontent*.cdninstagram.com`) di video e immagini del post/carosello.
 * 2. Se ancora non basta, prova i metadati JSON di vxinstagram / kkinstagram.
 */
async function tryDownloadInstagramFallback(
  url: URL,
  outDir: string,
): Promise<boolean> {
  const match = /^\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i.exec(
    url.pathname,
  );
  const shortcode = match?.[1];
  if (!shortcode) return false;

  try {
    const signal = AbortSignal.timeout(30_000);
    const embedUrl = new URL(
      `https://www.instagram.com/p/${shortcode}/embed/captioned/`,
    );
    const { response } = await safeFetch(embedUrl, signal);
    const html = await response.text();

    const mediaUrls: { url: string; ext: string }[] = [];
    const seen = new Set<string>();

    const addMedia = (rawUrl: string, ext: string) => {
      const cleaned = rawUrl
        .replace(/\\u0026/g, "&")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&");
      if (!cleaned.startsWith("https://")) return;
      // Evitiamo le miniature piccole (s150x150, p150x150, s64x64)
      if (/[/_][sp]\d{2,3}x\d{2,3}[/_]/i.test(cleaned)) return;
      const baseKey = cleaned.split("?")[0] ?? cleaned;
      if (seen.has(baseKey)) return;
      seen.add(baseKey);
      mediaUrls.push({ url: cleaned, ext });
    };

    // 1. Cerchiamo `contextJSON` (contiene l'intero carosello o il video in alta risoluzione)
    const contextMatch = /"contextJSON"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(html);
    if (contextMatch?.[1]) {
      try {
        const unescaped = JSON.parse(`"${contextMatch[1]}"`) as string;
        // Video URLs nel JSON
        for (const m of unescaped.matchAll(
          /"video_url"\s*:\s*"(https:[^"]+)"/g,
        )) {
          if (m[1]) addMedia(m[1], ".mp4");
        }
        // Immagini ad alta risoluzione nel JSON (display_url)
        for (const m of unescaped.matchAll(
          /"display_url"\s*:\s*"(https:[^"]+)"/g,
        )) {
          if (m[1]) addMedia(m[1], ".jpg");
        }
      } catch {
        // procediamo con i selettori HTML sotto
      }
    }

    // 2. Se contextJSON non c'era, cerchiamo i tag EmbeddedMediaVideo / EmbeddedMediaImage nell'HTML
    if (mediaUrls.length === 0) {
      for (const m of html.matchAll(
        /class="EmbeddedMediaImage"[^>]+src="([^"]+)"/g,
      )) {
        if (m[1]) addMedia(m[1], ".jpg");
      }
      for (const m of html.matchAll(/<video[^>]+src="([^"]+)"/g)) {
        if (m[1]) addMedia(m[1], ".mp4");
      }
    }

    if (mediaUrls.length === 0) return false;

    let saved = 0;
    for (const item of mediaUrls.slice(0, MAX_ITEMS)) {
      const dlSignal = AbortSignal.timeout(JOB_TIMEOUT_MS);
      const { response: mediaResp } = await safeFetch(
        new URL(item.url),
        dlSignal,
      );
      const type =
        (mediaResp.headers.get("content-type") ?? "")
          .split(";")[0]
          ?.trim()
          .toLowerCase() ?? "";
      const ext = DIRECT_TYPES[type] ?? item.ext;
      saved++;
      await saveBody(
        mediaResp,
        path.join(outDir, `${String(saved).padStart(2, "0")}${ext}`),
      );
    }

    return saved > 0;
  } catch (error) {
    console.warn(
      "[link] fallback Instagram embed non riuscito:",
      errorText(error),
    );
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    return false;
  }
}

// ─── yt-dlp e gallery-dl ─────────────────────────────────────────────────────

async function downloadWithTools(
  url: URL,
  first: Tool,
  jobDir: string,
  outDir: string,
) {
  const order: Tool[] =
    first === "ytdlp" ? ["ytdlp", "gallery"] : ["gallery", "ytdlp"];
  let lastError: unknown;

  // Se hai messo un file cookies.txt sul Pi, lo copiamo dentro jobDir così i tool
  // nella sandbox possono leggerlo senza accedere a /mnt o /home.
  const sandboxCookies = await prepareCookiesInSandbox(jobDir);

  for (const tool of order) {
    try {
      const args =
        tool === "ytdlp"
          ? ytdlpArgs(outDir, sandboxCookies)
          : galleryArgs(outDir, sandboxCookies);
      await runSandboxed(BIN[tool], [...args, "--", url.href], jobDir, outDir);
      if ((await readdir(outDir)).length > 0) return;
    } catch (error) {
      if (error instanceof Blocked) throw error;
      lastError = error;
    }
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir);
  }

  throw lastError ?? new Blocked("nel link non ho trovato foto o video");
}

async function prepareCookiesInSandbox(
  jobDir: string,
): Promise<string | undefined> {
  if (!existsSync(COOKIES_FILE)) return undefined;
  try {
    const target = path.join(jobDir, "cookies.txt");
    await copyFile(COOKIES_FILE, target);
    if (RUNNING_AS_ROOT) {
      await execFileAsync(BIN.chown, [
        `${SANDBOX_USER}:${SANDBOX_USER}`,
        target,
      ]);
    }
    return target;
  } catch {
    return undefined;
  }
}

function ytdlpArgs(outDir: string, cookiesPath?: string): string[] {
  const args = [
    "--ignore-config",
    "--no-cache-dir",
    "--use-extractors",
    "default,-generic",
    "--js-runtimes",
    `bun:${BIN.bun}`,
    "--user-agent",
    USER_AGENT,
    "--no-playlist",
    "--playlist-items",
    `1:${MAX_ITEMS}`,
    "--max-filesize",
    `${MAX_FILE_MB}M`,
    "-S",
    "res:1080,vcodec:h264,ext:mp4:m4a",
    "--merge-output-format",
    "mp4",
    "--embed-metadata",
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
  if (cookiesPath) args.push("--cookies", cookiesPath);
  return args;
}

function galleryArgs(outDir: string, cookiesPath?: string): string[] {
  const args = [
    "--config-ignore",
    "--no-input",
    "--no-colors",
    "--no-mtime",
    "--user-agent",
    USER_AGENT,
    "--range",
    `1-${MAX_ITEMS}`,
    "--filesize-max",
    `${MAX_FILE_MB}M`,
    "--http-timeout",
    "30",
    "--retries",
    "3",
    "-D",
    outDir,
  ];
  if (cookiesPath) args.push("--cookies", cookiesPath);
  return args;
}

// ─── Link diretti ────────────────────────────────────────────────────────────

type DirectResult = { kind: "saved" } | { kind: "page"; url: URL; first: Tool };

async function downloadDirect(url: URL, outDir: string): Promise<DirectResult> {
  const signal = AbortSignal.timeout(JOB_TIMEOUT_MS);
  const { response, finalUrl } = await safeFetch(url, signal);

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

  await response.body?.cancel();

  const platform = findPlatform(finalUrl.hostname);
  if (platform && type === "text/html")
    return { kind: "page", url: finalUrl, first: platform.first };

  throw new Blocked(
    type === "text/html"
      ? `${finalUrl.hostname} non è nella lista dei siti (PLATFORMS in link.ts)`
      : `tipo di file non ammesso (${type || "sconosciuto"})`,
  );
}

async function safeFetch(
  start: URL,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = start;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertSafeShape(current);
    await assertPublicHost(current.hostname);

    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json,image/*,video/*,audio/*,text/html;q=0.5",
      },
    });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      current = new URL(location, current);
      if (current.protocol === "http:") current.protocol = "https:";
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Blocked(`il sito risponde con errore ${response.status}`);
    }
    return { response, finalUrl: current };
  }

  throw new Blocked("troppi redirect");
}

async function saveBody(response: Response, file: string) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_FILE_MB * MB) {
    await response.body?.cancel();
    throw new Blocked(`file troppo grande (${Math.ceil(declared / MB)} MB)`);
  }
  if (!response.body) throw new Blocked("il sito ha risposto senza contenuto");

  const handle = await open(file, "wx", 0o644);
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
  const full = [
    "-n",
    "10",
    BIN.ionice,
    "-c",
    "2",
    "-n",
    "7",
    ...dropRoot(),
    ...inner,
  ];

  const controller = new AbortController();
  const watchdog = watchDir ? watchSize(watchDir, controller) : undefined;

  try {
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

function sandboxArgs(jobDir: string): string[] {
  const args = ["--ro-bind", "/", "/"];

  for (const dir of ["/home", "/root", "/mnt", "/media", "/srv"]) {
    if (existsSync(dir)) args.push("--tmpfs", dir);
  }
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
    jobDir,
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
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

let sandboxStatus: Promise<boolean> | undefined;

function sandboxWorks(): Promise<boolean> {
  const [command = BIN.bwrap, ...args] = [
    ...dropRoot(),
    BIN.bwrap,
    "--ro-bind",
    "/",
    "/",
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "/usr/bin/true",
  ];
  sandboxStatus ??= execFileAsync(command, args, { timeout: 10_000 })
    .then(() => true)
    .catch((error) => {
      console.warn("[link] sandbox bwrap non disponibile:", errorText(error));
      return false;
    });
  return sandboxStatus;
}

function dropRoot(): string[] {
  if (!RUNNING_AS_ROOT) return [];
  return [
    BIN.setpriv,
    "--reuid",
    SANDBOX_USER,
    "--regid",
    SANDBOX_USER,
    "--clear-groups",
  ];
}

function watchSize(dir: string, controller: AbortController) {
  return setInterval(async () => {
    let total = 0;
    for (const name of await readdir(dir).catch(() => [])) {
      total += (await lstat(path.join(dir, name)).catch(() => null))?.size ?? 0;
    }
    if (total > MAX_JOB_MB * MB) controller.abort();
  }, 3000);
}

let leftoversCleaned = false;

async function createJobDir(): Promise<string> {
  await mkdir(WORK_DIR, { recursive: true, mode: 0o700 });

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

  if (RUNNING_AS_ROOT)
    await execFileAsync(BIN.chown, [
      "-R",
      `${SANDBOX_USER}:${SANDBOX_USER}`,
      jobDir,
    ]);
  return jobDir;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICA DEI FILE (strato 6)
// ═══════════════════════════════════════════════════════════════════════════

async function collect(
  outDir: string,
  jobDir: string,
): Promise<{ media: Media[]; rejected: number }> {
  const media: Media[] = [];
  let rejected = 0;

  for (const name of (await readdir(outDir)).sort()) {
    if (name.startsWith(".") || /\.(part|ytdl|temp|tmp)$/i.test(name)) continue;
    const item = await inspectFile(path.join(outDir, name), jobDir);
    if (item) media.push(item);
    else rejected++;
    if (media.length >= MAX_ITEMS) break;
  }
  return { media, rejected };
}

async function inspectFile(
  file: string,
  jobDir: string,
): Promise<Media | undefined> {
  const ext = path.extname(file).toLowerCase();
  if (!MEDIA_EXT.includes(ext)) return undefined;

  const info = await lstat(file);
  if (!info.isFile() || info.size === 0 || info.size > MAX_FILE_MB * MB)
    return undefined;

  const probe = await runProbe(file, jobDir);
  if (!probe) return undefined;

  const streams = probe.streams ?? [];
  const video = streams.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  const audio = streams.find((s) => s.codec_type === "audio");
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const duration = Math.round(Number(probe.format?.duration) || 0);

  if (PHOTO_EXT.includes(ext) || GIF_EXT.includes(ext)) {
    if (!(await hasImageSignature(file, ext)) || width === 0 || height === 0)
      return undefined;
    if (GIF_EXT.includes(ext))
      return { kind: "animation", file, width, height };
    return photoOrDocument(file, ext, info.size, width, height, jobDir);
  }

  if (VIDEO_EXT.includes(ext) && video && width > 0 && height > 0) {
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
        FORMAT_WHITELIST,
        "-protocol_whitelist",
        "file",
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

async function photoOrDocument(
  file: string,
  ext: string,
  size: number,
  width: number,
  height: number,
  jobDir: string,
): Promise<Media> {
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
    return { kind: "document", file };
  }
}

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

function isVisual(item: Media): item is VisualMedia {
  return item.kind === "photo" || item.kind === "video";
}

async function deliver(
  api: Api,
  job: Job,
  items: Media[],
  caption: string,
): Promise<number[]> {
  const sent: number[] = [];

  let captionLeft: string | undefined = caption;
  const takeCaption = () => {
    const text = captionLeft;
    captionLeft = undefined;
    return text;
  };

  const visual = items.filter(isVisual);
  const others: Media[] = items.filter((item) => !isVisual(item));

  if (visual.length >= 2) {
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
    others.unshift(...visual);
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
          supports_streaming: true,
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
      return (
        await api.sendDocument(job.chatId, file, {
          ...base,
          disable_content_type_detection: true,
        })
      ).message_id;
    default: {
      const unhandled: never = item;
      throw new Error(`Tipo non gestito: ${JSON.stringify(unhandled)}`);
    }
  }
}

async function copyToArchive(
  api: Api,
  fromChatId: number,
  messageIds: number[],
) {
  const groupId = ARCHIVE_GROUP_ID;
  if (!COPY_TO_ARCHIVE || groupId === undefined || messageIds.length === 0)
    return;
  if (fromChatId === groupId) return;

  try {
    const ids = [...messageIds].sort((a, b) => a - b);
    await withTopic(api, groupId, (threadId) =>
      api.copyMessages(groupId, fromChatId, ids, {
        message_thread_id: threadId,
      }),
    );
  } catch (error) {
    console.warn(
      "[link] copia nel gruppo archivio non riuscita:",
      errorText(error),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOPIC 🔗 Link
// ═══════════════════════════════════════════════════════════════════════════

type TopicMap = Record<string, number>;

let topics: TopicMap | undefined;
const creating = new Map<number, Promise<number | undefined>>();

async function loadTopics(): Promise<TopicMap> {
  if (!topics) {
    try {
      topics = JSON.parse(await readFile(TOPICS_FILE, "utf8")) as TopicMap;
    } catch {
      topics = {};
    }
  }
  return topics;
}

async function saveTopics(map: TopicMap) {
  await mkdir(path.dirname(TOPICS_FILE), { recursive: true });
  const temp = `${TOPICS_FILE}.tmp`;
  await writeFile(temp, JSON.stringify(map, null, 2));
  await rename(temp, TOPICS_FILE);
}

async function getTopic(api: Api, chatId: number): Promise<number | undefined> {
  const map = await loadTopics();
  const known = map[chatId];
  if (known !== undefined) return known;

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
    return undefined;
  }
}

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

function errorText(error: unknown): string {
  if (error instanceof GrammyError) return error.description;

  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  const text =
    typeof stderr === "string" && stderr.trim() !== ""
      ? stderr
      : error instanceof Error
        ? error.message
        : String(error);

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
