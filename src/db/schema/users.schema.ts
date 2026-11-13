import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { db } from "..";
import { eq } from "drizzle-orm";
import z from "zod";

export const roleEnum = pgEnum("role", [
  "owner",
  "admin",
  "standard",
  "reported",
  "blocked",
]);

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  telegramId: bigint({ mode: "number" }).notNull().unique(),
  username: varchar({ length: 32 }),
  role: roleEnum().notNull().default("standard"),
  firstName: varchar({ length: 64 }).notNull(),
  lastName: varchar({ length: 64 }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** L'utente con ruolo "owner", oppure undefined se non c'è ancora. */
export async function findOwner() {
  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.role, "owner"))
    .limit(1);
  return owner;
}
export async function listAdmins() {
  return db.select().from(users).where(eq(users.role, "admin"));
}
// 
// export const owner = await findOwner();

export const insertUserSchema = createInsertSchema(users);
export const updateUserSchema = createUpdateSchema(users).omit({
  telegramId: true,
  createdAt: true,
});

export type CreateUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type Role = (typeof roleEnum.enumValues)[number];
export type User = typeof users.$inferSelect;
