import { Composer } from "grammy";
import { $ } from "bun";

const ME = 120075267;

$.nothrow();
export const admin = new Composer();
const me = admin.filter((ctx) => ctx.from?.id === ME);

const html = { parse_mode: "HTML" as const };
const pre = (r: Awaited<ReturnType<typeof $>>) => {
  const text = (r.stdout.toString() + r.stderr.toString()).trim() || "ok";
  return `<pre>${text.slice(-3500).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
};

me.command("status", async (ctx) =>
  ctx.reply(
    pre(await $`docker ps -a --format '{{.Names}}: {{.Status}}'`.quiet()),
    html,
  ),
);
me.command("disk", async (ctx) =>
  ctx.reply(pre(await $`df -h /mnt/storage`.quiet()), html),
);
me.command("import", async (ctx) =>
  ctx.reply(
    pre(
      await $`systemctl start --no-block beets-import.service mnamer-import.service`.quiet(),
    ),
    html,
  ),
);
me.command("restart", async (ctx) => {
  const name = ctx.match.trim();
  const names = (await $`docker ps -a --format '{{.Names}}'`.text())
    .trim()
    .split("\n");
  if (!names.includes(name))
    return ctx.reply(`Use: /restart <name>\n\n${names.join("\n")}`);
  await ctx.reply(`🔄 ${name}…`);
  await ctx.reply(pre(await $`docker restart ${name}`.quiet()), html);
});
