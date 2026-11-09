# 06 · Casa in 3D (Telegram Mini App)

## Cosa fa

```
Tu:    /casa
July:  [🏠 Apri casa]
```

Tocchi il pulsante e dentro Telegram si apre la tua casa in 3D: le stanze colorate dalla temperatura (blu fredda, rossa calda), le luci accese che brillano, le stanze occupate evidenziate (guida 02), il consumo attuale (guida 04). Tocchi una lampadina e si accende. Tutto si aggiorna in tempo reale.

## Cosa impari

three.js con React Three Fiber, geometrie estruse da poligoni, Telegram Mini Apps, WebSocket lato server con Bun, **autenticazione con HMAC** (la parte più importante), pubblicazione in HTTPS solo dentro Tailscale.

## Prerequisiti

- Guide 00 e 01 (`core/ha.ts`, la tabella dei rischi e `puo()` della 01).
- Facoltative: 02 e 04 per presenza e consumi.
- Certificati HTTPS attivi su Tailscale (pannello di amministrazione → DNS → HTTPS Certificates).

---

## Architettura

```
iPhone (Telegram + Tailscale acceso)
   │  https://mcloud.<tuo-tailnet>.ts.net:8443
   ▼
tailscale serve (HTTPS, certificato vero)
   │  http://127.0.0.1:3100
   ▼
July · Bun.serve
   ├── GET /         → la Mini App compilata (file statici)
   └── /ws           → WebSocket
          1. il client manda initData
          2. July la verifica (HMAC) e controlla l'ID in USERS
          3. July manda la fotografia iniziale degli stati
          4. July manda ogni cambio (da suCambio di core/ha.ts)
          5. il client manda comandi → stessi permessi della guida 01
```

```
JulyTheBot/
├── miniapp/                 progetto Vite + React (frontend)
│   ├── src/Casa.tsx
│   ├── src/planimetria.ts   tipi del file della casa
│   └── ...
└── funzioni/casa3d/
    ├── server.ts            Bun.serve + WebSocket
    ├── initdata.ts          verifica dell'autenticazione
    └── planimetria.json     la tua casa
```

---

## Passo 1 · La casa come dati

Prendi la planimetria (anche una foto del rogito) e misura le stanze in metri. Un angolo della casa è l'origine (0, 0).

```json
{
  "altezzaPareti": 2.7,
  "stanze": [
    { "nome": "Soggiorno", "poligono": [[0,0],[5.2,0],[5.2,4.1],[0,4.1]], "sensoreTemp": "sensor.soggiorno_temperatura" },
    { "nome": "Cucina",    "poligono": [[5.2,0],[8.0,0],[8.0,3.0],[5.2,3.0]] }
  ],
  "dispositivi": [
    { "entityId": "light.soggiorno_soffitto", "tipo": "luce", "posizione": [2.6, 2.0] }
  ]
}
```

Scrivi i tipi TypeScript in `miniapp/src/planimetria.ts` e validali con Zod quando July legge il file: un errore di battitura deve dare un messaggio chiaro, non una pagina bianca.

## Passo 2 · Il progetto frontend

Sul Mac, nella cartella `JulyTheBot`:

```bash
bun create vite miniapp --template react-ts
```

```bash
cd miniapp && bun add three @react-three/fiber @react-three/drei && bun add -d @types/three
```

React Three Fiber (R3F) ti fa scrivere la scena 3D come componenti React; drei aggiunge pezzi pronti, come `OrbitControls` per ruotare con le dita.

**✅ Verifica.** `bun run dev`, apri l'indirizzo nel browser del Mac: deve comparire la pagina di esempio di Vite.

## Passo 3 · Disegnare la casa

