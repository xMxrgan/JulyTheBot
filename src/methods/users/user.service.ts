// service.ts — logica sugli utenti.
// Qui si decide "quando", "come" e "con che ruolo" salvare una persona;
// le query vere e proprie le fa il repository.
import type { User as TelegramUser } from "grammy/types";

import {
  insertUserSchema,
  type CreateUser,
  type User,
} from "../../db/schema/users.schema";

import {
  deleteUserByTelegramId,
  getUserByTelegramId,
  upsertUser,
} from "./user.repository";
import { type Role } from "./user.types";

// L'ID Telegram dell'amministratore (tu), dal file .env.
// Se MORGAN_ID manca, Number(undefined) dà NaN e nessuno risulta admin:
// meglio un admin in meno che uno in più.
const ADMIN_ID = Number(process.env.MORGAN_ID);

// Una persona nel formato di July (camelCase, con il ruolo),
// non in quello di Telegram (first_name, last_name...).
export type TelegramProfile = {
  telegramId: number;
  role: Role;
  username?: string | null;
  firstName: string;
  lastName?: string | null;
};

// Legge una persona senza modificarla (null se non è mai stata salvata).
export const findUser = async (telegramId: number): Promise<User | null> => {
  return getUserByTelegramId(telegramId);
};

// Cancella una persona. true se esisteva, false se non c'era niente da cancellare.
export const removeUser = async (telegramId: number): Promise<boolean> => {
  return (await deleteUserByTelegramId(telegramId)) !== null;
};

export const displayName = async (user: User) => {
  return (await user.username)
    ? `@${user.username}`
    : [user.firstName, user.lastName].filter(Boolean).join(" ");
};
