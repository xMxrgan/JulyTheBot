# 🧰 Manuale dei comandi di mCloud

**Tutti i comandi utili per gestire il server, ognuno con la sua spiegazione**

Questo è il tuo _runbook_: il manuale da aprire quando devi fare qualcosa sul Pi e non ti ricordi il comando, o quando vuoi capire cosa fa un comando prima di lanciarlo. Gli esempi usano i percorsi e i nomi veri del tuo server (`/mnt/storage`, `jellyfin`, `nextcloud-app`, `july-api`, `gitsuite`…), così molti comandi si possono incollare così come sono.

---

## Come leggere questo manuale

**Dove si lancia un comando.** Quando non è ovvio, l'intestazione o il testo lo dicono: 🍓 significa **sul Pi** (dopo `ssh mcloud`), 🍎 significa **sul Mac**, nel Terminale. Tutto il resto è sul Pi.

**I segnaposto.** Le parti tra `<` e `>` vanno sostituite, **parentesi comprese**. Per esempio `docker logs <nome-container>` diventa `docker logs jellyfin`.

**sudo.** Davanti a un comando, `sudo` lo esegue con i permessi di amministratore (root). Serve per toccare file di sistema, cartelle di altri utenti e servizi. Usalo solo quando serve: se un comando funziona senza `sudo`, non aggiungerlo "per sicurezza".

**Docker senza sudo.** Il tuo utente `morgan` è nel gruppo `docker`, quindi i comandi `docker` funzionano anche senza `sudo` (è così che hai avviato GitSuite). Nella guida dei libri li trovi con `sudo` davanti: funzionano in entrambi i modi.

**Prima di incollare dall'iPhone.** Tieni spenta la _punteggiatura smart_ (Impostazioni → Generali → Tastiera), altrimenti `"` diventa `“` e i comandi si rompono.

**Indice**

1. Connettersi e orientarsi
2. Leggere i file
3. Cercare: grep e find
4. Creare, copiare, spostare, rinominare, cancellare
5. Modificare il contenuto dei file
6. Permessi, proprietari e utenti
7. Dischi e spazio
8. Processi, risorse e salute del Pi
9. Rete e Tailscale
10. Servizi systemd, timer e log
11. Pacchetti, aggiornamenti, riavvio
12. Trucchi della shell
13. Docker
14. Nextcloud da riga di comando (occ)
15. Trasferire file tra Mac e Pi
16. Caricare un nuovo bot sul Pi
17. Backup
18. Kit di emergenza
19. Gli errori più comuni e cosa significano

Appendice: "Voglio fare X" → comando

---

## 1. Connettersi e orientarsi

### 1.1 Entrare e uscire dal Pi

🍎 Dal Mac ti colleghi con il nome breve `mcloud`, che hai già configurato:

```
ssh mcloud
```

🍎 Puoi anche lanciare **un solo comando** sul Pi senza entrarci, scrivendolo tra virgolette dopo il nome. Il risultato arriva sul Mac:

```
ssh mcloud "df -h /mnt/storage"
```

Per uscire dal Pi e tornare al terminale di prima:

```
exit
```

**Come funziona il nome breve.** Sul Mac, il file `~/.ssh/config` contiene un blocco come questo, che associa il nome `mcloud` all'indirizzo e all'utente:

```
Host mcloud
    HostName mcloud.tail1b8ce0.ts.net
    User morgan
```

🍎 Per non dover scrivere la password a ogni accesso, copia una volta sola la tua chiave SSH sul Pi:

```
ssh-copy-id mcloud
```

### 1.2 tmux: sessioni che sopravvivono alle disconnessioni

Se la connessione SSH cade ("Connection reset by peer"), tutto ciò che stava girando muore con lei. Dentro **tmux** invece i comandi continuano sul Pi e tu puoi rientrare dopo.

Il comando più comodo, da usare sempre appena entri: **entra nella sessione `main` se esiste, altrimenti la crea** (`-A` = "attach se c'è già"):

```
tmux new -A -s main
```

| Azione                                   | Come                                      |
| ---------------------------------------- | ----------------------------------------- |
| Uscire lasciando tutto attivo (_detach_) | `Ctrl+b`, rilascia, poi `d`               |
| Elencare le sessioni aperte              | `tmux ls`                                 |
| Rientrare in una sessione                | `tmux attach -t main`                     |
| Aprire una nuova "finestra" dentro tmux  | `Ctrl+b`, poi `c`                         |
| Passare alla finestra successiva         | `Ctrl+b`, poi `n`                         |
| Scorrere verso l'alto l'output           | `Ctrl+b`, poi `[`, frecce; `q` per uscire |
| Chiudere davvero la sessione             | scrivi `exit` dentro tmux                 |

### 1.3 Dove sono? Cosa c'è qui?

`pwd` (_print working directory_) stampa la cartella in cui ti trovi:

```
pwd
```

`cd` (_change directory_) cambia cartella:

```
cd /mnt/storage/apps
```

Le scorciatoie di `cd`: `cd ~` (oppure solo `cd`) ti porta nella tua cartella home, `/home/morgan`; `cd ..` sale di un livello; `cd -` torna alla cartella in cui eri prima.

`ls` elenca il contenuto di una cartella. Con le opzioni `-l` (formato lungo), `-a` (anche i file nascosti, quelli che iniziano con `.`) e `-h` (dimensioni leggibili: K, M, G):

```
ls -lah /mnt/storage/shared
```

**Come si legge una riga di `ls -l`:**

```
drwxrwxr-x+ 5 morgan morgan 4.0K Nov 14 18:00 movies
│└──┬────┘│ │ └─┬──┘ └─┬──┘ └┬─┘ └────┬─────┘ └─┬──┘
│   │     │ │   │      │     │        │         └ nome
│   │     │ │   │      │     │        └ data dell'ultima modifica
│   │     │ │   │      │     └ dimensione
│   │     │ │   │      └ gruppo
│   │     │ │   └ proprietario
│   │     │ └ numero di collegamenti (puoi ignorarlo)
│   │     └ il "+" indica che ci sono ACL (permessi extra, sezione 6)
│   └ permessi (sezione 6)
└ tipo: d = cartella, - = file, l = collegamento
```

Altre varianti utili. Ordinare per data, i più recenti in alto:

```
ls -lt /mnt/storage/apps/_archive
```

Ordinare per dimensione, i più grandi in alto:

```
ls -lhS /mnt/storage/shared/movies_inbox
```

`tree` mostra una cartella come un albero. Non è installato di serie: si aggiunge una volta sola:

```
sudo apt install -y tree
```

Poi, per vedere due livelli di profondità:

```
tree -L 2 /mnt/storage/apps
```

### 1.4 La cronologia dei comandi

Freccia **su** e **giù** scorrono i comandi già usati. `Ctrl+R` cerca nella cronologia mentre scrivi: premilo, scrivi un pezzo del comando (ad esempio `compose`) e premi di nuovo `Ctrl+R` per i risultati più vecchi; Invio lo esegue, le frecce lo portano sulla riga per modificarlo.

Per vedere la cronologia filtrata:

```
history | grep docker
```

**Questo è il momento giusto per usare Atuin.** Atuin sostituisce `Ctrl+R` con una ricerca a schermo intero, ricorda per ogni comando in che cartella l'hai lanciato e se è andato a buon fine, e può sincronizzare la cronologia tra Mac e Pi. Per un server su cui lavori a sessioni spezzate dall'iPhone è proprio lo scenario in cui rende di più. Si installa con lo script ufficiale:

```
curl --proto '=https' --tlsv1.2 -LsSf https://setup.atuin.sh | sh
```

Poi chiudi e riapri la connessione SSH: da quel momento `Ctrl+R` apre Atuin.

---

## 2. Leggere i file

### 2.1 cat: stampare tutto il file

Va bene per file corti:

```
cat /etc/systemd/system/audiobooks-import.timer
```

`cat -A` mostra anche i caratteri invisibili: `$` a fine riga, `^I` dove c'è un Tab. È il modo per scoprire perché un file YAML non funziona (i Tab sono vietati) o se è entrata una virgoletta "smart":

```
cat -A /mnt/storage/apps/audiobookshelf/compose.yml
```

`cat -n` numera le righe:

```
cat -n /mnt/storage/apps/mnamer/run.sh
```

### 2.2 less: sfogliare file lunghi

```
less /mnt/storage/apps/mnamer/import.log
```

| Tasto               | Cosa fa                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `Spazio` / `b`      | pagina giù / pagina su                                               |
| `g` / `G`           | inizio / fine del file                                               |
| `/parola` poi Invio | cerca "parola" in avanti; `n` va al risultato successivo             |
| `?parola`           | cerca all'indietro                                                   |
| `F`                 | segue il file in tempo reale (come `tail -f`); `Ctrl+C` per smettere |
| `q`                 | esce                                                                 |

### 2.3 head e tail: l'inizio e la fine

Le prime 20 righe:

```
head -n 20 /mnt/storage/apps/beets/config.yaml
```

Le ultime 50 righe (perfetto per i log, dove le righe nuove sono in fondo):

```
tail -n 50 /mnt/storage/apps/mnamer/import.log
```

**Seguire un log in tempo reale** (`-f` = _follow_): le righe nuove compaiono man mano che vengono scritte. `Ctrl+C` per uscire:

```
tail -f /mnt/storage/apps/audiobooks-import/import.log
```

### 2.4 Informazioni su un file

`wc -l` conta le righe (`wc` = _word count_):

```
wc -l /mnt/storage/apps/mnamer/import.log
```

`stat` mostra dimensione, proprietario, permessi e le date di accesso e di modifica:

```
stat /mnt/storage/apps/mnamer/run.sh
```

`file` dice di che tipo è davvero un file, qualunque sia l'estensione:

```
file /mnt/storage/apps/mnamer/run.sh
```

---

## 3. Cercare: grep e find

Due strumenti diversi: **grep cerca testo dentro i file**, **find cerca file e cartelle** in base a nome, dimensione, data.

### 3.1 grep: cercare testo