- **Pavimenti:** per ogni stanza crei una `THREE.Shape` dal poligono (`moveTo` sul primo punto, `lineTo` sugli altri) e la estrudi di pochi centimetri con `ExtrudeGeometry`. La shape vive nel piano X-Y; ruotala di −90° sull'asse X per sdraiarla.
- **Pareti:** per ogni lato del poligono, un `boxGeometry` lungo come il lato, spesso 10 cm, alto `altezzaPareti`, ruotato con `Math.atan2(dy, dx)`. Rendile semitrasparenti, o basse (1 m), così vedi dentro.
- **Colore dalla temperatura:** scala da 16 °C (blu) a 26 °C (rosso). `new THREE.Color().lerpColors(blu, rosso, t)` con `t = (temp − 16) / 10` limitato tra 0 e 1.
- **Luci:** una piccola sfera; se accesa, materiale con `emissive` e un `pointLight` debole sopra.
- **Telecamera** dall'alto in diagonale, con `OrbitControls`.

**✅ Verifica.** Con dati finti scritti a mano nel componente, la casa si vede, si ruota con il mouse, e cambiando una temperatura cambia il colore.

## Passo 4 · Dentro Telegram

In `miniapp/index.html`, nel `<head>`, lo script ufficiale di Telegram:

```html
<script src="https://telegram.org/js/telegram-web-app.js"></script>
```

Nell'app:

```ts
const tg = (window as any).Telegram.WebApp
tg.ready()        // dice a Telegram che la pagina è pronta
tg.expand()       // a tutto schermo
tg.colorScheme    // 'light' o 'dark': scegli i colori di conseguenza
tg.initData       // la stringa firmata da Telegram che manderai al server (passo 6)
```

## Passo 5 · Il server in July

