import { bigint } from "zod";
import { Role } from "../methods/users/user.types";

const UserRole = {
  admin: "admin",
  user: "user",
} as const;

const CloudService = {
  Music: "Music",
  Cinema: "Cinema",
  Library: "Library",
  Storage: "Storage",
} as const;

export type AuthorizedUser = {
  telegramId: bigint;
  role: Role;
};
