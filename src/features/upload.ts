import { Composer, GrammyError, InlineKeyboard, type Api } from "grammy";
import type { Message } from "grammy/types";
import { chown, copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, parse } from "node:path";
import { API_DATA, Directories } from "../utils";

/*
 * Cosa fa questo file, per ogni file che mandi a July in chat privata:
 *   1. trova la cartella giusta guardando l'estensione (Directories in utils.ts);
 *      se l'estensione sta in più righe e il nome non basta a decidere, chiede con dei bottoni
 *   2. sposta il file in quella cartella (senza mai sovrascrivere)
 *   3. lo mette nel topic con lo stesso label nella chat con July
 *   4. lo copia nel topic con lo stesso label nel gruppo archivio
 *   5. se lo rimandi, non lo carica due volte
 *
 * /topics crea subito tutti i topic, nella chat in cui lo scrivi e nel gruppo.
 */

// ─── Configurazione ──────────────────────────────────────────────────────

// Il tuo ID Telegram, letto dal file .env.
// Se MORGAN_ID manca, Number(undefined) dà NaN e nessuno passa il controllo:
// meglio un bot bloccato che un bot aperto a tutti.
const ME = Number(process.env.MORGAN_ID);

// Per dare accesso a qualcun altro, aggiungi il suo ID Telegram a questa lista.
// (Va dichiarata DOPO ME, altrimenti ME non esiste ancora quando la usi.)
const allowedUsers = [ME];

/** true se chi ha scritto (o premuto un bottone) può usare gli upload. */
function isAllowed(userId: number | undefined): boolean {
  return userId !== undefined && allowedUsers.includes(userId);
}

// Gruppo archivio. Per i supergruppi l'id è NEGATIVO e inizia con -100
// (es. -1003978490692). Se manca o non è un numero, semplicemente non copiamo.
const archiveId = Number(process.env.ARCHIVE_GROUP_ID);
const ARCHIVE_GROUP_ID =
  Number.isSafeInteger(archiveId) && archiveId !== 0 ? archiveId : undefined;

// Dove July ricorda i topic creati e i file già caricati.
// Percorso assoluto sull'SSD: deve sopravvivere ai deploy.
const STATE_FILE =
  process.env.JULY_STATE_FILE ?? "/mnt/storage/apps/july/upload-state.json";

// Immich (facoltativo): dopo un upload in Library gli chiediamo di riscandire.
const IMMICH_URL = process.env.IMMICH_URL?.replace(/\/+$/, "");
const IMMICH_API_KEY = process.env.IMMICH_API_KEY;
const IMMICH_LIBRARY_ID = process.env.IMMICH_LIBRARY_ID;

// I label delle righe con un trattamento speciale. Devono essere identici a utils.ts.
const LIBRARY_LABEL = "📚 Library"; // foto: dopo l'upload, scansione di Immich
const CINEMA_LABEL = "🎬 Cinema"; // film e serie

/** Una riga di Directories. */
type Directory = (typeof Directories)[number];

// ─── Il file ricevuto ────────────────────────────────────────────────────

/** Quello che ci serve di un file, qualunque sia il tipo di messaggio. */
type IncomingFile = {
  kind: "document" | "audio" | "video" | "photo"; // come l'hai inviato
  fileId: string; // per chiedere il file alla Bot API
  fileUniqueId: string; // uguale anche se rimandi lo stesso file: chiave di idempotenza
  name: string; // nome sicuro, con estensione
};

/** Estensione dal tipo MIME, per i file che arrivano senza nome. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
};

/**
 * Rende sicuro il nome scelto da chi invia il file.
 * basename() toglie eventuali percorsi (es. "../../etc/passwd"), così nessuno
 * può scrivere fuori dalla cartella; via anche i punti iniziali (file nascosti).
 * Se il nome manca (foto inviate "come foto", alcuni video) ne inventiamo uno.
 */
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

