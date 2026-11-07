export const MUSIC_PATH = "/mnt/storage/shared/inbox";
export const VIDEO_PATH = "/mnt/storage/shared/movies_inbox";
export const FILE_PATH = "/mnt/storage/shared/files_inbox";
export const API_DATA = "/mnt/storage/july-api";

const Role = {
  admin: "admin",
  moderator: "moderator",
  user: "user",
} as const;

type Role = typeof Role;

type User = {
  name: string;
  telegramId: number;
  role: Role;
};

export const evergreen = [{ Morgan: 120075267 }] as const;

export const FILE_FORMATS = [".pdf", ".jpg", ".png"];
export const AUDIO_FORMATS = [
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
export const VIDEO_FORMATS = [".mkv", ".mp4", ".avi", ".m4v"];

export type Evergreen = typeof evergreen;