La forma base è `grep "testo" file`. Stampa ogni riga che contiene il testo:

```
grep "Importato" /mnt/storage/apps/audiobooks-import/import.log
```

Le opzioni che userai di più:

| Opzione                  | Significato                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- | --------- |
| `-i`                     | ignora maiuscole e minuscole                                                  |
| `-n`                     | mostra il numero di riga                                                      |
| `-r`                     | cerca in tutti i file di una cartella e delle sottocartelle                   |
| `-v`                     | mostra le righe che **non** contengono il testo                               |
| `-c`                     | conta le righe trovate invece di mostrarle                                    |
| `-l`                     | mostra solo i nomi dei file che contengono il testo                           |
| `-w`                     | solo parole intere (`-w cat` non trova "catalogo")                            |
| `-E`                     | espressioni regolari estese, per esempio `"errore\|fallito"` diventa `"errore | fallito"` |
| `-A 3` / `-B 3` / `-C 3` | mostra anche 3 righe dopo / prima / intorno a ogni risultato                  |
| `-o`                     | stampa solo la parte che corrisponde, non tutta la riga                       |
| `-q`                     | silenzioso: non stampa nulla, serve solo a sapere se c'è (negli script)       |

Esempi pratici sul tuo server.

Tutti gli errori in un log, senza badare a maiuscole e minuscole, con il numero di riga:

```
grep -in "errore" /mnt/storage/apps/audiobooks-import/import.log
```

Righe con "error" **oppure** "fail":

```
grep -iE "error|fail" /mnt/storage/apps/mnamer/import.log
```

Gli orari di **tutti** i tuoi timer in un colpo solo:

```
grep -n "OnCalendar" /etc/systemd/system/*.timer
```

Dove compare una variabile in tutto il progetto GitSuite, escludendo `node_modules`:

```
grep -rn "PUBLIC_URL" ~/gitsuite --exclude-dir=node_modules
```

Un file di configurazione senza commenti e senza righe vuote. Il primo `grep -v` toglie le righe che iniziano con `#` (anche dopo spazi), il secondo toglie le righe vuote. La barra verticale `|` passa l'output del primo comando al secondo (sezione 12):

```
grep -v '^\s*#' /mnt/storage/apps/beets/config.yaml | grep -v '^\s*$'
```

Quanti audiolibri sono stati importati finora:

```
grep -c "Importato" /mnt/storage/apps/audiobooks-import/import.log
```

**Mini guida alle espressioni regolari.** `^` è l'inizio riga, `$` la fine riga, `.` un carattere qualsiasi, `.*` "qualsiasi cosa", `\s` uno spazio o un Tab, `[0-9]` una cifra, `|` "oppure" (con `-E`). Quindi `'^\s*#'` significa "righe che iniziano con zero o più spazi seguiti da `#`".

### 3.2 find: cercare file e cartelle

La forma è sempre: `find <dove> <condizioni> <azione>`.

Per nome (`-name` distingue maiuscole e minuscole, `-iname` no; le virgolette sono obbligatorie quando usi `*`):

```
find /mnt/storage/shared/movies -iname "*.mkv"
```

Solo file (`-type f`) oppure solo cartelle (`-type d`):

```
find /mnt/storage/apps -maxdepth 1 -type d
```

`-maxdepth 1` limita la ricerca al primo livello, senza scendere nelle sottocartelle.

Per dimensione, qui file più grandi di 4 GB. `-exec ls -lh {} \;` esegue `ls -lh` su ogni risultato, al posto di `{}`, per vederne la dimensione:

```
find /mnt/storage/shared -type f -size +4G -exec ls -lh {} \;
```

Per data: modificati negli ultimi 60 minuti (`-mmin -60`) oppure negli ultimi 7 giorni (`-mtime -7`):

```
find /mnt/storage/shared/movies -mmin -60
```

File vuoti, da 0 byte (ti è successo con i problemi del disco):

```
find /mnt/storage/shared/music -type f -empty
```

Contare i risultati, collegando `find` a `wc -l`:

```
find /mnt/storage/shared/music -type f -iname "*.flac" | wc -l
```

**find e la cancellazione.** `find` ha un'azione `-delete` che cancella tutto ciò che trova. **Regola d'oro: lancia sempre prima lo stesso comando senza `-delete`**, leggi l'elenco, e solo se è esattamente ciò che vuoi aggiungi `-delete` in fondo. Esempio, per i file vuoti: prima

```
find /mnt/storage/shared/music -type f -empty
```

e poi, solo dopo aver controllato l'elenco:

```
find /mnt/storage/shared/music -type f -empty -delete
```

### 3.3 Dove si trova un programma?

`command -v` dice se un comando esiste e dove sta. Se non stampa nulla, il programma non è installato:

```
command -v ffprobe
```

---

## 4. Creare, copiare, spostare, rinominare, cancellare

### 4.1 Creare cartelle e file

`mkdir -p` crea una cartella e, se servono, anche quelle che la contengono. Se esiste già non dà errore:

```
mkdir -p /mnt/storage/apps/nuovo-servizio/config
```

Le parentesi graffe creano più cartelle in un colpo solo (si chiama _brace expansion_). Questo crea `src`, `test` e `docs` dentro `progetto`:

```
mkdir -p ~/progetto/{src,test,docs}
```

`touch` crea un file vuoto, oppure aggiorna la data di un file esistente:

```
touch ~/note.txt
```

### 4.2 Copiare

`cp origine destinazione` copia un file:

```
cp ~/note.txt ~/note-copia.txt
```

Per copiare una cartella con tutto il contenuto usa `cp -a` (_archive_): copia anche le sottocartelle e conserva permessi, proprietari e date. È quasi sempre meglio di `cp -r`, che invece li perde:

```
sudo cp -a /mnt/storage/apps/beets /mnt/storage/apps/_archive/beets-$(date +%Y%m%d)
```

`$(date +%Y%m%d)` viene sostituito dalla data di oggi, ad esempio `20261114`: è il modo standard per dare un nome unico ai backup.

**Il backup prima di modificare.** Prima di toccare un file importante, copialo nell'archivio con data e ora:

```
sudo cp -a /mnt/storage/apps/mnamer/run.sh /mnt/storage/apps/_archive/mnamer-run.sh.$(date +%Y%m%d-%H%M).bak
```

### 4.3 Spostare e rinominare

`mv` fa entrambe le cose: rinominare è spostare un file nella stessa cartella con un nome diverso.

Rinominare:

```
mv ~/note.txt ~/appunti.txt
```

Spostare in un'altra cartella (la `/` finale indica "dentro questa cartella"):

```
mv ~/appunti.txt /mnt/storage/apps/_archive/
```

`mv -n` non sovrascrive mai un file che esiste già alla destinazione: più sicuro.

```
mv -n ~/appunti.txt /mnt/storage/apps/_archive/
```

**Spostare è istantaneo… a volte.** Se origine e destinazione sono sullo stesso disco, `mv` cambia solo il "percorso" e non copia nulla, quindi è istantaneo anche per un film da 30 GB. Se invece sono su dischi diversi (per esempio dalla microSD a `/mnt/storage`), `mv` deve copiare tutto e poi cancellare l'originale. È lo stesso motivo per cui mnamer era lento con i volumi separati: nel container erano "dischi diversi".

### 4.4 Cancellare

**Attenzione: sulla riga di comando non c'è il cestino. Ciò che cancelli sparisce.** Per la tua regola, sul server la cosa giusta di solito è **archiviare** invece di cancellare:

```
mv /mnt/storage/apps/vecchio-servizio /mnt/storage/apps/_archive/
```

Quando invece vuoi davvero cancellare:

`rm` cancella un file:

```
rm ~/appunti.txt
```

`rm -i` chiede conferma per ogni file: utile quando usi `*`.

```
rm -i ~/*.txt
```

`rmdir` cancella una cartella solo se è vuota (e quindi non può fare danni):

```
rmdir ~/progetto/docs
```

`rm -r` cancella una cartella con tutto il contenuto; con `-f` non chiede niente nemmeno sui file protetti. È il comando più pericoloso di questo manuale.

```
rm -rf ~/progetto
```

**Tre regole per non pentirsene.** Prima di un `rm` con `*`, lancia `ls` con lo stesso percorso e controlla l'elenco (`ls ~/*.txt`, poi `rm ~/*.txt`). Metti **sempre** il percorso tra virgolette se contiene spazi o variabili: `rm -rf "$CARTELLA/"` con `CARTELLA` vuota diventerebbe `rm -rf /`. Non lanciare mai `rm -rf` con `sudo` su un percorso che non hai controllato due volte.

### 4.5 Collegamenti

Un collegamento simbolico (_symlink_) è un "alias": un file che punta a un altro. Utile per raggiungere velocemente cartelle profonde:

```
ln -s /mnt/storage/apps ~/apps
```

Da quel momento `cd ~/apps` ti porta in `/mnt/storage/apps`. Cancellare il collegamento (`rm ~/apps`) non cancella la cartella vera.

### 4.6 Archivi compressi

Creare un archivio `.tar.gz` di una cartella (`c` = crea, `z` = comprimi, `f` = nome del file):

```
tar czf ~/beets-config-$(date +%F).tar.gz -C /mnt/storage/apps beets
```

`-C /mnt/storage/apps beets` significa "entra in `/mnt/storage/apps` e archivia la cartella `beets`", così nell'archivio non finisce tutto il percorso.

Vedere cosa c'è dentro senza estrarre (`t` = elenca):

```
tar tzf ~/beets-config-2026-11-14.tar.gz | head
```

Estrarre in una cartella precisa (`x` = estrai):

```
mkdir -p ~/estratto && tar xzf ~/beets-config-2026-11-14.tar.gz -C ~/estratto
```

Per i file `.zip` serve `unzip`, che si installa una volta:

```
sudo apt install -y unzip zip
```

```
unzip archivio.zip -d ~/estratto
```

---

## 5. Modificare il contenuto dei file

### 5.1 nano: l'editor più semplice

