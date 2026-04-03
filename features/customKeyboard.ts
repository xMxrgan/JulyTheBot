import { Keyboard } from "grammy";

export const customKeyboard = new Keyboard()
  .text('🛍️ Lista della spesa').row()
  .text("🖼️ QR code").row()
  .resized();
