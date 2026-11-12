// features/ai.ts
// L'assistente July.
//
// Come funziona, in breve:
// 1. arriva un messaggio di testo da una persona di USERS, in chat privata
// 2. buildMessages prepara istruzioni, ricordi, conversazione recente e messaggio nuovo
// 3. askModel manda tutto a Ollama e aspetta la risposta
// 4. la risposta va su Telegram e viene aggiunta alla conversazione in corso

import { Composer, type Context } from "grammy";
import { $ } from "bun"; // $`comando` esegue un comando di shell sul Pi
import { getUser, type User } from "./users";
import { loadFacts } from "./memory";

// ---------- Impostazioni (si possono cambiare dal file .env sul Pi) ----------

// Indirizzo di Ollama sulla rete interna "llm": senza internet, raggiungibile solo dal Pi
const OLLAMA_URL = process.env.OLLAMA_URL || "http://10.89.0.10:11434";
const MODEL = process.env.AI_MODEL || "qwen3:4b";
const IMMICH_URL = process.env.IMMICH_URL || "http://127.0.0.1:2283";

// Quanti scambi (domanda + risposta) July tiene nella conversazione in corso
const MAX_TURNS = 10;

// Parole che indicano una domanda sul server: se il messaggio ne contiene almeno una,
// July allega lo stato attuale del server. Aggiungi qui le parole che usi di solito.
const SERVER_WORDS = [
  "server",
  "pi",
  "raspberry",
  "ram",
  "disco",
  "spazio",
  "ssd",
  "temperatura",
  "caldo",
  "scalda",
  "container",
  "docker",
  "servizi",
  "cpu",
  "jellyfin",
  "immich",
  "navidrome",
  "nextcloud",
  "vaultwarden",
  "audiobookshelf",
  "tailscale",
  "ollama",
];

// Parole che indicano una domanda sulle foto (usate solo se la persona ha una chiave Immich)
const PHOTO_WORDS = ["foto", "video", "immich", "album"];

// ---------- Conversazione in corso (solo in RAM) ----------

// Un messaggio come lo vuole Ollama: chi parla (role) e cosa dice (content)
type Message = { role: "system" | "user" | "assistant"; content: string };

// Per ogni Telegram ID, gli ultimi messaggi scambiati. Si svuota quando July si riavvia.
const conversations = new Map<number, Message[]>();

// ---------- Dati che July può allegare alla domanda ----------

// Divide un testo in parole minuscole: "Il Pi scalda?" diventa ["il", "pi", "scalda", ""]
// La regola /[^\p{L}\p{N}]+/u significa: taglia dove trovi qualcosa che non è una lettera o un numero.
function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
}

// true se il testo contiene almeno una parola dell'elenco
function containsAny(text: string, list: string[]): boolean {
  return wordsOf(text).some((word) => list.includes(word));
}

// Lo stato attuale del server. Ogni riga è un comando che lanceresti tu nel terminale:
// .nothrow() evita che un comando fallito blocchi tutto, .text() restituisce quello che stampa.
async function serverStatus(): Promise<string> {
  const uptime = await $`uptime -p`.nothrow().text(); // da quanto tempo è acceso
  const ram = await $`free -h`.nothrow().text(); // RAM usata e libera
  const disk = await $`df -h /mnt/storage`.nothrow().text(); // spazio sull'SSD
  const containers = await $`docker ps -a --format '{{.Names}}: {{.Status}}'`
    .nothrow()
    .text(); // stato dei container

  // Il Pi scrive la temperatura in millesimi di grado: "52350" significa 52,35 °C
  const milliDegrees = await Bun.file(
    "/sys/class/thermal/thermal_zone0/temp",
  ).text();
  const degrees = Math.round(Number(milliDegrees) / 1000);

  const lines = [
    `Uptime: ${uptime.trim()}`,
    `Temperatura CPU: ${degrees} °C`,
    `RAM:\n${ram.trim()}`,
    `SSD (/mnt/storage):\n${disk.trim()}`,
    `Container:\n${containers.trim()}`,
  ];
  return lines.join("\n"); // una riga sotto l'altra
}

// PREDISPOSTO per le persone con una chiave Immich: quante foto e video hanno.
// La chiave è di quella persona, quindi Immich restituisce solo i SUOI dati.
async function photoSummary(immichKey: string): Promise<string> {
  try {
    const response = await fetch(`${IMMICH_URL}/api/assets/statistics`, {
      headers: { "x-api-key": immichKey },
    });
    if (!response.ok) return "";
    const stats = (await response.json()) as { images: number; videos: number };
    return `Foto di questa persona su Immich: ${stats.images} foto e ${stats.videos} video.`;
  } catch {
    return ""; // Immich non raggiungibile: si risponde senza questi dati
  }
}

// Decide quali dati allegare. È QUI che si separano le persone:
// il modello vede solo quello che questa funzione restituisce per chi sta scrivendo.
async function extraDataFor(user: User, text: string): Promise<string> {
  if (user.role === "admin" && containsAny(text, SERVER_WORDS)) {
    return "Stato attuale del server:\n" + (await serverStatus());
  }
  if (user.immichKey && containsAny(text, PHOTO_WORDS)) {
    return await photoSummary(user.immichKey);
  }
  return "";
}

