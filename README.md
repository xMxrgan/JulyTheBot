# July

Bot Telegram personale che gira sul Raspberry Pi di casa (`mcloud`). Fa tre cose:

1. **Carica file sul server**: film, serie e canzoni, che poi i timer di beets e mnamer smistano da soli.
2. **Gestisce il server**: stato dei container, spazio su disco, import, riavvii.
3. **Fa da assistente privato**: risponde con Qwen3 4B, un modello AI che gira sul Pi senza accesso a internet, e ricorda le cose che gli chiedi di ricordare.

Questo file contiene tutto quello che serve per usarlo, modificarlo, rimetterlo in piedi e capire cosa non va.

---

## Indice

1. [Come è fatto](#come-è-fatto)
2. [Dove sta cosa](#dove-sta-cosa)
3. [Comandi Telegram](#comandi-telegram)
4. [Lavorare sul Pi: SSH e come incollare i comandi](#lavorare-sul-pi-ssh-e-come-incollare-i-comandi)
5. [Sviluppo e deploy](#sviluppo-e-deploy)
6. [Gestire il servizio July](#gestire-il-servizio-july)
7. [Gestire Ollama e i modelli](#gestire-ollama-e-i-modelli)
8. [Memoria](#memoria)
9. [Persone e compartimenti](#persone-e-compartimenti)
10. [Dove mettere le mani](#dove-mettere-le-mani)
11. [Risoluzione problemi](#risoluzione-problemi)
12. [Installazione da zero](#installazione-da-zero)
13. [Tenere leggero il Pi](#tenere-leggero-il-pi)
14. [Privacy e sicurezza](#privacy-e-sicurezza)
15. [Limiti del modello](#limiti-del-modello)

---

## Come è fatto

```
iPhone (app Telegram)
      │  i messaggi passano dai server di Telegram
      ▼
july-api        server Bot API locale (container Docker, porta 8081)
      │         serve per i file grandi, oltre il limite normale dei bot
      ▼
July            bot in TypeScript (Bun + grammY), servizio systemd "july", cartella ~/july
  ├── upload.ts   file ricevuti → cartelle inbox → timer beets / mnamer
  ├── admin.ts    /status /disk /import /restart
  ├── memory.ts   ricordi → /mnt/storage/july/memory/<ID Telegram>.json
  └── ai.ts       domande → Ollama
                        │  http://10.89.0.10:11434
                        ▼
                  ollama   container Docker sulla rete "llm", senza internet
                           modello Qwen3 4B Instruct, core 2 e 3, massimo 5 GB di RAM
```

**Il percorso di un messaggio.** grammY passa ogni messaggio ai gestori nell'ordine in cui sono registrati con `bot.use(...)` in `index.ts`. Il primo che lo gestisce si ferma lì; gli altri lo passano avanti con `next()`. L'ordine è:

1. `upload`: file ricevuti
2. `admin`: comandi del server, solo per il tuo ID
3. link → QR code e `/start` (direttamente in `index.ts`)
4. `memory`: `/ricorda`, `/memoria`, `/dimentica` e le frasi "ricorda che…", "dimentica…"
5. `ai`: tutti gli altri messaggi di testo, che vanno al modello

Per questo l'upload e i comandi non attivano mai il modello: vengono gestiti prima.

---

## Dove sta cosa

| Cosa                        | Dove                                                                   |
| --------------------------- | ---------------------------------------------------------------------- |
| Codice in sviluppo          | Mac, cartella `JulyTheBot` (repository git)                            |
| Codice in produzione        | Pi, cartella `/home/morgan/july`                                       |
| Configurazione segreta      | Pi, file `/home/morgan/july/.env` (mai in git)                         |
| Servizio che fa girare July | systemd, unità `july` (`systemctl cat july` per vederla)               |
| Runtime                     | Bun, in `/home/morgan/.bun/bin/bun`                                    |
| Server Bot API locale       | container Docker `july-api`, porta 8081                                |
| Modello AI                  | container Docker `ollama`, IP `10.89.0.10`, porta 11434                |
| Modelli scaricati           | volume Docker `ollama` (sull'SSD, perché `/var/lib/docker` è sull'SSD) |
| Ricordi                     | `/mnt/storage/july/memory/<ID Telegram>.json`                          |
| Dati (film, musica)         | SSD montato in `/mnt/storage`                                          |

### Variabili del file `.env`

Bun legge da solo il file `.env` dalla cartella in cui parte il bot. Una variabile per riga.

| Variabile            | Obbligatoria | Valore                              | A cosa serve                                                    |
| -------------------- | ------------ | ----------------------------------- | --------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN` | sì           | il token di @BotFather, tra apici   | Identifica il bot su Telegram                                   |
| `AI_MODEL`           | no           | `qwen3:4b-instruct-2507-q4_K_M`     | Il modello da usare; se manca, si usa quello scritto in `ai.ts` |
| `OLLAMA_URL`         | no           | `http://10.89.0.10:11434`           | Indirizzo di Ollama                                             |
| `MEMORY_DIR`         | no           | `/mnt/storage/july/memory`          | Cartella dei ricordi                                            |
| `IMMICH_URL`         | no           | `http://127.0.0.1:2283`             | Indirizzo di Immich                                             |
| `IMMICH_KEY_<NOME>`  | no           | chiave API creata da quella persona | Foto Immich di quella persona                                   |

Esempio:

```
TELEGRAM_BOT_TOKEN='123456789:ABC-il-tuo-token'
AI_MODEL=qwen3:4b-instruct-2507-q4_K_M
```

---

## Comandi Telegram

| Scrivi                                    | July fa                                                          | Chi può                                     |
| ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| `/start`                                  | Messaggio di benvenuto, tastiera e menu della lista della spesa  | tutti                                       |
| un link                                   | Risponde con il QR code del link                                 | tutti                                       |
| un file                                   | Lo carica sul Pi, dove i timer lo smistano                       | tu                                          |
| `/status`                                 | Elenco dei container e del loro stato                            | admin                                       |
| `/disk`                                   | Spazio libero sull'SSD                                           | admin                                       |
| `/import`                                 | Avvia subito gli import di musica e film                         | admin                                       |
| `/restart nome`                           | Riavvia quel container; con un nome sbagliato ti mostra l'elenco | admin                                       |
| `/memoria`                                | I tuoi ricordi, numerati                                         | persone in `users.ts`                       |
| `/ricorda testo`                          | Salva un ricordo                                                 | persone in `users.ts`                       |
| `/dimentica 3` oppure `/dimentica parola` | Cancella il ricordo numero 3, o quello che contiene la parola    | persone in `users.ts`                       |
| `/reset`                                  | Azzera la conversazione in corso; i ricordi restano              | persone in `users.ts`                       |
| qualsiasi altro testo                     | Risponde il modello                                              | persone in `users.ts`, solo in chat privata |

Frasi che salvano un ricordo senza comando: `ricorda che`, `ricordati che`, `ricorda:`, `tieni a mente che`, `tieni a mente:`, `segnati che`, `annota:`, `memorizza che`.
Frasi che lo cancellano: `dimentica`, `dimentica che`, `dimenticati che`.

### Il menu "/" di Telegram

Per far comparire i comandi nel menu che si apre scrivendo "/": su Telegram scrivi a @BotFather, invia `/setcommands`, scegli il bot e incolla:

```
status - Stato dei container
disk - Spazio libero sull'SSD
import - Avvia subito gli import di musica e film
restart - Riavvia un container
memoria - Mostra i ricordi salvati
ricorda - Salva un ricordo
dimentica - Cancella un ricordo
reset - Azzera la conversazione
```

---

## Lavorare sul Pi: SSH e come incollare i comandi

### Collegarsi

Il Pi si chiama `mcloud` su Tailscale, quindi funziona da casa e da fuori:

```bash
ssh morgan@mcloud
```

Dal Mac la password non serve, perché la chiave è già stata copiata con `ssh-copy-id`.

### Incollare comandi dall'iPhone

- **Un comando alla volta.** Incollalo, premi Invio, aspetta che finisca e leggi l'output prima di passare al successivo.
- **Disattiva le correzioni automatiche.** L'iPhone trasforma `july` in `July`, ma i nomi dei servizi distinguono maiuscole e minuscole e `July` non esiste. Nell'app SSH disattiva maiuscole automatiche e correzione.
- **Attenzione agli apici "intelligenti".** iOS può trasformare `'` in `’` e `--` in `—`, e la shell non li riconosce. Disattiva _Impostazioni → Generali → Tastiera → Punteggiatura smart_, oppure incolla i comandi invece di scriverli.
- **Comandi su più righe.** Una `\` alla fine di una riga significa "il comando continua sotto": incolla tutto il blocco insieme.
- **`&&` tra due comandi** esegue il secondo solo se il primo è riuscito. **`;`** li esegue tutti e due comunque.
- **Per interrompere** un comando che non finisce: Ctrl+C.
- **`sudo`** chiede la password di `morgan`. Mentre la scrivi non compare nulla: è normale.

### Modificare un file sul Pi con nano

```bash
nano ~/july/.env
```

| Tasti             | Azione             |
| ----------------- | ------------------ |
| frecce            | muoversi nel testo |
| Ctrl+W            | cercare un testo   |
| Ctrl+O, poi Invio | salvare            |
| Ctrl+X            | uscire             |

**Non usare `echo 'X=y' >> file` per aggiungere righe al `.env`.** Se l'ultima riga del file non finisce con un "a capo", il testo nuovo si attacca alla riga precedente e la rovina. È già successo con il token. Usa nano.

### Creare file con `cat << 'EOF'`

Nelle guide trovi spesso:

```bash
cat > nomefile << 'EOF'
contenuto...
EOF
```

Significa "scrivi nel file tutto quello che sta tra la prima riga e `EOF`". Gli apici attorno a `'EOF'` impediscono alla shell di modificare il testo, per esempio i `$` del codice. Se il file esiste già, viene sovrascritto.

---

## Sviluppo e deploy

Il giro è sempre lo stesso: **modifichi sul Mac → controlli → deploy → provi su Telegram → leggi il log**.

### 1. Modifica sul Mac

Lavora su un branch git, così puoi sempre tornare indietro:

```bash
git checkout -b nome-della-modifica
```

### 2. Controlla che il codice compili

Prima del deploy, questo comando prova a compilare tutto il bot in un file temporaneo. Se c'è un errore di sintassi, una parentesi o un apice mancante, lo vedi qui invece che sul Pi:

```bash
bun build ./index.ts --target bun --outfile /tmp/july-check.js
```

Non controlla i tipi TypeScript, solo che il codice sia scritto correttamente.

### 3. Deploy sul Pi

Dal Mac, nella cartella `JulyTheBot`:

```bash
rsync -av --exclude node_modules --exclude .git --exclude .env ./ morgan@mcloud:~/july/ && ssh -t morgan@mcloud 'cd ~/july && ~/.bun/bin/bun install && sudo systemctl restart july'
```

Cosa fa, pezzo per pezzo:

| Pezzo                         | Significato                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `rsync -av`                   | Copia la cartella sul Pi, mostrando i file copiati                          |
| `--exclude node_modules`      | Non copia le dipendenze: sul Pi le installa `bun install`                   |
| `--exclude .git`              | Non copia la storia git                                                     |
| `--exclude .env`              | Non tocca il `.env` del Pi, che ha il token e le impostazioni di produzione |
| `./ morgan@mcloud:~/july/`    | Da questa cartella alla cartella `july` sul Pi                              |
| `ssh -t morgan@mcloud '...'`  | Entra nel Pi ed esegue i comandi tra apici                                  |
| `bun install`                 | Installa le dipendenze di `package.json`                                    |
| `sudo systemctl restart july` | Riavvia il bot con il codice nuovo                                          |

Il deploy serve **solo quando cambia il codice**. Se cambi solo il `.env` sul Pi, basta riavviare July.

### 4. Prova e leggi il log

Sul Pi:

```bash
sudo journalctl -u july -n 30 --no-pager
```

Dopo un riavvio riuscito, tra le ultime righe c'è `Status: Running and listening for links...`.

### 5. Salva il lavoro

```bash
git add -A && git commit -m "Descrizione della modifica"
```

Controlla una volta che `.env` e `node_modules` siano nel file `.gitignore`:

```bash
cat .gitignore
```

### Non far girare il bot sul Mac mentre gira sul Pi

Due copie dello stesso bot che chiedono messaggi a Telegram nello stesso momento si danno fastidio: compare l'errore `409 Conflict`. In più `index.ts` usa il server Bot API locale (`http://localhost:8081`), che esiste solo sul Pi. Per provare le modifiche, fai il deploy sul Pi. Se un giorno vuoi provare in locale, crea un secondo bot di test con @BotFather e usa il suo token.

### Misurare i tempi di risposta

Per capire dove va il tempo, in `askModel` dentro `features/ai.ts` puoi aggiungere, subito dopo `const data = await response.json()`, questa riga. Ollama misura i tempi in nanosecondi, quindi `/ 1e9` li converte in secondi:

```ts
console.log(
  `Caricamento ${(data.load_duration / 1e9).toFixed(1)} s, prompt ${data.prompt_eval_count} token in ${(data.prompt_eval_duration / 1e9).toFixed(1)} s, risposta ${data.eval_count} token in ${(data.eval_duration / 1e9).toFixed(1)} s`,
);
```

I numeri compaiono nel log di July, senza il testo dei messaggi.

---

## Gestire il servizio July

Tutti questi comandi vanno lanciati sul Pi.

| Vuoi                                 | Comando                                    |
| ------------------------------------ | ------------------------------------------ |
| Vedere se gira                       | `systemctl status july`                    |
| Riavviarlo                           | `sudo systemctl restart july`              |
| Fermarlo                             | `sudo systemctl stop july`                 |
| Avviarlo                             | `sudo systemctl start july`                |
| Ultime 30 righe di log               | `sudo journalctl -u july -n 30 --no-pager` |
| Log in diretta (Ctrl+C per uscire)   | `sudo journalctl -u july -f`               |
| Vedere com'è configurato il servizio | `systemctl cat july`                       |

Il servizio riparte da solo se il bot si chiude con un errore, e anche quando si riavvia il Pi.

---

## Gestire Ollama e i modelli

Anche questi comandi vanno lanciati sul Pi.

### Controlli rapidi

| Vuoi                                          | Comando                          |
| --------------------------------------------- | -------------------------------- |
| Modelli installati                            | `docker exec ollama ollama list` |
| Modello caricato in RAM ora (vuoto = nessuno) | `docker exec ollama ollama ps`   |
| CPU e RAM di tutti i container                | `docker stats --no-stream`       |
| Log di Ollama                                 | `docker logs ollama --tail 30`   |
| Riavviare Ollama                              | `docker restart ollama`          |

### Provare il modello a mano, senza July

Manda un messaggio diretto a Ollama, come fa July. Se nella risposta trovi `"content":"ok"` o simile, Ollama funziona:

```bash
curl -s http://10.89.0.10:11434/api/chat -d '{"model": "qwen3:4b-instruct-2507-q4_K_M", "stream": false, "think": false, "messages": [{"role": "user", "content": "Rispondi solo: ok"}]}'
```

### Verificare che Ollama sia isolato da internet

L'ultima riga deve essere `OK: Ollama non raggiunge internet`. Un errore "Network is unreachable" prima di quella riga è normale, anzi è quello che vogliamo:

```bash
docker exec ollama timeout 5 bash -c 'echo > /dev/tcp/1.1.1.1/443' && echo "PROBLEMA: Ollama raggiunge internet" || echo "OK: Ollama non raggiunge internet"
```

### Aggiungere un modello

Il container `ollama` non ha internet, quindi i modelli si scaricano con un container temporaneo che usa lo stesso volume. Sostituisci `NOME_MODELLO` con il nome esatto del tag preso da ollama.com/library:

```bash
docker run -d --name ollama-pull -v ollama:/root/.ollama ollama/ollama && sleep 5 && until docker exec ollama-pull ollama pull NOME_MODELLO; do sleep 5; done && docker rm -f ollama-pull
```

`until ...; do sleep 5; done` ripete il download finché non riesce. Se poi il modello non compare in `ollama list`, riavvia Ollama con `docker restart ollama`.

Prima di scaricare un modello, verifica quattro cose:

1. **I pesi sono scaricabili?** Se esiste solo un'API sul cloud, non è privato.
2. **Quanto pesa?** Un modello Q4 occupa circa 0,6 GB per miliardo di parametri. Un 4B (circa 2,5 GB) va bene; un 8B (circa 5 GB) è troppo pesante e lento.
3. **È un MoE?** In un nome come "35B-A3B" il primo numero decide la RAM necessaria e il secondo la velocità. 35B non entra nel Pi.
4. **È "instruct" o "thinking"?** Per July serve un modello instruct, che risponde subito. Un modello thinking scrive il suo ragionamento prima della risposta.

### Cambiare il modello usato da July

```bash
nano ~/july/.env
```

Cambia la riga `AI_MODEL=...`, salva, poi:

```bash
sudo systemctl restart july
```

### Togliere un modello che non usi

Per esempio la versione "thinking" scaricata all'inizio, che libera 2,5 GB:

```bash
docker exec ollama ollama rm qwen3:4b
```

### Il comando con cui è stato creato il container `ollama`

Ti serve se devi ricrearlo, per esempio dopo `docker rm -f ollama`. I modelli restano nel volume.

```bash
docker run -d \
  --name ollama \
  --restart unless-stopped \
  --network llm \
  --ip 10.89.0.10 \
  --cpuset-cpus=2,3 \
  --cpu-shares=256 \
  --memory=5g \
  --memory-swap=5g \
  -e OLLAMA_KEEP_ALIVE=10m \
  -e OLLAMA_MAX_LOADED_MODELS=1 \
  -e OLLAMA_NUM_PARALLEL=1 \
  -v ollama:/root/.ollama \
  ollama/ollama
```

| Opzione                            | Cosa fa                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `-d`                               | Fa girare il container in background                                        |
| `--restart unless-stopped`         | Lo fa ripartire da solo con il Pi, a meno che tu non l'abbia fermato a mano |
| `--network llm`, `--ip 10.89.0.10` | Rete senza internet, con un indirizzo fisso che July conosce                |
| `--cpuset-cpus=2,3`                | Usa solo i core 2 e 3; lo 0 e l'1 restano liberi per film e musica          |
| `--cpu-shares=256`                 | Priorità bassa sulla CPU (quella normale è 1024)                            |
| `--memory=5g`, `--memory-swap=5g`  | Al massimo 5 GB di RAM, nessuno swap                                        |
| `OLLAMA_KEEP_ALIVE=10m`            | Toglie il modello dalla RAM dopo 10 minuti senza richieste                  |
| `OLLAMA_MAX_LOADED_MODELS=1`       | Un solo modello in RAM alla volta                                           |
| `OLLAMA_NUM_PARALLEL=1`            | Una richiesta alla volta, le altre aspettano in coda                        |
| `-v ollama:/root/.ollama`          | Il volume con i modelli                                                     |

Per cambiare un limite senza ricreare il container, usa `docker update`:

```bash
docker update --memory=4g --memory-swap=4g ollama
```

---

## Memoria

- July salva **solo** quello che gli chiedi esplicitamente. Non salva mai niente da solo.
- C'è un file JSON per persona: `/mnt/storage/july/memory/<ID Telegram>.json`. È un semplice elenco di frasi e puoi leggerlo o correggerlo a mano:

  ```bash
  cat /mnt/storage/july/memory/*.json
  ```

- A ogni messaggio i ricordi entrano nella parte fissa del prompt. Finché non cambiano, Ollama riusa quella parte già elaborata.
- Limiti, in `features/memory.ts`: al massimo `MAX_FACTS = 30` ricordi lunghi `MAX_LENGTH = 200` caratteri. Più ricordi significano prompt più lunghi e risposte più lente.
- La conversazione in corso è separata dai ricordi: sono gli ultimi `MAX_TURNS = 10` scambi, in `features/ai.ts`, tenuti solo in RAM. Si azzera con `/reset` o quando July si riavvia.

---

## Persone e compartimenti

July riconosce chi scrive dal **Telegram ID**, che Telegram allega a ogni messaggio e che non si può falsificare. Le persone stanno in `features/users.ts`:

```ts
const USERS: User[] = [
  { id: 120000000, name: "Nome", role: "admin" },
  // { id: 987654321, name: 'NOME', role: 'member', immichKey: process.env.IMMICH_KEY_NOME },
];
```

|                                                   | admin                                          | member |
| ------------------------------------------------- | ---------------------------------------------- | ------ |
| Parla con l'assistente                            | sì                                             | sì     |
| Ricordi propri                                    | sì                                             | sì     |
| Conversazione propria                             | sì                                             | sì     |
| Stato del server allegato alle risposte           | sì                                             | no     |
| Comandi `/status`, `/disk`, `/import`, `/restart` | sì (sono controllati da `admin.ts` sul tuo ID) | no     |

**La separazione la fa il codice, non il modello.** Il modello vede solo quello che `extraDataFor` e `loadFacts` restituiscono per chi sta scrivendo. Non può rivelare i dati di un'altra persona, perché non li riceve mai.

### Aggiungere una persona

1. Lei scrive a @userinfobot su Telegram e ti passa il suo ID.
2. Opzionale, per le sue foto: crea una chiave API dal **suo** account Immich, con soli permessi di lettura se Immich lo permette. Con la sua chiave Immich restituisce solo i suoi dati.
3. Sul Pi, aggiungi la chiave al `.env` con nano (non con `echo`):

   ```bash
   nano ~/july/.env
   ```

   e aggiungi una riga come `IMMICH_KEY_NOME=la_sua_chiave`.

4. Sul Mac, in `features/users.ts`, togli `//` dalla riga di esempio e completa ID e nome. Poi fai il deploy.

---

## Dove mettere le mani

| Vuoi…                                            | File                 | Cosa cambiare                                                                               |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------- |
| Cambiare modello                                 | `.env` sul Pi        | `AI_MODEL`, poi `sudo systemctl restart july`                                               |
| Cambiare carattere o regole di July              | `features/ai.ts`     | le frasi in `buildSystemPrompt`                                                             |
| Fargli riconoscere altre domande sul server      | `features/ai.ts`     | aggiungi parole a `SERVER_WORDS`                                                            |
| Allegare un dato nuovo, per esempio da Navidrome | `features/ai.ts`     | una funzione che lo legge, sul modello di `serverStatus`, e un nuovo `if` in `extraDataFor` |
| Risposte più lunghe o più creative               | `features/ai.ts`     | `num_predict` e `temperature` in `askModel`                                                 |
| Ricordare più o meno conversazione               | `features/ai.ts`     | `MAX_TURNS`                                                                                 |
| Più o meno ricordi                               | `features/memory.ts` | `MAX_FACTS` e `MAX_LENGTH`                                                                  |
| Altre frasi per "ricorda che"                    | `features/memory.ts` | aggiungi la frase a `SAVE_PHRASES`, con lo spazio finale                                    |
| Aggiungere una persona                           | `features/users.ts`  | una riga in `USERS`                                                                         |
| Un nuovo comando admin                           | `features/admin.ts`  | una riga `me.command('nome', ...)` che esegue un comando fisso                              |

### Come aggiungere un comando admin

In `features/admin.ts` ogni comando è una riga che esegue un comando di shell fisso e risponde con il risultato. Esempio, i 5 file più grandi sull'SSD:

```ts
// /grandi: i 5 file più grandi sull'SSD (può richiedere qualche secondo)
me.command("grandi", async (ctx) =>
  ctx.reply(
    pre(
      await $`find /mnt/storage -type f -printf '%s %p\n' | sort -nr | head -5 | numfmt --to=iec --field=1`.quiet(),
    ),
    html,
  ),
);
```

Regola di sicurezza: un comando deve eseguire sempre un'azione fissa. Non passare mai alla shell testo scritto in chat.

---

## Risoluzione problemi

Quando qualcosa non va, l'ordine è sempre lo stesso: **log di July → Ollama a mano → log di Ollama.**

| Sintomo                                                             | Causa probabile                                                      | Cosa fare                                                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| July non risponde a niente; nel log `401 Unauthorized`              | Token sbagliato o `.env` rovinato                                    | `cat ~/july/.env`: una variabile per riga, token tra apici. Correggi con nano e riavvia                           |
| Nel log `409 Conflict`                                              | Due copie del bot accese (per esempio Mac e Pi)                      | Spegni quella in più                                                                                              |
| `Unit July.service not found`                                       | Maiuscola: il servizio si chiama `july`                              | Riscrivi tutto minuscolo e disattiva la correzione automatica                                                     |
| "Il modello non risponde"                                           | Container `ollama` fermo o bloccato                                  | `docker ps`, poi `docker logs ollama --tail 30`, poi `docker restart ollama`                                      |
| Risposta in inglese che comincia con "Okay, let's…" e si interrompe | Modello "thinking" invece di "instruct"                              | `AI_MODEL=qwen3:4b-instruct-2507-q4_K_M` nel `.env`                                                               |
| Rifiuta argomenti normali, come la storia                           | Istruzioni troppo restrittive in `buildSystemPrompt`                 | Rileggi le frasi del prompt: deve poter usare le sue conoscenze generali                                          |
| Risposte lente                                                      | Caricamento del modello dopo una pausa, prompt lungo, risposta lunga | Misura con la riga di log dei tempi; prova `qwen3:1.7b`                                                           |
| "ricorda che" dà errore                                             | July non può scrivere nella cartella dei ricordi                     | `sudo chown -R morgan:morgan /mnt/storage/july`                                                                   |
| `network llm not found`                                             | La rete interna non esiste                                           | `docker network create --internal --subnet 10.89.0.0/24 llm`                                                      |
| `Pool overlaps` creando la rete                                     | La subnet è già usata da un'altra rete                               | Usa `10.90.0.0/24` e cambia l'IP ovunque (container e `OLLAMA_URL`)                                               |
| `Your kernel does not support memory limit capabilities`            | Limiti di memoria spenti in Raspberry Pi OS                          | Vedi "Limiti di memoria" in [Installazione da zero](#installazione-da-zero)                                       |
| `connection reset by peer` durante un download                      | Connessione instabile                                                | Riprova con `until`; con il cavo di rete va meglio che in Wi-Fi                                                   |
| Un container si riavvia da solo                                     | Ha superato il limite di memoria                                     | `docker inspect --format '{{.Name}}: {{.State.OOMKilled}}' nome`: se è `true`, alza il limite con `docker update` |

---

## Installazione da zero

Serve solo se rifai il Pi o ricrei tutto. In ordine:

### 1. Limiti di memoria per Docker

Raspberry Pi OS li ha spenti di default, quindi vanno accesi una volta sola.

```bash
sudo cp /boot/firmware/cmdline.txt /boot/firmware/cmdline.txt.bak
```

```bash
sudo sed -i '1 s/$/ cgroup_memory=1 cgroup_enable=memory/' /boot/firmware/cmdline.txt
```

Controlla che sia rimasta **una sola riga**, che finisce con `cgroup_memory=1 cgroup_enable=memory`:

```bash
cat /boot/firmware/cmdline.txt
```

```bash
sudo reboot
```

Se il Pi non riparte, metti la microSD nel Mac e rinomina `cmdline.txt.bak` in `cmdline.txt`.

### 2. Rete senza internet per Ollama

```bash
docker network create --internal --subnet 10.89.0.0/24 llm
```

### 3. Scaricare i modelli

Uno alla volta:

```bash
until docker pull ollama/ollama; do sleep 5; done
```

```bash
docker run -d --name ollama-pull -v ollama:/root/.ollama ollama/ollama
```

```bash
until docker exec ollama-pull ollama pull qwen3:4b-instruct-2507-q4_K_M; do sleep 5; done
```

```bash
until docker exec ollama-pull ollama pull qwen3:1.7b; do sleep 5; done
```

```bash
docker rm -f ollama-pull
```

### 4. Avviare Ollama

Usa il comando completo della sezione [Gestire Ollama e i modelli](#il-comando-con-cui-è-stato-creato-il-container-ollama), poi verifica con `docker exec ollama ollama list` e con il test di isolamento.

### 5. Cartella dei ricordi

```bash
sudo mkdir -p /mnt/storage/july/memory && sudo chown -R morgan:morgan /mnt/storage/july
```

### 6. Bun e il codice di July

Installa Bun sul Pi, se manca:

```bash
curl -fsSL https://bun.sh/install | bash
```

Poi fai il deploy dal Mac (vedi [Sviluppo e deploy](#sviluppo-e-deploy)) e crea il `.env` sul Pi con nano.

### 7. Il servizio systemd

Questo è un esempio di unità per far partire July all'avvio. Confrontalo con quella che usi davvero (`systemctl cat july`) prima di sovrascriverla.

```bash
sudo nano /etc/systemd/system/july.service
```

```ini
[Unit]
Description=July - Telegram bot
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=morgan
WorkingDirectory=/home/morgan/july
ExecStart=/home/morgan/.bun/bin/bun run index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

| Riga                             | Significato                                       |
| -------------------------------- | ------------------------------------------------- |
| `After=` / `Wants=`              | Parte dopo la rete e Docker                       |
| `User=morgan`                    | Gira con l'utente `morgan`, non come root         |
| `WorkingDirectory=`              | La cartella da cui parte; da qui Bun legge `.env` |
| `ExecStart=`                     | Il comando che avvia il bot                       |
| `Restart=always`, `RestartSec=5` | Se si chiude, riparte dopo 5 secondi              |
| `WantedBy=multi-user.target`     | Parte all'avvio del Pi                            |

Poi attivalo:

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now july
```

`daemon-reload` fa rileggere i file dei servizi; `enable --now` attiva l'avvio automatico e avvia subito il bot.

### 8. Il server Bot API locale (`july-api`)

È il container che permette a July di ricevere file grandi. Per ricrearlo servono `api_id` e `api_hash`, che si ottengono su my.telegram.org. Per vedere come è configurato quello attuale:

```bash
docker inspect july-api
```

---

## Tenere leggero il Pi

- **Ollama** è già limitato: core 2 e 3, priorità bassa, 5 GB di RAM, scaricato dopo 10 minuti di inattività. Il modello si attiva solo con i messaggi di testo normali, non con upload o comandi.
- **Jellyfin in direct play.** Il Pi 5 non ha un codificatore video hardware, quindi ogni transcodifica occupa tutta la CPU. Imposta i client sulla qualità originale. I sottotitoli impressi (PGS, ASS) costringono a transcodificare, gli SRT no.
- **Lavori pesanti di notte.** Controllo dei duplicati, attività pianificate di Jellyfin e import grandi di Immich: con un timer systemd (`OnCalendar=*-*-* 04:00:00`) o dalle impostazioni del servizio.
- **Priorità bassa ai timer ogni 5 minuti.** `sudo systemctl edit beets-import.service` (e lo stesso per `mnamer-import.service`), poi aggiungi:

  ```ini
  [Service]
  Nice=10
  IOSchedulingClass=idle
  ```

  `Nice=10` abbassa la priorità sulla CPU; `IOSchedulingClass=idle` fa usare il disco solo quando nessun altro lo usa.

- **Limiti di RAM per gli altri container**, come assicurazione contro un servizio che impazzisce:

  ```bash
  docker update --memory=2g --memory-swap=2g jellyfin && docker update --memory=1536m --memory-swap=1536m nextcloud-app && docker update --memory=1g --memory-swap=1g nextcloud-db && docker update --memory=512m --memory-swap=512m navidrome july-api
  ```

  Se un servizio è in un `docker-compose.yml`, scrivi il limite anche lì (`mem_limit: 2g`), altrimenti sparisce al prossimo `docker compose up -d`.

- **Caldo e alimentazione.** `vcgencmd get_throttled` deve dare `throttled=0x0`. Altrimenti servono un dissipatore attivo o l'alimentatore ufficiale da 27 W.

---

## Privacy e sicurezza

- **Il modello è privato.** Ollama sta su una rete Docker senza strada verso internet: non può mandare niente fuori, né usare modelli cloud. Lo raggiungono solo i programmi del Pi, non la rete di casa e non Tailscale.
- **Telegram no.** Le chat con i bot non hanno cifratura end-to-end: i server di Telegram vedono i tuoi messaggi e le risposte di July. Il server Bot API locale non cambia questa cosa. Non scrivere a July password o contenuti di documenti personali.
- **Il token del bot è un segreto.** Chi lo ha può comandare il bot e leggere i messaggi che riceve. Sta solo nel `.env`, che non va mai in git né incollato in chat. Se finisce da qualche parte: @BotFather → `/revoke` → token nuovo nel `.env` del Pi (e del Mac, se ce l'hai) → `sudo systemctl restart july`.
- **Il Telegram ID non è un segreto.** Funziona come un nome utente: per passare il controllo bisognerebbe essere davvero collegati al tuo account Telegram. Tieni attiva la verifica in due passaggi di Telegram.
- **Log puliti.** July scrive nel log solo gli errori e i tempi, mai il testo dei messaggi.
- **Su disco** finiscono solo i ricordi che chiedi tu. La conversazione resta in RAM.

---

## Limiti del modello

- **Conoscenze ferme a circa il 2024** e niente internet: non conosce notizie e versioni recenti.
- **Ricorda i concetti meglio dei dettagli.** Date, nomi poco noti e numeri li può sbagliare con sicurezza. Funziona molto meglio quando ragiona su dati che gli vengono dati (stato del server, ricordi) che quando deve ricordare fatti da solo.
- **Velocità:** su 2 core scrive circa 4–6 token al secondo. Una risposta breve richiede circa 10 secondi; la prima dopo una pausa qualche secondo in più, perché il modello deve caricarsi.
- **Non sa fare cose.** Non manda promemoria a orario, non cerca file, non riavvia servizi: per queste azioni servono comandi scritti nel codice (vedi [Come aggiungere un comando admin](#come-aggiungere-un-comando-admin)).
- **Codice:** spiega bene comandi ed errori, ma scrive codice poco affidabile. Per il codice le fonti migliori sono le documentazioni ufficiali di grammY, delle API di Ollama e di Bun.