Un `Bun.serve` su `127.0.0.1:3100` (solo locale: dall'esterno arriva tramite Tailscale):

```ts
Bun.serve<{ idUtente: number | null }>({
  hostname: '127.0.0.1',
  port: 3100,
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/ws') {
      // upgrade trasforma la richiesta HTTP in WebSocket; data è lo stato della connessione
      if (server.upgrade(req, { data: { idUtente: null } })) return
      return new Response('upgrade fallito', { status: 400 })
    }
    // altrimenti servi i file di miniapp/dist (e index.html per '/')
  },
  websocket: {
    open(ws) {},
    message(ws, messaggio) {
      // il primo messaggio deve essere { tipo: 'auth', initData }
      // finché ws.data.idUtente è null, rifiuta tutto il resto
    },
    close(ws) {},
  },
})
```

Bun ha un *pub/sub* integrato: dopo l'autenticazione `ws.subscribe('casa')`, e quando cambia uno stato `server.publish('casa', json)`. Manda solo le entità presenti nella planimetria, e al massimo 4 aggiornamenti al secondo per entità (un sensore di potenza ne manda molti di più).

## Passo 6 · L'autenticazione (non saltarla)

**Perché è essenziale.** La pagina è raggiungibile da chiunque sia nel tuo tailnet, **compreso l'amico con cui condividi il Pi**. Senza verifica, chiunque apra l'indirizzo comanda le luci di casa tua.

Telegram firma `initData` con una chiave derivata dal token del bot: solo Telegram (e July, che conosce il token) possono produrre una firma valida.

**L'algoritmo** (dalla documentazione Telegram delle Mini App):

1. `initData` è una stringa tipo query string. Leggila con `new URLSearchParams(initData)`.
2. Togli il campo `hash` e conservalo.
3. Con tutti gli altri campi costruisci la *data-check-string*: `chiave=valore`, ordinati per chiave in ordine alfabetico, uniti con `\n`.
4. `chiaveSegreta = HMAC_SHA256(chiave = "WebAppData", messaggio = token del bot)`.
5. `calcolato = HMAC_SHA256(chiave = chiaveSegreta, messaggio = data-check-string)`, in esadecimale.
6. Se `calcolato` è uguale a `hash` (confronto a tempo costante), i dati vengono da Telegram.
7. Controlla che `auth_date` (secondi) non sia più vecchio di un'ora.
8. Leggi `user` (è JSON), prendi `id` e controlla che sia in `USERS`.

**API di crittografia** (Bun supporta quella di Node):

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

const chiaveSegreta = createHmac('sha256', 'WebAppData').update(TOKEN).digest()        // Buffer
const calcolato = createHmac('sha256', chiaveSegreta).update(dataCheckString).digest('hex')
// timingSafeEqual vuole due Buffer della stessa lunghezza
const uguali = calcolato.length === hash.length &&
  timingSafeEqual(Buffer.from(calcolato), Buffer.from(hash))
```

Attenzione al punto 4: la **chiave** dell'HMAC è la stringa `"WebAppData"`, il **messaggio** è il token. È facile scambiarli.

**✅ Verifica.** Scrivi un test con una `initData` vera (stampala una volta dal telefono nel log, poi cancella quella riga): deve passare. Cambia un carattere qualsiasi: deve fallire. Se la `initData` contiene anche un campo `signature` e la verifica non passa, rileggi nella documentazione quali campi vanno nella data-check-string.

## Passo 7 · I comandi dalla Mini App

Il client manda `{ tipo: 'comando', entityId, azione }`. Il server:

1. ricontrolla l'utente della connessione;
2. usa **la stessa** `puo()` della guida 01: stesse regole che in chat;
3. per le azioni che chiedono conferma, il client mostra `tg.showConfirm('Apro la porta?', ok => ...)`, ma il server **non si fida**: le azioni ad alto rischio dalla Mini App rispondi "usa la chat" e basta, così la conferma resta una sola, quella con i pulsanti.

Regola generale: il client può essere modificato da chi lo usa. Ogni controllo che conta sta sul server.

## Passo 8 · Pubblicarla nel tailnet

Prima guarda cosa è già pubblicato, per non sovrascrivere niente:

```bash
tailscale serve status
```

Poi:

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:3100
```

L'indirizzo sarà `https://mcloud.<tuo-tailnet>.ts.net:8443` (il nome completo lo vedi in `tailscale status` o nel pannello). Funziona solo con Tailscale acceso sul telefono: è voluto.

Mettilo nel `.env` di July come `MINIAPP_URL`, e il comando `/casa`:

```ts
import { InlineKeyboard } from 'grammy'
await ctx.reply('La tua casa', { reply_markup: new InlineKeyboard().webApp('🏠 Apri casa', MINIAPP_URL) })
```

## Passo 9 · Deploy

Sul Mac compili il frontend, poi il deploy di sempre copia anche `miniapp/dist`:

```bash
cd miniapp && bun run build && cd ..
```

Aggiungi `--exclude miniapp/node_modules` al comando `rsync` del README di July.

**✅ Verifica finale.** Dal telefono, con Tailscale acceso: `/casa`, apri, accendi una luce dalla Mini App e guardala cambiare anche nell'app di HA. Poi spegni Tailscale e riapri: non deve caricarsi.

---

## Trappole

- **Saltare la verifica di `initData`.** Passo 6.
- **Prestazioni:** ombre e luci vere sono costose sul telefono. Una o due `pointLight` in tutto; le altre luci solo con `emissive`.
- **Troppi messaggi WebSocket:** limita gli aggiornamenti per entità (passo 5).
- **La cache di Telegram** a volte tiene la versione vecchia: aggiungi un numero di versione all'indirizzo (`?v=3`) quando pubblichi.

## Per andare oltre

- **Flusso di energia:** particelle che scorrono dal contatore alle stanze, più veloci con più consumo (guida 04).
- **Linea del tempo:** uno slider per rivedere la giornata (temperature e luci dallo storico di HA).
- **Pulsante menu:** invece di `/casa`, il pulsante fisso accanto al campo di testo (`setChatMenuButton` nella Bot API).

## Fonti

- ✔︎ grammY, pulsante Mini App (`webApp`): https://grammy.dev/plugins/keyboard
- Telegram Mini Apps e validazione di initData: https://core.telegram.org/bots/webapps (da verificare)
- React Three Fiber: https://r3f.docs.pmnd.rs (da verificare)
- drei: https://github.com/pmndrs/drei (da verificare)
- three.js, `ExtrudeGeometry` e `Shape`: https://threejs.org/docs (da verificare)
- Bun, WebSocket lato server: https://bun.sh/docs/api/websockets (da verificare)
- Tailscale serve: https://tailscale.com/kb/1312/serve (da verificare)
