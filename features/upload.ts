import { Composer } from "grammy";

import {
  API_DATA,
  AUDIO_FORMATS,
  Evergreen,
  MUSIC_PATH,
  VIDEO_FORMATS,
  VIDEO_PATH,
} from "../types/upload";
import { basename } from "@grammyjs/i18n/script/deps/deno.land/std@0.192.0/path/win32";
import { extname, join } from "@grammyjs/i18n/script/src/deps";

export const upload = new Composer();
const evergreens = keyof typeof Evergreen

upload.on(["message:document"], async (ctx) => {
  if (ctx.from?.id !== ) return;

  const media = ctx.msg.document;
  const name = basename(media?.file_name ?? "");
  const ext = extname(name).toLowerCase();
  const uploadDirectory = AUDIO_FORMATS.includes(ext)
    ? MUSIC_PATH
    : VIDEO_FORMATS.includes(ext)
      ? VIDEO_PATH
      : null;
  if (!uploadDirectory)
    return console.log(`❌ Not a proper directory found for ${name}!`);
  const file = await ctx.getFile();
  const src = file.file_path!.replace("/var/lib/telegram-bot-api", API_DATA);
  const dest = join(uploadDirectory, name);
  await rename(src, dest);
  const { uid, gid } = await stat(dir);
  await chown(dest, uid, gid);
  await ctx.reply(`✅ ${name}`);
});
