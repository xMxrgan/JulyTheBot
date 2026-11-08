import { Bot, InputFile } from "grammy";
import { qrCodeGenerator } from "./methods/qrCodeMethods";
import { groceryListMenu } from "./features/groceryList";
import { customKeyboard } from "./features/customKeyboard";
import { upload } from "./features/upload";
import { admin } from "./features/admin";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || "", {
  client: { apiRoot: "http://localhost:8081", timeoutSeconds: 3600 },
});

bot.use(upload);
bot.use(admin);

// Handlers
bot.on("message::url", async (ctx) => {
  const url = ctx.entities("url")[0]?.text;

  if (!url) {
    return ctx.reply("Oops! I couldn't find a valid link in your message.");
  }

  try {
    const qrBuffer = await qrCodeGenerator(url);
    return await ctx.replyWithPhoto(new InputFile(qrBuffer), {
      caption: `Done! Here is your QR for:\n${url}`,
    });
  } catch (error) {
    console.error("Bot logic error:", error);
    return ctx.reply(
      "Sorry, I failed to generate that QR code. Try another link.",
    );
  }
});

// Commands
bot.command("start", async (ctx) => {
  await ctx.reply("Welcome home! I'm back");
  await ctx.reply("Eccola lì la tastiera", { reply_markup: customKeyboard });
  await ctx.reply("Check out this menu:", { reply_markup: groceryListMenu });
});

import { memory } from "./features/memory";
import { ai } from "./features/ai";
bot.use(memory);
bot.use(ai);

bot.catch((err) => {
  const cfx = err.ctx;
  console.error(`Error while handling update ${cfx.update.update_id}:`);
  console.error(err.error);
});

// Start the bot
bot.start({
  onStart: (me) => {
    console.log(`--- BOT STATUS ---`);
    console.log(`User: @${me.username}`);
    console.log(`ID: ${me.id}`);
    console.log(`Status: Running and listening for links...`);
  },
});
