import { Composer, GrammyError, InlineKeyboard, type Api } from "grammy";
import type { Message, ReactionTypeEmoji } from "grammy/types";
import {
  chown,
  copyFile,
  mkdir,
  rename,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import { basename, dirname, extname, join, parse } from "node:path";
import { ApiDirectory, Directories } from "../../utils";

// ─── Configurazione Utenti e Percorsi ────────────────────────────────────

const ME = Number(process.env.MORGAN_ID);

type UserProfile = {
  folderSuffix: string;
  immichApiKey?: string;
  immichLibraryId?: string;
};

const OTHER_USERS: Record<number, UserProfile> = {
  858705722: {
    folderSuffix: process.env.USER_858705722_FOLDER ?? "858705722",
    immichApiKey: process.env.IMMICH_API_KEY_858705722,
    immichLibraryId: process.env.IMMICH_LIBRARY_ID_858705722,
  },
};

const allowedUsers = [ME, 120075267, 858705722];

function isAllowed(userId: number | undefined): boolean {
  return userId !== undefined && allowedUsers.includes(userId);
}

const archiveId = Number(process.env.ARCHIVE_GROUP_ID);
const ARCHIVE_GROUP_ID =
  Number.isSafeInteger(archiveId) && archiveId !== 0 ? archiveId : undefined;

const STATE_FILE =
  process.env.JULY_STATE_FILE ?? "/mnt/storage/apps/july/upload-state.json";

const IMMICH_URL = process.env.IMMICH_URL?.replace(/\/+$/, "");
const IMMICH_API_KEY = process.env.IMMICH_API_KEY;
const IMMICH_LIBRARY_ID = process.env.IMMICH_LIBRARY_ID;

const LIBRARY_LABEL = "🏔️ Library";
const CINEMA_LABEL = "🎬 Cinema";

const PERSONAL_LABELS = new Set<string>([
  LIBRARY_LABEL,
  "📁 File",
  "📄 File",
  "🗂️ File",
  "📂 File",
]);

type Directory = (typeof Directories)[number];

function resolveTargetDir(
  directory: Directory,
  senderId: number | undefined,
): string {
  if (!senderId || senderId === ME) return directory.directory;

  const isPersonal =
    PERSONAL_LABELS.has(directory.label) ||
    /library|file|doc/i.test(directory.label);
  if (!isPersonal) return directory.directory;

  const profile = OTHER_USERS[senderId];
  const suffix = profile?.folderSuffix ?? String(senderId);
  const cleanBase = directory.directory.replace(/\/+$/, "");
  return `${cleanBase}-${suffix}`;
}

// ─── Il file ricevuto ────────────────────────────────────────────────────

type IncomingFile = {
  kind: "document" | "audio" | "video" | "photo" | "lesson" | "book";
  fileId: string;
  fileUniqueId: string;
  name: string;
  mimeType: string | undefined;
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/heic": ".heic",
  "image/png": ".png",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
};

function safeName(
  kind: IncomingFile["kind"],
  fileName: string | undefined,
  mimeType: string | undefined,
): string {
  const cleaned = basename(fileName ?? "")
    .replace(/[\u0000-\u001f\\]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  if (cleaned) return cleaned;
  const extension = (mimeType && EXTENSION_BY_MIME[mimeType]) ?? "";
  return `${kind}-${Date.now()}${extension}`;
}

function extractFile(msg: Message): IncomingFile | undefined {
  if (msg.document) {
    const { file_id, file_unique_id, file_name, mime_type } = msg.document;
    return {
      kind: "document",
      fileId: file_id,
      fileUniqueId: file_unique_id,
      name: safeName("document", file_name, mime_type),
      mimeType: mime_type,
    };
  }
  if (msg.audio) {
    const { file_id, file_unique_id, file_name, mime_type } = msg.audio;
    return {
      kind: "audio",
      fileId: file_id,
      fileUniqueId: file_unique_id,
      name: safeName("audio", file_name, mime_type),
      mimeType: mime_type,
    };
  }
  if (msg.video) {
    const { file_id, file_unique_id, file_name, mime_type } = msg.video;
    return {
      kind: "video",
      fileId: file_id,
      fileUniqueId: file_unique_id,
      name: safeName("video", file_name, mime_type),
      mimeType: mime_type,
    };
  }
  if (msg.photo) {
    const largest = msg.photo.at(-1);
    if (!largest) return undefined;
    return {
      kind: "photo",
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      name: safeName("photo", undefined, "image/jpeg"),
      mimeType: "image/jpeg",
    };
  }
  return undefined;
}

// ─── Smistamento ─────────────────────────────────────────────────────────

const EPISODE_PATTERN = /\bS\d{1,2}\s?E\d{1,3}\b|\b\d{1,2}x\d{2,3}\b/i;
const CAMERA_PATTERN =
  /^(?:(?:IMG|VID|PXL|MVIMG|DSC|DSCN|GOPR|DJI)[_-]?\d|RPReplay)/i;

const PHOTO_EXTENSIONS = new Set([
  ".heic",
  ".heif",
  ".jpg",
  ".jpeg",
  ".dng",
  ".raw",
  ".cr2",
  ".nef",
  ".arw",
]);

function isImageOrVideo(file: IncomingFile): boolean {
  const mime = file.mimeType ?? "";
  return mime.startsWith("image/") || mime.startsWith("video/");
}

function candidatesFor(file: IncomingFile): Directory[] {
  const ext = extname(file.name).toLowerCase();
  const library = Directories.find((r) => r.label === LIBRARY_LABEL);
  const cinema = Directories.find((r) => r.label === CINEMA_LABEL);

  if (library && (file.kind === "photo" || PHOTO_EXTENSIONS.has(ext)))
    return [library];

  const matches = Directories.filter((r) => r.extension.some((e) => e === ext));

  if (library && isImageOrVideo(file) && !matches.includes(library))
    matches.push(library);

  if (matches.length === 0) return [...Directories];
  if (matches.length === 1) return matches;

  if (library && matches.includes(library) && CAMERA_PATTERN.test(file.name))
    return [library];
  if (cinema && matches.includes(cinema) && EPISODE_PATTERN.test(file.name))
    return [cinema];
  return matches;
}

// ─── Gestione Date e Metadati per Immich (EXIF + mtime) ──────────────────

function isExifArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "object" &&
    value[0] !== null
  );
}

