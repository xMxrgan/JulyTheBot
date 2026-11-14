# 📚 Libri e audiolibri su mCloud

**Guida completa: da zero a una libreria di ebook e audiolibri con importazione automatica**

Questa guida è scritta per il tuo Raspberry Pi 5 `mCloud` (utente `morgan`, disco dati montato su `/mnt/storage`) e segue lo stesso schema che usi già per musica e film. Ogni comando è completo e pronto da incollare via SSH dall'iPhone. Non ci sono "vedi sopra": ogni blocco si copia da solo, anche se ripete pezzi già visti.

Prima di ogni comando trovi **cosa fa e perché**, dopo trovi **cosa dovresti vedere** e, quando serve, **cosa fare se va storto**.

Tempo stimato: un'ora e mezza con calma, test compresi.

---

## Cosa avrai alla fine

```
   iPhone / Mac / (in futuro) July
            │  carichi un file
            ▼
 ┌───────────────────── Nextcloud ─────────────────────┐
 │   "Libri Inbox"                 "Audiolibri Inbox"   │
 └───────┬─────────────────────────────────┬───────────┘
         │   (sono le stesse cartelle       │
         │    sul disco del Pi)             │
         ▼                                  ▼
 /mnt/storage/shared/books_inbox   /mnt/storage/shared/audiobooks_inbox
         │                                  │
         │ Calibre-Web Automated            │ script audiobooks-import
         │ (si accorge subito dei file)     │ (systemd, ogni 5 minuti)
         ▼                                  ▼
 /mnt/storage/shared/books         /mnt/storage/shared/audiobooks
 (libreria Calibre)                (Autore/Titolo/)
         │                                  │
         ▼                                  ▼
  Calibre-Web  → porta 8083         Audiobookshelf → porta 13378
  leggi, copertine, trame           ascolti, capitoli, progressi
```

Carichi un **ebook** (epub, mobi, azw3, pdf…) nella cartella **Libri Inbox** di Nextcloud. Calibre-Web Automated se ne accorge in pochi secondi, lo converte in EPUB se serve, recupera titolo, autore, copertina e trama, lo mette in libreria e svuota la inbox. Lo leggi da Calibre-Web nel browser, in Apple Libri o in un'app di lettura.

Carichi un **audiolibro** (un file `.m4b` oppure una cartella di `.mp3`) nella cartella **Audiolibri Inbox**. Ogni 5 minuti uno script lo sposta nella libreria con la struttura `Autore/Titolo/`, e Audiobookshelf lo mostra con copertina, capitoli e progressi di ascolto sincronizzati tra i dispositivi.

È lo stesso schema che conosci già: _Music Inbox → beets → Navidrome_ e _Cinema Inbox → mnamer → Jellyfin_.

### Perché due programmi e non uno solo

Audiobookshelf sa leggere anche gli ebook, ma per gli ebook la sua importazione è poco automatica: si basa sui nomi delle cartelle e il collegamento con i dati online è quasi tutto manuale. Calibre-Web Automated invece ha un'importazione automatica nativa, pensata proprio per il "butto il file e non ci penso". Usando ognuno per ciò che fa meglio ottieni lo stesso livello di automazione su entrambi.

Le alternative scartate: **Booklore** ha un'interfaccia bellissima ma gira in Java con un database MariaDB, troppo pesante per un Pi che regge già Nextcloud, Jellyfin, Navidrome, Home Assistant e un LLM locale. **Readarr** (l'equivalente dei vari "\*arr" per i libri) è stato dismesso nel 2025.

---

## Indice

0. I concetti di base (leggili anche se ti sembrano ovvi)
1. Preparazione
2. Cartelle e permessi
3. Nextcloud: le inbox visibili ovunque
4. Calibre-Web Automated (ebook)
5. Audiobookshelf (audiolibri)
6. Inbox automatica degli audiolibri (script + timer)
7. Prova completa dall'iPhone
8. Leggere e ascoltare sull'iPhone
9. Manutenzione e risoluzione problemi
10. Prossimi passi

Appendice: mappa rapida di percorsi, porte e comandi

---

## Parte 0 — I concetti di base

Questa parte non contiene comandi. Serve a capire _perché_ i comandi delle parti successive sono fatti in quel modo, così quando qualcosa non va sai dove guardare.

### 0.1 Immagine e container

Un'**immagine** Docker è un pacchetto pronto che contiene un programma con tutto ciò che gli serve per funzionare. Un **container** è quell'immagine in esecuzione.

Un'analogia: l'immagine è la ricetta stampata, il container è il piatto cucinato. Puoi buttare il piatto e rifarlo identico dalla ricetta quando vuoi. Per questo motivo i dati importanti **non stanno mai dentro il container**: stanno in cartelle del Pi collegate al container (vedi 0.2). Se domani cancelli il container di Calibre-Web e lo ricrei, i tuoi libri sono ancora lì.

Lo stai già usando: Nextcloud, Jellyfin e Navidrome sono tutti container.

### 0.2 Volumi: come il container "vede" le cartelle del Pi

Nel file di configurazione troverai righe come questa:

```
- /mnt/storage/shared/books:/calibre-library
  └──── percorso sul Pi ─────┘└ percorso nel container ┘
```

Il programma dentro il container scrive in `/calibre-library`, ma i file finiscono davvero in `/mnt/storage/shared/books` sul disco del Pi. È come una porta tra due stanze: dentro il container la stanza si chiama in un modo, fuori in un altro, ma è la stessa stanza.

**Esempio concreto.** Se dentro il container esiste il file
`/calibre-library/Dante Alighieri/La Divina Commedia (1)/La Divina Commedia - Dante Alighieri.epub`,
sul Pi lo trovi in
`/mnt/storage/shared/books/Dante Alighieri/La Divina Commedia (1)/La Divina Commedia - Dante Alighieri.epub`.

**Trappola tipica.** Quando un'interfaccia web (Calibre-Web, Audiobookshelf) ti chiede un percorso, vuole quello **interno al container** (`/calibre-library`, `/audiobooks`), non quello del Pi. Il programma non sa nemmeno che esiste `/mnt/storage`.

### 0.3 Porte: come raggiungi il servizio

```
- "13378:80"
   └─┬─┘ └┬┘
     │    └── porta DENTRO il container (dove ascolta il programma)
     └─────── porta sul Pi (quella che scrivi nel browser)
```

Audiobookshelf dentro il container ascolta sulla porta 80. Fuori la esponiamo sulla 13378, perché ogni servizio sul Pi deve avere una porta diversa. Le porte che usi già:

| Servizio                          | Porta     |
| --------------------------------- | --------- |
| Navidrome                         | 4533      |
| Nextcloud                         | 8080      |
| Jellyfin                          | 8096      |
| **Calibre-Web Automated (nuovo)** | **8083**  |
| **Audiobookshelf (nuovo)**        | **13378** |

### 0.4 Docker Compose

Invece di scrivere comandi lunghissimi per creare un container, si descrive tutto in un file `compose.yml`: quale immagine, quali cartelle, quali porte. Poi bastano pochi comandi brevi, **da lanciare nella cartella che contiene il file** (per questo i comandi della guida iniziano con `cd`):

| Comando                              | Cosa fa                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `sudo docker compose config -q`      | Controlla che il file sia scritto bene. Se non stampa nulla, è tutto ok              |
| `sudo docker compose pull`           | Scarica (o aggiorna) l'immagine                                                      |
| `sudo docker compose up -d`          | Crea e avvia il container in background (`-d` = "staccato", non occupa il terminale) |
| `sudo docker compose logs --tail 50` | Mostra le ultime 50 righe di log                                                     |
| `sudo docker compose down`           | Ferma e rimuove il container. **I dati nelle cartelle restano**                      |

Il formato YAML è sensibile agli spazi: l'indentazione deve essere fatta **solo con spazi**, mai con il tasto Tab, e gli elementi allo stesso livello devono essere allineati.

### 0.5 Utenti "a numero": 1000 e 33

Linux riconosce gli utenti tramite un numero. Sul tuo Pi:

| Numero (UID) | Nome       | Chi è                                         |
| ------------ | ---------- | --------------------------------------------- |
| 1000         | `morgan`   | tu, e i servizi che facciamo girare "come te" |
| 33           | `www-data` | l'utente con cui lavora Nextcloud             |

Dentro un container i nomi possono essere diversi, ma i numeri sono gli stessi. Quando nel compose scrivi `PUID=1000`, stai dicendo a Calibre-Web: "lavora come l'utente numero 1000", cioè come `morgan`. Così i file che crea appartengono a te e non a `root`.

### 0.6 Permessi e ACL

I permessi classici di Linux prevedono un solo proprietario e un solo gruppo per ogni file. Qui però due "persone" diverse devono poter scrivere nelle stesse cartelle: Nextcloud (33), quando carichi un file dall'iPhone, e i servizi (1000), quando lo spostano o lo svuotano. La soluzione sono le **ACL** (Access Control List), cioè permessi aggiuntivi per utenti specifici. È lo stesso sistema che usi già per Music e Cinema.

Il comando che useremo è questo:

```
setfacl -R -m u:33:rwX,u:1000:rwX,d:u:33:rwX,d:u:1000:rwX CARTELLA
```

Pezzo per pezzo. `-R` applica a tutto il contenuto della cartella, sottocartelle comprese. `-m` vuol dire "modifica" (aggiunge permessi senza togliere quelli esistenti). `u:33:rwX` dà all'utente 33 lettura (`r`), scrittura (`w`) e `X`. La `X` **maiuscola** è furba: dà il permesso di "entrare" nelle cartelle, ma non rende eseguibili i file normali. Il prefisso `d:` sta per _default_ ed è la parte più importante: indica i permessi che **erediteranno i file e le cartelle creati in futuro**. Senza `d:`, un libro caricato domani non avrebbe i permessi giusti.

### 0.7 Lo schema "inbox"