```
sudo nano /mnt/storage/apps/audiobookshelf/compose.yml
```

`nano -l` mostra anche i numeri di riga, comodo quando un errore dice "line 12":

```
sudo nano -l /mnt/storage/apps/audiobookshelf/compose.yml
```

| Tasti               | Cosa fa                                                   |
| ------------------- | --------------------------------------------------------- |
| `Ctrl+O`, poi Invio | salva                                                     |
| `Ctrl+X`            | esce (se ci sono modifiche, chiede se salvare: `Y` o `N`) |
| `Ctrl+W`            | cerca                                                     |
| `Ctrl+K`            | taglia la riga intera                                     |
| `Ctrl+U`            | incolla la riga tagliata                                  |
| `Alt+U`             | annulla                                                   |
| `Ctrl+_`            | vai alla riga numero…                                     |

Dall'iPhone il tasto `Ctrl` dipende dall'app di terminale: di solito c'è una barra di tasti extra sopra la tastiera.

### 5.2 Scrivere un file intero da un comando (heredoc)

È il metodo che usiamo sempre per i compose e gli script: tutto il testo tra la prima riga e `EOF` finisce nel file. Sostituisce l'intero contenuto.

```
sudo tee /mnt/storage/apps/prova/nota.txt > /dev/null <<'EOF'
Prima riga
Seconda riga con un $SIMBOLO che resta così com'è
EOF
```

Pezzo per pezzo: `tee FILE` scrive nel file quello che riceve; `sudo` serve se la cartella non è tua; `> /dev/null` evita di ristampare il testo a schermo; `<<'EOF'` apre il blocco di testo e le **virgolette singole** intorno a `EOF` impediscono alla shell di interpretare `$` e altri simboli. La riga finale deve contenere **solo** `EOF`, senza spazi.

### 5.3 Aggiungere righe in fondo a un file

Se il file è tuo, basta `>>` (due frecce aggiungono, una sola sovrascrive: vedi 12.2):

```
echo "nuova riga" >> ~/appunti.txt
```

Se il file richiede `sudo`, **`sudo echo "x" >> file` non funziona**: il `>>` lo esegue la tua shell, non sudo, e quindi senza permessi. Si usa `tee -a` (`-a` = _append_, aggiungi):

```
echo "nuova riga" | sudo tee -a /mnt/storage/apps/prova/nota.txt
```

### 5.4 sed: modificare senza aprire il file

`sed` è un "trova e sostituisci" da riga di comando. **Prima prova sempre senza `-i`**: il risultato viene solo stampato a schermo e il file non viene toccato.

```
sed 's/retries: 5/retries: 10/' ~/gitsuite/docker-compose.yml | grep retries
```

Se il risultato è giusto, applica la modifica con `-i` (_in place_). Scrivendo `-i.bak`, sed salva prima una copia dell'originale con estensione `.bak`:

```
sed -i.bak 's/retries: 5/retries: 10/' ~/gitsuite/docker-compose.yml
```

Come si legge `s/vecchio/nuovo/g`: `s` = sostituisci, poi il testo da cercare, poi il testo nuovo; la `g` finale vuol dire "tutte le volte che compare nella riga", senza `g` solo la prima. Quando il testo contiene delle `/` (come i percorsi), puoi usare un altro separatore, ad esempio `|`:

```
sed 's|/mnt/vecchio|/mnt/storage/nuovo|g' ~/file.conf
```

Altri usi di sed. Stampare solo le righe da 10 a 20:

```
sed -n '10,20p' /mnt/storage/apps/mnamer/run.sh
```

Cancellare tutte le righe che contengono un testo (anche qui, prova prima senza `-i`):

```
sed '/user: "1000:1000"/d' /mnt/storage/apps/audiobookshelf/compose.yml
```

### 5.5 diff: cosa è cambiato tra due file

Confronta il file attuale con il backup. `-u` mostra le differenze nel formato classico: le righe con `-` sono state tolte, quelle con `+` aggiunte:

```
diff -u ~/gitsuite/docker-compose.yml.bak ~/gitsuite/docker-compose.yml
```

Se non stampa nulla, i file sono identici.

---

## 6. Permessi, proprietari e utenti

### 6.1 Come si leggono i permessi

```
-rwxr-xr--
│└┬┘└┬┘└┬┘
│ │  │  └── altri (tutti gli altri utenti): r-- = solo lettura
│ │  └───── gruppo:                        r-x = lettura ed esecuzione
│ └──────── proprietario:                  rwx = lettura, scrittura, esecuzione
└────────── tipo (- file, d cartella)
```

`r` (_read_) = leggere. `w` (_write_) = modificare. `x` (_execute_) = eseguire, per un file; per una **cartella** `x` significa "poterci entrare", e senza di essa non puoi aprirla nemmeno se hai `r`.

I permessi si scrivono spesso anche come numeri: `r` vale 4, `w` vale 2, `x` vale 1, e si sommano per ognuno dei tre gruppi. Quindi `7` = `rwx`, `6` = `rw-`, `5` = `r-x`, `4` = `r--`, `0` = `---`.

| Numero | Significa   | Uso tipico                        |
| ------ | ----------- | --------------------------------- |
| `755`  | rwx r-x r-x | cartelle e script eseguibili      |
| `644`  | rw- r-- r-- | file normali                      |
| `600`  | rw- --- --- | file segreti (`.env` con i token) |

### 6.2 chmod: cambiare i permessi

Rendere eseguibile uno script:

```
chmod +x /mnt/storage/apps/audiobooks-import/run.sh
```

Proteggere un file con dei segreti, leggibile solo da te:

```
chmod 600 ~/gitsuite/.env
```

Impostare con i numeri:

```
chmod 755 ~/script.sh
```

### 6.3 chown: cambiare il proprietario

Formato `proprietario:gruppo`. Con `-R` vale per tutta la cartella e il suo contenuto:

```
sudo chown -R morgan:morgan /mnt/storage/apps/nuovo-servizio
```

Puoi usare i numeri al posto dei nomi, utile con i container (vedi la guida dei libri, 0.5):

```
sudo chown -R 1000:1000 /mnt/storage/apps/nuovo-servizio
```

### 6.4 ACL: permessi per utenti specifici

Le ACL servono quando più utenti diversi devono scrivere nella stessa cartella, come Nextcloud (33) e i tuoi servizi (1000).

Vedere le ACL di una cartella:

```
getfacl /mnt/storage/shared/movies_inbox
```

Dare lettura e scrittura a 33 e 1000, adesso (`u:`) e per i file futuri (`d:u:`), su tutta la cartella:

```
sudo setfacl -R -m u:33:rwX,u:1000:rwX,d:u:33:rwX,d:u:1000:rwX /mnt/storage/shared/movies_inbox
```

Togliere tutte le ACL da una cartella (torna ai soli permessi classici; usalo con cautela):

```
sudo setfacl -R -b /mnt/storage/shared/cartella-di-prova
```

### 6.5 Il comando per capire un "Permission denied"

Quando un servizio non riesce ad aprire un file, il problema spesso non è il file ma una delle cartelle lungo il percorso. `namei -l` mostra i permessi di **ogni** cartella del percorso, dalla radice al file:

```
namei -l /mnt/storage/shared/movies/Inception\ \(2010\)
```

