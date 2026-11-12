import { Composer } from "grammy";
import { findOwner, bot } from "../..";
import { findUser } from "../methods/users/user.service";

export const authenticate = new Composer();

authenticate.on("message", async (ctx, next) => {
  if (!ctx.from) return;

  const user = await findUser(ctx.from.id);

  if (!user) {
    const owner = await findOwner();

    if (!owner) {
      console.warn(`Utente sconosciuto ${ctx.from.id}, ma nessun owner nel DB`);
      return;
    }

    await ctx.api.sendMessage(
      owner.telegramId,
      `New user request: ${ctx.from.first_name} (@${ctx.from.username ?? "No username"}), id ${ctx.from.id}\n` +
        `: ${ctx.msg.text ?? "(non testo)"}`,
    );
    return;
  }

  switch (user.role) {
    case "owner":
    case "admin":
      return next();
    default: {
      return;
    }
  }
});
