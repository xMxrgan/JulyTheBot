import { Composer } from "grammy";
import { rename, stat, chown } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const ME = 120075267;
const MUSIC_DIR = "/mnt/storage/shared/inbox";
const VIDEO_DIR = "/mnt/storage/shared/movies_inbox";
const API_DATA = "/mnt/storage/july-api";

const AUDIO = [".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".aiff", ".wma"];
const VIDEO = [".mkv", ".mp4", ".avi", ".m4v"];

export const upload = new Composer();

upload.on(["message:document", "message:audio", "message:video"], async (ctx, next) => {
  if (ctx.from?.id !== ME) return next();
  const media = ctx.msg.document ?? ctx.msg.audio ?? ctx.msg.video;
  const name = basename(media?.file_name ?? "");
  const ext = extname(name).toLowerCase();
  const dir = AUDIO.includes(ext) ? MUSIC_DIR : VIDEO.includes(ext) ? VIDEO_DIR : null;
  if (!dir) return next();
  const file = await ctx.getFile();
  const src = file.file_path!.replace("/var/lib/telegram-bot-api", API_DATA);
  const dest = join(dir, name);
  await rename(src, dest);
  const { uid, gid } = await stat(dir);
  await chown(dest, uid, gid);
  await ctx.reply(`✅ ${name}`);
});