// Data e ora attuali in italiano, con il giorno della settimana
function nowText(): string {
  return new Date().toLocaleString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- Il prompt ----------

// Istruzioni fisse per il modello. Restano uguali tra un messaggio e l'altro
// (cambiano solo se cambiano i ricordi), così Ollama le riusa senza rielaborarle.
function buildSystemPrompt(user: User, facts: string[]): string {
  const parts: string[] = [];

  parts.push(
    `Sei July, l'assistente personale di ${user.name} in stile Jarvis: pratico, conciso, attento ai dettagli. Giri in privato su un Raspberry Pi 5 di casa.`,
  );
  parts.push("Rispondi in italiano, in modo breve e diretto, senza markdown.");

  if (user.role === "admin") {
    parts.push(
      `${user.name} è l'amministratore. Per le domande sul server usa solo i dati in "Stato attuale del server"; se un dato manca, dillo.`,
    );
  } else {
    parts.push("Non hai accesso al server né ai dati di altre persone.");
  }

  // Conoscenze generali sì, dati inventati no: senza questa distinzione il modello rifiuta anche la storia
  parts.push(
    "Per le domande generali (storia, scienza, cultura, consigli) rispondi con le tue conoscenze, anche su temi delicati, in modo informativo. Se non sei sicuro di un dettaglio, dillo.",
  );
  parts.push(
    "I dati personali e quelli del server usali solo se ti vengono forniti nel messaggio: se mancano, dillo invece di inventarli. Non puoi mandare promemoria né eseguire azioni: se te lo chiedono, dillo chiaramente.",
  );

  if (facts.length > 0) {
    const list = facts.map((fact) => `- ${fact}`).join("\n");
    parts.push(
      `Cose che ${user.name} ti ha chiesto di ricordare. Usale per personalizzare risposte e piccoli compiti (liste, messaggi, piani, consigli), senza elencarle se non te lo chiede:\n${list}`,
    );
  }

  return parts.join("\n\n"); // un paragrafo per ogni parte
}

// Tutto quello che va al modello: istruzioni + conversazione recente + messaggio nuovo.
async function buildMessages(user: User, text: string): Promise<Message[]> {
  const facts = await loadFacts(user.id);
  const history = conversations.get(user.id) ?? []; // ?? [] = se non c'è ancora, elenco vuoto
  const extraData = await extraDataFor(user, text);

  // Data, ora ed eventuali dati vanno nel messaggio nuovo e NON nelle istruzioni fisse:
  // così le istruzioni restano uguali e Ollama può riusarle.
  let newMessage = `Adesso: ${nowText()}\n\n`;
  if (extraData !== "") newMessage += `${extraData}\n\n`;
  newMessage += `Messaggio: ${text}`;

  return [
    { role: "system", content: buildSystemPrompt(user, facts) },
    ...history, // ... = inserisci qui tutti i messaggi della conversazione
    { role: "user", content: newMessage },
  ];
}

// ---------- La chiamata a Ollama ----------

async function askModel(messages: Message[]): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: messages,
      stream: false, // la risposta arriva tutta insieme, non a pezzi
      think: false, // niente "ragionamento" interno: sul Pi sarebbe troppo lento
      options: {
        num_thread: 2, // 2 thread, come i 2 core riservati al container
        num_ctx: 6144, // quanti token può leggere in una volta (istruzioni + conversazione)
        num_predict: 400, // lunghezza massima della risposta, in token
        temperature: 0.4, // bassa = risposte più precise e meno fantasiose
      },
    }),
    signal: AbortSignal.timeout(5 * 60 * 1000), // dopo 5 minuti rinuncia
  });

  if (!response.ok)
    throw new Error(`Ollama ha risposto con errore HTTP ${response.status}`);

  const data = (await response.json()) as {
    message?: { content?: string };
  };
  return data.message?.content?.trim() || "(nessuna risposta)"; // ?. = se manca, non va in errore
}

// ---------- Strumenti ----------

// Salva domanda e risposta nella conversazione in corso, tenendo solo gli ultimi scambi.
function saveTurn(userId: number, question: string, answer: string): void {
  const history = conversations.get(userId) ?? [];
  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  conversations.set(userId, history.slice(-MAX_TURNS * 2)); // ogni scambio sono 2 messaggi; slice(-12) tiene gli ultimi 12
}

// Mostra "sta scrivendo…" su Telegram finché non chiami la funzione che restituisce.
// Telegram lo nasconde dopo circa 5 secondi, quindi va ripetuto.
function showTyping(ctx: Context): () => void {
  ctx.replyWithChatAction("typing").catch(() => {});
  const timer = setInterval(
    () => ctx.replyWithChatAction("typing").catch(() => {}),
    4500,
  );
  return () => clearInterval(timer);
}

// ---------- Collegamento a Telegram ----------

export const ai = new Composer();

// /reset: dimentica la conversazione in corso, non i ricordi salvati
ai.command("reset", async (ctx) => {
  const user = getUser(ctx.from?.id);
  if (!user) return;
  conversations.delete(user.id);
  await ctx.reply(
    "Conversazione azzerata. I ricordi restano: li vedi con /memoria.",
  );
});

// Tutti gli altri messaggi di testo
ai.on("message:text", async (ctx, next) => {
  const user = getUser(ctx.from?.id);
  const isPrivate = ctx.chat.type === "private";
  const text = ctx.message.text;

  // Sconosciuti, gruppi e comandi non sono affari dell'assistente: passa avanti
  if (!user || !isPrivate || text.startsWith("/")) return next();

  const stopTyping = showTyping(ctx);
  try {
    const messages = await buildMessages(user, text);
    const answer = await askModel(messages);
    saveTurn(user.id, text, answer);
    await ctx.reply(answer.slice(0, 4000)); // Telegram accetta al massimo 4096 caratteri per messaggio
  } catch (error) {
    // Nel log solo il tipo di errore, mai il testo dei messaggi
    console.error("Errore assistente:", (error as Error).message);
    await ctx.reply(
      "Il modello non risponde. Con /status controlla che il container ollama sia attivo.",
    );
  } finally {
    stopTyping(); // finally = in ogni caso, sia se è andata bene sia se c'è stato un errore
  }
});
