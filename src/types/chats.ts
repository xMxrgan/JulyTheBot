import z, { number, string } from "zod";

const ChatSchema = z.object({
  chatId: z.xor([z.string(), z.number()]),
});