Due cartelle separate: la **inbox**, dove butti i file così come sono, e la **libreria**, dove vivono i file ordinati. Un "robot" prende periodicamente i file dalla inbox, li riconosce, li rinomina e li sposta in libreria. **La libreria non la tocchi mai a mano**: ci pensa il robot.

Per gli ebook il robot è dentro Calibre-Web Automated e reagisce subito, senza timer. Per gli audiolibri il robot è uno script che scriverai nella Parte 6, lanciato da un timer ogni 5 minuti, esattamente come mnamer per i film.

### 0.8 Metadati: da dove arrivano copertine e trame

I **metadati** sono le informazioni sul libro: titolo, autore, serie, trama, copertina, anno, ISBN e, per gli audiolibri, il narratore. Arrivano da due fonti.

La prima è **il file stesso**. Un EPUB contiene al suo interno una piccola "scheda" con titolo, autore e spesso la copertina. Un `.m4b` o un `.mp3` ha dei tag, proprio come le canzoni.

La seconda sono i **fornitori online**: Google Books, Amazon e Hardcover per gli ebook; Audible, Google Books, Open Library e iTunes per gli audiolibri. Il programma legge prima quello che c'è nel file, poi puoi "abbinare" (fare _match_) il libro con una fonte online per avere trama e copertina migliori. È lo stesso principio di Jellyfin con TMDb per i film.

### 0.9 Servizio e timer di systemd

Li usi già per `mnamer-import` e beets. Un **servizio** (`.service`) dice _cosa_ eseguire. Un **timer** (`.timer`) dice _quando_. Il timer degli audiolibri avrà `OnCalendar=*:02/5`, che si legge "ogni ora (`*`), a partire dal minuto 2, ogni 5 minuti": quindi alle :02, :07, :12, :17 e così via.

### 0.10 OPDS

**OPDS** è un formato standard per pubblicare un catalogo di libri sul web. Un'app di lettura compatibile con OPDS può sfogliare la tua libreria e scaricare i libri direttamente, un po' come un'app di podcast legge un feed. Calibre-Web pubblica il suo catalogo OPDS all'indirizzo `/opds`.

---

## Parte 1 — Preparazione

### 1.1 Disattiva la punteggiatura smart dell'iPhone

**Perché:** iOS trasforma le virgolette `"` in `“ ”` e i doppi trattini `--` in `—`. Nei comandi questo li rompe in modi difficili da capire (ti è già successo).

**Come:** Impostazioni → Generali → Tastiera → **Punteggiatura smart** → spento.

### 1.2 Questo è il momento giusto per usare tmux

Scaricare le immagini Docker può richiedere qualche minuto. Se la connessione SSH cade a metà ("Connection reset by peer"), il comando in corso muore con lei. Dentro una sessione **tmux**, invece, il comando continua a girare sul Pi anche se l'iPhone si disconnette.

Apri una sessione dedicata a questa guida:

```
tmux new -s libri
```

Se la connessione cade, ti ricolleghi via SSH e rientri nella stessa sessione, ritrovando tutto com'era:

```
tmux attach -t libri
```

Per uscire da tmux lasciandolo attivo: premi `Ctrl+b`, rilascia, poi premi `d`. Per chiudere davvero la sessione a fine lavoro, scrivi `exit` dentro tmux.

### 1.3 Controlli iniziali

**Cosa fa:** verifica i numeri utente, l'architettura del Pi, lo spazio libero e le versioni di Docker. Non modifica nulla.

```
id morgan && id www-data && uname -m && df -h /mnt/storage && sudo docker --version && sudo docker compose version
```

**Cosa dovresti vedere** (i numeri di versione e le dimensioni saranno diversi):

```
uid=1000(morgan) gid=1000(morgan) groups=1000(morgan),27(sudo),...
uid=33(www-data) gid=33(www-data) groups=33(www-data)
aarch64
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1       1.8T  700G  1.1T  40% /mnt/storage
Docker version 27.x.x, build ...
Docker Compose version v2.x.x
```

**Cosa controllare.** `morgan` deve avere `uid=1000` e `gid=1000`: se il numero fosse diverso, dovresti sostituire `1000` con il tuo numero in tutta la guida. `uname -m` deve dire `aarch64` (sistema a 64 bit): entrambi i programmi lo supportano. La colonna `Avail` ti dice lo spazio libero: un ebook pesa pochi MB, un audiolibro di 10 ore in `.m4b` pesa circa 300 MB. Docker Compose deve essere la versione 2 (`v2.x.x`).

**Cosa fa:** controlla che le porte 8083 e 13378 non siano già occupate da un altro servizio.

```
sudo ss -tlnp | grep -E ':(8083|13378)\s' || echo "OK: porte 8083 e 13378 libere"
```

**Cosa dovresti vedere:** `OK: porte 8083 e 13378 libere`. Se invece compare una riga con il nome di un programma, quella porta è occupata: scegli un altro numero (ad esempio 8084) e usalo al posto di 8083 nella parte sinistra della riga `ports` del compose e in tutti gli indirizzi.

**Cosa fa:** mostra le cartelle che hai già, per confermare che la struttura è quella attesa.

```
ls -la /mnt/storage/shared /mnt/storage/apps
```

**Cosa dovresti vedere:** in `shared` le cartelle `music`, `inbox`, `movies`, `movies_inbox`, `tv`; in `apps` le cartelle `nextcloud`, `mnamer`, `beets` e `_archive`.

---

## Parte 2 — Cartelle e permessi

### 2.1 La mappa delle cartelle

Prima di creare qualcosa, ecco cosa creeremo e perché:

| Cartella sul Pi                                   | A cosa serve                                           | In Nextcloud              |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| `/mnt/storage/shared/books_inbox`                 | dove carichi gli ebook; Calibre-Web la svuota          | **Libri Inbox**           |
| `/mnt/storage/shared/books`                       | libreria ebook di Calibre (file + database)            | non visibile (vedi sotto) |
| `/mnt/storage/shared/audiobooks_inbox`            | dove carichi gli audiolibri                            | **Audiolibri Inbox**      |
| `/mnt/storage/shared/audiobooks`                  | libreria audiolibri, struttura `Autore/Titolo/`        | **Audiolibri**            |
| `/mnt/storage/shared/podcasts`                    | podcast di Audiobookshelf (facoltativo)                | non visibile              |
| `/mnt/storage/apps/calibre-web-automated/`        | compose e impostazioni di Calibre-Web                  | —                         |
| `/mnt/storage/apps/audiobookshelf/`               | compose, database e copertine di Audiobookshelf        | —                         |
| `/mnt/storage/apps/audiobooks-import/`            | lo script di importazione, il suo log e il lock        | —                         |
| `/mnt/storage/apps/_archive/audiobooks-scartati/` | doppioni e file non audio, archiviati e non cancellati | —                         |

**Perché la libreria ebook non va in Nextcloud.** Calibre tiene un database (`metadata.db`) che deve corrispondere esattamente ai file sul disco. Se rinomini, sposti o cancelli un file a mano, il database punta a qualcosa che non esiste più e il libro si rompe. Regola semplice: **la libreria ebook si gestisce solo da Calibre-Web.** La libreria degli audiolibri invece è fatta di semplici cartelle, e Audiobookshelf si riallinea da solo se qualcosa cambia, quindi può stare in Nextcloud come Cinema e Music.

### 2.2 Creare le cartelle

**Cosa fa:** `mkdir -p` crea le cartelle (e le eventuali cartelle "genitore" mancanti) senza dare errore se esistono già. Alla fine `ls` mostra il risultato.

```
sudo mkdir -p /mnt/storage/shared/books /mnt/storage/shared/books_inbox /mnt/storage/shared/audiobooks /mnt/storage/shared/audiobooks_inbox /mnt/storage/shared/podcasts && sudo mkdir -p /mnt/storage/apps/calibre-web-automated/config /mnt/storage/apps/audiobookshelf/config /mnt/storage/apps/audiobookshelf/metadata /mnt/storage/apps/audiobooks-import /mnt/storage/apps/_archive/audiobooks-scartati && ls -la /mnt/storage/shared
```

**Cosa dovresti vedere:** in elenco, oltre alle cartelle di prima, `audiobooks`, `audiobooks_inbox`, `books`, `books_inbox` e `podcasts`.

### 2.3 Proprietario: morgan (1000)

**Cosa fa:** `chown -R 1000:1000` rende `morgan` proprietario delle nuove cartelle di dati e di quelle delle due app, così i container (che girano come 1000) possono scriverci. `ls -ln` mostra i proprietari in forma numerica, per verificare.

```
sudo chown -R 1000:1000 /mnt/storage/shared/books /mnt/storage/shared/books_inbox /mnt/storage/shared/audiobooks /mnt/storage/shared/audiobooks_inbox /mnt/storage/shared/podcasts /mnt/storage/apps/calibre-web-automated /mnt/storage/apps/audiobookshelf && ls -ln /mnt/storage/shared
```

**Cosa dovresti vedere:** le cinque cartelle nuove con `1000 1000` nelle colonne del proprietario, ad esempio:

```
drwxr-xr-x 2 1000 1000 4096 Nov 14 18:00 audiobooks
```

### 2.4 ACL: anche Nextcloud (33) deve poter scrivere

**Cosa fa:** il primo `setfacl` dà a Nextcloud (33) e a te (1000) lettura e scrittura, presenti e future, sulle due inbox e sulla libreria audiolibri, cioè le cartelle che vedrai in Nextcloud. Il secondo `setfacl` dà i permessi solo a 1000 sulla libreria ebook e sui podcast, che Nextcloud non deve toccare. Il `getfacl` finale mostra il risultato su una delle cartelle.

```
sudo setfacl -R -m u:33:rwX,u:1000:rwX,d:u:33:rwX,d:u:1000:rwX /mnt/storage/shared/books_inbox /mnt/storage/shared/audiobooks /mnt/storage/shared/audiobooks_inbox && sudo setfacl -R -m u:1000:rwX,d:u:1000:rwX /mnt/storage/shared/books /mnt/storage/shared/podcasts && getfacl /mnt/storage/shared/audiobooks_inbox
```

