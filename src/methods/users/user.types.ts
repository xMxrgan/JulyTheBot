import z from "zod";

// I ruoli possibili. Le chiavi (Admin, Standard) sono comode da scrivere;
// i valori ("admin", "standard") sono quelli che finiscono nel database.
export const Role = {
  Admin: "admin",
  Standard: "standard",
} as const;

// Il tipo dei VALORI: "admin" | "standard" (non le chiavi "Admin" | "Standard").
// (typeof Role)[keyof typeof Role] = prendi tutti i valori dell'oggetto.
export type Role = (typeof Role)[keyof typeof Role];

export const UserSchema = z.object({
  telegramId: z.number(),
  username: z.string(),
  role: z.enum(Role),
  name: z.string().optional(),
  surname: z.string().optional(),
});
