# 08 · Messaggi vocali

## Cosa fa

```
Tu:    🎙️ (vocale, 3 s) "spegni le luci della cucina"
July:  🎙️ «spegni le luci della cucina»
       ✅ Spente 2 luci in cucina.

Tu:    🎙️ (vocale, 12 s) "ricordati che giovedì porto la macchina dal meccanico"
July:  🎙️ «ricordati che giovedì porto la macchina dal meccanico»
       📝 Salvato.
```

Il vocale viene trascritto **sul Pi**, da un modello che non ha accesso a internet, e il testo prende la stessa strada di un messaggio scritto.

## Cosa impari

Riconoscimento vocale con whisper.cpp, un servizio isolato come Ollama, richieste `multipart/form-data`, misurare il *real-time factor*, una coda per i lavori pesanti, e un refactoring importante: separare "da dove arriva il testo" da "cosa ne faccio".

## Prerequisiti

- Guida 00 parte A.
- Utile: 01, così i vocali comandano la casa.
- La rete Docker `llm`, senza internet, che usi già per Ollama.

---

## Architettura

```
Telegram ─► july-api (file su disco) ─► July
                                         │  POST multipart (file .oga)
                                         ▼
                              whisper  container sulla rete "llm"
                              10.89.0.11:8080, core 2 e 3, senza internet
                                         │  { "text": "..." }
                                         ▼
                              gestisciTesto(ctx, testo)  ← lo stesso dei messaggi scritti
```

---

## Passo 1 · Il modello

whisper.cpp ha modelli di varie dimensioni. Per l'italiano sul Pi i candidati sono:

| Modello | Qualità in italiano | Velocità |
| --- | --- | --- |
| `base` | discreta, sbaglia nomi e parole rare | veloce |
| `small` | buona | circa 3 volte più lento |

Al passo 5 li misuri tutti e due e scegli tu. Scarica entrambi con un container temporaneo che ha internet, nello stesso volume (come fai per i modelli di Ollama):

```bash
docker run --rm -v whisper-models:/models ghcr.io/ggml-org/whisper.cpp:main download-ggml-model.sh base /models
```

```bash
docker run --rm -v whisper-models:/models ghcr.io/ggml-org/whisper.cpp:main download-ggml-model.sh small /models
```

L'immagine `main` è disponibile per `arm64` e contiene anche `ffmpeg`, che serve al passo 2.

## Passo 2 · Il servizio

```bash
docker run -d --name whisper --restart unless-stopped --network llm --ip 10.89.0.11 --cpuset-cpus=2,3 --cpu-shares=256 --memory=1g --memory-swap=1g -v whisper-models:/models ghcr.io/ggml-org/whisper.cpp:main whisper-server --host 0.0.0.0 --port 8080 -m /models/ggml-base.bin -l it -t 2 --convert
```

| Opzione | Cosa fa |
| --- | --- |
| `--network llm --ip 10.89.0.11` | Stessa rete isolata di Ollama, indirizzo fisso |
| `--cpuset-cpus=2,3 --cpu-shares=256` | Come Ollama: core 2 e 3, priorità bassa, film e musica restano liberi |
| `-l it` | Lingua italiana (il predefinito è inglese) |
| `-t 2` | Due thread, uno per core |
| `--convert` | Converte l'audio in WAV con ffmpeg: puoi mandargli direttamente il file di Telegram |