**Cosa dovresti vedere** (getfacl traduce i numeri in nomi: 33 diventa `www-data`, 1000 diventa `morgan`):

```
# file: mnt/storage/shared/audiobooks_inbox
# owner: morgan
# group: morgan
user::rwx
user:www-data:rwx
user:morgan:rwx
group::r-x
mask::rwx
other::r-x
default:user::rwx
default:user:www-data:rwx
default:user:morgan:rwx
default:group::r-x
default:mask::rwx
default:other::r-x
```

Le righe da cercare sono `user:www-data:rwx` (Nextcloud può scrivere adesso) e `default:user:www-data:rwx` (Nextcloud potrà scrivere anche nei file creati in futuro).

**Se va storto:** `setfacl: command not found` significa che manca il pacchetto delle ACL. Strano, perché l'hai già usato per Cinema, ma si installa così:

```
sudo apt update && sudo apt install -y acl
```

---

## Parte 3 — Nextcloud: le inbox visibili ovunque

L'obiettivo è vedere in Nextcloud tre nuove cartelle: **Libri Inbox**, **Audiolibri Inbox** e **Audiolibri**. Il procedimento è identico a quello che hai fatto per Cinema: prima si "collegano" le cartelle del Pi al container di Nextcloud (volumi, vedi 0.2), poi si dice a Nextcloud di mostrarle come _External Storage_.

### 3.1 Aggiungere le cartelle al compose di Nextcloud

**Cosa fa, pezzo per pezzo:**

`cd /mnt/storage/apps/nextcloud` entra nella cartella di Nextcloud. `F=$(ls ... | head -1)` trova come si chiama il tuo file compose (può essere `compose.yml`, `docker-compose.yml`…) e lo salva nella variabile `F`. `sudo cp ... _archive/...bak` fa una copia di sicurezza con data e ora nella cartella `_archive`, come da tua regola: si archivia, non si cancella. Poi c'è un controllo: se nel file c'è già `books_inbox`, le righe sono già state aggiunte e non le aggiunge una seconda volta (così il comando è sicuro anche se lo rilanci per sbaglio). Altrimenti `sed -i` cerca la riga che contiene `movies_inbox` e subito dopo inserisce tre righe nuove con la stessa indentazione (`\1` è "lo stesso numero di spazi della riga trovata"). `grep -n "/mnt/"` mostra tutte le righe dei volumi con il numero di riga. Infine `docker compose config -q && echo OK` controlla che il file sia ancora valido.

```
cd /mnt/storage/apps/nextcloud && F=$(ls docker-compose.yml compose.yml docker-compose.yaml compose.yaml 2>/dev/null | head -1) && echo "File: $F" && sudo cp "$F" "/mnt/storage/apps/_archive/nextcloud-$F.$(date +%Y%m%d-%H%M).bak" && (grep -q books_inbox "$F" && echo "Righe già presenti, non le aggiungo di nuovo" || sudo sed -i 's|^\(\s*\)- \(.*\)movies_inbox\(.*\)$|&\n\1- /mnt/storage/shared/books_inbox:/mnt/books-inbox\n\1- /mnt/storage/shared/audiobooks:/mnt/audiobooks\n\1- /mnt/storage/shared/audiobooks_inbox:/mnt/audiobooks-inbox|' "$F") && grep -n "/mnt/" "$F" && sudo docker compose config -q && echo OK
```

**Cosa dovresti vedere** (i numeri di riga saranno diversi), con **OK** in fondo:

```
File: compose.yml
14:      - /mnt/storage/apps/nextcloud/app:/var/www/html
15:      - /mnt/storage/apps/nextcloud/data:/var/www/html/data
16:      - /mnt/storage/shared/music:/mnt/music
17:      - /mnt/storage/shared/inbox:/mnt/music-inbox
18:      - /mnt/storage/shared/movies:/mnt/movies
19:      - /mnt/storage/shared/movies_inbox:/mnt/movies-inbox
20:      - /mnt/storage/shared/books_inbox:/mnt/books-inbox
21:      - /mnt/storage/shared/audiobooks:/mnt/audiobooks
22:      - /mnt/storage/shared/audiobooks_inbox:/mnt/audiobooks-inbox
OK
```

**Se va storto** (le tre righe nuove mancano, oppure non compare OK), ripristina la copia di sicurezza più recente con questo comando:

```
cd /mnt/storage/apps/nextcloud && F=$(ls docker-compose.yml compose.yml docker-compose.yaml compose.yaml 2>/dev/null | head -1) && B=$(ls -t /mnt/storage/apps/_archive/nextcloud-$F.*.bak | head -1) && echo "Ripristino $B" && sudo cp "$B" "$F" && sudo docker compose config -q && echo OK
```

Poi aggiungi le righe a mano con l'editor `nano`. Apri il file (sostituisci `compose.yml` con il nome che ti ha stampato `File:`):

```
cd /mnt/storage/apps/nextcloud && sudo nano compose.yml
```

Spostati con le frecce fino alla riga con `movies_inbox`, vai a fine riga, premi Invio e scrivi le tre righe nuove allineandole **con spazi** esattamente sotto quella sopra. Salva con `Ctrl+O` e poi Invio, esci con `Ctrl+X`.

### 3.2 Riavviare Nextcloud con le nuove cartelle

**Cosa fa:** `docker compose up -d` vede che il compose è cambiato e ricrea il container di Nextcloud con i volumi nuovi (i dati non si toccano). `sleep 20` aspetta che Nextcloud riparta. `docker inspect` elenca i volumi effettivamente collegati al container, così verifichi che i nuovi ci siano davvero.

```
cd /mnt/storage/apps/nextcloud && sudo docker compose up -d && sleep 20 && sudo docker inspect nextcloud-app --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

**Cosa dovresti vedere**, tra le altre, queste tre righe:

```
/mnt/storage/shared/books_inbox -> /mnt/books-inbox
/mnt/storage/shared/audiobooks -> /mnt/audiobooks
/mnt/storage/shared/audiobooks_inbox -> /mnt/audiobooks-inbox
```

### 3.3 Creare le tre cartelle in Nextcloud

**Cosa fa:** `docker exec -u 33 nextcloud-app php occ` esegue `occ`, lo strumento a riga di comando di Nextcloud, dentro il suo container e come utente www-data (33).

`files_external:create "/Libri Inbox" local null::null -c datadir=/mnt/books-inbox` crea una _External Storage_ chiamata "Libri Inbox", di tipo cartella locale (`local`), senza autenticazione (`null::null`), che punta a `/mnt/books-inbox`. Nota bene: è il percorso **dentro il container di Nextcloud**, quello che hai appena collegato (vedi la trappola in 0.2).

`grep -o '[0-9]\+$'` prende dalla risposta di occ ("Storage created with id 7") solo il numero finale e lo salva in `ID1`, `ID2`, `ID3`. `files_external:applicable --add-group=admin` rende ogni cartella visibile al gruppo `admin`, come Music e Cinema. Infine `files_external:list` mostra la tabella completa.

**Lancialo una volta sola:** se lo rilanci, crea cartelle doppie.

```
ID1=$(sudo docker exec -u 33 nextcloud-app php occ files_external:create "/Libri Inbox" local null::null -c datadir=/mnt/books-inbox | grep -o '[0-9]\+$') && ID2=$(sudo docker exec -u 33 nextcloud-app php occ files_external:create /Audiolibri local null::null -c datadir=/mnt/audiobooks | grep -o '[0-9]\+$') && ID3=$(sudo docker exec -u 33 nextcloud-app php occ files_external:create "/Audiolibri Inbox" local null::null -c datadir=/mnt/audiobooks-inbox | grep -o '[0-9]\+$') && sudo docker exec -u 33 nextcloud-app php occ files_external:applicable --add-group=admin $ID1 && sudo docker exec -u 33 nextcloud-app php occ files_external:applicable --add-group=admin $ID2 && sudo docker exec -u 33 nextcloud-app php occ files_external:applicable --add-group=admin $ID3 && sudo docker exec -u 33 nextcloud-app php occ files_external:list
```

**Cosa dovresti vedere:** la tabella con Music, Music Inbox, Cinema, Cinema Inbox e le tre nuove righe `/Libri Inbox`, `/Audiolibri`, `/Audiolibri Inbox`, ognuna con `admin` nella colonna _Applicable Groups_.

**Se hai creato un doppione per errore**, guarda il suo numero nella colonna _Mount ID_ e cancellalo (sostituisci `9` con il numero giusto):

```
sudo docker exec -u 33 nextcloud-app php occ files_external:delete -y 9 && sudo docker exec -u 33 nextcloud-app php occ files_external:list
```

### 3.4 Verifica dall'iPhone

Apri l'app Nextcloud e trascina verso il basso per aggiornare. Nella cartella principale devono comparire **Libri Inbox**, **Audiolibri** e **Audiolibri Inbox**, vuote. Prova a creare una cartella di prova dentro Audiolibri Inbox e poi a cancellarla: se ci riesci, i permessi sono giusti.

---

## Parte 4 — Calibre-Web Automated (ebook)

**Calibre** è il programma storico per gestire librerie di ebook. **Calibre-Web** è la sua versione web, che puoi usare dal browser. **Calibre-Web Automated** (CWA) è Calibre-Web con in più l'importazione automatica: la cartella inbox, la conversione dei formati e il recupero dei metadati.

### 4.1 Scrivere il compose

**Cosa fa:** `sudo tee FILE > /dev/null <<'EOF' … EOF` scrive nel file tutto il testo compreso tra la prima riga e la riga `EOF`. `tee` scrive ciò che riceve dentro il file; `sudo` serve per avere i permessi; `> /dev/null` evita che il testo venga ristampato a schermo. Gli apici in `'EOF'` dicono alla shell di non interpretare niente del testo, per esempio i `$`. Si chiama _heredoc_.

**Incolla tutto il blocco insieme**, dalla prima riga fino a `EOF` compreso.

```
sudo tee /mnt/storage/apps/calibre-web-automated/compose.yml > /dev/null <<'EOF'
# =====================================================================
#  Calibre-Web Automated (CWA): libreria ebook con importazione automatica
#  Interfaccia web:  http://mcloud.tail1b8ce0.ts.net:8083
#  Questo file:      /mnt/storage/apps/calibre-web-automated/compose.yml
# =====================================================================
services:
  calibre-web-automated:
    # Immagine ufficiale del progetto, scaricata da Docker Hub
    image: crocodilestick/calibre-web-automated:latest

    # Nome fisso del container: comodo nei comandi
    # (es. "sudo docker logs calibre-web-automated")
    container_name: calibre-web-automated

    environment:
      # Il programma lavora come utente 1000 (morgan):
      # i file che crea appartengono a te e non a root
      - PUID=1000
      - PGID=1000
      # Fuso orario: date e orari giusti nei log
      - TZ=Europe/Rome

    volumes:
      # Impostazioni, utenti e stato di lettura dell'app (NON i libri)
      - /mnt/storage/apps/calibre-web-automated/config:/config
      # INBOX: ciò che metti qui viene importato e poi RIMOSSO dalla cartella
      - /mnt/storage/shared/books_inbox:/cwa-book-ingest
      # LIBRERIA: i libri ordinati + il database di Calibre (metadata.db)
      - /mnt/storage/shared/books:/calibre-library

    ports:
      # porta sul Pi : porta dentro il container
      - "8083:8083"

    # Riparte da solo dopo un riavvio del Pi o un crash
    # (ma non se lo fermi tu con "docker compose down")
    restart: unless-stopped
