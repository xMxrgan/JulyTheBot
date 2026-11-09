# 09 · Watchdog del Pi

## Cosa fa

Oggi `/status` e `/disk` rispondono quando chiedi. Il watchdog controlla **da solo** e ti scrive quando qualcosa va storto, e anche quando torna a posto.

```
July:  ⚠️ CPU a 78 °C da 10 minuti (Jellyfin sta transcodificando?).
July:  ✅ Risolto: CPU a 61 °C.

July:  🔴 Il container immich_server si è riavviato 4 volte nell'ultima ora.
       Ultima uscita: memoria esaurita (OOMKilled).

July:  ⚠️ beets-import non gira da 40 minuti (dovrebbe ogni 5).

Tu:    /salute
July:  🟢 CPU 54 °C   ▃▃▄▅▇▅▄▃▃▃▂▂  (ultime 24 h)
       🟢 RAM libera 2,1 GB
       🟡 SSD 87% (sopra 85%)
       🟢 Alimentazione ok, nessun throttling
       🟢 12 container su 12 attivi
       🟢 Timer: beets 2 min fa, mnamer 3 min fa
       🟢 SSD SMART: ok, usura 3%
```

## Cosa impari

Leggere lo stato di Linux da file e comandi, decodificare campi a bit, macchine a stati con isteresi e durata minima, sottocampionamento dei dati, permessi `sudo` stretti per un solo comando, e come sorvegliare il sorvegliante.

## Prerequisiti

- Guida 00 parte A (`notify`, `scheduler`, `db`).
- Nessun hardware nuovo. È la guida giusta per cominciare.

---

## Architettura

```
scheduler (ogni minuto)
   │
   ├─ controllo temperatura ─┐
   ├─ controllo throttling  ─┤
   ├─ controllo disco       ─┤──► macchina a stati per controllo ──► notifica / risolto
   ├─ controllo container   ─┤          │
   ├─ controllo timer       ─┤          └──► storico (1 valore ogni 5 min) ──► /salute
   └─ controllo SMART       ─┘   (ogni ora)
```

```
funzioni/watchdog/
├── controlli/        un file per controllo
├── stato.ts          la macchina a stati
├── storico.ts        sottocampionamento + sparkline
├── comandi.ts        /salute
└── battito.ts        passo 7
```

---

## Passo 1 · L'interfaccia comune

```ts
type Livello = 'ok' | 'avviso' | 'critico'

interface Risultato {
  livello: Livello
  valore?: number          // per lo storico e i grafici
  testo: string            // "CPU a 78 °C"
}

interface Controllo {
  nome: string             // 'cpu-temp'
  ogniSecondi: number
  perAlmeno: Record<Exclude<Livello, 'ok'>, number>   // secondi prima di avvisare
  esegui: () => Promise<Risultato>
}
```

Ogni controllo è una funzione piccola che **non manda niente**: dice solo com'è la situazione. Chi decide se avvisare è il passo 3. Così ogni controllo si testa da solo.

## Passo 2 · I controlli

Ogni riga è un controllo. Leggi il comando, provalo a mano sul Pi, guarda l'output vero, poi scrivi il parser.

| Controllo | Da dove | Avviso | Critico |
| --- | --- | --- | --- |
| Temperatura CPU | file `/sys/class/thermal/thermal_zone0/temp` (millesimi di °C) | 75 °C | 82 °C |
| Throttling | `vcgencmd get_throttled` | qualsiasi bit "è successo" | bit "adesso" |
| Disco | `df -B1 --output=size,used /mnt/storage` | 85% | 95% |
| RAM | `/proc/meminfo`, riga `MemAvailable` | < 500 MB | < 200 MB |
| Container | `docker ps -a --format '{{json .}}'` + `docker inspect` | riavvii ripetuti | fermo, o `OOMKilled` |
| Timer | `systemctl show beets-import.service -p ExecMainExitTimestamp` | > 3× l'intervallo | > 6× |
| Servizi falliti | `systemctl --failed --no-legend` | — | almeno uno |
| SSD SMART | `smartctl -j -H -A /dev/sda` (passo 4) | usura > 80% | `passed: false` |

