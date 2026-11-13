import "dotenv/config"; // carica DATABASE_URL dal file .env
import { drizzle } from "drizzle-orm/node-postgres";

export const db = drizzle((process.env.DATABASE_URL ?? "postgres://disabled@127.0.0.1:1/disabled"));