/** Estrae il file da un messaggio; undefined se il messaggio non ne contiene uno. */
function extractFile(msg: Message): IncomingFile | undefined {
  if (msg.document) {
    const { file_id, file_unique_id, file_name, mime_type } = msg.document;
    return {
      kind: "document",
      fileId: file_id,
      fileUniqueId: file_unique_id,
      name: safeName("document", file_name, mime_type),
    };
  }
  if (msg.audio) {
    const { file_id, file_unique_id, file_name, mime_type } = msg.audio;
    return {
      kind: "audio",
      fileId: file_id,
      fileUniqueId: file_unique_id,
      name: safeName("audio", file_name, mime_type),
    };
  }
  if (msg.video) {
    const { file_id, file_unique_id, file_name, mime_type } = msg.video;
    return {
      kind: "video",
      fileId: file_id,
      fileUniqueId: file_unique_id,
      name: safeName("video", file_name, mime_type),
    };
  }
  if (msg.photo) {
    // Telegram manda la stessa foto in più dimensioni: l'ultima è la più grande.
    const largest = msg.photo.at(-1);
    if (!largest) return undefined;
    return {
      kind: "photo",
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
      name: safeName("photo", undefined, "image/jpeg"),
    };
  }
  return undefined;
}

// ─── Smistamento ─────────────────────────────────────────────────────────

// Episodi: "S01E02", "s1 e2", "1x02" → Cinema.
const EPISODE_PATTERN = /\bS\d{1,2}\s?E\d{1,3}\b|\b\d{1,2}x\d{2,3}\b/i;
// Nomi di fotocamere e telefoni (IMG_1234, PXL_…, registrazioni schermo) → Library.
const CAMERA_PATTERN =
  /^(?:(?:IMG|VID|PXL|MVIMG|DSC|DSCN|GOPR|DJI)[_-]?\d|RPReplay)/i;

/**
 * Le righe candidate per un file:
 *   0 righe → non è un file nostro (passiamo al prossimo handler)
 *   1 riga  → sicuro
 *   più     → se il nome non basta a decidere, chiediamo
 */
function candidatesFor(file: IncomingFile): Directory[] {
  const ext = extname(file.name).toLowerCase();
  const matches = Directories.filter((r) => r.extension.some((e) => e === ext));
  if (matches.length <= 1) return matches;

  // Più righe con la stessa estensione (es. .mp4 in Cinema e in Library):
  // proviamo a decidere dal nome prima di disturbarti.
  const library = matches.find((r) => r.label === LIBRARY_LABEL);
  const cinema = matches.find((r) => r.label === CINEMA_LABEL);
  if ((file.kind === "photo" || CAMERA_PATTERN.test(file.name)) && library)
    return [library];
  if (EPISODE_PATTERN.test(file.name) && cinema) return [cinema];
  return matches;
}

// ─── Stato su disco (topic creati + file già caricati) ───────────────────

/*
 * Un piccolo file JSON. Più avanti puoi sostituirlo con le tabelle Drizzle:
 * le funzioni di questa sezione sono le uniche che toccano lo stato.
 */

type State = {
  topics: Record<string, number>; // "chatId:label" → message_thread_id
  done: string[]; // file_unique_id dei file già caricati
};

const MAX_DONE = 10_000; // quanti file ricordare, per non far crescere il file all'infinito
let cachedState: State | undefined;

/** Custom type guard: controlla che il JSON letto abbia la forma giusta. */
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

