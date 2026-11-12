import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./generated",
  // tutti i .ts dentro schema/, anche nelle sottocartelle:
  // una tabella nuova viene presa in automatico, senza elencarla qui
  schema: "./src/db/schema/**/*.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
