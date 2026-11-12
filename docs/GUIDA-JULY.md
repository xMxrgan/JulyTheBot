# July — guida alle funzioni Telegram

Bot **July** (TypeScript + grammY, eseguito da Bun) sul Pi `mcloud`, con il Bot API server locale `july-api`.

- I comandi **per il Pi** sono completi e pronti da incollare via SSH (`ssh morgan@mcloud`).
- I comandi **per il Mac** si lanciano dalla cartella del repo `JulyTheBot`.
- `link.ts`, `media.ts`, `topics.ts`, `auth.ts` e gli esempi per July sono stati controllati con TypeScript in modalità `strict` contro grammY 1.46.

## Indice

1. [Come è fatto July](#1-come-è-fatto-july)
2. [Guida passo passo: link → file nella cartella "Link"](#2-guida-passo-passo-link--file-nella-cartella-link)
3. [Funzioni Telegram per gestire il bot](#3-funzioni-telegram-per-gestire-il-bot)
4. [Autenticazione tramite bot](#4-autenticazione-tramite-bot)
5. [Affidabilità e ottimizzazione](#5-affidabilità-e-ottimizzazione)
6. [Comandi rapidi](#6-comandi-rapidi)

---

## 1. Come è fatto July

```
Mac (repo JulyTheBot) ──git push pi main──▶ Pi mcloud
                                            ├─ july.service  (Bun esegue index.ts)
                                            │      │ parla con
                                            │      ▼
                                            └─ july-api      (Bot API server locale, Docker, 127.0.0.1:8081)
                                                   │ parla con
                                                   ▼
                                                Telegram
```

**Ogni funzione vive in un file** `features/*.ts` ed esporta un `Composer`, cioè un "pezzo" di bot con i suoi gestori. `index.ts` li monta con `bot.use(...)`.

**L'ordine in `index.ts` conta.** Un messaggio attraversa i pezzi nell'ordine in cui li registri. Un pezzo che lo gestisce e non chiama `next()` lo ferma lì; uno che non lo riguarda lo lascia passare al successivo. L'ordine giusto per July è:

1. `auth`: decide chi può entrare (sezione 4).
2. Le funzioni specifiche: `upload`, `link`, `admin`…
3. L'LLM per ultimo, perché risponde a qualsiasi testo che nessun altro ha preso.

```ts
// index.ts — ordine di montaggio
bot.use(auth)     // 1. il buttafuori (se lo aggiungi, sezione 4.2)
bot.use(upload)   // 2. file che mandi tu
bot.use(link)     //    link da scaricare
bot.use(admin)    //    comandi del server
bot.use(llm)      // 3. tutto il testo rimasto va a Qwen
```

**Perché `july-api`:** il server locale alza i limiti sui file (da 20/50 MB a 2000 MB) e legge i file direttamente dal disco del Pi. La tabella completa dei limiti è nella sezione 3.12.

---

## 2. Guida passo passo: link → file nella cartella "Link"

### Cosa ottieni

1. Mandi un link a July, in qualsiasi punto della chat.
2. Sul tuo messaggio compare 👀: July l'ha ricevuto.
3. Nella cartella **Link** compare "⏳ In coda", che diventa "⬇️ Scarico…" e poi "📤 Invio…".
4. Arriva il contenuto **nel suo formato**: video, audio (con titolo e artista), foto, GIF o file. In didascalia c'è il link d'origine.
5. Il messaggio di stato sparisce e 👀 diventa 👍.
6. Sul Pi non resta niente: la cartella del download è temporanea e viene cancellata subito dopo l'invio. I file oltre 2000 MB non vengono proprio tenuti.

> **Nota sui topic.** Le cartelle (topic) nelle chat private con i bot sono una funzione recente della Bot API. grammY 1.46 la supporta: `createForumTopic` funziona con "a private chat with a user". Se un nome nei menu di BotFather non corrisponde a quello scritto qui, controlla la changelog ufficiale: <https://core.telegram.org/bots/api-changelog>.
> Senza topic July funziona lo stesso, e manda tutto nella chat normale.

### Passo 1 — Attiva i topic per July (dal telefono)

1. Apri **@BotFather** e scegli July (da `/mybots`, oppure dalla mini app di BotFather con il pulsante *Open*).
2. In **Bot Settings** attiva la modalità topic (**Threaded Mode**).
3. Se c'è anche l'opzione che permette agli utenti di creare e cancellare topic, scegli tu: July funziona in entrambi i casi.

### Passo 2 — Aggiorna july-api (Pi)

Il server locale deve conoscere la versione nuova della Bot API, altrimenti non sa creare topic nelle chat private.

Il comando fa quattro cose:
- recupera `API_ID` e `API_HASH` dal container attuale, così non li devi riscrivere;
- se non li trova, si ferma prima di toccare qualsiasi cosa;
- scarica l'immagine nuova e ricrea il container con le stesse impostazioni (i dati in `/mnt/storage/july-api` restano);
- riavvia July.

```bash
API_ID=$(sudo docker inspect july-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^TELEGRAM_API_ID=' | cut -d= -f2) && API_HASH=$(sudo docker inspect july-api --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^TELEGRAM_API_HASH=' | cut -d= -f2) && [ -n "$API_ID" ] && [ -n "$API_HASH" ] && sudo docker pull aiogram/telegram-bot-api:latest && sudo docker rm -f july-api && sudo docker run -d --name july-api --restart unless-stopped -p 127.0.0.1:8081:8081 -e TELEGRAM_API_ID=$API_ID -e TELEGRAM_API_HASH=$API_HASH -e TELEGRAM_LOCAL=1 -v /mnt/storage/july-api:/var/lib/telegram-bot-api aiogram/telegram-bot-api:latest && sudo systemctl restart july
```

### Passo 3 — Controlla che i topic siano attivi (Pi)

Questo comando chiede a Telegram "chi sono?" (`getMe`) usando il token di July:

```bash
TOKEN=$(grep -m1 'TOKEN=' ~/july/.env | cut -d= -f2- | tr -d '"') && curl -s "http://localhost:8081/bot$TOKEN/getMe" | grep -o '"has_topics_enabled":[a-z]*'
```

- Se stampa `"has_topics_enabled":true`, è tutto a posto.
- Se non stampa niente, la modalità topic non è attiva (rifai il passo 1) oppure july-api è ancora vecchio (rifai il passo 2).
- Se il tuo `.env` non è in `~/july` (per esempio dopo aver impostato il deploy con git), trovi il percorso giusto con `systemctl cat july`: guarda le righe `WorkingDirectory` o `EnvironmentFile`.

### Passo 4 — Strumenti e cartelle (Pi)

Rilancialo anche se avevi già installato yt-dlp: è innocuo da ripetere e crea la nuova cartella `july-data`.

```bash
sudo curl -fL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && sudo chmod a+rx /usr/local/bin/yt-dlp && echo '--js-runtimes bun:/home/morgan/.bun/bin/bun' | sudo tee /etc/yt-dlp.conf && sudo mkdir -p /mnt/storage/july-downloads /mnt/storage/july-data && sudo chown morgan:morgan /mnt/storage/july-downloads /mnt/storage/july-data && echo '30 4 * * 1 root /usr/local/bin/yt-dlp -U' | sudo tee /etc/cron.d/yt-dlp-update && (command -v ffmpeg || (sudo apt-get update -qq && sudo apt-get install -y --no-install-recommends ffmpeg)) && yt-dlp --version
```

Ecco cosa fa ogni parte:

| Parte | Perché |
|---|---|
| `curl … yt-dlp` | Scarica la versione ufficiale e aggiornata. Quella di `apt` è sempre vecchia e i siti la rompono. |
| `/etc/yt-dlp.conf` | Per YouTube, yt-dlp ha bisogno di un motore JavaScript. Così usa il **Bun che hai già**, senza installare Deno. |
| `july-downloads` | Cartelle temporanee dei download, sull'SSD. |
| `july-data` | Dove July salva i dati: gli ID dei topic e, in futuro, gli utenti. |
| `cron.d/yt-dlp-update` | Aggiorna yt-dlp ogni lunedì alle 4:30. |
| `command -v ffmpeg \|\| …` | Installa ffmpeg solo se manca, senza pacchetti extra. Serve a unire video e audio, e con `ffprobe` a riconoscere che cosa è stato scaricato. |

### Passo 5 — Il codice (Mac)

**1. Scarica i file.** Dalla chat scarica `link.ts`, `media.ts` e `topics.ts`: finiscono in `~/Downloads`.

**2. Spostali in `features/`.** Il nuovo `link.ts` sostituisce la versione precedente.

```bash
mv ~/Downloads/link.ts ~/Downloads/media.ts ~/Downloads/topics.ts features/
```

**3. Controlla la registrazione in `index.ts`.** Questo comando mostra tutte le righe `bot.use` con il loro numero:

```bash
grep -n "bot.use" index.ts
```

Devi vedere `bot.use(link)` dopo `bot.use(upload)` e prima del gestore dell'LLM. Se manca, aggiungilo a mano:

```ts
import { link } from './features/link'
bot.use(link)
```

`media.ts` e `topics.ts` non vanno registrati: sono librerie che `link.ts` usa da solo.

**4. Consigliato:** aggiungi la rete di sicurezza contro i crash (sezione 5.1). È un minuto di lavoro.

### Passo 6 — Deploy e test

Dal Mac, questo comando aggiunge i file, fa il commit e il deploy:

```bash
git add features/link.ts features/media.ts features/topics.ts index.ts && git commit -m "feat: link nel formato originale, nel topic Link" && git push pi main
```

Il deploy compila e controlla i tipi prima di cambiare versione. Se qualcosa non va, July resta sulla versione vecchia.

**Test:** manda a July il link di un video **corto**. Se qualcosa non torna, guarda i log in diretta sul Pi:

```bash
sudo journalctl -u july -f
```

### Come funziona il codice

| Pezzo | File | Cosa fa |
|---|---|---|
| `link.on('message:entities:url')` | link.ts | Si attiva solo per i messaggi in cui Telegram ha riconosciuto un link. |
| `ctx.react('👀')` | link.ts | Conferma di ricezione senza aggiungere messaggi alla chat. |
| `getTopic()` | topics.ts | Crea "Link" la prima volta, poi riusa l'ID salvato in `/mnt/storage/july-data/topics.json`. |
| `openStatus()` | link.ts | Scrive "⏳ In coda" nel topic. Se l'hai cancellato a mano, lo ricrea. |
| `enqueue()` | link.ts | Coda: un download alla volta. Il gestore finisce subito, quindi July resta reattivo. |
| `isWebPage()` | link.ts | Richiesta `HEAD`: se il server risponde `text/html` usa yt-dlp, altrimenti curl. |
| `run()` | link.ts | `execFile`: gli argomenti arrivano al programma uno per uno, senza passare dalla shell. |
| `DownloadResult` | link.ts | Discriminated union `ok / tooBig / error`, gestita con uno `switch` su `kind`. |
| `inspect()` | media.ts | Con `ffprobe` capisce se il file è video, audio, foto, GIF o altro, e ne legge durata, dimensioni, titolo e artista. |
| `sendMedia()` | media.ts | Sceglie `sendVideo`, `sendAudio`, `sendPhoto`, `sendAnimation` o `sendDocument` e passa i dati che migliorano la resa. |
| `finally { rm(...) }` | link.ts | Cancella **sempre** la cartella temporanea del download. |
| `cleanWorkDir()` | link.ts | All'avvio svuota `july-downloads` dagli avanzi di un crash o di uno spegnimento brusco. |
| `--max-filesize` | link.ts | Se il file supera 2000 MB, yt-dlp e curl non lo scaricano neanche. |

### Se qualcosa non va

| Sintomo | Causa probabile | Cosa fare |
|---|---|---|
| Tutto arriva nella chat normale, la cartella "Link" non c'è | Topic non attivi, o july-api vecchio | Rifai i passi 1–3. Nei log cerca `[topics]`. |
| Nessuna reazione, nessuna risposta | Il link è finito all'LLM, oppure July è giù | Controlla che `bot.use(link)` venga prima dell'LLM. Guarda i log. |
| `❌ … Unsupported URL` | Sito non supportato, o contenuto che richiede un login (es. profili Instagram privati) | Prova un altro link. I contenuti privati non si scaricano. |
| YouTube: "Sign in to confirm…" o errori sul "JavaScript runtime" | yt-dlp vecchio, o Bun non trovato | `sudo yt-dlp -U`, poi controlla che `/home/morgan/.bun/bin/bun` esista. |
| `ffmpeg not found` / errore di merge | ffmpeg mancante | Rifai il passo 4. |
| `EACCES` / `permission denied` nei log | Le cartelle non sono di `morgan` | Rifai il passo 4. |
| 📦 "troppo grande" | File oltre 2000 MB, il limite di Telegram | Non viene tenuto sul server. Se ti serve, scegli una qualità più bassa (`res:720`). |

### Personalizzazioni rapide

Sono tutte costanti in cima a `link.ts`:

- **Nome della cartella:** `TOPIC_NAME`.
- **Qualità:** in `YTDLP_ARGS` cambia `res:1080` in `res:720` per file più leggeri, oppure togli `res:1080,` per avere sempre il massimo.
- **Limite di peso:** `MAX_MB`.
- **Foto originali senza compressione:** in `media.ts` metti `PHOTOS_AS_FILES = true`. Arriveranno come file.
- **Link anche per altri utenti:** dopo aver aggiunto `auth` (sezione 4.2), cancella la riga `if (ctx.from?.id !== ME) return next()`. Ogni utente avrà la sua cartella "Link", perché i topic sono per chat.

---

## 3. Funzioni Telegram per gestire il bot

Per ogni funzione trovi cosa fa, quando usarla e il codice.

### 3.1 Menu dei comandi solo per te

**Cosa fa:** riempie il menu `/` con i tuoi comandi e la loro descrizione. Con lo **scope** decidi chi li vede: qui solo la tua chat, quindi gli altri utenti non vedono i comandi di amministrazione.

**Dove:** in `index.ts`, prima di `bot.start()`. Lanciarlo a ogni avvio è innocuo.

```ts
// Il menu "/" che vedi solo tu
await bot.api.setMyCommands(
  [
    { command: 'status', description: 'Container in esecuzione' },
    { command: 'disk', description: 'Spazio sui dischi' },
    { command: 'import', description: 'Lancia subito gli import' },
    { command: 'restart', description: 'Riavvia un container' },
    { command: 'invita', description: 'Link d’invito monouso' },
    { command: 'utenti', description: 'Chi ha accesso a July' },
  ],
  { scope: { type: 'chat', chat_id: 120075267 } },
)
```

### 3.2 Una cartella per ogni funzione

`getTopic()` funziona per qualsiasi nome. Per esempio puoi mandare le conferme di `upload.ts` in "Film" e "Musica", e gli avvisi di sistema in "Server":

```ts
import { getTopic } from './topics'

// dentro upload.ts, al posto di ctx.reply(`✅ ${name}`)
const threadId = await getTopic(ctx.api, ctx.chat.id, dir === MUSIC_DIR ? 'Musica' : 'Film')
await ctx.api.sendMessage(ctx.chat.id, `✅ ${name}`, { message_thread_id: threadId })
```

### 3.3 Un messaggio di stato invece di dieci

**Cosa fa:** con `editMessageText` aggiorni sempre lo stesso messaggio (⏳ → ⬇️ → 📤). Così ricevi una notifica sola invece di cinque e resti lontano dai limiti di Telegram. È quello che fa `setStatus()` in `link.ts`.

### 3.4 Reazioni come conferme

**Cosa fa:** `ctx.react('👀')` mette una reazione sul messaggio dell'utente. È la conferma più leggera che esista: niente messaggi nuovi, niente notifiche.

Le emoji sono una lista fissa decisa da Telegram. Fra le più utili ci sono 👀 👍 👌 🔥 ⚡ 🎉 🤔 💯.

```ts
await ctx.react('👀')
await ctx.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji: '👍' }])
```

### 3.5 Bottoni per confermare azioni pericolose

**Cosa fa:** sotto il messaggio compaiono dei bottoni. Quando ne premi uno, il bot riceve una *callback query* con un testo che hai scelto tu (`callback_data`, massimo 64 byte). È perfetto per chiedere conferma prima di `/reboot` o `/restart`.

```ts
import { InlineKeyboard } from 'grammy'

admin.command('reboot', (ctx) =>
  ctx.reply('Riavvio il Pi?', {
    reply_markup: new InlineKeyboard().text('✅ Sì, riavvia', 'reboot:yes').text('❌ No', 'reboot:no'),
  }),
)

admin.callbackQuery('reboot:yes', async (ctx) => {
  await ctx.answerCallbackQuery()          // toglie la rotellina dal bottone: va SEMPRE chiamato
  await ctx.editMessageText('🔄 Riavvio…')
  // qui il tuo execFile('sudo', ['systemctl', 'reboot']) con la regola sudoers dedicata
})

admin.callbackQuery('reboot:no', async (ctx) => {
  await ctx.answerCallbackQuery('Annullato') // piccolo avviso in sovrimpressione
  await ctx.deleteMessage()
})
```

### 3.6 "July sta inviando un file…"

**Cosa fa:** `sendChatAction` mostra in alto "sta inviando un documento…", "sta scrivendo…" e simili. L'indicazione dura circa 5 secondi, quindi per i lavori lunghi va ripetuta. Il plugin `@grammyjs/auto-chat-action` lo fa per te.

```ts
await ctx.api.sendChatAction(chatId, 'upload_document', { message_thread_id: threadId })
```

### 3.7 Notifiche silenziose

**Cosa fa:** `disable_notification: true` consegna il messaggio senza suono né vibrazione. È ideale per le cose di routine, come "import completato" o il backup notturno.

```ts
await ctx.reply('🎵 Import beets completato', { disable_notification: true })
```

### 3.8 Un cruscotto fissato in cima alla chat

**Cosa fa:** mandi un messaggio, lo fissi con `pinChatMessage` e poi lo aggiorni ogni tanto con `editMessageText` (disco, temperatura, container attivi). Hai lo stato del Pi sempre in cima alla chat, senza mandare messaggi nuovi.

```ts
const msg = await bot.api.sendMessage(OWNER, '📊 Cruscotto…', { disable_notification: true })
await bot.api.pinChatMessage(OWNER, msg.message_id, { disable_notification: true })
// Salva msg.message_id su file (come fa topics.ts), poi aggiornalo con un setInterval
```

### 3.9 Testo formattato

**Cosa fa:** con `parse_mode: 'HTML'` puoi usare `<b>`, `<i>`, `<code>` e `<pre>`. `<pre>` è perfetto per l'output dei comandi come `df -h`, perché mantiene le colonne allineate.

**Attenzione:** il testo che viene da fuori (output dei comandi, nomi dei file) va "ripulito" dai caratteri `< > &`, altrimenti Telegram rifiuta il messaggio.

```ts
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
await ctx.reply(`<b>Dischi</b>\n<pre>${escapeHtml(dfOutput)}</pre>`, { parse_mode: 'HTML' })
```

### 3.10 Risposte dell'LLM che si scrivono davanti a te

**Cosa fa:** `sendMessageDraft` fa comparire la risposta di Qwen **mentre la genera**, come nelle app di chat AI. La bozza è temporanea (dura circa 30 secondi): alla fine bisogna mandare il messaggio definitivo con `sendMessage`. Funziona solo nelle chat private.

```ts
import type { Context } from 'grammy'

/** Mostra la risposta mentre arriva a pezzi (es. dallo stream di Ollama), poi la salva. */
export async function streamReply(ctx: Context, chunks: AsyncIterable<string>) {
  const chatId = ctx.chat!.id
  const threadId = ctx.msg?.message_thread_id                   // resta nello stesso topic
  const draftId = Math.floor(Math.random() * 1_000_000_000) + 1 // qualsiasi numero diverso da 0
  let text = ''
  let lastDraft = 0

  // Testo vuoto = Telegram mostra "Sta pensando…"
  await ctx.api.sendMessageDraft(chatId, draftId, '', { message_thread_id: threadId }).catch(() => {})

  for await (const chunk of chunks) {
    text += chunk
    if (Date.now() - lastDraft > 700) { // al massimo un aggiornamento ogni 0,7 s
      lastDraft = Date.now()
      await ctx.api
        .sendMessageDraft(chatId, draftId, text.slice(0, 4096), { message_thread_id: threadId })
        .catch(() => {})
    }
  }

  // La bozza sparisce da sola: il messaggio vero va mandato alla fine
  await ctx.api.sendMessage(chatId, text.slice(0, 4096) || '🤷', { message_thread_id: threadId })
}
```

**Alternativa che funziona ovunque:** manda un messaggio e modificalo con `editMessageText` al massimo ogni 1,5 secondi. È meno fluido, ma va bene anche nei gruppi.

### 3.11 Link profondi (deep link)

**Cosa fa:** `https://t.me/NOME_DEL_BOT?start=CODICE` apre la chat col bot. Quando l'utente preme *Avvia*, il bot riceve `/start CODICE`.

Il codice può essere lungo al massimo 64 caratteri, fra lettere, numeri, `_` e `-`. Serve per inviti (sezione 4.3), per collegare account e per scorciatoie ("apri July direttamente su /disk").

```ts
bot.command('start', (ctx) => {
  const payload = ctx.match // il testo dopo /start, vuoto se non c'è
})
```

### 3.12 Limiti da ricordare

| Cosa | API cloud di Telegram | Il tuo july-api locale |
|---|---|---|
| File che il bot riceve | 20 MB | senza limite |
| File che il bot invia | 50 MB | 2000 MB |
| Testo di un messaggio | 4096 caratteri | uguale |
| Didascalia | 1024 caratteri | uguale |
| `callback_data` dei bottoni | 64 byte | uguale |
| Codice dei deep link | 64 caratteri | uguale |
| Ritmo dei messaggi | circa 1 al secondo per chat, circa 30 al secondo in totale (anche le modifiche contano) | uguale |

---

## 4. Autenticazione tramite bot

### 4.1 Come ragiona la sicurezza di un bot

Tre idee da tenere in testa:

- **`ctx.from.id` non si può falsificare.** Lo scrive Telegram, non l'utente. Controllare l'ID è quindi un'autenticazione solida.
- **Il token è la vera chiave.** Chi ha il token *è* July. Proteggilo come una password (sezione 4.8).
- **La sicurezza dipende anche dal tuo account Telegram.** Se qualcuno entra nel tuo account, entra anche in July. Tieni attiva la **verifica in due passaggi** di Telegram.

### 4.2 Passo passo: un unico "buttafuori" (`auth.ts`)

Oggi ogni feature ha la sua riga `if (ctx.from?.id !== ME)`. Con un buttafuori unico il controllo sta in un posto solo, e puoi aggiungere altre persone (per esempio la tua ragazza) senza toccare le feature.

**1.** Crea `features/auth.ts`:

```ts
// features/auth.ts — il "buttafuori" di July: decide chi può usare il bot.
// Va registrato PRIMA di tutte le altre feature: bot.use(auth)

import { Composer, type Context } from 'grammy'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const OWNER = 120075267                                // tu: puoi fare tutto
const USERS_FILE = '/mnt/storage/july-data/users.json' // gli altri utenti, salvati sull'SSD
const INVITE_MINUTES = 15                              // un invito scade dopo 15 minuti

type Role = 'owner' | 'user'
type UserInfo = { name: string; role: Role; since: string }

// id Telegram → info. Le chiavi sono stringhe perché in JSON le chiavi sono sempre stringhe
let users: Record<string, UserInfo> = {}

// Inviti attivi: codice → scadenza (in millisecondi).
// Solo in memoria: se July si riavvia gli inviti spariscono, ed è giusto così.
const invites = new Map<string, number>()

/** Da chiamare una volta all'avvio, prima di bot.start() */
export async function loadUsers() {
  try {
    users = JSON.parse(await readFile(USERS_FILE, 'utf8'))
  } catch {
    users = {} // primo avvio: nessun utente oltre a te
  }
}

async function saveUsers() {
  await mkdir(dirname(USERS_FILE), { recursive: true })
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2))
}

/** Il ruolo di chi ha mandato l'update, oppure undefined se è uno sconosciuto */
export function roleOf(ctx: Context): Role | undefined {
  const id = ctx.from?.id
  if (id === undefined) return undefined
  if (id === OWNER) return 'owner'
  return users[id]?.role
}

export const isOwner = (ctx: Context) => roleOf(ctx) === 'owner'

export const auth = new Composer()

// 1) Il buttafuori: gira su OGNI update, prima di tutto il resto
auth.use(async (ctx, next) => {
  if (roleOf(ctx)) return next() // conosciuto → avanti

  // Sconosciuto: l'unica cosa ammessa è "/start CODICE" arrivato da un link d'invito
  const text = ctx.message?.text ?? ''
  const code = text.startsWith('/start ') ? text.slice('/start '.length).trim() : ''
  const expiresAt = invites.get(code)

  if (ctx.from && expiresAt !== undefined && expiresAt > Date.now()) {
    invites.delete(code) // un invito vale UNA volta sola
    users[ctx.from.id] = { name: ctx.from.first_name, role: 'user', since: new Date().toISOString() }
    await saveUsers()
    await ctx.reply(`Ciao ${ctx.from.first_name}! Ora puoi usare July 👋`)
    await ctx.api.sendMessage(OWNER, `✅ ${ctx.from.first_name} (${ctx.from.id}) è entrato/a con un invito`)
    return
  }

  // Tutto il resto: silenzio. Chi non è autorizzato non deve neanche sapere che il bot risponde.
  console.warn(`[auth] bloccato id=${ctx.from?.id} @${ctx.from?.username ?? '-'}`)
})

// Da qui in giù arrivano solo utenti conosciuti. I comandi di gestione sono solo tuoi:
const owner = auth.filter(isOwner)

// 2) /invita — crea un link d'invito monouso
owner.command('invita', async (ctx) => {
  const code = randomBytes(16).toString('base64url') // 22 caratteri casuali, validi in un link
  invites.set(code, Date.now() + INVITE_MINUTES * 60_000)
  await ctx.reply(
    `Invito valido ${INVITE_MINUTES} minuti, usabile una volta:\nhttps://t.me/${ctx.me.username}?start=${code}`,
  )
})

// 3) /utenti — chi ha accesso
owner.command('utenti', async (ctx) => {
  const lines = Object.entries(users).map(([id, u]) => `• ${u.name} — ${id} (${u.role})`)
  await ctx.reply(lines.length > 0 ? lines.join('\n') : 'Solo tu.')
})

// 4) /rimuovi ID — toglie l'accesso
owner.command('rimuovi', async (ctx) => {
  const id = ctx.match.trim()
  if (!users[id]) return void (await ctx.reply('ID non trovato. Usa /utenti per la lista.'))
  delete users[id]
  await saveUsers()
  await ctx.reply(`🚫 Rimosso ${id}`)
})
```

**2.** Montalo **per primo** in `index.ts` e carica gli utenti prima di avviare il bot:

```ts
import { auth, loadUsers } from './features/auth'

await loadUsers()
bot.use(auth) // PRIMA di upload, link, admin, llm
```

**3.** Fai il deploy (stesso comando del passo 6, aggiungendo `features/auth.ts`).

**4.** Prova: scrivi a July da un account che non è il tuo. Non deve rispondere niente, e nei log deve comparire `[auth] bloccato`.

### 4.3 Passo passo: invitare qualcuno con un link

1. Tu scrivi `/invita` a July.
2. July risponde con un link valido 15 minuti e usabile una sola volta.
3. Lo mandi alla persona, che lo apre e preme **Avvia**.
4. July la aggiunge a `users.json`, la saluta e avvisa te.
5. Con `/utenti` vedi chi ha accesso; con `/rimuovi ID` lo togli.

**Perché è sicuro:** il codice è casuale (16 byte, impossibile da indovinare), scade presto e vale una volta sola. Anche se il link finisse nelle mani sbagliate dopo l'uso, non servirebbe più a niente.

### 4.4 Comandi solo per te (ruoli)

`composer.filter(condizione)` crea un pezzo di bot che si attiva solo quando la condizione è vera. È il modo più pulito per separare i comandi tuoi da quelli di tutti.

```ts
import { Composer } from 'grammy'
import { isOwner } from './auth'

export const admin = new Composer()
const owner = admin.filter(isOwner) // tutto ciò che registri su `owner` è solo per te

owner.command('restart', async (ctx) => { /* … */ })
admin.command('ciao', (ctx) => ctx.reply('Ciao!')) // questo invece è per tutti gli utenti ammessi
```

### 4.5 Accedere a un tuo sito con Telegram (Login Widget)

Serve per un futuro pannello web di July, o per i tuoi backend Fastify: niente password, entri col tuo account Telegram.

1. In @BotFather usa **/setdomain**, scegli il bot e indica il dominio del sito.
2. Nella pagina di login metti il widget ufficiale:

   ```html
   <script async src="https://telegram.org/js/telegram-widget.js?22"
     data-telegram-login="NOME_DEL_BOT" data-size="large"
     data-auth-url="https://tuodominio/auth/telegram"></script>
   ```

3. Dopo il login Telegram rimanda l'utente a `data-auth-url` con i suoi dati (`id`, `first_name`, `username`, `auth_date`, `hash`…).
4. **Sul server** verifichi la firma. Senza questa verifica chiunque potrebbe scriversi un `id` a mano nell'indirizzo.

```ts
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

// Confronto "a tempo costante": non fa capire a un attaccante quante lettere erano giuste
function sameHex(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** Verifica i dati che il Login Widget di Telegram manda al tuo sito. */
export function verifyTelegramLogin(query: Record<string, string>, botToken: string, maxAgeSec = 86400): boolean {
  const { hash, ...fields } = query
  if (!hash) return false

  // 1. "chiave=valore" di tutti i campi tranne hash, in ordine alfabetico, uno per riga
  const checkString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')

  // 2. la chiave segreta è lo SHA-256 del token del bot
  const secret = createHash('sha256').update(botToken).digest()

  // 3. la firma che avrebbe calcolato Telegram con questi dati
  const expected = createHmac('sha256', secret).update(checkString).digest('hex')

  // 4. firma uguale e login recente (di default: meno di un giorno fa)
  const age = Date.now() / 1000 - Number(fields.auth_date)
  return sameHex(expected, hash) && age < maxAgeSec
}
```

Una rotta Fastify che la usa:

```ts
app.get('/auth/telegram', async (req, reply) => {
  const query = req.query as Record<string, string>
  if (!verifyTelegramLogin(query, process.env.BOT_TOKEN!)) return reply.code(401).send('Firma non valida')
  if (query.id !== '120075267') return reply.code(403).send('Non autorizzato')
  // qui crei la sessione (cookie firmato o JWT), come nei tuoi backend
  return reply.redirect('/')
})
```

### 4.6 Mini App: verificare chi la apre

Una Mini App è una pagina web che si apre **dentro** Telegram, da un bottone del bot. Per esempio potrebbe essere un pannello di July con grafici e pulsanti.

La pagina riceve `Telegram.WebApp.initData`, che va mandato al tuo server e verificato lì, mai nel browser. Il meccanismo è quasi identico al Login Widget:

```ts
/** Verifica l'initData di una Mini App (Telegram.WebApp.initData). Va fatto sul server. */
export function verifyInitData(initData: string, botToken: string, maxAgeSec = 3600): boolean {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return false
  params.delete('hash')

  const checkString = [...params.keys()].sort().map((k) => `${k}=${params.get(k)}`).join('\n')

  // Unica differenza col Login Widget: la chiave segreta è HMAC con chiave "WebAppData"
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest('hex')

  const age = Date.now() / 1000 - Number(params.get('auth_date'))
  return sameHex(expected, hash) && age < maxAgeSec
}
```

### 4.7 Avviso Telegram a ogni accesso SSH al Pi

July ti scrive ogni volta che qualcuno entra nel Pi via SSH. Se l'accesso non l'hai fatto tu, lo sai subito.

> Funziona con l'SSH normale (`ssh morgan@mcloud`). Se un giorno passi a *Tailscale SSH*, questi accessi non passano da qui.
> **Mentre lo configuri, tieni aperta una seconda sessione SSH**: se sbagli qualcosa, hai ancora un modo per entrare.

**1. Crea lo script** (incolla tutto il blocco):

```bash
sudo tee /usr/local/bin/ssh-alert.sh >/dev/null <<'EOF'
#!/bin/sh
# Manda un messaggio Telegram a ogni accesso SSH riuscito.
# Lo lancia PAM (come root) quando si apre una sessione SSH.
[ "$PAM_TYPE" = "open_session" ] || exit 0
TOKEN=$(grep -m1 'TOKEN=' /home/morgan/july/.env | cut -d= -f2- | tr -d '"')
TEXT="🔐 Accesso SSH a mcloud: utente $PAM_USER da $PAM_RHOST"
# & = in background, -m 5 = massimo 5 secondi: il login non aspetta mai Telegram
curl -s -m 5 "http://localhost:8081/bot$TOKEN/sendMessage" -d chat_id=120075267 --data-urlencode "text=$TEXT" >/dev/null 2>&1 &
exit 0
EOF
```

**2. Rendilo eseguibile solo da root e collegalo a SSH.** `optional` significa che, se lo script fallisce, il login funziona comunque:

```bash
sudo chmod 700 /usr/local/bin/ssh-alert.sh && echo 'session optional pam_exec.so /usr/local/bin/ssh-alert.sh' | sudo tee -a /etc/pam.d/sshd
```

**3. Prova:** apri una nuova sessione SSH. Su Telegram deve arrivare il messaggio 🔐.

### 4.8 Igiene del token

- **Permessi del `.env`:** leggibile solo da te.

  ```bash
  chmod 600 ~/july/.env
  ```

- **Mai nel repo:** `.env` deve stare nel `.gitignore`.
- **Un token per ogni scopo:** il bot di sviluppo ha il suo token (già fatto). Per gli avvisi di servizi esterni come healthchecks.io usa un bot separato: se quel token esce, July resta al sicuro.
- **Se il token esce:** in @BotFather usa `/revoke`, metti il nuovo token nel `.env` e riavvia July (`sudo systemctl restart july`).

---

## 5. Affidabilità e ottimizzazione

### 5.1 Rete di sicurezza contro i crash: `bot.catch`

Senza un gestore degli errori, grammY **ferma il bot** al primo errore non gestito. systemd poi lo riavvia, ma intanto perdi tempo e messaggi. Con `bot.catch` l'errore viene registrato nei log e July continua a funzionare.

Mettilo in `index.ts`, prima di `bot.start()`:

```ts
import { GrammyError, HttpError } from 'grammy'

bot.catch((err) => {
  const e = err.error
  if (e instanceof GrammyError) console.error('[telegram]', e.description)               // Telegram ha detto no
  else if (e instanceof HttpError) console.error('[rete] july-api non raggiungibile:', e) // problema di rete
  else console.error('[bug]', e)                                                         // errore nel tuo codice
})
```

### 5.2 Ripetere da solo quando Telegram dice "rallenta"

Se mandi troppi messaggi, Telegram risponde con l'errore 429 e indica quanti secondi aspettare. Il plugin `auto-retry` aspetta quel tempo e riprova da solo.

Sul Mac:

```bash
bun add @grammyjs/auto-retry
```

In `index.ts`, subito dopo `new Bot(...)`:

```ts
import { autoRetry } from '@grammyjs/auto-retry'
bot.api.config.use(autoRetry())
```

### 5.3 Lavori lunghi senza bloccare il bot

`bot.start()` gestisce **un update alla volta**: se un gestore aspetta 5 minuti, July resta muto per 5 minuti.

Ci sono due soluzioni:
- **La coda di `link.ts`** (consigliata per July): il gestore risponde subito e il lavoro gira dopo, uno alla volta. È semplice e non sovraccarica il Pi.
- **`@grammyjs/runner`:** gestisce più update in parallelo. Serve a un bot con tanti utenti, per July è eccessivo.

### 5.4 Spegnimento gentile

Nel tuo shutdown esistente (il gestore di `SIGTERM`) aspetta anche i download:

```ts
import { waitForDownloads } from './features/link'

async function shutdown() {
  await bot.stop()          // smette di ricevere messaggi nuovi
  await waitForDownloads()  // finisce i download già in coda
  process.exit(0)
}
process.once('SIGTERM', shutdown) // systemctl stop/restart e deploy
process.once('SIGINT', shutdown)  // Ctrl+C
```

Di default systemd aspetta 90 secondi e poi chiude July a forza. Se vuoi che i download lunghi finiscano anche durante un deploy, alza l'attesa a 15 minuti. Il prezzo è che un deploy durante un download lungo ci metterà di più.

```bash
sudo mkdir -p /etc/systemd/system/july.service.d && printf '[Service]\nTimeoutStopSec=15min\n' | sudo tee /etc/systemd/system/july.service.d/zz-timeout.conf && sudo systemctl daemon-reload
```

### 5.5 Bot di sviluppo separato

Hai già un secondo token per sviluppare. La regola è: **mai** lo stesso token in due posti contemporaneamente, altrimenti Telegram risponde con l'errore 409 e uno dei due si blocca.

### 5.6 Disco: niente robaccia sul server

La cartella `/mnt/storage/july-downloads` è solo di passaggio:
- ogni download ha una sottocartella che viene cancellata **sempre** dopo l'invio (`finally`);
- i file oltre 2000 MB non vengono scaricati, o vengono cancellati appena si scopre il peso;
- all'avvio July svuota gli avanzi di un crash o di uno spegnimento brusco (`cleanWorkDir`).

Non serve nessun cron di pulizia. Se ne avevi creato uno con una versione precedente di questa guida, lo togli così:

```bash
sudo rm -f /etc/cron.d/july-downloads-cleanup
```

Per controllare quanto spazio occupano la cartella temporanea (dovrebbe essere quasi vuota) e i file ricevuti da july-api:

```bash
sudo du -sh /mnt/storage/july-downloads /mnt/storage/july-api
```

---

## 6. Comandi rapidi

**Pi**

| Cosa | Comando |
|---|---|
| Log di July in diretta | `sudo journalctl -u july -f` |
| Ultimi 50 log | `sudo journalctl -u july -n 50 --no-pager` |
| Riavvia July | `sudo systemctl restart july` |
| Stato di July | `systemctl status july --no-pager` |
| Aggiorna yt-dlp subito | `sudo yt-dlp -U` |
| Aggiorna july-api | il comando del passo 2 |
| Topic salvati | `cat /mnt/storage/july-data/topics.json` |
| Utenti ammessi | `cat /mnt/storage/july-data/users.json` |
| Cartella temporanea (di solito vuota) | `ls -lh /mnt/storage/july-downloads` |
| Spazio su disco | `df -h /mnt/storage` |

**Mac**

| Cosa | Comando |
|---|---|
| Deploy | `git add -A && git commit -m "…" && git push pi main` |
| Aggiorna grammY | `bun add grammy@latest` |