**Il throttling** è un numero esadecimale in cui ogni bit significa una cosa:

| Bit | Valore | Significato |
| --- | --- | --- |
| 0 | `0x1` | sottotensione **adesso** |
| 1 | `0x2` | frequenza limitata **adesso** |
| 2 | `0x4` | throttling **adesso** |
| 3 | `0x8` | limite di temperatura **adesso** |
| 16 | `0x10000` | sottotensione è successa dall'avvio |
| 17 | `0x20000` | frequenza limitata è successa |
| 18 | `0x40000` | throttling è successo |
| 19 | `0x80000` | limite di temperatura è successo |

Esempio: `throttled=0x50000` = bit 16 e 18 → "dall'ultimo avvio c'è stata sottotensione e throttling, ma adesso è tutto ok". Per leggerli: `parseInt('50000', 16) & 0x10000` è diverso da 0 se il bit 16 è acceso. Sottotensione quasi sempre significa alimentatore non adatto.

**Docker:** con `--format '{{json .}}'` ogni riga è un JSON: niente parsing di colonne. Per i riavvii e l'OOM: `docker inspect --format '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}}' nome`.

**Il timer:** il controllo funziona se sai ogni quanto deve girare. Scrivi gli intervalli attesi in una tabella nel codice (`beets-import: 5 min`, `mnamer-import: 5 min`).

**✅ Verifica.** Un comando admin `/controlli` che esegue tutti i controlli una volta e stampa i risultati grezzi.

## Passo 3 · Stati, isteresi e durata minima

Senza regole, una temperatura che oscilla tra 74 e 76 °C ti manderebbe un messaggio al minuto.

**Durata minima (`perAlmeno`).** Un controllo deve restare in `avviso` per, ad esempio, 10 minuti prima che parta la notifica. Un picco di un minuto non conta.

**Isteresi.** Si entra in `avviso` a 75 °C ma si torna `ok` solo sotto 70 °C. Due soglie, non una.

**Le transizioni.** Avvisa solo quando lo stato **confermato** cambia:

| Da → a | Cosa fa |
| --- | --- |
| ok → avviso | `notifica` gravità avviso |
| avviso → critico | `notifica` gravità critico (stessa chiave: sostituisce) |
| qualsiasi → ok | `risolto` |

Tieni per ogni controllo: stato confermato, stato candidato, da quando il candidato è vero. Lo stato vive in RAM; dopo un riavvio di July riparte da `ok` e ritrova i problemi in pochi minuti.

**✅ Verifica.** Test con una sequenza finta di valori: `[70, 76, 76, 74, 76, 76, 76 …]` con `perAlmeno` di 3 campioni deve dare **un** avviso, e `risolto` solo quando si scende sotto 70.

## Passo 4 · SMART dell'SSD

`smartctl` legge la "salute" dell'SSD, ma vuole i permessi di root. Non far girare July come root: concedi **solo quel comando, con quegli argomenti**.

```bash
sudo apt install -y smartmontools
```

Prima scopri come si chiama il disco e se serve l'opzione per gli adattatori USB:

```bash
lsblk -o NAME,SIZE,MODEL,TRAN && sudo smartctl -j -H -A /dev/sda | head -40
```

Se risponde con un errore sul tipo di dispositivo, prova `sudo smartctl -d sat -j -H -A /dev/sda`. Usa nella regola sudo il comando che ha funzionato:

```bash
echo 'morgan ALL=(root) NOPASSWD: /usr/sbin/smartctl -j -H -A /dev/sda' | sudo tee /etc/sudoers.d/july-smartctl && sudo chmod 440 /etc/sudoers.d/july-smartctl && sudo visudo -c
```

`visudo -c` controlla che il file sia scritto bene: un errore in sudoers può bloccare `sudo` per tutti. Deve dire che i file sono `parsed OK`.

