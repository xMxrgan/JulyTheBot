import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import z, { keyof } from "zod";
import { createInsertSchema, createUpdateSchema } from "drizzle-zod";
import { db } from "..";
import { eq } from "drizzle-orm";

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
  chatId:,
  username: varchar({ length: 32 }),
  role: roleEnum().notNull().default("standard"),
  firstName: varchar({ length: 64 }).notNull(),
  lastName: varchar({ length: 64 }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const findOwner = async () => {
  const [owner] = await db
  .select()
    .from(users)
    .where(eq(users.role, "owner"))
    .limit(1); // ci aspettiamo un solo owner
  return owner;
};

export const listAdmins = ()=> {
  const admins= await db.select().from(users).where(eq(users.role, 'admin'))
  return   admins
} 

export const owner = await findOwner();

export const insertUserSchema = createInsertSchema(users);
export const updateUserSchema = createUpdateSchema(users).omit({
  telegramId: true,
  createdAt: true,
});

export type CreateUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type Role = (typeof roleEnum.enumValues)[number];
export type User = typeof users.$inferSelect;
