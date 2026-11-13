import { Bot } from "grammy";
import { upload } from "./src/features/upload";
import { link } from "./src/features/link";

// import { saveUser } from "./src/utils";
// import { authenticate } from "./src/features/authenticate";
// import { db } from "./src/db";
// import { users } from "./src/db/schema/users.schema";
// import { eq } from "drizzle-orm";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Missing Bot Token");

export const bot = new Bot(token, {
  client: {
    apiRoot: "http://localhost:8081", // server Bot API locale (container july-api)
    timeoutSeconds: 3600, // file grandi: lasciamo tempo al download
  },
});

// /** L'utente con ruolo "owner", oppure undefined se non esiste ancora. */
// export async function findOwner() {
//   const [owner] = await db
//     .select()
//     .from(users)
//     .where(eq(users.role, "owner"))
//     .limit(1); // ci aspettiamo un solo owner
//   return owner;
// }

// // Dentro un handler, quando serve:
// const owner = await findOwner();

// ─── 1. Creazione del bot ───────────────────────────────────────────────

// ─── 2. Feature specifiche ───────────────────────────────────────────────

bot.use(link);
// bot.use(authenticate);
bot.use(upload);

// ─── 3. Comandi ──────────────────────────────────────────────────────────

// bot.command("start", async (ctx) => {
//   authenticate;
//   saveUser(ctx.from);
// });

// ─── Errori ──────────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error(`Error while handling update ${err.ctx.update.update_id}:`);
  console.error(err.error);
});

// ─── Avvio ───────────────────────────────────────────────────────────────

bot.start({
  onStart: (me) => {
    console.log(`--- BOT STATUS ---`);
    console.log(`User: @${me.username}`);
    console.log(`ID: ${me.id}`);
    console.log(`Status: Running`);
  },
});