/** Scrive prima un file temporaneo e poi lo rinomina: mai un JSON scritto a metà. */
async function saveState(): Promise<void> {
  if (!cachedState) return;
  await mkdir(dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  await Bun.write(temporary, JSON.stringify(cachedState, null, 2));
  await rename(temporary, STATE_FILE);
}

async function isAlreadyDone(fileUniqueId: string): Promise<boolean> {
  return (await loadState()).done.includes(fileUniqueId);
}

async function markDone(fileUniqueId: string): Promise<void> {
  const state = await loadState();
  state.done.push(fileUniqueId);
  if (state.done.length > MAX_DONE)
    state.done.splice(0, state.done.length - MAX_DONE);
  await saveState();
}

// ─── Topic ───────────────────────────────────────────────────────────────

const topicKey = (chatId: number, directory: Directory) =>
  `${chatId}:${directory.label}`;

// Topic in fase di creazione: se due file arrivano insieme aspettano la stessa
// creazione, invece di creare due topic uguali.
const creatingTopics = new Map<string, Promise<number>>();

/** L'id del topic di quella riga in quella chat; lo crea se non esiste. */
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
    // Il Bot API non permette di elencare i topic: l'id lo salviamo subito.
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

/** Crea (se mancano) tutti i topic di Directories in una chat. */
export async function ensureAllTopics(api: Api, chatId: number): Promise<void> {
  for (const directory of Directories) {
    await getOrCreateTopic(api, chatId, directory);
  }
}

/** true se Telegram dice che il topic non esiste più (l'hai cancellato a mano). */
function isTopicGone(error: unknown): boolean {
  return (
    error instanceof GrammyError &&
    /thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test(error.description)
  );
}

/** Esegue un'azione dentro il topic. Se il topic è stato cancellato, lo ricrea e riprova. */
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

/** Il topic in cui sta un messaggio, o undefined se non sta in un topic. */
function threadOf(msg: Message): number | undefined {
  return msg.is_topic_message ? msg.message_thread_id : undefined;
}

// ─── Spostamento file ────────────────────────────────────────────────────

/** Custom type guard: un errore di Node con `code` (es. "EXDEV"). Niente `as`. */
function isErrnoError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Sposta un file da `src` a `destination`.
 *
 * rename() è istantaneo, ma funziona solo dentro lo stesso filesystem
 * (e, se il bot gira in Docker, dentro lo stesso volume montato).
 * Se le due cartelle stanno su mount diversi, Node lancia l'errore EXDEV:
 * in quel caso copiamo il file e poi cancelliamo l'originale.
 *
 * La copia va prima su un file nascosto ".nome.part" e solo alla fine viene
 * rinominata: beets e mnamer girano ogni 5 minuti e non devono mai vedere
 * un file copiato a metà (ignorano i file nascosti e le estensioni sconosciute).
 */
async function moveFile(src: string, destination: string): Promise<void> {
  try {
    await rename(src, destination);
  } catch (error) {
    // Qualsiasi errore diverso da EXDEV è un problema vero: lo rilanciamo.
    if (!isErrnoError(error) || error.code !== "EXDEV") throw error;

    const temporary = join(
      dirname(destination),
      `.${basename(destination)}.part`,
    );
    await copyFile(src, temporary);
    await rename(temporary, destination); // stesso disco: istantaneo
    await unlink(src);
  }
}

/** "Film.mkv" → "Film (1).mkv" → "Film (2).mkv"… finché il nome è libero. */
async function freePath(dir: string, name: string): Promise<string> {
  const { name: stem, ext } = parse(name);
  let candidate = join(dir, name);
  for (let i = 1; await Bun.file(candidate).exists(); i++) {
    candidate = join(dir, `${stem} (${i})${ext}`);
  }
  return candidate;
}

/**
 * Dai al file lo stesso proprietario della cartella, così il servizio che la
 * gestisce (beets, mnamer, Nextcloud...) può leggerlo e spostarlo.
 * Se July non gira come root, può farlo solo se il proprietario è già lui:
 * in quel caso un EPERM non è grave (il file è comunque al suo posto).
 */
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

/**
 * Chiede a Immich di riscandire la libreria, così la foto compare subito.
 * Restituisce una riga da aggiungere alla risposta. Non lancia mai:
 * se Immich è spento la foto è comunque al sicuro nella cartella.
 */
async function scanImmich(): Promise<string> {
  if (!IMMICH_URL || !IMMICH_API_KEY || !IMMICH_LIBRARY_ID) return "";
  try {
    const response = await fetch(
      `${IMMICH_URL}/api/libraries/${IMMICH_LIBRARY_ID}/scan`,
      {
        method: "POST",
        headers: { "x-api-key": IMMICH_API_KEY },
      },
    );
    return response.ok
      ? "\n📷 Immich la sta importando"
      : `\n⚠️ Immich ha risposto HTTP ${response.status}`;
  } catch {
    return "\n⚠️ Immich non raggiungibile: la troverà alla prossima scansione";
  }
}

// ─── La pipeline ─────────────────────────────────────────────────────────

// File in lavorazione adesso: evita di processare due volte lo stesso file
// se arriva di nuovo mentre il primo upload non è ancora finito.
const inProgress = new Set<string>();

/** Un errore in una reazione non deve mai bloccare l'upload. */
async function react(
  api: Api,
  chatId: number,
  messageId: number,
  emoji: "👀" | "👍",
): Promise<void> {
  await api
    .setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }])
    .catch(() => undefined);
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
  const key = file.fileUniqueId;
  const replyHere = {
    message_thread_id: threadOf(msg),
    reply_parameters: {
      message_id: msg.message_id,
      allow_sending_without_reply: true,
    },
  };

  // Idempotenza: lo stesso file (anche rimandato) si carica una volta sola.
  if (inProgress.has(key)) return;
  if (await isAlreadyDone(key)) {
    await api.sendMessage(
      chatId,
      `ℹ️ ${file.name} è già stato caricato.`,
      replyHere,
    );
    return;
  }

  inProgress.add(key); // "claim first": lo prenotiamo prima di iniziare
  try {
    await react(api, chatId, msg.message_id, "👀");

    // 1. Chiedi alla Bot API locale dove ha salvato il file.
    //    (Per i file grandi aspetta che july-api finisca di scaricarli.)
    const info = await api.getFile(file.fileId);
    if (!info.file_path)
      throw new Error("Telegram non ha restituito il percorso del file");

    // Il server della Bot API vede i file in /var/lib/telegram-bot-api,
    // il bot li vede in API_DATA: traduciamo il percorso dall'uno all'altro.
    const src = info.file_path.replace("/var/lib/telegram-bot-api", API_DATA);

    // 2. Sposta il file nella cartella giusta, con un nome libero.
    await mkdir(directory.directory, { recursive: true });
    const destination = await freePath(directory.directory, file.name);
    await moveFile(src, destination);
    await adoptFolderOwner(destination, directory.directory);

    let text = `✅ ${basename(destination)} → ${directory.label}`;
    if (directory.label === LIBRARY_LABEL) text += await scanImmich();
    if (file.kind === "photo")
      text +=
        "\n⚠️ Inviata come foto: è compressa. Per l'originale mandala come file.";

    // 3. Nel topic giusto della chat con July. Se il file è già lì non lo tocchiamo,
    //    altrimenti lo copiamo nel topic e togliamo l'originale.
    const topicThreadId = await getOrCreateTopic(api, chatId, directory);
    let messageInTopic = msg.message_id;
    if (threadOf(msg) !== topicThreadId) {
      const copied = await inTopic(api, chatId, directory, (threadId) =>
        api.copyMessage(chatId, chatId, msg.message_id, {
          message_thread_id: threadId,
        }),
      );
      messageInTopic = copied.message_id;
      await api.deleteMessage(chatId, msg.message_id).catch(() => undefined);
    }

    // 4. Nel topic con lo stesso label nel gruppo archivio.
    //    copyMessage = arriva "pulito"; forwardMessage (stessi argomenti) mostrerebbe "Inoltrato da".
    //    Telegram copia il file dai suoi server: dal Pi non passa niente.
    if (ARCHIVE_GROUP_ID !== undefined) {
      const groupId = ARCHIVE_GROUP_ID;
      await inTopic(api, groupId, directory, (threadId) =>
        api.copyMessage(groupId, chatId, messageInTopic, {
          message_thread_id: threadId,
        }),
      );
    }

    // 5. Esito, come risposta al file nel topic.
    await inTopic(api, chatId, directory, (threadId) =>
      api.sendMessage(chatId, text, {
        message_thread_id: threadId,
        reply_parameters: {
          message_id: messageInTopic,
          allow_sending_without_reply: true,
        },
      }),
    );
    await react(api, chatId, messageInTopic, "👍");

    await markDone(key);
  } catch (error) {
    // Se qualcosa va storto lo vedi subito in chat e nei log,
    // invece di un silenzio che non sai interpretare.
    console.error("Upload fallito:", error);
    const reason = error instanceof Error ? error.message : String(error);
    await api
      .sendMessage(chatId, `❌ ${file.name}: ${reason}`, replyHere)
      .catch(() => undefined);
  } finally {
    inProgress.delete(key);
  }
}