Nel JSON cerca `smart_status.passed` e, per gli SSD NVMe, `nvme_smart_health_information_log.percentage_used` e `media_errors`. Per gli SSD SATA i campi dell'usura cambiano da marca a marca: guarda l'output del tuo.

Ogni ora basta: lo SMART cambia lentamente.

## Passo 5 · Storico leggero e sparkline

**Sottocampionamento.** I controlli girano ogni minuto, ma nel database salvi **un valore ogni 5 minuti** (la media) e tieni 30 giorni. Ogni notte cancelli i più vecchi. Sono 8.640 righe per controllo al mese: niente.

**Sparkline.** Un grafico in una riga di testo, senza librerie né immagini:

```ts
const BARRE = '▁▂▃▄▅▆▇█'
// per ogni valore v: indice = Math.round((v - min) / (max - min) * 7)
```

Per `/salute`, prendi le ultime 24 ore e raggruppale in 12 punti (uno ogni 2 ore). Se `max === min`, usa sempre la barra di mezzo.

## Passo 6 · Il comando `/salute` e il riassunto settimanale

`/salute`: una riga per controllo, con 🟢🟡🔴 e la sparkline dove ha senso, come nell'esempio in alto.

Ogni domenica sera, con lo scheduler: temperatura massima della settimana, spazio guadagnato o perso sull'SSD, quante volte si è riavviato ogni container, quanti avvisi ci sono stati.

## Passo 7 · Chi sorveglia il sorvegliante

Se July si blocca, non può avvisarti che si è bloccato. systemd lo fa ripartire se **termina**, ma non se resta acceso e bloccato.

1. **Il battito.** Ogni minuto July scrive l'ora corrente in `/run/july/battito`. `/run` sta in RAM: zero usura dell'SSD. Per avere la cartella con i permessi giusti, aggiungi al servizio:

    ```bash
    sudo systemctl edit july
    ```

    ```ini
    [Service]
    RuntimeDirectory=july
    ```

    systemd crea `/run/july` di proprietà di `morgan` a ogni avvio del servizio.

2. **Il controllo**, fuori da July: uno script e un timer systemd ogni 5 minuti. Se il file è più vecchio di 3 minuti, lo script riavvia July e ti manda un messaggio **direttamente con la Bot API**, con `curl`, leggendo token e il tuo ID dal `.env`. È l'unico caso in cui qualcosa che non è July scrive a nome del bot.

Scrivi script e timer da te: hai già due timer (beets e mnamer) come esempio. Ricordati `Nice=10` come gli altri.

**✅ Verifica.** `sudo systemctl kill -s STOP july` congela il processo senza fermarlo. Entro 8 minuti deve arrivarti il messaggio e July deve tornare a rispondere.

---

## Trappole

- **Comandi con testo dalla chat.** I controlli eseguono solo comandi fissi, come `admin.ts`. Nessun parametro viene mai dalla chat.
- **Avvisi a raffica al primo avvio:** se il disco è già all'87%, ricevi l'avviso subito. È giusto, ma una volta sola: per questo serve lo stato su `notify`.
- **Il controllo che fa danni:** `smartctl` ogni minuto su certi dischi USB impedisce lo spegnimento automatico. Ogni ora va bene.

## Per andare oltre

- **Previsioni:** con lo storico del disco, una regressione lineare sugli ultimi 30 giorni ti dice "a questo ritmo, SSD pieno tra 47 giorni".
- **Backup:** se il backup verso il secondo Pi scrive un file con data ed esito, un controllo in più: "ultimo backup riuscito più di 2 giorni fa".

## Fonti

- `vcgencmd get_throttled`: https://www.raspberrypi.com/documentation/computers/os.html#get_throttled (da verificare)
- smartmontools: https://www.smartmontools.org (da verificare)
- systemd, `RuntimeDirectory=`: https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html (da verificare)
- Docker, formati di output: https://docs.docker.com/engine/cli/formatting/ (da verificare)
