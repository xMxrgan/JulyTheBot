// features/memory.ts
// La memoria a lungo termine di July.
// Salva solo le frasi che chiedi esplicitamente di ricordare ("ricorda che ..."),
// in un file JSON per persona sull'SSD. July non salva mai niente di sua iniziativa.

import { Composer, type Context } from "grammy";
import { mkdir } from "node:fs/promises";
import { getUser } from "./users";

// ---------- Impostazioni ----------

// Cartella dei ricordi: un file per persona, per esempio /mnt/storage/july/memory/120075267.json
const MEMORY_DIR = process.env.MEMORY_DIR || "/mnt/storage/july/memory";

// Pochi ricordi e brevi: ogni ricordo finisce nel prompt e allunga i tempi di risposta.
const MAX_FACTS = 30;
const MAX_LENGTH = 200;

// Frasi con cui chiedi di ricordare. Viene salvato il testo che segue la frase.
// Ogni frase finisce con uno spazio, così "ricorda che" non scatta su "ricorda chester".
const SAVE_PHRASES = [
  "ricorda che ",
  "ricordati che ",
  "ricorda: ",
  "tieni a mente che ",
  "tieni a mente: ",
  "segnati che ",
  "annota: ",
  "memorizza che ",
];

// Frasi con cui chiedi di dimenticare.
// L'ordine conta: le frasi più lunghe prima, altrimenti "dimentica " scatterebbe anche su "dimentica che ".
const FORGET_PHRASES = ["dimenticati che ", "dimentica che ", "dimentica "];

// ---------- Lettura e scrittura del file ----------

// Percorso del file di una persona
function fileOf(userId: number): string {
  return `${MEMORY_DIR}/${userId}.json`;
}

// Legge i ricordi di una persona. Se il file non esiste ancora, restituisce un elenco vuoto.
export async function loadFacts(userId: number): Promise<string[]> {
  const file = Bun.file(fileOf(userId));
  if (!(await file.exists())) return [];
  return await file.json();
}

// Sovrascrive il file con l'elenco aggiornato.
async function saveFacts(userId: number, facts: string[]): Promise<void> {
  await mkdir(MEMORY_DIR, { recursive: true }); // crea la cartella se manca
  await Bun.write(fileOf(userId), JSON.stringify(facts, null, 2)); // null, 2 = JSON leggibile, con rientri
}

// ---------- Le tre operazioni: ricorda, dimentica, elenca ----------

// Aggiunge un ricordo e restituisce il testo della risposta per Telegram.
async function remember(userId: number, text: string): Promise<string> {
  const fact = text.trim(); // toglie gli spazi all'inizio e alla fine

  if (fact === "")
    return "Cosa devo ricordare? Per esempio: ricorda che il disco esterno si chiama Archivio.";
  if (fact.length > MAX_LENGTH)
    return `Troppo lungo: massimo ${MAX_LENGTH} caratteri. Riassumilo in una frase.`;

  const facts = await loadFacts(userId);
  if (facts.includes(fact)) return "Lo ricordo già.";
  if (facts.length >= MAX_FACTS)
    return `Ho già ${MAX_FACTS} ricordi: cancellane uno con /dimentica e riprova.`;

  facts.push(fact); // aggiunge in fondo all'elenco
  await saveFacts(userId, facts);
  return `Ok, me lo ricordo: «${fact}»`;
}

// Cancella un ricordo, indicato con il suo numero o con una parola che contiene.
async function forget(userId: number, query: string): Promise<string> {
  const search = query.trim();
  if (search === "")
    return "Cosa devo dimenticare? Scrivi /dimentica 3 oppure /dimentica parola.";

  const facts = await loadFacts(userId);

  // Caso 1: un numero, per esempio "/dimentica 3": il ricordo numero 3 dell'elenco di /memoria
  const number = Number(search);
  if (Number.isInteger(number) && number >= 1 && number <= facts.length) {
    const removed = facts[number - 1]; // gli elenchi partono da 0, quindi il numero 3 sta in posizione 2
    facts.splice(number - 1, 1); // toglie 1 elemento in quella posizione
    await saveFacts(userId, facts);
    return `Dimenticato: «${removed}»`;
  }

  // Caso 2: una parola, per esempio "dimentica Archivio": cerca i ricordi che la contengono
  const matches = facts.filter((fact) =>
    fact.toLowerCase().includes(search.toLowerCase()),
  );

  if (matches.length === 0)
    return "Non trovo quel ricordo. Con /memoria vedi l’elenco numerato.";
  if (matches.length > 1)
    return "Più ricordi contengono quella parola: guarda /memoria e usa /dimentica con il numero.";

  const remaining = facts.filter((fact) => fact !== matches[0]); // tutti tranne quello trovato
  await saveFacts(userId, remaining);
  return `Dimenticato: «${matches[0]}»`;
}

// Restituisce l'elenco numerato dei ricordi.
async function listFacts(userId: number): Promise<string> {
  const facts = await loadFacts(userId);
  if (facts.length === 0)
    return "Non ricordo ancora niente. Scrivi: ricorda che …";

  // ["a", "b"] diventa "1. a" e "2. b", una riga sotto l'altra
  return facts.map((fact, index) => `${index + 1}. ${fact}`).join("\n");
}

// ---------- Strumenti ----------

// Se il messaggio inizia con una delle frasi, restituisce il testo che segue; altrimenti null.
// Esempio: "Ricorda che il Pi è mcloud" con SAVE_PHRASES restituisce "il Pi è mcloud".
function textAfterPhrase(message: string, phrases: string[]): string | null {
  const lower = message.toLowerCase(); // il confronto ignora maiuscole e minuscole
  for (const phrase of phrases) {
    if (lower.startsWith(phrase)) return message.slice(phrase.length); // slice = tutto dopo la frase
  }
  return null;
}

// Riconosce chi scrive, ma solo in chat privata: i ricordi non devono mai comparire in un gruppo.
function privateUser(ctx: Context) {
  if (ctx.chat?.type !== "private") return undefined;
  return getUser(ctx.from?.id);
}

// ---------- Collegamento a Telegram ----------

export const memory = new Composer();

// /ricorda testo
memory.command("ricorda", async (ctx) => {
  const user = privateUser(ctx);
  if (!user) return;
  await ctx.reply(await remember(user.id, ctx.match)); // ctx.match = il testo scritto dopo il comando
});

// /dimentica 3  oppure  /dimentica parola
memory.command("dimentica", async (ctx) => {
  const user = privateUser(ctx);
  if (!user) return;
  await ctx.reply(await forget(user.id, ctx.match));
});

// /memoria
memory.command("memoria", async (ctx) => {
  const user = privateUser(ctx);
  if (!user) return;
  await ctx.reply(await listFacts(user.id));
});

// Messaggi normali: se iniziano con "ricorda che ..." o "dimentica ..." li gestisce la memoria,
// altrimenti next() li passa avanti e li gestisce l'assistente in ai.ts.
memory.on("message:text", async (ctx, next) => {
  const user = privateUser(ctx);
  if (!user) return next();

  const toRemember = textAfterPhrase(ctx.message.text, SAVE_PHRASES);
  if (toRemember !== null) {
    await ctx.reply(await remember(user.id, toRemember));
    return;
  }

  const toForget = textAfterPhrase(ctx.message.text, FORGET_PHRASES);
  if (toForget !== null) {
    await ctx.reply(await forget(user.id, toForget));
    return;
  }

  await next();
});
