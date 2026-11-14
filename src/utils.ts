import { CreateUser } from "./db/schema/users.schema";
import { createUser } from "./methods/users/user.repository";

export const MusicDirectory = "/mnt/storage/shared/inbox";
export const CinemaDirectory = "/mnt/storage/shared/movies_inbox";
export const FilesDirectory = "/mnt/storage/shared/files";
export const LibraryDirectory = "/mnt/storage/shared/library";
export const BookDirectory = "/mnt/storage/shared/book";
export const UnivrDirectory = "/mnt/storage/shared/univr";
export const ApiDirectory = "/mnt/storage/july-api";

export const MusicExtensions = [
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
export const CinemaExtensions = [".mkv", ".mp4", ".avi", ".m4v"];
export const FilesExtensions = [".pdf", ".jpg"];
export const LibraryExtensions = [".mov", ".hevc"];
export const BookExtensions = [".epub", ".mobi", ".pdf"];
export const UnivrExtensions = [".mkv"];

export const Directories = [
  { extension: MusicExtensions, directory: MusicDirectory, label: "🎵 Music" },
  {
    extension: CinemaExtensions,
    directory: CinemaDirectory,
    label: "🎬 Cinema",
  },
  { extension: FilesExtensions, directory: FilesDirectory, label: "📄 Files" },
  {
    extension: LibraryExtensions,
    directory: LibraryDirectory,
    label: "🏔️ Library",
  },
  { extension: BookExtensions, directory: BookDirectory, label: "📚 Books" },
  {
    extension: UnivrExtensions,
    directory: UnivrDirectory,
    label: "🎓 Lessons",
  },
] as const;

export const checkAuthorization = (telegramId: bigint)=> {

  return 
} satisfies

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