(Le `\` prima di spazi e parentesi le "neutralizzano"; in alternativa metti tutto il percorso tra virgolette.)

Per verificare se un certo utente può scrivere in una cartella, prova come se fossi lui con `sudo -u`. `test -w` controlla il permesso di scrittura senza scrivere niente:

```
sudo -u www-data test -w /mnt/storage/shared/movies_inbox && echo "Nextcloud può scrivere" || echo "Nextcloud NON può scrivere"
```

### 6.6 Chi sono? Utenti e gruppi

Il tuo nome utente:

```
whoami
```

Il tuo numero utente e i gruppi a cui appartieni:

```
id
```

Aggiungere un utente a un gruppo (qui `morgan` al gruppo `docker`). `-aG` vuol dire "aggiungi a questo gruppo", **senza la `a` toglieresti tutti gli altri gruppi**. L'effetto arriva al prossimo accesso SSH:

```
sudo usermod -aG docker morgan
```

Cambiare la tua password:

```
passwd
```

---

## 7. Dischi e spazio

### 7.1 Quanto spazio libero c'è

`df -h` mostra lo spazio di ogni disco montato. Guarda le colonne `Avail` (libero) e `Use%` (percentuale usata):

```
df -h
```

Solo i due dischi che ti interessano, la microSD (`/`) e il disco dati:

```
df -h / /mnt/storage
```

### 7.2 Cosa occupa spazio

`du -sh` dice quanto pesa una cartella (`-s` = solo il totale, `-h` = leggibile):

```
du -sh /mnt/storage/shared/movies
```

Il peso di ogni elemento dentro una cartella, ordinato dal più piccolo al più grande (`sort -h` sa ordinare "2G", "500M"…). Le cose grosse finiscono in fondo, cioè sotto i tuoi occhi:

```
sudo du -sh /mnt/storage/shared/* | sort -h
```

Lo stesso, un livello sotto `/mnt/storage`:

```
sudo du -h --max-depth=1 /mnt/storage | sort -h
```

**ncdu** fa la stessa cosa in modo interattivo: navighi tra le cartelle con le frecce e vedi subito cosa pesa. Si installa una volta:

```
sudo apt install -y ncdu
```

```
sudo ncdu /mnt/storage
```

Dentro ncdu: frecce per muoverti, Invio per entrare, `q` per uscire. Ha anche il tasto `d` per cancellare: evitalo, archivia invece.

### 7.3 I dischi collegati

`lsblk -f` elenca i dischi e le loro partizioni, con tipo di filesystem, etichetta e dove sono montati:

```
lsblk -f
```

`findmnt` dice da quale disco viene una cartella montata e con quali opzioni:

```
findmnt /mnt/storage
```

### 7.4 Problemi del disco

Il kernel scrive i problemi hardware in un registro chiamato `dmesg`. È il primo posto da guardare se il disco USB si disconnette (ti è già successo con il disco SMR). `-T` mostra date leggibili:

```
sudo dmesg -T | grep -iE "usb|sda|i/o error|reset" | tail -n 30
```

Se vedi righe con `I/O error`, `reset high-speed USB device` o `Remounting filesystem read-only`, il disco ha avuto problemi.

La salute del disco (SMART). Si installa una volta:

```
sudo apt install -y smartmontools
```

`-H` dà il verdetto sintetico. `-d sat` serve spesso con i dischi collegati via USB:

```
sudo smartctl -d sat -H /dev/sda
```

**Cosa dovresti vedere:** `SMART overall-health self-assessment test result: PASSED`. Per il rapporto completo usa `-a` al posto di `-H`.

---

## 8. Processi, risorse e salute del Pi

### 8.1 Una panoramica veloce

Da quanto tempo è acceso il Pi e il carico medio (gli ultimi tre numeri: carico dell'ultimo minuto, degli ultimi 5 e degli ultimi 15; sul Pi 5, che ha 4 core, sotto 4 va bene):

```
uptime
```

La memoria RAM. Guarda la colonna `available`, non `free`: Linux usa la RAM libera come cache e la restituisce quando serve:

```
free -h
```

### 8.2 htop: il "Monitoraggio attività" del Pi

```
htop
```

In alto vedi CPU, memoria e swap; sotto, i processi. `F6` sceglie per cosa ordinare (CPU%, MEM%), `F4` filtra per nome, `F9` invia un segnale per terminare un processo, `q` esce. Se manca: `sudo apt install -y htop`.

### 8.3 Trovare e fermare un processo

`ps aux` elenca tutti i processi. Qui ordinati per memoria usata, i primi 10:

```
ps aux --sort=-%mem | head -n 10
```

Cercare un processo per nome. Il trucco `[b]eet` evita che nei risultati compaia il `grep` stesso:

```
ps aux | grep "[b]eet"
```

Fermare un processo con il suo numero (PID, la seconda colonna di `ps aux`). `kill` chiede gentilmente di chiudersi:

```
kill <PID>
```

Se dopo qualche secondo è ancora lì, `kill -9` lo forza. È l'ultima risorsa: il processo non ha modo di salvare niente.

```
kill -9 <PID>
```

`pkill -f` ferma i processi per nome invece che per numero:

```
pkill -f "beet import"
```

**I container non si fermano così.** Per un servizio in Docker usa sempre i comandi Docker (sezione 13), altrimenti Docker lo fa ripartire o lo lascia in uno stato strano.

### 8.4 Temperatura e alimentazione (comandi del Raspberry Pi)

La temperatura della CPU. Sotto i 70 °C va benissimo; sopra gli 80 °C il Pi rallenta per proteggersi:

```
vcgencmd measure_temp
```

Se il Pi ha avuto problemi di alimentazione o di calore:

```
vcgencmd get_throttled
```

**Cosa dovresti vedere:** `throttled=0x0`, che vuol dire nessun problema, né ora né dall'ultimo avvio. Qualsiasi altro valore indica tensione troppo bassa o rallentamenti per il calore: controlla l'alimentatore (per il Pi 5 serve quello ufficiale da 27 W, soprattutto con un disco USB) e la ventilazione.

---

## 9. Rete e Tailscale

### 9.1 Indirizzi e connessione

Gli indirizzi IP del Pi, in forma compatta (`-br` = _brief_):

```
ip -br a
```

Vedrai `eth0` o `wlan0` (rete di casa) e `tailscale0` (l'indirizzo `100.x.x.x` di Tailscale).

C'è internet? `ping` manda 4 pacchetti a un server e misura la risposta. Il primo usa un indirizzo IP, il secondo un nome: se il primo funziona e il secondo no, il problema è il DNS.

```
ping -c 4 1.1.1.1
```

```
ping -c 4 google.com
```

### 9.2 Quali porte sono aperte e da chi

`ss -tlnp` elenca i programmi in ascolto sulle porte TCP (`-t` TCP, `-l` in ascolto, `-n` numeri invece di nomi, `-p` mostra il programma; per quest'ultimo serve `sudo`):

```
sudo ss -tlnp
```

Chi usa una porta precisa, per esempio la 8096 di Jellyfin:

```
sudo ss -tlnp | grep ":8096 "
```

### 9.3 Un servizio risponde?

`curl` fa una richiesta web dal Pi stesso. `-s` = silenzioso, `-I` = solo l'intestazione della risposta; `head -n 1` tiene la prima riga, quella con il codice:

```
curl -sI http://localhost:8096 | head -n 1
```

`HTTP/1.1 200 OK` o `302` = il servizio risponde. Nessun output = il servizio non è in ascolto su quella porta.

L'indirizzo IP pubblico della tua connessione di casa:

```
curl -s ifconfig.me && echo
```

### 9.4 Tailscale

I dispositivi della tua rete Tailscale e se sono online:

```
tailscale status
```

L'indirizzo Tailscale del Pi:

```
tailscale ip -4
```

Verificare che un altro dispositivo sia raggiungibile attraverso Tailscale (sostituisci con il nome che vedi in `tailscale status`):

```
tailscale ping <nome-dispositivo>
```

La diagnosi della connessione (NAT, server di relay usati, latenze):

```
tailscale netcheck
```

Cosa stai esponendo con Serve (solo dentro la tua rete Tailscale) e con Funnel (pubblico su internet):

```
tailscale serve status && tailscale funnel status
```

Se Tailscale si comporta in modo strano, riavvia il suo servizio:

```
sudo systemctl restart tailscaled
```

---

## 10. Servizi systemd, timer e log

### 10.1 Controllare i servizi

`systemctl` comanda systemd, il "direttore d'orchestra" che avvia e sorveglia i servizi del Pi.

Lo stato di un servizio o di un timer (attivo? da quando? ultime righe di log):

```
systemctl status mnamer-import.timer --no-pager
```

`--no-pager` stampa tutto e restituisce subito il terminale, invece di aprire una vista da cui devi uscire con `q`.

Tutti i timer, con l'orario della prossima e dell'ultima esecuzione:

```
systemctl list-timers --no-pager
```

I servizi che hanno avuto un errore. Se non ce ne sono, stampa `0 loaded units listed`:

```
systemctl --failed --no-pager
```

Il contenuto del file di un servizio, senza dover cercare dove sta:

```
systemctl cat audiobooks-import.service
```

### 10.2 Comandare i servizi

| Comando                               | Cosa fa                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `sudo systemctl start <nome>`         | avvia adesso (per un `.service` di import: esegue subito un giro) |
| `sudo systemctl stop <nome>`          | ferma adesso                                                      |
| `sudo systemctl restart <nome>`       | ferma e riavvia                                                   |
| `sudo systemctl enable --now <nome>`  | attiva adesso **e** a ogni accensione del Pi                      |
| `sudo systemctl disable --now <nome>` | disattiva adesso e a ogni accensione                              |
| `sudo systemctl daemon-reload`        | rilegge i file dei servizi dopo che li hai modificati             |

Esempio: lanciare subito un import dei film senza aspettare il timer, poi vedere com'è andata:

```
sudo systemctl start mnamer-import.service && journalctl -u mnamer-import.service -n 20 --no-pager
```

Esempio: sospendere l'import della musica (per una manutenzione) e poi riattivarlo. Per scoprire il nome esatto del timer di beets, guarda `systemctl list-timers --no-pager`.

```
sudo systemctl stop <timer-di-beets>.timer
```

```
sudo systemctl start <timer-di-beets>.timer
```

**Dopo aver modificato un file `.service` o `.timer`**, systemd non se ne accorge da solo:

```
sudo systemctl daemon-reload && sudo systemctl restart audiobooks-import.timer && systemctl list-timers audiobooks-import.timer --no-pager
```

**Attenzione a `sudo systemctl restart docker`**: riavvia Docker e con lui **tutti** i container. Usalo solo se Docker stesso è bloccato.

### 10.3 Leggere i log di systemd (journalctl)

Tutto ciò che i servizi stampano finisce nel _journal_. Le ultime 50 righe di un servizio:

```
journalctl -u mnamer-import.service -n 50 --no-pager
```

Seguire in tempo reale (`Ctrl+C` per uscire):

```
journalctl -u audiobooks-import.service -f
```

Da un certo momento in poi. Accetta forme come `"today"`, `"1 hour ago"`, `"2026-11-14 10:00"`:

```
journalctl -u mnamer-import.service --since "1 hour ago" --no-pager
```

Solo gli errori dall'ultimo avvio del Pi (`-p err` = priorità "errore" o peggio, `-b` = da questo avvio):

```
journalctl -p err -b --no-pager | tail -n 40
```

Quanto spazio occupa il journal e come ridurlo, tenendo solo le ultime due settimane:

```
journalctl --disk-usage
```

```
sudo journalctl --vacuum-time=14d
```

---

## 11. Pacchetti, aggiornamenti, riavvio

### 11.1 apt: installare e aggiornare programmi

`apt` è il "negozio di app" del Pi. Prima si aggiorna l'elenco dei pacchetti disponibili (non installa niente):

```
sudo apt update
```

Vedere cosa c'è da aggiornare:

```
apt list --upgradable
```

Aggiornare tutto. Sul Raspberry Pi si consiglia `full-upgrade`, che gestisce anche i cambi di dipendenze del sistema; `-y` risponde "sì" in automatico:

```
sudo apt update && sudo apt full-upgrade -y
```

Installare un programma:

```
sudo apt install -y <pacchetto>
```

Rimuoverlo:

```
sudo apt remove <pacchetto>
```

Togliere le dipendenze non più usate da nessuno:

```
sudo apt autoremove -y
```

Cercare un pacchetto e leggerne la descrizione:

```
apt search ncdu
```

```
apt show ncdu
```

**Gli aggiornamenti di sistema non toccano i container**: quelli si aggiornano con Docker (sezione 13.6).

### 11.2 Riavviare e spegnere

Riavviare:

```
sudo reboot
```

Spegnere. **Fallo sempre prima di staccare la corrente o il disco USB**, altrimenti rischi di corrompere i dati (ricordi il database di containerd):

```
sudo shutdown -h now
```

Programmare un riavvio tra 5 minuti, e annullarlo se cambi idea:

```
sudo shutdown -r +5
```

```
sudo shutdown -c
```

Dopo un riavvio, controlla che sia tornato tutto su:

```
uptime && docker ps --format 'table {{.Names}}\t{{.Status}}' && systemctl --failed --no-pager
```

---

## 12. Trucchi della shell

### 12.1 Concatenare comandi

| Simbolo    | Significato                                 | Esempio                                         |
| ---------- | ------------------------------------------- | ----------------------------------------------- |
| `A && B`   | esegue B **solo se A è andato bene**        | `cd ~/gitsuite && docker compose ps`            |
| `A \|\| B` | esegue B **solo se A è fallito**            | `command -v tree \|\| sudo apt install -y tree` |
| `A ; B`    | esegue B comunque                           | `date ; uptime`                                 |
| `A \| B`   | (_pipe_) l'output di A diventa l'input di B | `docker ps \| grep jellyfin`                    |

È il motivo per cui i comandi che ti preparo sono catene di `&&`: se un passaggio fallisce, quelli dopo non partono e non fanno danni.

Ogni comando, quando finisce, lascia un **codice di uscita**: `0` = tutto bene, qualsiasi altro numero = errore. Per vedere quello dell'ultimo comando:

```
echo $?
```

### 12.2 Redirezioni: dove va l'output

| Forma                 | Cosa fa                                             |
| --------------------- | --------------------------------------------------- |
| `comando > file`      | scrive l'output nel file, **sovrascrivendolo**      |
| `comando >> file`     | aggiunge l'output in fondo al file                  |
| `comando 2> file`     | scrive nel file solo gli errori                     |
| `comando > file 2>&1` | scrive nel file output **ed** errori                |
| `comando 2>/dev/null` | butta via gli errori (`/dev/null` è un "buco nero") |
| `comando \| tee file` | mostra a schermo **e** scrive nel file              |

Esempio: salvare un elenco dei container in un file per confrontarlo dopo un aggiornamento:

```
docker ps --format '{{.Names}} {{.Image}}' > ~/container-prima.txt
```

### 12.3 Variabili, virgolette e caratteri speciali

Una variabile si crea **senza spazi** intorno all'`=` e si usa con `$`:

```
CARTELLA=/mnt/storage/apps/mnamer && ls -la "$CARTELLA"
```

Le **virgolette doppie** `"..."` lasciano funzionare le variabili ma proteggono gli spazi: `"$CARTELLA"` resta un solo argomento anche se contiene spazi. Le **virgolette singole** `'...'` prendono tutto alla lettera: `'$CARTELLA'` stampa proprio `$CARTELLA`. Regola pratica: metti sempre le virgolette doppie intorno alle variabili e ai percorsi con spazi.

`$(comando)` viene sostituito con l'output del comando:

```
echo "Oggi è $(date +%A) e il disco è pieno al $(df --output=pcent /mnt/storage | tail -n 1)"
```

I caratteri jolly: `*` = qualsiasi sequenza di caratteri, `?` = un carattere qualsiasi, `[abc]` = uno tra a, b, c. Sono espansi dalla shell **prima** di eseguire il comando, quindi `ls *.log` riceve già l'elenco dei file.

### 12.4 Strumenti per lavorare sui testi

**sort** ordina le righe (`-h` capisce "2G" e "500M", `-n` ordina numeri, `-r` al contrario). **uniq -c** conta le righe uguali consecutive (per questo si mette dopo `sort`). Insieme rispondono a domande come "quali messaggi compaiono più spesso nel log?": qui `cut` toglie data e ora (i primi due campi separati da spazio) e tiene il resto.

```
cut -d' ' -f3- /mnt/storage/apps/audiobooks-import/import.log | sort | uniq -c | sort -rn | head
```

**cut** prende delle colonne: `-d` indica il separatore, `-f` i campi. Esempio: l'elenco degli utenti del sistema, primo campo di `/etc/passwd`, separato da `:`:

```
cut -d: -f1 /etc/passwd
```

**awk** è ottimo per le colonne separate da spazi. `$1` è la prima colonna, `$5` la quinta. Qui mostra solo i dischi pieni oltre l'80% (`$5+0` trasforma "85%" nel numero 85):

```
df -h | awk 'NR==1 || $5+0 > 80'
```

(`NR==1` tiene anche la prima riga, quella dei titoli delle colonne.)

**xargs** passa un elenco di risultati come argomenti a un altro comando. Qui: il peso totale di tutti gli mkv. `-print0` e `-0` gestiscono correttamente i nomi con spazi; `du -ch` stampa anche una riga "total", che `tail -n 1` tiene:

```
find /mnt/storage/shared/movies -iname "*.mkv" -print0 | xargs -0 du -ch | tail -n 1
```

### 12.5 Tasti che fanno risparmiare tempo

| Tasti               | Cosa fanno                                                                       |
| ------------------- | -------------------------------------------------------------------------------- |
| `Tab`               | completa nomi di comandi, file e cartelle; due volte `Tab` mostra le possibilità |
| `Ctrl+C`            | interrompe il comando in corso                                                   |
| `Ctrl+D`            | chiude la sessione (come `exit`)                                                 |
| `Ctrl+L`            | pulisce lo schermo                                                               |
| `Ctrl+A` / `Ctrl+E` | va all'inizio / alla fine della riga                                             |
| `Ctrl+U`            | cancella dal cursore all'inizio della riga                                       |
| `Ctrl+W`            | cancella la parola prima del cursore                                             |
| `!!`                | ripete l'ultimo comando                                                          |
| `sudo !!`           | ripete l'ultimo comando con sudo davanti ("Permission denied"? `sudo !!`)        |

Il `Tab` è il miglior antidoto contro gli errori di battitura: se il completamento non funziona, quasi sempre il percorso che stai scrivendo è sbagliato.

### 12.6 Alias: le tue scorciatoie

Un alias è un nome breve per un comando lungo. Si scrivono nel file `~/.bashrc`, che la shell legge a ogni accesso. Questo comando aggiunge quattro alias utili in fondo al file:

```
cat >> ~/.bashrc <<'EOF'

# ---- Alias personali di mCloud ----
# Stato di tutti i container in tabella
alias dps="docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
# Spazio sui due dischi
alias spazio="df -h / /mnt/storage"
# Controllo di salute rapido del Pi (vedi sezione 18)
alias salute="uptime && free -h && df -h / /mnt/storage && vcgencmd measure_temp && vcgencmd get_throttled && systemctl --failed --no-pager"
# Tutti i timer
alias timer="systemctl list-timers --no-pager"
EOF
```

Per attivarli subito, senza uscire e rientrare:

```
source ~/.bashrc
```

Da adesso scrivi `dps`, `spazio`, `salute` o `timer`. Per vedere tutti gli alias definiti: `alias`.

---

## 13. Docker

Ripasso lampo (spiegato meglio nella guida dei libri, parte 0): un'**immagine** è il pacchetto del programma, un **container** è l'immagine in esecuzione, i **volumi** collegano cartelle del Pi a cartelle del container, il file **compose** descrive tutto. I dati veri stanno nei volumi, quindi un container si può cancellare e ricreare senza perdere niente.

Ci sono due modi di dare comandi: **`docker`** agisce su un singolo container per nome, da qualsiasi cartella; **`docker compose`** agisce sui servizi descritti nel compose e va lanciato **nella cartella del compose**.

### 13.1 Vedere cosa gira

I container attivi:

```
docker ps
```

Anche quelli fermi o andati in errore (`-a` = _all_). Se un servizio "sparisce", guarda qui la colonna STATUS: `Exited (1)` vuol dire che si è fermato con un errore.

```
docker ps -a
```

Una tabella più leggibile, con nome, stato e porte:

```
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

**Dove sta il compose di ogni servizio?** Questo comando elenca i progetti compose attivi con il percorso del loro file. Utilissimo quando non ricordi dove hai messo qualcosa:

```
docker compose ls
```

Quanta CPU e RAM usa ogni container in questo momento (`--no-stream` = una sola fotografia, invece di un aggiornamento continuo):

```
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
```

### 13.2 I log di un container

Le ultime 50 righe:

```
docker logs jellyfin --tail 50
```

In tempo reale (`Ctrl+C` per uscire, il container continua a girare):

```
docker logs -f july-api
```

Solo gli ultimi 30 minuti:

```
docker logs nextcloud-app --since 30m
```

**Cercare negli errori di un container.** Molti programmi scrivono nel canale degli errori (_stderr_), che `grep` da solo non vede. `2>&1` unisce i due canali prima di passarli a grep:

```
docker logs nextcloud-app 2>&1 | grep -i error | tail -n 20
```

### 13.3 Avviare, fermare, riavviare un container

| Comando                 | Cosa fa                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `docker restart <nome>` | riavvia (il rimedio più comune)                                       |
| `docker stop <nome>`    | ferma; resta fermo finché non lo riavvii, anche dopo un reboot del Pi |
| `docker start <nome>`   | riavvia un container fermo                                            |
| `docker rm <nome>`      | cancella un container **fermo** (i volumi restano)                    |
| `docker rm -f <nome>`   | ferma e cancella in un colpo solo                                     |

Esempio:

```
docker restart july-api && docker logs july-api --tail 20
```

### 13.4 Entrare in un container

`docker exec` esegue un comando **dentro** un container in funzione. Con `-it` apri una shell interattiva, come se fossi entrato in SSH nel container. Si esce con `exit`.

```
docker exec -it jellyfin bash
```

Se ricevi `executable file not found` per `bash`, l'immagine è minimale (spesso basata su Alpine) e ha solo `sh`:

```
docker exec -it audiobookshelf sh
```

Un singolo comando, senza entrare. Per esempio, vedere cosa vede Jellyfin nella sua cartella dei film:

```
docker exec jellyfin ls /media
```

Come un utente specifico (`-u`), come fai già con Nextcloud:

```
docker exec -u 33 nextcloud-app php occ status
```

### 13.5 Ispezionare un container

`docker inspect` restituisce tutta la configurazione di un container. Con `--format` scegli solo il pezzo che ti serve.

I volumi, cioè quali cartelle del Pi sono collegate e dove:

```
docker inspect jellyfin --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

Lo stato del controllo di salute (_healthcheck_), se il container ne ha uno: `healthy`, `unhealthy` o `starting`:

```
docker inspect jellyfin --format '{{.State.Health.Status}}'
```

La politica di riavvio (`unless-stopped` = riparte da solo dopo un reboot):

```
docker inspect july-api --format '{{.HostConfig.RestartPolicy.Name}}'
```

Copiare un file **dal** container al Pi, e **dal** Pi al container:

```
docker cp jellyfin:/config/log ./jellyfin-log
```

```
docker cp ./file.txt jellyfin:/tmp/file.txt
```

### 13.6 Docker Compose

Tutti questi comandi vanno lanciati **nella cartella del compose**, per questo iniziano con `cd`. In alternativa puoi indicare il file con `-f`: `docker compose -f /mnt/storage/apps/audiobookshelf/compose.yml ps`.

Lo stato dei servizi del progetto:

```
cd ~/gitsuite && docker compose ps
```

| Comando                                            | Cosa fa                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `docker compose up -d`                             | crea e avvia tutto in background; se hai cambiato il compose, ricrea solo i container toccati |
| `docker compose up -d --build`                     | come sopra, ma prima ricostruisce l'immagine dal `Dockerfile` (dopo aver cambiato il codice)  |
| `docker compose up -d --force-recreate <servizio>` | ricrea il container anche se nulla è cambiato (per esempio dopo aver modificato `.env`)       |
| `docker compose restart <servizio>`                | riavvia **senza** rileggere compose ed `.env`                                                 |
| `docker compose stop` / `start`                    | ferma / riavvia senza cancellare                                                              |
| `docker compose down`                              | ferma e cancella i container e le reti del progetto. **I volumi e le cartelle restano**       |
| `docker compose pull`                              | scarica le versioni nuove delle immagini                                                      |
| `docker compose logs -f <servizio>`                | log in tempo reale di un servizio                                                             |
| `docker compose logs --tail 50`                    | ultime 50 righe di tutti i servizi                                                            |
| `docker compose exec <servizio> sh`                | entra nel container di un servizio                                                            |
| `docker compose config -q`                         | controlla che il file sia valido (nessun output = ok)                                         |
| `docker compose config`                            | mostra la configurazione finale, con le variabili di `.env` già sostituite                    |

**`restart` non basta dopo aver cambiato `.env` o il compose.** `restart` riavvia lo stesso container con la vecchia configurazione. Per applicare le modifiche serve `up -d` (o `up -d --force-recreate` se cambia solo `.env`).

**⚠️ `docker compose down -v` cancella i volumi con nome**, cioè per esempio il database Postgres di GitSuite, se è in un volume Docker. Non usare `-v` a meno che tu non voglia proprio ripartire da zero.

**La ricetta per aggiornare un servizio** (qui Audiobookshelf). `image prune -f` cancella poi le immagini vecchie rimaste inutilizzate:

```
cd /mnt/storage/apps/audiobookshelf && docker compose pull && docker compose up -d && docker image prune -f
```

Per gli altri servizi cambia solo la cartella: se non ricordi dove sta il compose di un servizio, `docker compose ls` te lo dice (13.1).

### 13.7 Fare pulizia

Quanto spazio occupano immagini, container, volumi e cache:

```
docker system df
```

In ordine dal più sicuro al più drastico:

| Comando                     | Cosa cancella                                                  | Rischio                                                          |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `docker image prune -f`     | immagini senza nome, residui di aggiornamenti                  | nessuno                                                          |
| `docker builder prune -f`   | la cache delle build (`--build`)                               | nessuno: la prossima build sarà solo più lenta                   |
| `docker container prune -f` | tutti i container **fermi**                                    | perdi un container fermato apposta (i dati nei volumi restano)   |
| `docker image prune -a -f`  | tutte le immagini non usate da un container                    | il prossimo avvio di quei servizi le riscarica                   |
| `docker system prune`       | container fermi, reti inutilizzate, immagini senza nome, cache | come sopra; chiede conferma                                      |
| `docker volume prune`       | volumi non collegati a nessun container                        | **può cancellare dati** (database di un servizio fermo): evitalo |

Il giro di pulizia sicuro:

```
docker image prune -f && docker builder prune -f && docker system df
```

**Un'interfaccia per Docker.** Se ti è piaciuto lazygit, esiste **lazydocker**, dello stesso autore: un'interfaccia a pannelli nel terminale per vedere container, log e risorse e per riavviare con un tasto. Le istruzioni di installazione per ARM sono nella sua pagina GitHub.

---

## 14. Nextcloud da riga di comando (occ)

`occ` è lo strumento di amministrazione di Nextcloud. Si lancia dentro il container, come utente 33 (www-data):

```
docker exec -u 33 nextcloud-app php occ status
```

**Far vedere a Nextcloud file aggiunti "da fuori"** (copiati da riga di comando, spostati da uno script). Nextcloud tiene un indice dei file, e questo comando lo aggiorna. Su librerie grandi può richiedere molti minuti: lancialo in tmux.

```
docker exec -u 33 nextcloud-app php occ files:scan --all
```

Le cartelle esterne configurate (Music, Cinema, Libri Inbox…):

```
docker exec -u 33 nextcloud-app php occ files_external:list
```

Svuotare il cestino di tutti gli utenti e le vecchie versioni dei file (lo avevi fatto per liberare circa 17 GB):

```
docker exec -u 33 nextcloud-app php occ trashbin:cleanup --all-users && docker exec -u 33 nextcloud-app php occ versions:cleanup
```

Gli utenti di Nextcloud:

```
docker exec -u 33 nextcloud-app php occ user:list
```

La modalità manutenzione (Nextcloud mostra una pagina "in manutenzione" e non accetta modifiche: utile durante un backup) e la sua disattivazione:

```
docker exec -u 33 nextcloud-app php occ maintenance:mode --on
```

```
docker exec -u 33 nextcloud-app php occ maintenance:mode --off
```

---

## 15. Trasferire file tra Mac e Pi

Tutti i comandi di questa sezione si lanciano 🍎 **sul Mac**. Dall'iPhone, per i file usa Nextcloud o July.

### 15.1 scp: copie semplici

Il formato è `scp origine destinazione`, dove un percorso sul Pi si scrive `mcloud:percorso`.

Dal Mac al Pi (nella tua home):

```
scp ~/Downloads/file.txt mcloud:~/
```

Dal Pi al Mac (nella cartella in cui ti trovi, il `.` finale):

```
scp mcloud:~/gitsuite/docker-compose.yml .
```

Un'intera cartella (`-r`):

```
scp -r ~/Downloads/cartella mcloud:~/
```

### 15.2 rsync: copie intelligenti

`rsync` copia **solo ciò che è cambiato**, può riprendere un trasferimento interrotto e può escludere file. Per i progetti è sempre meglio di scp.

```
rsync -av --exclude node_modules ./ mcloud:~/gitsuite/
```

Le opzioni: `-a` (_archive_) copia le sottocartelle e conserva permessi e date; `-v` (_verbose_) elenca i file copiati; `--exclude` salta un file o una cartella (si può ripetere); `-P` mostra l'avanzamento e permette di riprendere i file grandi interrotti; `-n` (_dry run_) **simula** senza copiare niente.

**La barra finale cambia tutto:**

| Comando                                  | Risultato sul Pi                                           |
| ---------------------------------------- | ---------------------------------------------------------- |
| `rsync -av progetto/ mcloud:~/progetto/` | il **contenuto** di `progetto` finisce in `~/progetto/` ✅ |
| `rsync -av progetto mcloud:~/progetto/`  | la **cartella** finisce dentro: `~/progetto/progetto/` ❌  |

Regola semplice: metti sempre la `/` finale sia all'origine sia alla destinazione.

**`--delete`** rende la destinazione una copia esatta, cancellando sul Pi i file che non esistono più sul Mac. È potente e pericoloso: provalo **sempre** prima con `-n` e leggi l'elenco delle righe `deleting`.

```
rsync -avn --delete --exclude node_modules --exclude .env ./ mcloud:~/gitsuite/
```

---

## 16. Caricare un nuovo bot sul Pi

Questa è la ricetta generale per mettere in produzione sul Pi un bot Telegram in TypeScript (grammY), la stessa che hai seguito per GitSuite.

### 16.1 Dove metterlo

GitSuite sta in `~/gitsuite`, cioè sulla microSD. Per coerenza con la tua regola "sulla microSD solo il sistema operativo", per i bot nuovi conviene usare `/mnt/storage/apps/<nome-bot>`, come per gli altri servizi. Le immagini e i volumi Docker finiscono già sul disco dati, ma il codice sorgente e le cartelle collegate seguono il percorso che scegli. Negli esempi qui sotto userò `/mnt/storage/apps/mio-bot`.

🍓 Crea la cartella e rendila tua (così rsync può scriverci senza sudo):

```
sudo mkdir -p /mnt/storage/apps/mio-bot && sudo chown morgan:morgan /mnt/storage/apps/mio-bot && ls -ld /mnt/storage/apps/mio-bot
```

### 16.2 I file che servono nel progetto

Il progetto deve contenere quattro file per girare in Docker. Se li ha già (come GitSuite), salta al 16.3.

**`Dockerfile`**: la ricetta per costruire l'immagine del bot.

```dockerfile
# Immagine di base: Node su Alpine (piccola).
# Usa la stessa versione di Node che hai in sviluppo con mise.
FROM node:22-alpine

# Cartella di lavoro dentro il container
WORKDIR /app

# pnpm arriva con corepack, incluso in Node
RUN corepack enable

# Prima SOLO i file delle dipendenze: se non cambiano, Docker riusa
# questo passaggio dalla cache e la build è molto più veloce
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Poi tutto il resto del codice, e la compilazione da TypeScript
COPY . .
RUN pnpm build

# Il bot non gira come root: se venisse bucato, farebbe meno danni
USER node

# Il comando che avvia il bot (adattalo al tuo file di ingresso)
CMD ["node", "dist/index.js"]
```

Se usi Prisma, aggiungi `RUN apk add --no-cache openssl` subito dopo `FROM`: i motori di Prisma su Alpine ne hanno bisogno.

**`.dockerignore`**: cosa **non** copiare nell'immagine. Senza questo file, `COPY . .` copierebbe anche `node_modules` del Mac (inutile e pesante) e il file `.env` con i segreti dentro l'immagine.

```
node_modules
dist
.git
.env
```

**`docker-compose.yml`**: come far girare il bot.

```yaml
services:
  bot:
    # Costruisci l'immagine dal Dockerfile in questa cartella
    build: .
    container_name: mio-bot
    # Le variabili segrete (token del bot ecc.) arrivano da .env,
    # al momento dell'avvio: non finiscono mai dentro l'immagine
    env_file: .env
    # Riparte da solo dopo un crash o un riavvio del Pi
    restart: unless-stopped
    # Tetto di memoria: se il bot impazzisce, non soffoca il Pi
    mem_limit: 256m
    # Log a rotazione: al massimo 3 file da 10 MB, così non riempiono il disco
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    # Le porte servono SOLO se il bot ha un server HTTP (webhook).
    # Un bot in long polling non ne ha bisogno.
    # ports:
    #   - "3000:3000"
```

**`.env`**: i segreti, una variabile per riga, **mai** su git (deve stare nel `.gitignore`):

```
BOT_TOKEN=123456:ABC-il-tuo-token
```

### 16.3 La prima messa in produzione

**1. 🍎 Prova sul Mac.** Nella cartella del progetto, avvialo in primo piano per vedere subito i log (`Ctrl+C` per fermarlo):

```
docker compose up --build
```

**2. 🍎 Ferma il bot sul Mac.** Telegram permette a un solo programma alla volta di leggere i messaggi di un bot: se lo stesso token gira sia sul Mac sia sul Pi, uno dei due riceve l'errore `409 Conflict`.

```
docker compose down
```

**3. 🍎 Simula la copia sul Pi.** `-n` mostra cosa verrebbe copiato senza copiare niente. Le esclusioni saltano le cartelle pesanti che il Pi ricostruisce da solo. La prima volta il `.env` va copiato:

```
rsync -avn --exclude node_modules --exclude dist --exclude .git ./ mcloud:/mnt/storage/apps/mio-bot/
```

**4. 🍎 Copia davvero** (stesso comando senza `-n`):

```
rsync -av --exclude node_modules --exclude dist --exclude .git ./ mcloud:/mnt/storage/apps/mio-bot/
```

**5. 🍎 Entra nel Pi:**

```
ssh mcloud
```

**6. 🍓 Proteggi il file dei segreti**, leggibile solo da te:

```
chmod 600 /mnt/storage/apps/mio-bot/.env && ls -l /mnt/storage/apps/mio-bot/.env
```

**7. 🍓 Se il bot ha un server HTTP, controlla che la porta sia libera** (qui la 3000):

```
sudo ss -tlnp | grep ":3000 " || echo "porta 3000 libera"
```

**8. 🍓 Costruisci e avvia.** La prima build sul Pi richiede qualche minuto: lanciala in tmux. Quando nei log compare il messaggio di avvio del bot, `Ctrl+C` esce dai log e il bot continua a girare:

```
cd /mnt/storage/apps/mio-bot && docker compose up -d --build && docker compose logs -f bot
```

**9. Verifica.** Su Telegram manda `/start` al bot. Sul Pi, controlla lo stato:

```
cd /mnt/storage/apps/mio-bot && docker compose ps && docker stats --no-stream mio-bot
```

**Architettura.** Il Pi e il Mac M2 sono entrambi ARM a 64 bit, quindi ciò che funziona in Docker sul Mac funziona anche sul Pi. Il computer di lavoro `dev10` invece è quasi certamente x86: un'immagine costruita lì e portata sul Pi darebbe `exec format error`. Per questo la ricetta ricostruisce sempre l'immagine sul Pi con `--build`.

### 16.4 Aggiornare il bot dopo una modifica

Dopo il primo deploy, sul Mac di solito usi un **secondo bot di sviluppo** (creato con @BotFather, con il suo token nel `.env` del Mac), così puoi provare senza fermare quello vero. Per questo, da qui in poi, **escludi `.env`** dalla copia: altrimenti il token di sviluppo sovrascriverebbe quello di produzione.

🍎 Copia il codice aggiornato:

```
rsync -av --exclude node_modules --exclude dist --exclude .git --exclude .env ./ mcloud:/mnt/storage/apps/mio-bot/
```

🍎 Ricostruisci e riavvia sul Pi, senza nemmeno entrarci, e guarda le ultime righe di log:

```
ssh mcloud "cd /mnt/storage/apps/mio-bot && docker compose up -d --build && docker compose logs --tail 30 bot"
```

Se hai modificato solo il `.env` sul Pi (non il codice), basta ricreare il container per fargli rileggere le variabili:

```
cd /mnt/storage/apps/mio-bot && docker compose up -d --force-recreate bot && docker compose logs --tail 20 bot
```

**Tornare indietro.** Se la versione nuova non funziona, il modo più semplice è tornare alla versione precedente del codice sul Mac (con git: `git checkout <commit-precedente>`), ripetere il rsync e il `up -d --build`, e poi tornare all'ultima versione su git per sistemare il problema.

### 16.5 Se il bot ha bisogno di essere raggiungibile da internet

Un bot in long polling non ne ha bisogno. Se invece riceve webhook (come GitSuite da GitHub), puoi esporre **solo la sua porta** su internet con Tailscale Funnel. Qui la porta 3000 del bot viene pubblicata in HTTPS sulla 8443:

```
sudo tailscale funnel --bg --https=8443 3000 && tailscale funnel status
```

Per spegnere quell'esposizione:

```
sudo tailscale funnel --https=8443 off && tailscale funnel status
```

### 16.6 Se il bot ha un database Postgres nel compose

Entrare nel database con il client `psql` (utente e nome del database sono quelli del tuo `.env`):

```
cd /mnt/storage/apps/mio-bot && docker compose exec db psql -U <utente> -d <database>
```

Dentro psql: `\dt` elenca le tabelle, `\q` esce.

Il backup e il ripristino sono nella sezione 17.3.

### 16.7 Spegnere o togliere un bot

Fermarlo (dati e volumi restano, lo riaccendi con `up -d`):

```
cd /mnt/storage/apps/mio-bot && docker compose down
```

Toglierlo del tutto, archiviando la cartella invece di cancellarla:

```
cd /mnt/storage/apps/mio-bot && docker compose down && sudo mv /mnt/storage/apps/mio-bot /mnt/storage/apps/_archive/mio-bot-$(date +%Y%m%d)
```

---

## 17. Backup

### 17.1 Una cartella in un archivio

Il backup più semplice: un archivio compresso con la data nel nome. Qui la configurazione di tutti i servizi in `/mnt/storage/apps`, salvato nell'archivio. `--exclude` evita di mettere l'archivio dentro sé stesso:

```
sudo tar czf /mnt/storage/apps/_archive/apps-config-$(date +%F).tar.gz --exclude=_archive -C /mnt/storage apps && ls -lh /mnt/storage/apps/_archive/apps-config-*.tar.gz
```

### 17.2 Una copia su un altro disco con rsync

rsync funziona anche tra due cartelle dello stesso Pi, per esempio verso un disco di backup collegato. La prima volta copia tutto, le volte successive solo le differenze. Qui il disco di backup è immaginato su `/mnt/backup`; prima simula con `-n`:

```
sudo rsync -avn /mnt/storage/shared/music/ /mnt/backup/music/
```

Poi copia davvero, con `-P` per vedere l'avanzamento:

```
sudo rsync -aP /mnt/storage/shared/music/ /mnt/backup/music/
```

Con `--delete` il backup diventa una copia esatta, ma **se cancelli per sbaglio un file dall'originale, sparisce anche dal backup** al giro successivo. Per un backup vero, senza `--delete` è più prudente.

### 17.3 Backup di un database Postgres

**Non si copiano i file di un database mentre è acceso**: la copia potrebbe essere incoerente. Si usa `pg_dump`, che esporta il contenuto in un file SQL. `-T` serve perché l'output viene rediretto in un file (senza un terminale interattivo):

```
cd ~/gitsuite && docker compose exec -T db pg_dump -U <utente> <database> > /mnt/storage/apps/_archive/gitsuite-db-$(date +%F).sql && ls -lh /mnt/storage/apps/_archive/gitsuite-db-*.sql
```

Il ripristino, nel database (vuoto) dello stesso servizio:

```
cd ~/gitsuite && cat /mnt/storage/apps/_archive/gitsuite-db-2026-11-14.sql | docker compose exec -T db psql -U <utente> -d <database>
```

### 17.4 Cosa salvare, in generale

Le cose importanti del tuo server sono di tre tipi. I **contenuti** (`/mnt/storage/shared`: musica, film, libri, audiolibri) sono i più grandi e si salvano con rsync. Le **configurazioni** (`/mnt/storage/apps`: compose, script, cartelle `config` dei servizi) sono piccole e si salvano con tar. I **database** (Postgres di GitSuite e di Immich, SQLite dentro le cartelle `config`) vanno esportati a servizio fermo o con lo strumento apposito, come `pg_dump`. Nella guida dei libri, la sezione 9.3 elenca le cartelle precise di Calibre-Web e Audiobookshelf.

---

## 18. Kit di emergenza

Quando qualcosa non va e non sai da dove cominciare, segui quest'ordine: dal generale al particolare.

### 18.1 Il controllo di salute in un comando

Stato del Pi, RAM, spazio, temperatura, alimentazione, servizi falliti e container, tutto insieme (se hai creato gli alias del 12.6, ti basta scrivere `salute` e `dps`):

```
uptime && free -h && df -h / /mnt/storage && vcgencmd measure_temp && vcgencmd get_throttled && systemctl --failed --no-pager && docker ps -a --format 'table {{.Names}}\t{{.Status}}'
```

**Come leggerlo:** carico (gli ultimi 3 numeri di `uptime`) sotto 4; `available` della RAM non vicino a zero; `Use%` dei dischi sotto il 90%; temperatura sotto 80 °C; `throttled=0x0`; nessun servizio fallito; tutti i container `Up`, nessuno `Exited` o `Restarting`.

### 18.2 Sintomo → dove guardare

**Un servizio web non si apre dall'iPhone.** Prima escludi l'iPhone: il servizio risponde dal Pi stesso?

```
curl -sI http://localhost:8096 | head -n 1
```

Se risponde dal Pi ma non dall'iPhone, il problema è la rete: Tailscale attivo sull'iPhone? Il nome `mcloud` viene risolto? Prova l'IP `100.64.248.96`. Se invece non risponde nemmeno dal Pi, il problema è il servizio: guarda `docker ps -a` e i suoi log.

**Un container continua a riavviarsi** (`Restarting` in `docker ps`). La causa è quasi sempre scritta nelle ultime righe dei suoi log:

```
docker logs <nome> --tail 50
```

Le cause più frequenti: permessi su una cartella (sezione 6.5), una porta già occupata (9.2), un errore nel compose o nel `.env`.

**Un import (musica, film, audiolibri) non parte.** Controlla il timer e l'ultimo giro:

```
systemctl list-timers --no-pager && systemctl --failed --no-pager
```

```
journalctl -u mnamer-import.service -n 30 --no-pager
```

**Il disco è pieno.** Trova cosa occupa spazio e libera quello di Docker:

```
df -h / /mnt/storage && sudo du -sh /mnt/storage/* | sort -h && docker system df
```

Poi il giro di pulizia sicuro di Docker (13.7) e, se serve, il cestino e le versioni di Nextcloud (14).

**Il Pi è lento.** Chi sta consumando?

```
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' && vcgencmd measure_temp && vcgencmd get_throttled
```

Poi `htop` per i processi fuori da Docker. Ricorda che il LLM locale di July, quando è caricato, occupa molta RAM per i 10 minuti successivi all'ultima richiesta.

**Il disco dati sembra sparito, o i file sono "Read-only".**

```
findmnt /mnt/storage && sudo dmesg -T | grep -iE "usb|sda|i/o error|reset|read-only" | tail -n 30
```

Se `findmnt` non stampa nulla, il disco non è montato. Se `dmesg` mostra errori di I/O o reset USB, il disco ha avuto problemi di connessione o alimentazione: spegni il Pi con `sudo shutdown -h now`, controlla cavo e alimentatore, riaccendi.

**La connessione SSH cade continuamente.** Lavora sempre dentro tmux (1.2), così i comandi lunghi non muoiono con la connessione.

---

## 19. Gli errori più comuni e cosa significano

| Messaggio                                                               | Cosa significa                                                   | Cosa fare                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Permission denied`                                                     | non hai i permessi per quel file o cartella                      | serve `sudo` (`sudo !!` ripete il comando), oppure i permessi vanno sistemati (sezione 6) |
| `permission denied while trying to connect to the Docker daemon socket` | il tuo utente non può parlare con Docker                         | metti `sudo` davanti, o aggiungiti al gruppo `docker` (6.6)                               |
| `command not found`                                                     | il programma non è installato, oppure c'è un errore di battitura | `command -v <nome>`; se manca, `sudo apt install -y <pacchetto>`                          |
| `No such file or directory`                                             | il percorso non esiste                                           | controlla con `ls`; usa `Tab` per completare; metti tra virgolette i percorsi con spazi   |
| `Is a directory` / `Not a directory`                                    | hai dato una cartella dove serviva un file, o viceversa          | per le cartelle servono opzioni come `-r` o `-a`                                          |
| `Address already in use` / `port is already allocated`                  | la porta è già usata da un altro servizio                        | `sudo ss -tlnp \| grep ":<porta> "` e scegli un'altra porta                               |
| `yaml: line 12: ...`                                                    | errore di formato nel compose                                    | spazi sbagliati o un Tab: `cat -A file` mostra i Tab come `^I`                            |
| `No space left on device`                                               | disco pieno                                                      | sezione 7.2 e pulizia Docker (13.7)                                                       |
| `Read-only file system`                                                 | il disco è stato rimontato in sola lettura dopo un errore        | `dmesg` (7.4) e riavvio controllato                                                       |
| `409 Conflict: terminated by other getUpdates request`                  | lo stesso bot gira in due posti                                  | ferma l'altra istanza (16.3, punto 2)                                                     |
| `exec format error`                                                     | immagine costruita per un'altra architettura (x86 invece di ARM) | ricostruiscila sul Pi con `docker compose up -d --build`                                  |
| `Connection reset by peer`                                              | la connessione SSH è caduta                                      | riconnettiti ed entra in tmux con `tmux new -A -s main`                                   |
| `E: Could not get lock /var/lib/dpkg/lock`                              | un altro apt è già in corso (magari un aggiornamento automatico) | aspetta qualche minuto e riprova                                                          |
| Caratteri strani come `“` o `—` nel comando                             | la punteggiatura smart dell'iPhone ha modificato il testo        | disattivala e incolla di nuovo                                                            |

---

## Appendice: "Voglio fare X" → comando

| Voglio…                                         | Comando                                                        |
| ----------------------------------------------- | -------------------------------------------------------------- |
| entrare nel Pi dal Mac                          | `ssh mcloud`                                                   |
| una sessione che sopravvive alle disconnessioni | `tmux new -A -s main`                                          |
| sapere dove sono                                | `pwd`                                                          |
| vedere cosa c'è in una cartella                 | `ls -lah <cartella>`                                           |
| leggere un file corto                           | `cat <file>`                                                   |
| sfogliare un file lungo                         | `less <file>`                                                  |
| vedere la fine di un log                        | `tail -n 50 <file>`                                            |
| seguire un log in tempo reale                   | `tail -f <file>`                                               |
| cercare un testo in un file                     | `grep -in "testo" <file>`                                      |
| cercare un testo in tutta una cartella          | `grep -rn "testo" <cartella>`                                  |
| cercare file per nome                           | `find <cartella> -iname "*parola*"`                            |
| trovare i file più grandi di 4 GB               | `find <cartella> -type f -size +4G`                            |
| creare una cartella                             | `mkdir -p <cartella>`                                          |
| copiare una cartella conservando tutto          | `cp -a <origine> <destinazione>`                               |
| spostare o rinominare                           | `mv <origine> <destinazione>`                                  |
| archiviare invece di cancellare                 | `mv <cosa> /mnt/storage/apps/_archive/`                        |
| cancellare un file                              | `rm <file>`                                                    |
| modificare un file                              | `sudo nano <file>`                                             |
| sostituire un testo in un file                  | `sed -i.bak 's/vecchio/nuovo/g' <file>`                        |
| aggiungere una riga a un file di sistema        | `echo "riga" \| sudo tee -a <file>`                            |
| rendere eseguibile uno script                   | `chmod +x <file>`                                              |
| proteggere un file di segreti                   | `chmod 600 <file>`                                             |
| cambiare proprietario                           | `sudo chown -R morgan:morgan <cartella>`                       |
| capire un Permission denied                     | `namei -l <percorso>`                                          |
| vedere lo spazio libero                         | `df -h / /mnt/storage`                                         |
| sapere cosa occupa spazio                       | `sudo du -sh <cartella>/* \| sort -h`                          |
| vedere RAM e processi                           | `htop`                                                         |
| controllare temperatura e alimentazione         | `vcgencmd measure_temp && vcgencmd get_throttled`              |
| sapere chi usa una porta                        | `sudo ss -tlnp \| grep ":<porta> "`                            |
| sapere se un servizio risponde                  | `curl -sI http://localhost:<porta> \| head -n 1`               |
| vedere i dispositivi Tailscale                  | `tailscale status`                                             |
| vedere tutti i timer                            | `systemctl list-timers --no-pager`                             |
| lanciare subito un import                       | `sudo systemctl start <nome>.service`                          |
| leggere i log di un servizio systemd            | `journalctl -u <nome> -n 50 --no-pager`                        |
| aggiornare il sistema                           | `sudo apt update && sudo apt full-upgrade -y`                  |
| installare un programma                         | `sudo apt install -y <pacchetto>`                              |
| riavviare il Pi                                 | `sudo reboot`                                                  |
| spegnere il Pi                                  | `sudo shutdown -h now`                                         |
| vedere i container                              | `docker ps -a`                                                 |
| sapere dove sta un compose                      | `docker compose ls`                                            |
| leggere i log di un container                   | `docker logs <nome> --tail 50`                                 |
| riavviare un container                          | `docker restart <nome>`                                        |
| entrare in un container                         | `docker exec -it <nome> sh`                                    |
| aggiornare un servizio compose                  | `cd <cartella> && docker compose pull && docker compose up -d` |
| applicare modifiche al compose o al .env        | `cd <cartella> && docker compose up -d`                        |
| ricostruire dopo aver cambiato il codice        | `cd <cartella> && docker compose up -d --build`                |
| liberare spazio di Docker                       | `docker image prune -f && docker builder prune -f`             |
| far vedere a Nextcloud file nuovi               | `docker exec -u 33 nextcloud-app php occ files:scan --all`     |
| copiare dal Mac al Pi                           | `rsync -av ./ mcloud:<cartella>/`                              |
| copiare dal Pi al Mac                           | `scp mcloud:<file> .`                                          |
| mettere un bot sul Pi                           | sezione 16                                                     |
| il controllo di salute completo                 | sezione 18.1                                                   |