/** Quando July non è sicuro: un bottone per ogni cartella candidata. */
async function askDirectory(
  api: Api,
  msg: Message,
  file: IncomingFile,
  candidates: readonly Directory[],
): Promise<void> {
  const keyboard = new InlineKeyboard();
  candidates.forEach((entry, index) => {
    // Nel bottone c'è la posizione della riga in Directories: "up:0", "up:1"…
    keyboard.text(entry.label, `up:${Directories.indexOf(entry)}`);
    if (index % 2 === 1) keyboard.row(); // due bottoni per riga
  });

  await api.sendMessage(msg.chat.id, `🤔 Dove va ${file.name}?`, {
    message_thread_id: threadOf(msg),
    // La domanda risponde al file: quando premi un bottone, da lì ritroviamo il file.
    reply_parameters: { message_id: msg.message_id },
    reply_markup: keyboard,
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────

export const upload = new Composer();

// /topics: crea tutti i topic nella chat in cui lo scrivi e nel gruppo archivio.
upload.command("topics", async (ctx, next) => {
  if (!isAllowed(ctx.from?.id)) return next();

  const chats = [ctx.chat.id];
  if (ARCHIVE_GROUP_ID !== undefined && ARCHIVE_GROUP_ID !== ctx.chat.id)
    chats.push(ARCHIVE_GROUP_ID);

  const report: string[] = [];
  for (const chatId of chats) {
    try {
      await ensureAllTopics(ctx.api, chatId);
      report.push(
        `✅ ${chatId}: ${Directories.map((r) => r.label).join(", ")}`,
      );
    } catch (error) {
      // Tipico: topic non attivi nella chat, o July non è admin con "Gestisci topic".
      const reason =
        error instanceof GrammyError ? error.description : String(error);
      report.push(`❌ ${chatId}: ${reason}`);
    }
  }
  await ctx.reply(report.join("\n"));
});

// Solo in chat privata: un file mandato nel gruppo non va rimandato nel gruppo.
upload
  .chatType("private")
  .on(
    ["message:document", "message:audio", "message:video", "message:photo"],
    async (ctx, next) => {
      // 1. Solo gli utenti autorizzati. Gli altri passano al prossimo handler.
      if (!isAllowed(ctx.from.id)) return next();

      // 2. Prendi il file allegato, qualunque sia il tipo di messaggio.
      const file = extractFile(ctx.msg);
      if (!file) return next();

      // 3. Trova la cartella. Nessuna regola → non è un file nostro, passa avanti.
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

// Bottone premuto: "up:0", "up:3"…
upload.callbackQuery(/^up:(\d+)$/, async (ctx) => {
  if (!isAllowed(ctx.from.id)) {
    await ctx.answerCallbackQuery();
    return;
  }

  // Directories[i] può non esistere (bottone vecchio, tabella cambiata): controlliamo.
  const directory = Directories[Number(ctx.match[1])];
  if (!directory) {
    await ctx.answerCallbackQuery({
      text: "Cartella non più valida: rimanda il file.",
      show_alert: true,
    });
    return;
  }

  // Il messaggio con i bottoni rispondeva al file: lì dentro c'è il file originale.
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

  // Rispondiamo subito al bottone (altrimenti resta la rotellina), poi lavoriamo.
  await ctx.answerCallbackQuery({ text: `Salvo in ${directory.label}` });
  await ctx.deleteMessage().catch(() => undefined);
  await processUpload(ctx.api, original, directory);
});
