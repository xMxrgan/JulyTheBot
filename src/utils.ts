import { CreateUser } from "./db/schema/users.schema";
import { createUser } from "./methods/users/user.repository";

export const MUSIC_DIR = "/mnt/storage/shared/inbox";
export const VIDEO_DIR = "/mnt/storage/shared/movies_inbox";
export const FILES_DIR = "/mnt/storage/shared/files";
export const LIBRARY_DIR = "/mnt/storage/shared/library";
export const API_DATA = "/mnt/storage/july-api";

export const AUDIO = [
  ".mp3",
  ".flac",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".wav",
  ".aiff",
  ".wma",
];
export const VIDEO = [".mkv", ".mp4", ".avi", ".m4v"];
export const FILE = [".pdf", ".jpg"];
export const LIBRARY = [".mov", ".hevc"];

export const Directories = [
  { extension: AUDIO, directory: MUSIC_DIR, label: "🎵 Music" },
  { extension: VIDEO, directory: VIDEO_DIR, label: "🎬 Cinema" },
  { extension: FILE, directory: FILES_DIR, label: "📄 Files" },
  { extension: LIBRARY, directory: LIBRARY_DIR, label: "📚 Library" },
] as const;

export const saveUser = async (ctx: any) => {
  if (!ctx.from) return;
  const user: CreateUser = {
    telegramId: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
  };
  if (!user.telegramId) await createUser(user);
};