EOF
```

I nomi `/cwa-book-ingest` e `/calibre-library` non sono inventati: sono i percorsi che CWA si aspetta dentro il container. Non cambiarli.

### 4.2 Controllare il file

**Cosa fa:** `cat` mostra il file appena scritto; `docker compose config -q` controlla che sia YAML valido.

```
cat /mnt/storage/apps/calibre-web-automated/compose.yml && cd /mnt/storage/apps/calibre-web-automated && sudo docker compose config -q && echo "compose OK"
```

**Cosa dovresti vedere:** il file per intero e, in fondo, `compose OK`. Se invece compare un errore tipo `yaml: line 12: ...`, quasi sempre è un problema di spazi: riscrivi il file con il comando del 4.1.

### 4.3 Scaricare e avviare

**Cosa fa:** `pull` scarica l'immagine (qualche centinaio di MB, ci vuole qualche minuto: ecco perché sei in tmux), `up -d` crea e avvia il container.

```
cd /mnt/storage/apps/calibre-web-automated && sudo docker compose pull && sudo docker compose up -d
```

**Cosa dovresti vedere** alla fine:

```
[+] Running 1/1
 ✔ Container calibre-web-automated  Started
```

### 4.4 Verificare che funzioni

Al primo avvio CWA prepara la libreria e ci mette uno o due minuti. Aspetta, poi:

**Cosa fa:** `docker ps` mostra se il container è attivo; `docker logs` mostra le ultime righe di log; `curl -sI` chiede la pagina al servizio direttamente dal Pi e ne stampa solo la prima riga della risposta.

```
sudo docker ps --filter name=calibre-web-automated && sudo docker logs calibre-web-automated --tail 30 && curl -sI http://localhost:8083 | head -n 1
```

**Cosa dovresti vedere:** nella colonna STATUS qualcosa come `Up 2 minutes`; nei log nessuna riga con `ERROR` ripetuta in continuazione; come ultima riga `HTTP/1.1 302 FOUND` oppure `HTTP/1.1 200 OK`. Entrambe vanno bene: il 302 è un rimando alla pagina di login.

**Se l'ultima riga è vuota**, il servizio non è ancora pronto: aspetta un altro minuto e riprova lo stesso comando.

Ora controlla che CWA abbia creato la libreria vuota:

```
ls -la /mnt/storage/shared/books
```

**Cosa dovresti vedere:** un file `metadata.db`. È il database di Calibre: il cuore della libreria.

### 4.5 Primo accesso e sicurezza

Dall'iPhone, con Tailscale attivo, apri in Safari:

`http://mcloud.tail1b8ce0.ts.net:8083`

Se il nome non viene trovato (ti è già capitato dopo un aggiornamento di iOS), usa l'indirizzo IP: `http://100.64.248.96:8083`.

Accedi con le credenziali di fabbrica: utente **`admin`**, password **`admin123`**.

**Cambia subito la password.** Tocca il nome utente `admin` in alto, scegli una password nuova e salva. Nella stessa pagina, alla voce della lingua, scegli **Italiano**.

Se al primo accesso ti viene chiesto il percorso del database di Calibre (_Location of Calibre database_), scrivi **`/calibre-library`**: è il percorso **dentro il container** (vedi 0.2), non quello del Pi.

### 4.6 Impostazioni consigliate

I nomi esatti delle voci cambiano un po' da una versione all'altra, quindi cerca il significato più che la parola precisa.

**Impostazioni di CWA.** Nel pannello di amministrazione (_Admin_) trovi una pagina dedicata, **CWA Settings**, con le opzioni dell'automazione. Quelle che contano:

La **conversione automatica** va lasciata attiva con formato di destinazione **EPUB**. L'EPUB si legge ovunque, Apple Libri compreso. Se c'è un'opzione per escludere dei formati dalla conversione, escludi PDF e fumetti (CBZ, CBR): convertire un PDF impaginato in EPUB spesso rovina il layout.

Il **recupero automatico dei metadati all'importazione** va attivato, se la tua versione ce l'ha. Se puoi scegliere l'ordine delle fonti, metti Google Books per primo: per i titoli italiani è quello che trova più spesso trama e copertina.

Per i **doppioni**, se la tua versione ha un'opzione su cosa fare quando importi un libro già presente, decidi tu: "ignora" si comporta come i film (il doppione viene scartato), "sovrascrivi" come la musica (la copia nuova sostituisce la vecchia).

I **backup automatici**, se presenti, vanno lasciati attivi. Le opzioni **Kobo** e **kepub** lasciale spente, a meno che tu non abbia un e-reader Kobo.

**Caricamento dal browser (facoltativo).** In _Admin → Modifica configurazione di base → Configurazione funzionalità_ puoi attivare **Abilita caricamento**. Così puoi aggiungere libri anche direttamente dal sito di Calibre-Web, oltre che dalla inbox.

**Altri utenti (facoltativo).** Da _Admin → Aggiungi nuovo utente_ puoi creare un account per ogni persona che usa il cloud. Ognuno avrà i propri scaffali e il proprio stato di lettura, sulla stessa libreria.

---

## Parte 5 — Audiobookshelf (audiolibri)

### 5.1 Scrivere il compose

**Cosa fa:** come nel 4.1, scrive il file compose con un heredoc. Incolla tutto il blocco insieme, fino a `EOF` compreso.

```
sudo tee /mnt/storage/apps/audiobookshelf/compose.yml > /dev/null <<'EOF'
# =====================================================================
#  Audiobookshelf (ABS): server per audiolibri e podcast
#  Interfaccia web:  http://mcloud.tail1b8ce0.ts.net:13378
#  Questo file:      /mnt/storage/apps/audiobookshelf/compose.yml
# =====================================================================
services:
  audiobookshelf:
    # Immagine ufficiale, scaricata dal registro di GitHub (ghcr.io)
    image: ghcr.io/advplyr/audiobookshelf:latest
    container_name: audiobookshelf

    # Gira come utente 1000 (morgan) invece che come root
    user: "1000:1000"

    environment:
      - TZ=Europe/Rome

    volumes:
      # LIBRERIA audiolibri: qui lo script mette Autore/Titolo/
      - /mnt/storage/shared/audiobooks:/audiobooks
      # Podcast (facoltativo: se non li usi resta vuota)
      - /mnt/storage/shared/podcasts:/podcasts
      # Database dell'app: utenti, progressi di ascolto, segnalibri
      - /mnt/storage/apps/audiobookshelf/config:/config
      # Copertine scaricate, cache e backup automatici di ABS
      - /mnt/storage/apps/audiobookshelf/metadata:/metadata

    ports:
      # ABS dentro il container ascolta sulla 80; sul Pi la chiamiamo 13378
      - "13378:80"

    restart: unless-stopped
EOF
```

### 5.2 Controllare, scaricare e avviare

**Cosa fa:** mostra il file, controlla che sia valido, scarica l'immagine e avvia il container. Sono gli stessi passaggi del 4.2 e del 4.3, messi in fila.

```
cat /mnt/storage/apps/audiobookshelf/compose.yml && cd /mnt/storage/apps/audiobookshelf && sudo docker compose config -q && echo "compose OK" && sudo docker compose pull && sudo docker compose up -d
```

**Cosa dovresti vedere:** il file, `compose OK`, il download e infine `✔ Container audiobookshelf  Started`.

### 5.3 Verificare che funzioni

Aspetta una trentina di secondi, poi:

```
sudo docker ps --filter name=audiobookshelf && sudo docker logs audiobookshelf --tail 30 && curl -sI http://localhost:13378 | head -n 1
```

**Cosa dovresti vedere:** STATUS `Up ...` e come ultima riga `HTTP/1.1 200 OK` (oppure un 302).

**Se il container si riavvia in continuazione** (STATUS `Restarting`) e nei log compare `EACCES` o `permission denied` sulla porta 80, significa che l'utente 1000 non riesce ad aprire la porta 80 dentro il container. Togli la riga `user: "1000:1000"` dal compose e riavvia:

```
cd /mnt/storage/apps/audiobookshelf && sudo sed -i '/user: "1000:1000"/d' compose.yml && sudo docker compose up -d && sleep 30 && sudo docker ps --filter name=audiobookshelf
```

