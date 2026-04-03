import { InlineKeyboard } from "grammy";

export const groceryListMenu = new InlineKeyboard()
  .text("« 1", "first")
  .text("‹ 3", "prev")
  .text("· 4 ·", "stay")
  .text("5 ›", "next")
  .text("31 »", "last");