function parseExifDateString(raw: string): Date | undefined {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
    raw.trim(),
  );
  if (!match) return undefined;
  const [, y, m, d, hh, mm, ss] = match;
  const date = new Date(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
  );
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function readEmbeddedExifDate(
  filePath: string,
): Promise<Date | undefined> {
  try {
    const proc = Bun.spawn(
      [
        "exiftool",
        "-json",
        "-SubSecDateTimeOriginal",
        "-DateTimeOriginal",
        "-CreationDate",
        "-CreateDate",
        "-TrackCreateDate",
        "-MediaCreateDate",
        filePath,
      ],
      { stdout: "pipe", stderr: "ignore" },
    );

    const output = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return undefined;

    const parsed: unknown = JSON.parse(output);
    if (!isExifArray(parsed) || !parsed[0]) return undefined;

    const meta = parsed[0];
    const rawDate =
      meta.SubSecDateTimeOriginal ??
      meta.DateTimeOriginal ??
      meta.CreationDate ??
      meta.CreateDate ??
      meta.TrackCreateDate ??
      meta.MediaCreateDate;

    if (typeof rawDate === "string" && !rawDate.startsWith("0000:00:00")) {
      return parseExifDateString(rawDate);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function extractFallbackDate(msg: Message, fileName: string): Date | undefined {
  const caption = msg.caption?.trim();
  const text = `${caption ?? ""} ${fileName}`;

  if (caption) {
    const rel =
      /^-?\s*(\d{1,3})\s*(?:d|gg|giorni|days?)(?:\s+fa|\s+ago)?$/i.exec(
        caption,
      );
    if (rel) {
      const days = Number(rel[1]);
      return new Date(Date.now() - days * 86_400_000);
    }

    const itMatch =
      /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})(?:\s+(\d{1,2})[:.](\d{2}))?\b/.exec(
        caption,
      );
    if (itMatch) {
      const [, d, m, y, hh = "12", mm = "00"] = itMatch;
      return new Date(
        Number(y),
        Number(m) - 1,
        Number(d),
        Number(hh),
        Number(mm),
        0,
      );
    }
  }

  const isoMatch =
    /(?:^|\D)(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[ T_-]?([01]\d|2[0-3])[:.]?([0-5]\d)[:.]?([0-5]\d)?)?(?:\D|$)/.exec(
      text,
    );
  if (isoMatch) {
    const [, y, m, d, hh = "12", mm = "00", ss = "00"] = isoMatch;
    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
    );
  }

  if (msg.forward_origin && "date" in msg.forward_origin) {
    return new Date(msg.forward_origin.date * 1000);
  }

  return undefined;
}

function formatExifDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function stampFileDate(filePath: string, date: Date): Promise<void> {
  const exifStr = formatExifDate(date);
  try {
    const writeProc = Bun.spawn(
      [
        "exiftool",
        "-overwrite_original",
        `-AllDates=${exifStr}`,
        `-DateTimeOriginal=${exifStr}`,
        `-CreateDate=${exifStr}`,
        `-CreationDate=${exifStr}`,
        `-TrackCreateDate=${exifStr}`,
        `-MediaCreateDate=${exifStr}`,
        filePath,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    await writeProc.exited;
  } catch {
    // continua con utimes
  }
  await utimes(filePath, date, date).catch(() => undefined);
}

// Mappa in memoria dei file appena salvati senza EXIF, così con 1 bottone puoi
// cambiarne la data direttamente sul file già salvato in Library!
const recentLibraryFiles = new Map<
  number,
  { path: string; dir: string; senderId: number | undefined }
>();

// ─── Stato su disco (topic creati + file già caricati) ───────────────────

type State = {
  topics: Record<string, number>;
  done: string[];
};

const MAX_DONE = 10_000;
let cachedState: State | undefined;

function isState(value: unknown): value is State {
  if (typeof value !== "object" || value === null) return false;
  return (
    "topics" in value &&
    typeof value.topics === "object" &&
    "done" in value &&
    Array.isArray(value.done)
  );
}

async function loadState(): Promise<State> {
  if (cachedState) return cachedState;
  const file = Bun.file(STATE_FILE);
  const data: unknown = (await file.exists()) ? await file.json() : undefined;
  cachedState = isState(data) ? data : { topics: {}, done: [] };
  return cachedState;
}

async function saveState(): Promise<void> {
  if (!cachedState) return;
  await mkdir(dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  await Bun.write(temporary, JSON.stringify(cachedState, null, 2));
  await rename(temporary, STATE_FILE);
}

function doneKeyFor(
  fileUniqueId: string,
  targetDir: string,
  senderId: number | undefined,
): string {
  if (!senderId || senderId === ME) return fileUniqueId;
  return `${senderId}:${targetDir}:${fileUniqueId}`;
}

async function isAlreadyDone(doneKey: string): Promise<boolean> {
  return (await loadState()).done.includes(doneKey);
}

async function markDone(doneKey: string): Promise<void> {
  const state = await loadState();
  state.done.push(doneKey);
  if (state.done.length > MAX_DONE)
    state.done.splice(0, state.done.length - MAX_DONE);
  await saveState();
}

// ─── Topic (solo nel gruppo archivio) ────────────────────────────────────

const topicKey = (chatId: number, directory: Directory) =>
  `${chatId}:${directory.label}`;

const creatingTopics = new Map<string, Promise<number>>();

async function getOrCreateTopic(
  api: Api,
  chatId: number,
  directory: Directory,
): Promise<number> {
  const key = topicKey(chatId, directory);

  const saved = (await loadState()).topics[key];
  if (saved !== undefined) return saved;

  const pending = creatingTopics.get(key);
  if (pending) return pending;

  const creation = (async () => {
    const topic = await api.createForumTopic(chatId, directory.label);
    const state = await loadState();
    state.topics[key] = topic.message_thread_id;
    await saveState();
    return topic.message_thread_id;
  })();

  creatingTopics.set(key, creation);
  try {
    return await creation;
  } finally {
    creatingTopics.delete(key);
  }
}

export async function ensureAllTopics(api: Api, chatId: number): Promise<void> {
  for (const directory of Directories) {
    await getOrCreateTopic(api, chatId, directory);
  }
}

function isTopicGone(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    /thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test(error.description)
  );
}

async function inTopic<T>(
  api: Api,
  chatId: number,
  directory: Directory,
  action: (threadId: number) => Promise<T>,
): Promise<T> {
  const threadId = await getOrCreateTopic(api, chatId, directory);
  try {
    return await action(threadId);
  } catch (error) {
    if (!isTopicGone(error)) throw error;
    const state = await loadState();
    delete state.topics[topicKey(chatId, directory)];
    await saveState();
    return action(await getOrCreateTopic(api, chatId, directory));
  }
}

function threadOf(msg: Message): number | undefined {
  return msg.is_topic_message ? msg.message_thread_id : undefined;
}

// ─── Spostamento file ────────────────────────────────────────────────────

function isErrnoError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function moveFile(src: string, destination: string): Promise<void> {
  try {
    await rename(src, destination);
  } catch (error) {
    if (!isErrnoError(error) || error.code !== "EXDEV") throw error;

    const temporary = join(
      dirname(destination),
      `.${basename(destination)}.part`,
    );
    await copyFile(src, temporary);
    await rename(temporary, destination);
    await unlink(src);
  }
}

async function freePath(dir: string, name: string): Promise<string> {
  const { name: stem, ext } = parse(name);
  let candidate = join(dir, name);
  for (let i = 1; await Bun.file(candidate).exists(); i++) {
    candidate = join(dir, `${stem} (${i})${ext}`);
  }
  return candidate;
}

async function adoptFolderOwner(file: string, dir: string): Promise<void> {
  const { uid, gid } = await stat(dir);
  try {
    await chown(file, uid, gid);
  } catch (error) {
    if (!isErrnoError(error) || error.code !== "EPERM") throw error;
    console.warn(
      `chown di ${file} non permesso: resta il proprietario attuale`,
    );
  }
}

// ─── Immich ──────────────────────────────────────────────────────────────

async function scanImmich(
  senderId: number | undefined,
): Promise<string | undefined> {
  if (!IMMICH_URL) return undefined;

  const isMe = !senderId || senderId === ME;
  const apiKey = isMe ? IMMICH_API_KEY : OTHER_USERS[senderId]?.immichApiKey;
  const libraryId = isMe
    ? IMMICH_LIBRARY_ID
    : OTHER_USERS[senderId]?.immichLibraryId;

  if (!apiKey || !libraryId) return undefined;

  try {
    const response = await fetch(
      `${IMMICH_URL}/api/libraries/${libraryId}/scan`,
      {
        method: "POST",
        headers: { "x-api-key": apiKey },
      },
    );
    return response.ok
      ? undefined
      : `⚠️ Caricato in ${LIBRARY_LABEL}, ma Immich ha risposto HTTP ${response.status}`;
  } catch {
    return `⚠️ Caricato in ${LIBRARY_LABEL}, ma Immich non è raggiungibile (lo importerà alla prossima scansione)`;
  }
}

// ─── La pipeline ─────────────────────────────────────────────────────────

const inProgress = new Set<string>();

async function react(
  api: Api,
  chatId: number,
  messageId: number,
  status: "working" | "done",
): Promise<void> {
  const emojis: ReactionTypeEmoji["emoji"][] =
    status === "working" ? ["👀"] : ["👍"];
  for (const emoji of emojis) {
    try {
      await api.setMessageReaction(chatId, messageId, [
        { type: "emoji", emoji },
      ]);
      return;
    } catch {
      // Prova l'emoji successiva
    }
  }
}

/** Tutto il lavoro per un file di cui conosciamo già la cartella. */
async function processUpload(
  api: Api,
  msg: Message,
  directory: Directory,
): Promise<void> {
  const file = extractFile(msg);
  if (!file) return;

  const chatId = msg.chat.id;
  const senderId = msg.from?.id;
  const isLibrary = directory.label === LIBRARY_LABEL;
  const targetDir = resolveTargetDir(directory, senderId);
  const key = doneKeyFor(file.fileUniqueId, targetDir, senderId);

  const replyHere = {
    message_thread_id: threadOf(msg),
    reply_parameters: {
      message_id: msg.message_id,
      allow_sending_without_reply: true,
    },
  };

  if (isLibrary && file.kind !== "document") {
    await api.sendMessage(
      chatId,
      `❌ Inviato come ${file.kind === "photo" ? "foto compressa" : "video compresso"}: Telegram ha rimosso i metadati.\n📎 Rimandalo come File per caricarlo in ${LIBRARY_LABEL}.`,
      replyHere,
    );
    return;
  }

  if (inProgress.has(key)) return;

  // Se il file era già in `done`, ma sul disco NON esiste più (perché l'hai cancellato
  // per rifare il test), lo lasciamo ricaricare tranquillamente!
  const expectedPath = join(targetDir, file.name);
  if ((await isAlreadyDone(key)) && (await Bun.file(expectedPath).exists())) {
    await api.sendMessage(
      chatId,
      `ℹ️ ${file.name} è già stato caricato (usa /resetuploads se vuoi forzare il ricaricamento).`,
      replyHere,
    );
    return;
  }

  inProgress.add(key);
  try {
    await react(api, chatId, msg.message_id, "working");

    // 1. Chiedi alla Bot API locale dove ha salvato il file.
    const info = await api.getFile(file.fileId);
    if (!info.file_path)
      throw new Error("Telegram non ha restituito il percorso del file");

    const src = info.file_path.replace(
      "/var/lib/telegram-bot-api",
      ApiDirectory,
    );

    // 2. Sposta il file in una posizione di staging nella cartella di destinazione.
    await mkdir(targetDir, { recursive: true });
    const destination = await freePath(targetDir, file.name);
    const staging = join(targetDir, `.${basename(destination)}.staging`);

    await moveFile(src, staging);
    await adoptFolderOwner(staging, targetDir);

    // 3. Controllo data per Library:
    let missingExifAndDate = false;
    if (isLibrary) {
      const exifDate = await readEmbeddedExifDate(staging);
      const fallbackDate = extractFallbackDate(msg, file.name);

      if (msg.caption && fallbackDate) {
        // Hai scritto una data esplicita nella caption (es. "3d" o "10/11/2026")
        await stampFileDate(staging, fallbackDate);
      } else if (exifDate) {
        // Ha già la data EXIF originale dell'iPhone: allineiamo l'mtime del file
        await utimes(staging, exifDate, exifDate).catch(() => undefined);
      } else if (fallbackDate) {
        // Data trovata nel nome del file o messaggio inoltrato
        await stampFileDate(staging, fallbackDate);
      } else {
        // Immagine scaricata da internet senza EXIF e senza data nel nome/caption
        missingExifAndDate = true;
      }
      await adoptFolderOwner(staging, targetDir);
    }

    // 4. Rinomina il file al suo nome definitivo nella cartella
    await rename(staging, destination);

    // 5. Avvia la scansione Immich
    if (isLibrary) {
      const immichWarning = await scanImmich(senderId);
      if (immichWarning) {
        await api.sendMessage(chatId, immichWarning, replyHere);
      }
    }

    // 6. Copia nel gruppo archivio SOLO se il file l'hai mandato tu (ME).
    if (ARCHIVE_GROUP_ID !== undefined && senderId === ME) {
      const groupId = ARCHIVE_GROUP_ID;
      await inTopic(api, groupId, directory, (threadId) =>
        api.copyMessage(groupId, chatId, msg.message_id, {
          message_thread_id: threadId,
        }),
      );
    }

    // 7. Spunta ☑️ sul file
    await react(api, chatId, msg.message_id, "done");
    await markDone(key);

    // 8. Se il file non aveva NESSUNA data (scaricato da internet senza EXIF),
    //    è già stato caricato ma ti offriamo i bottoni per retrodatarlo al volo!
    if (missingExifAndDate) {
      recentLibraryFiles.set(msg.message_id, {
        path: destination,
        dir: targetDir,
        senderId,
      });
      const kb = new InlineKeyboard()
        .text("Oggi ✓", `setdate:${msg.message_id}:0`)
        .text("Ieri", `setdate:${msg.message_id}:1`)
        .text("2 gg fa", `setdate:${msg.message_id}:2`)
        .row()
        .text("3 gg fa", `setdate:${msg.message_id}:3`)
        .text("4 gg fa", `setdate:${msg.message_id}:4`)
        .text("1 sett fa", `setdate:${msg.message_id}:7`);

      await api.sendMessage(
        chatId,
        `📅 *${basename(destination)}* non aveva data EXIF. Caricata a oggi — se l'hai scaricata giorni fa, tocca qui per spostarla su Immich:`,
        { ...replyHere, reply_markup: kb, parse_mode: "Markdown" },
      );
    }
  } catch (error) {
    console.error("Upload fallito:", error);
    const reason = error instanceof Error ? error.message : String(error);
    await api
      .sendMessage(chatId, `❌ ${file.name}: ${reason}`, replyHere)
      .catch(() => undefined);
  } finally {
    inProgress.delete(key);
  }
}

async function askDirectory(
  api: Api,
  msg: Message,
  file: IncomingFile,
  candidates: readonly Directory[],
): Promise<void> {
  const keyboard = new InlineKeyboard();
  candidates.forEach((entry, index) => {
    keyboard.text(entry.label, `up:${Directories.indexOf(entry)}`);
    if (index % 2 === 1) keyboard.row();
  });

  await api.sendMessage(msg.chat.id, `🤔 Dove va ${file.name}?`, {
    message_thread_id: threadOf(msg),
    reply_parameters: { message_id: msg.message_id },
    reply_markup: keyboard,
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────

export const upload = new Composer();

// /resetuploads: svuota la memoria dei file già caricati, utile quando fai test.
upload.command("resetuploads", async (ctx, next) => {
  if (!isAllowed(ctx.from?.id)) return next();
  const state = await loadState();
  state.done = [];
  await saveState();
  await ctx.reply("♻️ Lista dei file caricati azzerata: ora puoi rimandarli.");
});

upload.command("topics", async (ctx, next) => {
  if (ctx.from?.id !== ME) return next();

  if (ARCHIVE_GROUP_ID === undefined) {
    await ctx.reply("❌ ARCHIVE_GROUP_ID non è impostato nel .env");
    return;
  }

  try {
    await ensureAllTopics(ctx.api, ARCHIVE_GROUP_ID);
    await ctx.reply(
      `✅ ${ARCHIVE_GROUP_ID}: ${Directories.map((r) => r.label).join(", ")}`,
    );
  } catch (error) {
    const reason =
      error instanceof GrammyError ? error.description : String(error);
    await ctx.reply(`❌ ${ARCHIVE_GROUP_ID}: ${reason}`);
  }
});

upload
  .chatType("private")
  .on(
    ["message:document", "message:audio", "message:video", "message:photo"],
    async (ctx, next) => {
      if (!isAllowed(ctx.from.id)) return next();

      const file = extractFile(ctx.msg);
      if (!file) return next();

      const candidates = candidatesFor(file);
      const [only] = candidates;
      if (!only) return next();

      if (candidates.length === 1) {
        await processUpload(ctx.api, ctx.msg, only);
      } else {
        await askDirectory(ctx.api, ctx.msg, file, candidates);
      }
    },
  );

upload.callbackQuery(/^up:(\d+)$/, async (ctx) => {
  if (!isAllowed(ctx.from.id)) {
    await ctx.answerCallbackQuery();
    return;
  }

  const directory = Directories[Number(ctx.match[1])];
  if (!directory) {
    await ctx.answerCallbackQuery({
      text: "Cartella non più valida: rimanda il file.",
      show_alert: true,
    });
    return;
  }

  const question = ctx.callbackQuery.message;
  const original =
    question && "reply_to_message" in question
      ? question.reply_to_message
      : undefined;
  if (!original) {
    await ctx.answerCallbackQuery({
      text: "Non trovo più il file: rimandalo.",
      show_alert: true,
    });
    return;
  }

  await ctx.answerCallbackQuery({ text: `Salvo in ${directory.label}` });
  await ctx.deleteMessage().catch(() => undefined);
  await processUpload(ctx.api, original, directory);
});

// Bottone per retrodatare un'immagine scaricata da internet già salvata in Library
upload.callbackQuery(/^setdate:(\d+):(\d+)$/, async (ctx) => {
  if (!isAllowed(ctx.from.id)) {
    await ctx.answerCallbackQuery();
    return;
  }

  const msgId = Number(ctx.match[1]);
  const daysAgo = Number(ctx.match[2]);
  const entry = recentLibraryFiles.get(msgId);

  if (!entry || !(await Bun.file(entry.path).exists())) {
    await ctx.answerCallbackQuery({
      text: "File non più in cache.",
      show_alert: true,
    });
    await ctx.deleteMessage().catch(() => undefined);
    return;
  }

  if (daysAgo > 0) {
    const newDate = new Date(Date.now() - daysAgo * 86_400_000);
    // Rinominiamo temporaneamente il file cambiando nome (aggiungendo la data)
    // così Immich lo rielabora subito come nuovo file con la nuova data EXIF!
    const { dir, name: stem, ext } = parse(entry.path);
    const datePrefix = newDate.toISOString().slice(0, 10);
    const renamedPath = await freePath(dir, `${datePrefix}_${stem}${ext}`);

    await stampFileDate(entry.path, newDate);
    await rename(entry.path, renamedPath);
    await adoptFolderOwner(renamedPath, entry.dir);
    await scanImmich(entry.senderId);
  }

  recentLibraryFiles.delete(msgId);
  await ctx.answerCallbackQuery({
    text:
      daysAgo === 0
        ? "Data lasciata a oggi"
        : `Data impostata a ${daysAgo} gg fa!`,
  });
  await ctx.deleteMessage().catch(() => undefined);
});