Grazie alle ACL della Parte 2, funziona anche così.

### 5.4 Primo accesso

Apri in Safari `http://mcloud.tail1b8ce0.ts.net:13378` (oppure `http://100.64.248.96:13378`).

Al primo avvio ABS ti chiede di creare l'account amministratore, chiamato **root**. Scegli una password robusta, salvala in Vaultwarden e accedi.

### 5.5 Creare la libreria

Vai in **Impostazioni** (icona dell'ingranaggio) → **Librerie** → **Aggiungi libreria** (il pulsante con il `+`). Nella finestra che si apre:

Come **nome** scrivi `Audiolibri`. Come **tipo di media** scegli **Libri** (_Books_). Nella sezione delle **cartelle** scrivi `/audiobooks` e aggiungila: di nuovo, è il percorso dentro il container (vedi 0.2). Come **fornitore di metadati** scegli **Audible.it**, che ha le schede degli audiolibri italiani; se non lo trovi, scegli Audible.com.

Nella scheda **Impostazioni** della stessa finestra, attiva **Solo audiolibri** (_Audiobooks only_): così ABS ignora eventuali file ebook, che sono compito di Calibre-Web. L'opzione delle **copertine quadrate** la scegli tu: le copertine degli audiolibri di solito sono quadrate, quindi attivarla è una buona idea.

Premi **Crea**.

Se vuoi anche i podcast, crea una seconda libreria con nome `Podcast`, tipo **Podcast** e cartella `/podcasts`.

### 5.6 Impostazioni del server

In **Impostazioni → Generale**:

Scegli la **lingua italiana**, se non è già impostata. Assicurati che l'opzione per **disattivare il watcher** (_Disable watcher_) sia **spenta**: il _watcher_ è il "guardiano" che si accorge da solo dei file nuovi nella libreria, e ci serve acceso. Ti consiglio di attivare l'opzione per **salvare le copertine insieme ai file** (_Store covers with item_): la copertina finisce come `cover.jpg` nella cartella del libro, la vedi anche da Nextcloud e sopravvive a una reinstallazione di ABS. Va nella direzione della portabilità che cerchi.

**Altri utenti (facoltativo).** In **Impostazioni → Utenti** puoi creare un account per ogni persona: ognuno avrà i propri progressi e segnalibri.

---

## Parte 6 — Inbox automatica degli audiolibri

Audiobookshelf non ha una inbox come quella di Calibre-Web: legge una libreria che si aspetta già in ordine, nella forma `Autore/Titolo/`. Quindi scriviamo noi il "robot", come mnamer per i film: uno script che ogni 5 minuti guarda nella inbox, decide autore e titolo di ogni audiolibro e lo sposta al posto giusto.

### 6.1 Come ragiona lo script

**La regola d'oro:** ogni elemento al primo livello della inbox è **un** audiolibro. Può essere una cartella (con dentro più file audio, per esempio un mp3 per capitolo) oppure un singolo file (tipicamente un `.m4b`, che contiene già tutti i capitoli). Non mettere due libri nella stessa cartella.

Per decidere **autore e titolo**, lo script prova tre strade, in quest'ordine:

1. **Il nome che hai scelto tu.** Se la cartella o il file si chiama `Autore - Titolo` (con spazio, trattino, spazio), vince quello.
2. **I tag del file audio.** L'autore si prende da `album_artist` o `artist`, il titolo da `album` (o da `title` nel caso di un file unico).
3. **La riserva.** Autore "Autore sconosciuto" e, come titolo, il nome originale.

Perché il nome scelto da te vince sui tag? Perché i tag degli audiolibri sono spesso disordinati: capita di trovare il narratore nel campo dell'artista, o il nome del capitolo al posto del titolo. Il nome che scrivi tu invece è una scelta esplicita.

Ecco qualche esempio:

| Cosa carichi in "Audiolibri Inbox"                                                      | Come decide  | Dove finisce in "Audiolibri"                             |
| --------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------- |
| cartella `Italo Svevo - La coscienza di Zeno/` con `01.mp3`, `02.mp3`…                  | nome         | `Italo Svevo/La coscienza di Zeno/`                      |
| file `Luigi Pirandello - Il fu Mattia Pascal.m4b`                                       | nome         | `Luigi Pirandello/Il fu Mattia Pascal/` (il file dentro) |
| cartella `zeno/` con mp3 taggati _artist = Italo Svevo_, _album = La coscienza di Zeno_ | tag          | `Italo Svevo/La coscienza di Zeno/`                      |
| file `audiolibro.m4b` senza tag                                                         | riserva      | `Autore sconosciuto/audiolibro/`                         |
| cartella con dentro solo un PDF                                                         | nessun audio | dopo 30 minuti in `_archive/audiobooks-scartati/`        |
| un libro già presente in libreria                                                       | doppione     | `_archive/audiobooks-scartati/`                          |

**L'attesa di 10 minuti.** Lo script non tocca niente se nella inbox qualcosa è cambiato negli ultimi 10 minuti. Il motivo: un audiolibro in mp3 può essere fatto di decine di file. Se lo script spostasse la cartella a metà caricamento, i file arrivati dopo finirebbero in una nuova cartella nella inbox, che verrebbe poi scartata come doppione. Con 10 minuti di "silenzio" richiesti, un audiolibro compare in libreria tra 10 e 15 minuti dopo la fine del caricamento. Il valore si cambia in cima allo script (variabile `ATTESA_MINUTI`).

> **Chesterton's Fence.** Tra qualche mese potresti pensare "questa attesa di 10 minuti è inutile, la tolgo". È proprio il caso del principio di Chesterton: prima di abbattere una staccionata, chiediti perché qualcuno l'ha messa lì. Questa serve a non spezzare in due i caricamenti lunghi. Il commento nello script te lo ricorderà.

### 6.2 Installare ffprobe

Per leggere i tag dei file audio lo script usa **ffprobe**, che fa parte del pacchetto `ffmpeg`.

**Cosa fa:** `command -v ffprobe` controlla se ffprobe c'è già; se manca (`||`), aggiorna l'elenco dei pacchetti e installa ffmpeg. Alla fine stampa la versione per conferma.

```
command -v ffprobe || (sudo apt update && sudo apt install -y ffmpeg) && ffprobe -version | head -n 1
```

**Cosa dovresti vedere:** una riga come `ffprobe version 5.1.x ...`.

### 6.3 Scrivere lo script

**Cosa fa:** scrive lo script con un heredoc (vedi 4.1). Incolla tutto il blocco insieme, fino a `EOF` compreso. Leggi i commenti: sono scritti apposta perché tu possa modificare lo script da solo in futuro.

```
sudo tee /mnt/storage/apps/audiobooks-import/run.sh > /dev/null <<'EOF'
#!/bin/bash
# =====================================================================
#  audiobooks-import/run.sh
#
#  COSA FA
#    Prende quello che carichi in "Audiolibri Inbox" e lo sposta nella
#    libreria di Audiobookshelf con la struttura  Autore/Titolo/
#
#  COME DECIDE AUTORE E TITOLO (in quest'ordine)
#    1. Il nome scelto da te:  "Autore - Titolo"  (cartella o file)
#    2. I tag del file audio:  album_artist o artist / album o title
#    3. Riserva:               "Autore sconosciuto" / nome originale
#
#  CHI LO LANCIA
#    audiobooks-import.timer (systemd), ogni 5 minuti.
#
#  VARIABILI CHE PUOI CAMBIARE AL VOLO (valgono solo per quel giro)
#    PROVA=1           non sposta niente, mostra solo cosa farebbe
#    ATTESA_MINUTI=0   non aspetta che la inbox sia "ferma" (utile nei test)
#    Esempio:  sudo env PROVA=1 ATTESA_MINUTI=0 bash run.sh
# =====================================================================

set -uo pipefail
# -u       : se uso una variabile mai definita (es. un errore di battitura)
#            lo script si ferma, invece di andare avanti con un valore vuoto
# pipefail : in "comando1 | comando2", se fallisce comando1 è un errore
# Niente "-e" di proposito: un audiolibro problematico non deve
# bloccare l'importazione di tutti gli altri.

# ---------------------------------------------------------------------
# Impostazioni
# ---------------------------------------------------------------------
INBOX=/mnt/storage/shared/audiobooks_inbox                # Nextcloud: "Audiolibri Inbox"
LIBRERIA=/mnt/storage/shared/audiobooks                   # letta da Audiobookshelf
SCARTATI=/mnt/storage/apps/_archive/audiobooks-scartati   # archiviati, mai cancellati
APP=/mnt/storage/apps/audiobooks-import                   # cartella dello script
LOG="$APP/import.log"

# Minuti di "silenzio" richiesti nella inbox prima di toccare qualcosa.
# NON TOGLIERE: evita di spostare un audiolibro mentre lo stai ancora
# caricando (spezzerebbe i caricamenti lunghi in due, vedi la guida).
# "${VAR:-10}" significa: usa VAR se è stata impostata, altrimenti 10.
ATTESA_MINUTI="${ATTESA_MINUTI:-10}"

# Modalità prova: 1 = mostra soltanto, 0 = fa davvero
PROVA="${PROVA:-0}"

# Estensioni audio riconosciute (find -iregex ignora maiuscole e minuscole)
AUDIO_REGEX='.*\.\(m4b\|m4a\|mp3\|flac\|ogg\|opus\|aac\)'

# ---------------------------------------------------------------------
# Funzioni di supporto
# ---------------------------------------------------------------------

# Scrive un messaggio con data e ora, sia a schermo sia nel file di log
log() {
  local prefisso=""
  if [ "$PROVA" = 1 ]; then prefisso="[PROVA] "; fi
  echo "$(date '+%F %T') ${prefisso}$*" | tee -a "$LOG"
}

# Esegue un comando; in modalità PROVA invece lo mostra e basta.
# Uso: esegui mv -- origine destinazione
esegui() {
  if [ "$PROVA" = 1 ]; then
    echo "    farei: $*"
  else
    "$@"        # "$@" = tutti gli argomenti ricevuti, così come sono
  fi
}

# Legge un tag da un file audio.   Uso: leggi_tag FILE NOME_TAG
# Stampa il valore del tag, oppure niente se il tag non c'è.
leggi_tag() {
  ffprobe -v quiet -show_entries "format_tags=$2" \
          -of default=noprint_wrappers=1:nokey=1 "$1" 2>/dev/null | head -n 1
}

# Rende un testo sicuro come nome di cartella:
#   - sostituisce con _ i caratteri vietati o scomodi:  / \ : * ? " < > |
#     (tr ripete l'ultimo carattere della seconda lista, quindi basta un "_")
#   - toglie spazi e punti all'inizio e alla fine
pulisci() {
  printf '%s' "$1" | tr '/\\:*?"<>|' '_' | sed 's/^[ .]*//; s/[ .]*$//'
}

# Archivia un elemento negli scartati, con data e ora davanti al nome
# (così due scarti con lo stesso nome non si sovrascrivono)
scarta() {
  esegui mv -- "$1" "$SCARTATI/$(date +%Y%m%d-%H%M%S)_$(basename "$1")"
}

# ---------------------------------------------------------------------
# 1) Un solo giro alla volta
#    Il file .lock fa da semaforo: se il giro precedente è ancora in
#    corso, questo esce subito invece di lavorare sugli stessi file.
# ---------------------------------------------------------------------
exec 9>"$APP/.lock"
flock -n 9 || exit 0

# ---------------------------------------------------------------------
# 2) Caricamento in corso? Allora aspetto il prossimo giro
#    Se qualcosa nella inbox è cambiato negli ultimi ATTESA_MINUTI
#    minuti, probabilmente stai ancora caricando: non tocco niente.
# ---------------------------------------------------------------------
if [ -n "$(find "$INBOX" -mindepth 1 -cmin "-$ATTESA_MINUTI" -print -quit)" ]; then
  echo "Inbox modificata da meno di $ATTESA_MINUTI minuti: riprovo al prossimo giro."
  exit 0
fi

# ---------------------------------------------------------------------
# 3) Giro principale: ogni elemento al primo livello della inbox
#    (una cartella oppure un singolo file) è UN audiolibro.
# ---------------------------------------------------------------------
shopt -s nullglob   # se la inbox è vuota, il ciclo non parte nemmeno

for elemento in "$INBOX"/*; do
  nome=$(basename "$elemento")

  # Nome "di base": a un file tolgo l'estensione (".m4b", ".mp3"...)
  if [ -f "$elemento" ]; then
    nome_base="${nome%.*}"
  else
    nome_base="$nome"
  fi

  # --- 3a) Cerco il primo file audio, in ordine alfabetico -----------
  # Funziona sia per le cartelle (cerca dentro) sia per i file singoli.
  primo_audio=$(find "$elemento" -type f -iregex "$AUDIO_REGEX" | sort | head -n 1)

  # --- 3b) Nessun file audio? Lo archivio, ma solo dopo 30 minuti ----
  # (gli lascio tempo: magari hai appena creato la cartella)
  if [ -z "$primo_audio" ]; then
    if [ -n "$(find "$elemento" -maxdepth 0 -mmin +30)" ]; then
      log "Nessun file audio, lo archivio: $nome"
      scarta "$elemento"
    fi
    continue
  fi

  # --- 3c) Decido autore e titolo ------------------------------------
  autore=""
  titolo=""

  # Regola 1: il nome scelto da te, nella forma "Autore - Titolo"
  if [[ "$nome_base" == *" - "* ]]; then
    autore="${nome_base%% - *}"   # tutto quello che sta PRIMA del primo " - "
    titolo="${nome_base#* - }"    # tutto quello che sta DOPO il primo " - "
  fi

  # Regola 2: i tag del file audio, solo per i campi ancora vuoti
  if [ -z "$autore" ]; then autore=$(leggi_tag "$primo_audio" album_artist); fi
  if [ -z "$autore" ]; then autore=$(leggi_tag "$primo_audio" artist); fi
  if [ -z "$titolo" ]; then titolo=$(leggi_tag "$primo_audio" album); fi
  # In un file unico (.m4b) il tag "title" di solito è il titolo del libro;
  # in una cartella di mp3 invece è il nome del capitolo, quindi lì non lo uso.
  if [ -z "$titolo" ] && [ -f "$elemento" ]; then
    titolo=$(leggi_tag "$primo_audio" title)
  fi

  # Se ci sono più autori ("Rossi/Bianchi" oppure "Rossi; Bianchi") tengo il primo
  autore="${autore%%[/;]*}"

  # Rendo i nomi sicuri come cartelle
  autore=$(pulisci "$autore")
  titolo=$(pulisci "$titolo")

  # Regola 3: valori di riserva
  if [ -z "$autore" ]; then autore="Autore sconosciuto"; fi
  if [ -z "$titolo" ]; then titolo=$(pulisci "$nome_base"); fi

  destinazione="$LIBRERIA/$autore/$titolo"

  # --- 3d) È un doppione? Allora non lo aggiungo una seconda volta ----
  if [ -e "$destinazione" ]; then
    log "Già in libreria ($autore / $titolo), archivio il doppione: $nome"
    scarta "$elemento"
    continue
  fi

  # --- 3e) Sposto nella libreria --------------------------------------
  # Inbox e libreria stanno sullo stesso disco: "mv" è istantaneo,
  # non copia i dati, cambia solo il percorso.
  esegui mkdir -p -- "$LIBRERIA/$autore"
  if [ -d "$elemento" ]; then
    # La cartella intera diventa .../Autore/Titolo
    esegui mv -- "$elemento" "$destinazione"
  else
    # Il file singolo va dentro una cartella tutta sua .../Autore/Titolo/
    esegui mkdir -p -- "$destinazione" && esegui mv -- "$elemento" "$destinazione/"
  fi
  esito=$?   # 0 = tutto bene, altro = errore

  if [ "$esito" -eq 0 ]; then
    log "Importato: $autore / $titolo"
  else
    log "ERRORE nello spostare: $nome (codice $esito)"
  fi
done

exit 0
EOF
```

### 6.4 Renderlo eseguibile e controllarne la sintassi

**Cosa fa:** `chmod +x` rende lo script eseguibile. `bash -n` legge lo script e controlla che sia scritto correttamente **senza eseguirlo**: è il modo più rapido per scoprire una parentesi mancante o un errore di copia-incolla.

```
sudo chmod +x /mnt/storage/apps/audiobooks-import/run.sh && bash -n /mnt/storage/apps/audiobooks-import/run.sh && echo "Sintassi OK"
```

**Cosa dovresti vedere:** `Sintassi OK`. Se compare un errore tipo `line 42: syntax error`, il copia-incolla si è rovinato (spesso per colpa della punteggiatura smart): riscrivi il file con il comando del 6.3.

### 6.5 Test con audiolibri finti

Non serve un vero audiolibro per provare lo script: ffmpeg può generare un mp3 di 5 secondi (un "beep") con i tag che vogliamo.

**Cosa fa:** crea `/tmp/prova.mp3` con i tag _artist = Mario Rossi_ e _album = Libro di Prova_. Poi prepara due casi nella inbox: una cartella `prova-tag` che contiene quel file (caso "tag") e un file chiamato `Anna Bianchi - Racconto di Prova.mp3` (caso "nome"). Alla fine mostra la inbox.

```
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:duration=5" -metadata artist="Mario Rossi" -metadata album="Libro di Prova" /tmp/prova.mp3 && sudo mkdir -p /mnt/storage/shared/audiobooks_inbox/prova-tag && sudo cp /tmp/prova.mp3 /mnt/storage/shared/audiobooks_inbox/prova-tag/ && sudo cp /tmp/prova.mp3 "/mnt/storage/shared/audiobooks_inbox/Anna Bianchi - Racconto di Prova.mp3" && ls -la /mnt/storage/shared/audiobooks_inbox
```

**Prima la prova a secco.** `PROVA=1` fa sì che lo script mostri cosa farebbe senza spostare niente. `ATTESA_MINUTI=0` salta l'attesa di 10 minuti, che altrimenti lo fermerebbe perché hai appena copiato i file. `sudo env VARIABILE=valore comando` è il modo sicuro per passare variabili a un comando lanciato con sudo.

```
sudo env PROVA=1 ATTESA_MINUTI=0 bash /mnt/storage/apps/audiobooks-import/run.sh
```

**Cosa dovresti vedere** (l'ordine può cambiare):

```
    farei: mkdir -p -- /mnt/storage/shared/audiobooks/Anna Bianchi
    farei: mkdir -p -- /mnt/storage/shared/audiobooks/Anna Bianchi/Racconto di Prova
    farei: mv -- /mnt/storage/shared/audiobooks_inbox/Anna Bianchi - Racconto di Prova.mp3 /mnt/storage/shared/audiobooks/Anna Bianchi/Racconto di Prova/
2026-11-14 18:10:00 [PROVA] Importato: Anna Bianchi / Racconto di Prova
    farei: mkdir -p -- /mnt/storage/shared/audiobooks/Mario Rossi
    farei: mv -- /mnt/storage/shared/audiobooks_inbox/prova-tag /mnt/storage/shared/audiobooks/Mario Rossi/Libro di Prova
2026-11-14 18:10:00 [PROVA] Importato: Mario Rossi / Libro di Prova
```

Il primo libro è stato riconosciuto dal **nome**, il secondo dai **tag** (la cartella si chiamava `prova-tag`, ma il libro diventa "Libro di Prova" di "Mario Rossi").

**Ora per davvero.** Stesso comando senza `PROVA=1`; poi `find` mostra la libreria fino a tre livelli di profondità (Autore, Titolo, file).

```
sudo env ATTESA_MINUTI=0 bash /mnt/storage/apps/audiobooks-import/run.sh && find /mnt/storage/shared/audiobooks -maxdepth 3
```

**Cosa dovresti vedere:**

```
/mnt/storage/shared/audiobooks
/mnt/storage/shared/audiobooks/Anna Bianchi
/mnt/storage/shared/audiobooks/Anna Bianchi/Racconto di Prova
/mnt/storage/shared/audiobooks/Anna Bianchi/Racconto di Prova/Anna Bianchi - Racconto di Prova.mp3
/mnt/storage/shared/audiobooks/Mario Rossi
/mnt/storage/shared/audiobooks/Mario Rossi/Libro di Prova
/mnt/storage/shared/audiobooks/Mario Rossi/Libro di Prova/prova.mp3
```

Apri Audiobookshelf: entro un minuto devono comparire i due libri. Se non compaiono, vai in **Impostazioni → Librerie**, apri il menu `⋮` accanto ad _Audiolibri_ e scegli **Scansiona**.

**Test dei doppioni.** Ricarica lo stesso libro e verifica che venga archiviato invece di essere aggiunto due volte:

```
sudo mkdir -p /mnt/storage/shared/audiobooks_inbox/prova-tag && sudo cp /tmp/prova.mp3 /mnt/storage/shared/audiobooks_inbox/prova-tag/ && sudo env ATTESA_MINUTI=0 bash /mnt/storage/apps/audiobooks-import/run.sh && ls -la /mnt/storage/apps/_archive/audiobooks-scartati
```

**Cosa dovresti vedere:** la riga `Già in libreria (Mario Rossi / Libro di Prova), archivio il doppione: prova-tag`, e negli scartati una cartella come `20261114-181500_prova-tag`.

**Pulizia dei test.** Cancella i libri finti, svuota gli scartati di prova e rimuovi il file temporaneo:

```
sudo rm -rf "/mnt/storage/shared/audiobooks/Mario Rossi" "/mnt/storage/shared/audiobooks/Anna Bianchi" && sudo find /mnt/storage/apps/_archive/audiobooks-scartati -mindepth 1 -delete && rm -f /tmp/prova.mp3 && ls -la /mnt/storage/shared/audiobooks
```

In Audiobookshelf i due libri resteranno visibili come "mancanti". Per toglierli, nella libreria filtra per **Problemi** (_Issues_) e usa il pulsante per rimuovere gli elementi mancanti.

### 6.6 Il servizio systemd

**Cosa fa:** scrive il file del servizio, cioè _cosa_ eseguire. `RequiresMountsFor=/mnt/storage` fa partire lo script solo se il disco dati è montato (così non lavora mai su un disco assente). `Type=oneshot` vuol dire "esegui e finisci", non è un programma sempre acceso. `Nice=10` e `IOSchedulingClass=idle` danno allo script la priorità più bassa per processore e disco: non deve mai rallentare un film su Jellyfin o la musica su Navidrome. Incolla tutto il blocco fino a `EOF`.

```
sudo tee /etc/systemd/system/audiobooks-import.service > /dev/null <<'EOF'
[Unit]
Description=Import audiolibri dalla inbox (Audiobookshelf)
# Parte solo se il disco dati è montato
RequiresMountsFor=/mnt/storage

[Service]
Type=oneshot
ExecStart=/mnt/storage/apps/audiobooks-import/run.sh
# Priorità bassa: non deve rallentare film e musica
Nice=10
IOSchedulingClass=idle
EOF
```

### 6.7 Il timer systemd

Prima guarda quando partono gli altri import, così sfalsi quello nuovo e il disco non deve fare tutto nello stesso istante:

```
systemctl list-timers --no-pager
```

Nella colonna **NEXT** vedi l'orario della prossima esecuzione di ogni timer (cerca `mnamer-import` e quello di beets). Il timer nuovo partirà ai minuti :02, :07, :12… Se uno degli altri usa già quei minuti, nel comando qui sotto cambia `*:02/5` in `*:03/5` o `*:04/5`.

**Cosa fa:** scrive il file del timer, cioè _quando_ eseguire. `Persistent=true` fa sì che, se il Pi era spento all'orario previsto, il giro saltato venga recuperato alla riaccensione. Incolla tutto il blocco fino a `EOF`.

```
sudo tee /etc/systemd/system/audiobooks-import.timer > /dev/null <<'EOF'
[Unit]
Description=Import audiolibri ogni 5 minuti

[Timer]
# Ogni 5 minuti a partire dal minuto 2 (:02, :07, :12, ...),
# sfalsato rispetto agli import di musica e film
OnCalendar=*:02/5
# Se il Pi era spento all'orario previsto, recupera alla riaccensione
Persistent=true

[Install]
WantedBy=timers.target
EOF
```

### 6.8 Attivare il timer

**Cosa fa:** `daemon-reload` fa rileggere a systemd i file nuovi. `enable --now` attiva il timer adesso e a ogni avvio del Pi. `list-timers` mostra quando partirà la prima volta.

```
sudo systemctl daemon-reload && sudo systemctl enable --now audiobooks-import.timer && systemctl list-timers audiobooks-import.timer --no-pager
```

**Cosa dovresti vedere:** una riga con `audiobooks-import.timer` e, nella colonna NEXT, un orario entro i prossimi 5 minuti.

Dopo che è partito almeno una volta, controlla che il giro sia andato bene:

```
journalctl -u audiobooks-import.service -n 20 --no-pager
```

**Cosa dovresti vedere:** righe come `Finished audiobooks-import.service - Import audiolibri dalla inbox (Audiobookshelf).` Se la inbox era vuota, lo script non scrive altro: è normale.

---

## Parte 7 — Prova completa dall'iPhone

### 7.1 Un ebook

Scarica un ebook di pubblico dominio in formato EPUB, per esempio un classico italiano da **Liber Liber** (liberliber.it) o da **Project Gutenberg** (gutenberg.org). In Safari, quando il download è finito, tocca **Condividi → Salva su File**, scegli **Nextcloud** e poi la cartella **Libri Inbox**. In alternativa: apri l'app Nextcloud, entra in _Libri Inbox_, tocca **+** e carica il file.

Entro pochi secondi il file **sparisce dalla inbox** (aggiorna la cartella trascinando verso il basso). È il segnale che Calibre-Web Automated l'ha preso in carico. Apri Calibre-Web: il libro è in libreria, con la copertina.

Se manca la trama o la copertina è brutta: apri il libro, tocca **Modifica metadati**, poi **Recupera metadati** (_Fetch metadata_). Cerca il titolo, scegli il risultato giusto e salva. Con le impostazioni del 4.6 attive, CWA scrive le modifiche anche dentro il file EPUB.

Per vedere cosa è successo dietro le quinte:

```
sudo docker logs calibre-web-automated --tail 40
```

### 7.2 Un audiolibro

Liber Liber offre anche audiolibri gratuiti in italiano, e **LibriVox** (librivox.org) ne ha moltissimi di pubblico dominio. Di solito sono una serie di mp3, uno per capitolo.

Il modo più affidabile per caricare un audiolibro fatto di tanti file è **dal Mac**: rinomina la cartella in `Autore - Titolo` e trascinala intera dentro _Audiolibri Inbox_ (dall'app Nextcloud per Mac o dal sito di Nextcloud). Dall'iPhone puoi creare la cartella `Autore - Titolo` dentro _Audiolibri Inbox_ e poi caricarci dentro i file, ma cerca di caricarli tutti in una volta sola (ricordi l'attesa di 10 minuti del 6.1). Un singolo file `.m4b` invece si carica da qualsiasi dispositivo senza pensieri.

Tra 10 e 15 minuti dopo la fine del caricamento, l'audiolibro compare in Audiobookshelf. Per seguire lo script in tempo reale:

```
tail -n 30 /mnt/storage/apps/audiobooks-import/import.log
```

**Abbinare i metadati online.** Apri l'audiolibro in ABS, tocca l'icona della **matita** (modifica), vai nella scheda **Abbina** (_Match_), cerca il titolo, scegli il risultato giusto e conferma. Arrivano copertina in alta qualità, trama, narratore e serie. Per abbinare tutta la libreria in una volta: **Impostazioni → Librerie → menu `⋮` di Audiolibri → abbina libri** (_Match books_). È comodo, ma prende sempre il primo risultato trovato: controlla poi i libri dall'aspetto strano.

---

## Parte 8 — Leggere e ascoltare sull'iPhone

Tutto funziona solo con **Tailscale attivo** sull'iPhone, esattamente come Jellyfin e Navidrome.

### 8.1 Ebook

Hai tre modi, dal più semplice al più comodo.

**Nel browser.** In Calibre-Web apri un libro e tocca **Leggi nel browser**. Per averlo come un'app: in Safari tocca **Condividi → Aggiungi alla schermata Home**.

**In Apple Libri.** In Calibre-Web apri il libro, tocca **Scarica** e scegli EPUB; poi **Condividi → Libri**. Il libro diventa una copia locale, che resta leggibile anche offline.

**Con un'app OPDS.** Le app di lettura compatibili con OPDS (per esempio Readest o KyBook 3; prima di sceglierne una, verifica nella descrizione dell'App Store che supporti i cataloghi OPDS) possono sfogliare la tua libreria e scaricare i libri direttamente. L'indirizzo da inserire è:

`http://mcloud.tail1b8ce0.ts.net:8083/opds`

con il tuo utente e la tua password di Calibre-Web.

### 8.2 Audiolibri

Cerca **Audiobookshelf** nell'App Store. Esistono sia l'app ufficiale (per un periodo è stata distribuita solo tramite TestFlight) sia app alternative pensate per iPhone, come **ShelfPlayer** e **Plappa**. Tutte chiedono l'indirizzo del server:

`http://mcloud.tail1b8ce0.ts.net:13378`

oppure `http://100.64.248.96:13378` se il nome non viene trovato. Poi utente e password di ABS. Con queste app puoi scaricare l'audiolibro per ascoltarlo offline, usare il timer di spegnimento e ritrovare il punto esatto dove eri arrivato su qualsiasi dispositivo.

---

## Parte 9 — Manutenzione e risoluzione problemi

### 9.1 Aggiornare

**Cosa fa:** `pull` scarica la versione nuova dell'immagine; `up -d` ricrea il container con quella versione (i dati non si toccano); `image prune -f` cancella le immagini vecchie non più usate e libera spazio.

Calibre-Web Automated:

```
cd /mnt/storage/apps/calibre-web-automated && sudo docker compose pull && sudo docker compose up -d && sudo docker image prune -f
```

Audiobookshelf:

```
cd /mnt/storage/apps/audiobookshelf && sudo docker compose pull && sudo docker compose up -d && sudo docker image prune -f
```

Un buon ritmo è una volta al mese. Prima di un aggiornamento importante, fai un backup delle cartelle `config` (vedi 9.3).

### 9.2 Controllare lo stato

Tutti i container in un colpo d'occhio:

```
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Log di Calibre-Web Automated:

```
sudo docker logs calibre-web-automated --tail 50
```

Log di Audiobookshelf:

```
sudo docker logs audiobookshelf --tail 50
```

Log dello script degli audiolibri:

```
tail -n 50 /mnt/storage/apps/audiobooks-import/import.log
```

Stato del timer degli audiolibri:

```
systemctl list-timers audiobooks-import.timer --no-pager && journalctl -u audiobooks-import.service -n 20 --no-pager
```

### 9.3 Cosa mettere nel backup

Quando completerai il backup off-site, queste sono le cartelle da includere:

| Cosa                | Dove                                             | Perché conta                                                                     |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Libreria ebook      | `/mnt/storage/shared/books`                      | i libri **e** il loro database `metadata.db`: vanno salvati sempre insieme       |
| Impostazioni di CWA | `/mnt/storage/apps/calibre-web-automated/config` | utenti, scaffali, stato di lettura                                               |
| Audiolibri          | `/mnt/storage/shared/audiobooks`                 | i file                                                                           |
| Database di ABS     | `/mnt/storage/apps/audiobookshelf/config`        | progressi di ascolto e segnalibri: se lo perdi, perdi il punto dove eri arrivato |
| Metadati di ABS     | `/mnt/storage/apps/audiobookshelf/metadata`      | copertine e backup automatici di ABS                                             |
| Script di import    | `/mnt/storage/apps/audiobooks-import`            | lo script e il suo log                                                           |

### 9.4 Problemi comuni

| Sintomo                                                              | Causa probabile                                                              | Cosa fare                                                                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| La pagina non si apre dall'iPhone                                    | Tailscale spento, o il nome `mcloud` non viene risolto                       | attiva Tailscale; prova con l'IP `100.64.248.96`                                                                                                                    |
| `curl` non risponde                                                  | container fermo o ancora in avvio                                            | `sudo docker ps -a` per vedere lo stato, poi i log del container                                                                                                    |
| Nei log compare `Permission denied`                                  | permessi delle cartelle                                                      | rilancia i comandi del 2.3 e del 2.4, poi controlla con `getfacl`                                                                                                   |
| L'ebook resta nella inbox                                            | CWA non l'ha visto o il formato non è supportato                             | guarda i log di CWA; prova a riavviarlo con `cd /mnt/storage/apps/calibre-web-automated && sudo docker compose restart`                                             |
| L'ebook sparisce ma non compare in libreria                          | doppione scartato o conversione fallita                                      | guarda i log di CWA e l'impostazione dei doppioni (4.6)                                                                                                             |
| L'audiolibro resta nella inbox                                       | l'attesa di 10 minuti non è ancora passata, il timer è fermo o c'è un errore | `tail -n 50 /mnt/storage/apps/audiobooks-import/import.log` e lo stato del timer (9.2)                                                                              |
| L'audiolibro finisce in "Autore sconosciuto"                         | niente nome `Autore - Titolo` e niente tag                                   | in ABS usa **Abbina** (7.2): i dati mostrati si correggono anche senza spostare i file                                                                              |
| Un audiolibro è spezzato in due (una parte archiviata come doppione) | il caricamento si è fermato per più di 10 minuti                             | recupera i file da `_archive/audiobooks-scartati`, spostali nella cartella del libro, poi in ABS **Scansiona**; se capita spesso, alza `ATTESA_MINUTI` nello script |
| Il libro non compare in ABS                                          | il watcher non l'ha notato                                                   | **Impostazioni → Librerie → `⋮` → Scansiona**                                                                                                                       |

---

## Parte 10 — Prossimi passi

### 10.1 Collegare July

Ora che le inbox esistono, aggiungere libri e audiolibri a July è naturale: due categorie in più nel sistema di upload a topic che stai già costruendo.

**Libri** → salva in `/mnt/storage/shared/books_inbox`. **Audiolibri** → salva in `/mnt/storage/shared/audiobooks_inbox`. Siccome July gira in Docker (`july-api`), le due cartelle vanno prima aggiunte ai volumi del suo compose, con lo stesso meccanismo che hai visto nel 3.1.

Per il riconoscimento automatico della categoria: `.epub`, `.mobi` e `.azw3` sono sicuramente libri; `.m4b` è sicuramente un audiolibro; `.mp3` è ambiguo (musica o audiolibro?), quindi lì July deve chiedertelo, come fa già quando non è sicuro.

C'è un punto delicato da gestire nel codice: July riceve i file uno alla volta. Se un audiolibro è fatto di tanti mp3 e July li salva tutti al primo livello della inbox, lo script li tratterà come tanti libri diversi (regola d'oro del 6.1). July deve quindi salvarli dentro una sottocartella `Autore - Titolo/`, chiedendoti il nome oppure ricavandolo dai tag del primo file.

### 10.2 Questo è il momento giusto per un ADR

Hai appena preso una decisione architetturale con alternative vere: due servizi invece di uno, Booklore scartato, lo script degli audiolibri. Tra sei mesi ti chiederai "perché non ho usato solo Audiobookshelf?". Un **Architecture Decision Record** risponde a questa domanda in due minuti di lettura. Eccone uno già impostato, da salvare dove tieni gli altri ADR:

```
# ADR-000X — Ebook con Calibre-Web Automated, audiolibri con Audiobookshelf

Data: 2026-11-14 · Stato: accettata

## Contesto
Voglio ebook e audiolibri sul Pi con lo stesso flusso di musica e film:
carico in una inbox di Nextcloud, il resto avviene da solo, con copertine
e schede. Il Pi esegue già Nextcloud, Jellyfin, Navidrome, Home Assistant
e un LLM locale: le risorse sono limitate.

## Decisione
- Ebook: Calibre-Web Automated (inbox nativa, conversione e metadati automatici).
- Audiolibri: Audiobookshelf + script audiobooks-import con timer systemd
  (ogni 5 minuti, attesa di 10 minuti di inattività nella inbox).

## Alternative scartate
- Solo Audiobookshelf anche per gli ebook: un servizio in meno, ma
  l'importazione degli ebook è poco automatica.
- Booklore: interfaccia migliore, ma Java + MariaDB, troppo pesante per il Pi.
- Readarr: progetto dismesso nel 2025.

## Conseguenze
- Due servizi in più da aggiornare (porte 8083 e 13378).
- La libreria ebook non va mai modificata a mano (database di Calibre).
- Gli audiolibri fatti di tanti file vanno caricati tutti in una volta.
```

---

## Appendice — Mappa rapida

### Servizi

| Servizio              | Indirizzo                                   | Compose / script                                      |
| --------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Calibre-Web Automated | `http://mcloud.tail1b8ce0.ts.net:8083`      | `/mnt/storage/apps/calibre-web-automated/compose.yml` |
| Catalogo OPDS         | `http://mcloud.tail1b8ce0.ts.net:8083/opds` | —                                                     |
| Audiobookshelf        | `http://mcloud.tail1b8ce0.ts.net:13378`     | `/mnt/storage/apps/audiobookshelf/compose.yml`        |
| Import audiolibri     | timer ogni 5 minuti                         | `/mnt/storage/apps/audiobooks-import/run.sh`          |

### Cartelle

| Sul Pi                                           | Nel container                                           | In Nextcloud     |
| ------------------------------------------------ | ------------------------------------------------------- | ---------------- |
| `/mnt/storage/shared/books_inbox`                | CWA: `/cwa-book-ingest` · Nextcloud: `/mnt/books-inbox` | Libri Inbox      |
| `/mnt/storage/shared/books`                      | CWA: `/calibre-library`                                 | —                |
| `/mnt/storage/shared/audiobooks_inbox`           | Nextcloud: `/mnt/audiobooks-inbox`                      | Audiolibri Inbox |
| `/mnt/storage/shared/audiobooks`                 | ABS: `/audiobooks` · Nextcloud: `/mnt/audiobooks`       | Audiolibri       |
| `/mnt/storage/shared/podcasts`                   | ABS: `/podcasts`                                        | —                |
| `/mnt/storage/apps/_archive/audiobooks-scartati` | —                                                       | —                |

### Comandi più usati

Stato di tutti i container:

```
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Log dell'import degli audiolibri:

```
tail -n 50 /mnt/storage/apps/audiobooks-import/import.log
```

Lanciare subito l'import degli audiolibri, senza aspettare il timer:

```
sudo systemctl start audiobooks-import.service && tail -n 20 /mnt/storage/apps/audiobooks-import/import.log
```

Prova a secco dell'import (non sposta nulla):

```
sudo env PROVA=1 ATTESA_MINUTI=0 bash /mnt/storage/apps/audiobooks-import/run.sh
```

Riavviare Calibre-Web Automated:

```
cd /mnt/storage/apps/calibre-web-automated && sudo docker compose restart
```

Riavviare Audiobookshelf:

```
cd /mnt/storage/apps/audiobookshelf && sudo docker compose restart
```
