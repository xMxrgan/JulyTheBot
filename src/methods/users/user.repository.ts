// repository.ts — CRUD puro sulla tabella users (solo query, zero logica)
// Qui parliamo solo con il database: niente regole di business.
// Le decisioni ("quando" e "perché" salvare) stanno nel service.
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  users,
  type CreateUser,
  type User,
} from "../../db/schema/users.schema";

// Inserisce una riga nuova e la restituisce.
// returning() ci ridà la riga appena salvata, con id e updatedAt generati dal DB.
export async function createUser(values: CreateUser): Promise<User> {
  const [user] = await db.insert(users).values(values).returning();
  return user;
}

// Cerca una persona per ID Telegram.
// limit(1) perché telegramId è unico; se non esiste torna null (non undefined).
export async function getUserByTelegramId(
  telegramId: number,
): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);
  return user ?? null;
}

// Tutte le persone salvate, senza filtri.
export async function listUsers(): Promise<User[]> {
  return db.select().from(users);
}

// Aggiorna solo i campi passati in "patch".
// updatedAt lo tocchiamo a mano: il defaultNow() vale solo all'inserimento.
export async function updateUserByTelegramId(
  telegramId: number,
  patch: Partial<CreateUser>,
): Promise<User | null> {
  const [user] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.telegramId, telegramId))
    .returning();
  return user ?? null;
}

// Insert + update in una sola query.
// Se il telegramId esiste già (ON CONFLICT) aggiorna i dati, altrimenti crea la riga.
export async function upsertUser(values: CreateUser): Promise<User> {
  const [user] = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        username: values.username ?? null,
        firstName: values.firstName,
        lastName: values.lastName ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return user;
}

// Cancella la persona e restituisce la riga eliminata (null se non esisteva).
export async function deleteUserByTelegramId(
  telegramId: number,
): Promise<User | null> {
  const [user] = await db
    .delete(users)
    .where(eq(users.telegramId, telegramId))
    .returning();
  return user ?? null;
}