**✅ Verifica 1, isolamento** (stessa prova di Ollama, l'ultima riga deve essere "OK"):

```bash
docker exec whisper timeout 5 bash -c 'echo > /dev/tcp/1.1.1.1/443' && echo "PROBLEMA: whisper raggiunge internet" || echo "OK: whisper non raggiunge internet"
```

Se il container non ha `bash`, prova con `sh` o controlla solo che la rete sia `llm` con `docker inspect whisper`.

**✅ Verifica 2, funziona.** Registra un vocale qualsiasi sul Mac, copialo sul Pi come `/tmp/prova.ogg`, poi:

```bash
curl -s http://10.89.0.11:8080/inference -F file=@/tmp/prova.ogg -F response_format=json
```

Deve rispondere `{"text": "..."}` con quello che hai detto.

## Passo 3 · Il refactoring: un solo ingresso per il testo

Oggi ogni gestore di July legge `ctx.message.text`. Un vocale non ha `text`: se lo trascrivi e basta, nessun gestore lo vede.

**La soluzione.** Una funzione `gestisciTesto(ctx, testo)` in `features/router.ts` che fa, in ordine, quello che oggi fanno i gestori di testo: frasi della memoria → casa (guida 01) → AI. Poi:

- il gestore dei messaggi scritti diventa `gestisciTesto(ctx, ctx.message.text)`;
- il gestore dei vocali diventa `gestisciTesto(ctx, testoTrascritto)`.

Per farlo, le funzioni di `memory.ts`, della casa e di `ai.ts` devono ricevere il testo come **parametro**, invece di leggerlo da `ctx`. È il cambiamento più grande di questa guida, ed è quello che la rende pulita: da qui in poi qualsiasi nuova sorgente di testo (un comando da una Mini App, un'automazione) usa la stessa strada.

Fallo **prima** di aggiungere i vocali, e controlla che i messaggi scritti funzionino esattamente come prima.

## Passo 4 · Il gestore dei vocali

```ts
bot.on('message:voice', async (ctx) => {
  const voce = ctx.message.voice          // { file_id, duration, mime_type, ... }
  // 1. durata: rifiuta oltre 60 secondi (protegge la CPU)
  // 2. percorso del file sul disco: usa lo stesso metodo di upload.ts
  //    (con il server Bot API locale, il file è già sul Pi)
  // 3. trascrivi
  // 4. rispondi con «testo» e poi gestisciTesto(ctx, testo)
})
```

**La trascrizione** (FormData di Bun, come nel browser):

```ts
const form = new FormData()
form.append('file', Bun.file(percorso), 'voce.oga')   // Bun.file è un Blob
form.append('response_format', 'json')
form.append('temperature', '0.0')

const r = await fetch('http://10.89.0.11:8080/inference', {
  method: 'POST',
  body: form,                       // il Content-Type multipart lo imposta fetch da solo
  signal: AbortSignal.timeout(60_000),
})
const { text } = await r.json()
```

**Pulizia del testo:** togli spazi in eccesso e i segnaposto che Whisper scrive quando non sente parole, tipo `[BLANK_AUDIO]` o `(musica)`: una regex per tutto quello tra quadre o tonde all'inizio o da solo. Se dopo la pulizia non resta niente: "Non ho sentito niente, riprova".

**Mostra sempre il testo capito** prima di agire. Se July ha capito "spegni la luce della camera" invece di "della cucina", lo vedi subito.

**Mentre lavora:** `ctx.replyWithChatAction('typing')` (o `'record_voice'`) così sai che sta elaborando.

## Passo 5 · Misura e scegli

Il *real-time factor* (RTF) è `tempo di trascrizione / durata dell'audio`. Con RTF 0,5 un vocale di 10 secondi richiede 5 secondi.

Scrivi `scripts/misura-whisper.ts`: per 3 vocali di prova (circa 3, 10 e 30 secondi) e per ciascun modello, trascrive 3 volte e stampa tempo medio, RTF e testo. Per passare da un modello all'altro ricrei il container cambiando `-m`.

Scegli `small` se l'RTF resta sotto 1 per i vocali di 10 secondi; altrimenti `base`. Scrivi il risultato nel README di July.

## Passo 6 · Una coda per i lavori pesanti

Whisper e Ollama girano sugli stessi due core. Se arrivano insieme un vocale e una domanda, si rallentano a vicenda e nessuno dei due finisce in tempi ragionevoli.

`core/pesante.ts`: una funzione `inCoda<T>(lavoro: () => Promise<T>): Promise<T>` che esegue un lavoro alla volta, nell'ordine di arrivo. La usano sia la trascrizione sia `askModel`. Un vocale seguito da un comando di casa diventa: trascrizione (5 s) → poi Qwen (8 s), invece di tutti e due lenti insieme.

> **Se ti blocchi:** tieni una variabile `ultima: Promise<unknown> = Promise.resolve()`. Ogni chiamata fa `const mia = ultima.then(lavoro, lavoro)`, poi `ultima = mia.catch(() => {})`, e restituisce `mia`. Il `.catch` serve perché un errore in un lavoro non blocchi tutti quelli dopo.

---

## Trappole

- **Lingua sbagliata:** senza `-l it` Whisper prova l'inglese e scrive cose senza senso.
- **Vocali lunghi:** un audio di 5 minuti blocca i core per minuti. Il limite di 60 secondi del passo 4 non è un dettaglio.
- **Privacy:** la trascrizione è locale, ma il **vocale stesso** passa dai server di Telegram, come ogni messaggio.

## Per andare oltre

- **July risponde a voce:** sintesi vocale locale con Piper (ha voci italiane), poi `ffmpeg -i risposta.wav -c:a libopus -b:a 32k risposta.ogg` e `ctx.replyWithVoice(new InputFile(percorso))`. Telegram mostra come "vocale" solo i file OGG con codec Opus. Il progetto Piper ha cambiato casa più volte: cerca la versione attuale prima di installarlo.
- **Parole tue:** whisper-server accetta un prompt iniziale, all'avvio con `--prompt` o a ogni richiesta con il campo `prompt` del form. Mettici i nomi delle tue stanze e dei tuoi dispositivi: migliora il riconoscimento dei nomi propri.

## Fonti

- ✔︎ whisper.cpp, modelli, Docker: https://github.com/ggml-org/whisper.cpp
- ✔︎ whisper-server, opzioni ed endpoint `/inference`: https://github.com/ggml-org/whisper.cpp/tree/master/examples/server
- grammY, file: https://grammy.dev/guide/files (da verificare)
- Bun, `fetch` e `FormData`: https://bun.sh/docs/api/fetch (da verificare)
