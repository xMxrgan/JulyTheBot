# Idee · Famiglia

Schede dei progetti per la famiglia. Una scheda non è una guida: dice **cosa** e **perché**, abbozza il **come** e raccoglie i dubbi. Quando un progetto entra in sviluppo, la scheda diventa una guida in `funzioni/`.

Tutte dipendono da **FA01**, tranne FA12 e FA16.

| ID | Progetto | Difficoltà | Fase |
| --- | --- | --- | --- |
| [FA01](#fa01--spazio-comune-e-gruppo-di-famiglia) | Spazio comune e gruppo di famiglia | ★★★ | 1 |
| [FA02](#fa02--promemoria-in-linguaggio-naturale) | Promemoria in linguaggio naturale | ★★★ | 1 |
| [FA03](#fa03--promemoria-allarrivo-a-casa) | Promemoria all'arrivo a casa | ★★★ | 3 |
| [FA04](#fa04--scadenze-di-casa) | Scadenze di casa | ★★ | 2 |
| [FA05](#fa05--faccende-a-turni) | Faccende a turni | ★★★ | 2 |
| [FA06](#fa06--chi-cè-a-cena) | "Chi c'è a cena?" | ★★ | 2 |
| [FA07](#fa07--lista-della-spesa-evoluta) | Lista della spesa evoluta | ★★★ | 2 |
| [FA08](#fa08--dispensa-e-frigo) | Dispensa e frigo | ★★★ | 4 |
| [FA09](#fa09--spese-condivise) | Spese condivise | ★★★ | 2 |
| [FA10](#fa10--la-lavatrice-ha-finito) | "La lavatrice ha finito" | ★★★ | 3 |
| [FA11](#fa11--allarmi-con-ci-penso-io) | Allarmi con "Ci penso io" | ★★★ | 3 |
| [FA12](#fa12--wifi-per-gli-ospiti) | Wi‑Fi per gli ospiti | ★ | 2 |
| [FA13](#fa13--registro-manutenzione) | Registro manutenzione | ★★ | 2 |
| [FA14](#fa14--idee-regalo-nascoste) | Idee regalo nascoste | ★★★ | 2 |
| [FA15](#fa15--foto-della-settimana) | Foto della settimana | ★★ | 2 |
| [FA16](#fa16--tutto-bene-per-chi-vive-da-solo) | "Tutto bene?" per chi vive da solo | ★★★★ | 4 |

---

## FA01 · Spazio comune e gruppo di famiglia

**Problema.** Oggi July ha solo compartimenti privati. Liste, turni e spese sono di tutti.

**Cosa fa.**

```
(nel gruppo "Casa")
Tu:    /collega
July:  ✅ Gruppo collegato allo spazio di famiglia. Membri: 3.
```

**Come funziona.**

- In `users.ts`, campo `famiglia: true` per chi fa parte della famiglia.
- Colonna `spazio` (`u:<ID>` o `famiglia`) in ogni tabella, e `puoVedere(persona, spazio)` in `core/spazi.ts`: l'unico posto che decide.
- Tabella `gruppi (chat_id, spazio, collegato_da, ts)`. Un gruppo non registrato → July esce.
- In `gestisciTesto`: se il messaggio arriva da un gruppo, lo spazio è `famiglia` e l'AI non riceve i ricordi privati.
- Preferenza per persona: gli avvisi di famiglia nel gruppo o in privato.

**Riusa:** `users.ts`, G00 A.
**Privacy:** il punto è proprio questo. Privacy mode di @BotFather attiva; dopo aver aggiunto July al gruppo, `/setjoingroups` disattivato.
**Difficoltà:** ★★★, non per il codice ma perché tocca il router e tutte le funzioni dopo. Va fatta bene una volta.
**Domande aperte:** chi fa parte della famiglia? Una sola famiglia o anche parenti in un'altra casa (spazi multipli)?

---

## FA02 · Promemoria in linguaggio naturale

**Problema.** July oggi risponde che non può mandare promemoria.

**Cosa fa.**

```
Tu:    ricordami domani alle 9 di chiamare il dottore
July:  ⏰ Martedì 10 novembre, 9:00 · «chiamare il dottore»   [OK] [Cambia]

July:  ⏰ Chiamare il dottore   [✅ Fatto] [10 min] [Domani]

Tu:    ricorda a tutti ogni primo lunedì del mese di pagare l'affitto
```

**Come funziona.**

- **Corsia veloce** con regex per i casi semplici ("tra 10 minuti", "alle 18").
- **Il resto con Qwen** e output strutturato: `{ testo, quando (ISO), ripetizione, destinatari }`. Data e ora di oggi nel messaggio utente (stessa tecnica di G10). Il codice controlla che la data sia valida e nel futuro.
- **Mostra sempre cosa ha capito** prima di salvare.
- Tabella `promemoria (id, spazio, per, testo, prossimo_ts, regola, stato)`. La ripetizione come pattern cron di croner.
- All'avvio di July ricarica tutti i promemoria futuri nello scheduler; quelli scaduti mentre era spento li manda con "in ritardo".
- Dopo, aggiorna il prompt di `ai.ts`: July ora sa mandare promemoria.

**Riusa:** G00 A (scheduler, db), tecnica di G01 e G10 per l'output strutturato.
**Privacy:** promemoria personali in privato; "a tutti" solo nello spazio di famiglia.
**Difficoltà:** ★★★ per le date relative e le ripetizioni ("ogni primo lunedì", "l'ultimo giorno del mese").
**Domande aperte:** ripetizioni complesse con cron o con una regola propria? Fuso orario fisso Europe/Rome anche in viaggio?

---

## FA03 · Promemoria all'arrivo a casa

**Problema.** Certe cose vanno ricordate in un posto, non a un'ora: "quando torni, prendi il pacco dal vicino".

**Cosa fa.**

```
Tu:    quando NOME arriva a casa, ricordale di ritirare il pacco
July:  📍 Lo ricordo a NOME al suo prossimo arrivo.

(a NOME, quando arriva)
July:  📍 Da OJ: ritirare il pacco.
```

**Come funziona.** Un tipo di promemoria in più in FA02, con trigger `arrivo` invece di un orario. Si iscrive agli eventi di G02 e si consegna una volta.
**Riusa:** FA02, G02.
**Privacy:** chi lascia il promemoria **non** riceve conferma della consegna (rivelerebbe l'ora di arrivo dell'altra persona), a meno che lei abbia attivato la condivisione della presenza.
**Difficoltà:** ★★★, soprattutto per i falsi arrivi di G02.
**Domande aperte:** anche "quando esco di casa" (per "prendi l'ombrello")?

---

## FA04 · Scadenze di casa

**Problema.** Bollo, revisione, assicurazione, documenti, controllo della caldaia: date lontane e facili da dimenticare.

**Cosa fa.**

```
Tu:    /scadenze
July:  📅 Prossime scadenze
       31 gen · Bollo auto (tra 83 giorni)
       14 mar · Carta d'identità di NOME
       giugno · Controllo caldaia

July:  ⚠️ Tra 7 giorni scade l'assicurazione auto.   [Rinnovata] [Ricordamelo domani]
```

**Come funziona.** Tabella `scadenze (id, spazio, cosa, data, ricorrenza, preavvisi, responsabile)`. Preavvisi a 30, 7 e 1 giorno. "Rinnovata" calcola la prossima data dalla ricorrenza (annuale, biennale…). Il motore dei promemoria è quello di FA02.
**Riusa:** FA01, FA02.
**Privacy:** i documenti personali possono stare nello spazio privato.
**Difficoltà:** ★★.
**Domande aperte:** la periodicità di alcune scadenze (caldaia, revisione) dipende dal caso: la inserisci tu, non la indovina July.

---

## FA05 · Faccende a turni

**Problema.** Chi porta giù la spazzatura questa settimana?

**Cosa fa.**

```
July:  🧹 Turni della settimana
       Spazzatura: OJ · Bagno: NOME · Spesa grande: OJ

Tu:    /turni scambia
July:  Con chi? [NOME]   → a NOME: OJ ti propone di scambiare "Bagno" con "Spazzatura". [Accetto] [No]
```

**Come funziona.** Tabelle `faccende (id, nome, peso, frequenza)` e `turni (faccenda, persona, settimana, fatto)`. Rotazione a giro tra i membri, con il **peso** (il bagno vale più della spazzatura) per un conteggio equo. Scambi con conferma dell'altra persona. Pulsante "Fatto". Riepilogo a fine mese con i punti.
**Riusa:** FA01, FA02.
**Privacy:** —
**Difficoltà:** ★★★ per la rotazione equa con pesi e assenze (con G02 si può saltare chi è via).
**Domande aperte:** turni settimanali o per giorno? Le assenze si recuperano?

---

## FA06 · "Chi c'è a cena?"

**Problema.** Sapere quante porzioni fare senza chiederlo a tutti.

**Cosa fa.**

```
(alle 16, nel gruppo)
July:  🍝 Cena stasera?   [Ci sono] [No] [Forse] [+1 ospite]
(alle 18)
July:  🍝 Stasera: 3 persone + 1 ospite. NOME non ha risposto.
```

**Come funziona.** Un messaggio con pulsanti inline (non i sondaggi nativi di Telegram: con i pulsanti July può aggiornare il messaggio e fare il riepilogo). Ogni tocco aggiorna il testo. Orari configurabili; niente sondaggio nei giorni scelti.
**Riusa:** FA01, G00 scheduler.
**Privacy:** —
**Difficoltà:** ★★. Buon primo progetto di famiglia.
**Domande aperte:** collegarla alla spesa (FA07) se mancano ingredienti?

---

## FA07 · Lista della spesa evoluta

**Problema.** La lista c'è già. Può fare di più.

**Cosa fa.**

```
Tu:    🎙️ "è finito il latte, prendi anche uova e due chili di farina"
July:  🛒 Aggiunti: latte · uova · farina (2 kg)

Tu:    /spesa
July:  🛒 Lista (ordinata per reparto)
       Latticini: ☐ latte ☐ uova
       Dispensa:  ☐ farina 2 kg
       💡 È da 12 giorni che non compri il caffè, di solito ogni 10.
```

**Come funziona.**

- **Più prodotti in una frase**, con quantità: Qwen con output strutturato `[{ nome, quantita, unita }]`.
- **Reparto:** la prima volta Qwen sceglie da un elenco chiuso (`enum`); poi la scelta si salva in un dizionario e non serve più il modello.
- **Spunta mentre fai la spesa:** pulsanti inline che modificano il messaggio.
- **Suggerimenti:** per ogni prodotto, la mediana dei giorni tra un acquisto e l'altro.

**Riusa:** B06 (la lista attuale), FA01, G08 per i vocali.
**Privacy:** —
**Difficoltà:** ★★★.
**Domande aperte:** com'è fatta oggi la lista di B06? Va migrata nel database o tenuta com'è? L'ordine dei reparti è quello del tuo supermercato?

---

## FA08 · Dispensa e frigo

**Problema.** Cibo che scade dimenticato in fondo al frigo.

**Cosa fa.**

```
Tu:    lo yogurt scade venerdì
July:  🧊 Segnato.

July:  🧊 Scadono domani: yogurt, prosciutto. Idea: piadina con prosciutto e salsa allo yogurt?
```

**Come funziona.** Tabella `dispensa (prodotto, quantita, scadenza, spazio)`. Riepilogo mattutino delle scadenze vicine. La ricetta la propone Qwen: qui la lentezza non conta, può prepararla prima. Quando un prodotto finisce, proposta di aggiungerlo alla spesa (FA07).
**Riusa:** FA01, FA07, G11 (sezione del briefing).
**Privacy:** —
**Difficoltà:** ★★★. Il difficile non è il codice ma l'abitudine di inserire i dati: deve costare pochissimo (un vocale).
**Domande aperte:** codici a barre? Servirebbe un database esterno di prodotti (es. Open Food Facts), da valutare per la privacy.

---

## FA09 · Spese condivise

**Problema.** Chi ha pagato cosa, e chi deve quanto a chi.

**Cosa fa.**

```
Tu:    ho pagato 45,60 € di spesa
July:  💶 Spesa 45,60 € pagata da OJ, divisa tra 3.

Tu:    /spese
July:  💶 Novembre: OJ +30,40 € · NOME −15,20 € · NOME2 −15,20 €
       Per pareggiare: NOME → OJ 15,20 € · NOME2 → OJ 15,20 €
```

**Come funziona.**

- La frase si capisce con una regex (importo + descrizione); Qwen solo per i casi strani ("per me e NOME").
- **Importi in centesimi interi**, mai decimali.
- Tabelle `spese (id, pagato_da, importo_cent, descrizione, ts)` e `quote (spesa_id, persona, importo_cent)`. Il resto della divisione (1 centesimo) va a turno.
- **Pareggiare:** saldi per persona, poi l'algoritmo che abbina il creditore più grande con il debitore più grande, finché tutto è a zero. Non garantisce sempre il minimo assoluto di bonifici (quel problema è molto più difficile), ma ne fa al massimo uno meno delle persone.

**Riusa:** FA01.
**Privacy:** gli importi restano sul Pi; i messaggi passano da Telegram (D01).
**Difficoltà:** ★★★.
**Domande aperte:** divisione sempre in parti uguali, o anche a percentuale?

---

## FA10 · "La lavatrice ha finito"

**Problema.** Il bucato dimenticato in lavatrice.

**Cosa fa.**

```
July:  🧺 La lavatrice ha finito (1 h 52 min).   [Svuotata]
(dopo un'ora, se nessuno ha premuto)
July:  🧺 La lavatrice aspetta ancora.
```

**Come funziona.** Una presa con misura di potenza (Zigbee o Shelly, letta tramite Home Assistant). Macchina a stati: **ferma** (sotto 5 W) → **in funzione** (sopra 20 W per 2 minuti) → **forse finita** (sotto 5 W) → **finita** se resta bassa per 5 minuti. La pausa serve perché le lavatrici si fermano anche durante il lavaggio. Avvisa chi era in casa all'avvio (G02) o tutto lo spazio di famiglia. Uguale per lavastoviglie e asciugatrice.
**Riusa:** G00 B (HA), G02 facoltativa, G04 per l'idea della macchina a stati.
**Privacy:** —
**Difficoltà:** ★★★ per trovare le soglie giuste della tua lavatrice: registra qualche lavaggio prima.
**Domande aperte:** chi l'ha avviata? Un pulsante "L'ho avviata io" all'avvio è la soluzione più semplice.

---

## FA11 · Allarmi con "Ci penso io"

**Problema.** Un allarme a tutti: o ci pensano tutti, o nessuno.

**Cosa fa.**

```
(a tutti)
July:  🚨 Perdita d'acqua sotto la lavatrice!   [Ci penso io]
(dopo che NOME preme)
July:  🚨 Perdita d'acqua sotto la lavatrice · ✋ ci pensa NOME
```

**Come funziona.** Gli avvisi critici di G07 vanno a tutto lo spazio di famiglia. July salva l'ID di ogni messaggio inviato; quando qualcuno preme il pulsante, modifica i messaggi di tutti. Se nessuno risponde entro 5 minuti, rimanda l'avviso.
**Riusa:** FA01, G07, `core/notify.ts`.
**Privacy:** —
**Difficoltà:** ★★★.
**Domande aperte:** un contatto di emergenza fuori casa (un vicino) per quando nessuno risponde?

---

## FA12 · Wi‑Fi per gli ospiti

**Problema.** Dettare la password del Wi‑Fi a ogni ospite.

**Cosa fa.**

```
Tu:    /wifi
July:  📶 Fai inquadrare questo codice all'ospite.   [immagine QR]
```

**Come funziona.** July sa già fare i QR code dai link (B05). Il testo del codice segue il formato `WIFI:T:WPA;S:<nome rete>;P:<password>;;`, con i caratteri speciali (`\ ; , : "`) preceduti da `\`. Nome rete e password nel `.env`. Lo manda sempre **in privato**, anche se chiesto nel gruppo.
**Riusa:** B05.
**Privacy:** la password della rete **ospiti**, mai quella principale.
**Difficoltà:** ★. La vittoria più facile della lista.
**Domande aperte:** cambiare la password ospiti ogni mese? Dipende dal router e dalle sue API.

---

## FA13 · Registro manutenzione

**Problema.** "Quando abbiamo cambiato il filtro della cappa?"

**Cosa fa.**

```
Tu:    fatto il filtro della cappa
July:  🔧 Segnato. Prossimo tra 3 mesi (febbraio).

Tu:    quando abbiamo decalcificato la macchina del caffè?
July:  🔧 Il 12 settembre (OJ).
```

**Come funziona.** Tabelle `manutenzioni (id, cosa, ogni_giorni)` e `interventi (manutenzione, ts, chi, nota)`. Il prossimo intervento crea un promemoria (FA02). Esempi: filtri della cappa e del condizionatore, pulizia della lavatrice, decalcificazione, batterie dei rilevatori di fumo, controllo della caldaia (secondo il libretto).
**Riusa:** FA01, FA02.
**Privacy:** —
**Difficoltà:** ★★.
**Domande aperte:** anche i costi degli interventi?

---

## FA14 · Idee regalo nascoste

**Problema.** Ricordarsi le idee regalo durante l'anno, senza che il festeggiato le veda.

**Cosa fa.**

```
(in privato)
Tu:    idea regalo per NOME: la borraccia termica che ha visto al mercato
July:  🎁 Salvata. NOME non la vedrà.

(a tutti tranne NOME, 14 giorni prima)
July:  🎁 Tra 14 giorni è il compleanno di NOME. Idee: borraccia termica (OJ), libro di … (NOME2)
       [Prenoto io]
```

**Come funziona.** Tabella `regali (id, per, idea, aggiunta_da, prenotata_da)`. La regola: **ogni lettura esclude le righe in cui `per` è chi sta leggendo**. Mai nel gruppo, perché il festeggiato ne fa parte. L'AI non riceve mai le liste quando scrive il festeggiato. Compleanni in una tabella, promemoria con FA02.
**Riusa:** FA01, FA02.
**Privacy:** è il cuore del progetto. Scrivi i test **prima** del codice: "NOME chiede /regali → non vede niente su di sé".
**Difficoltà:** ★★★.
**Domande aperte:** anche la lista dei desideri di ognuno, visibile a tutti?

---

## FA15 · Foto della settimana

**Problema.** Le foto di famiglia restano ognuna nel telefono di chi le ha fatte.

**Cosa fa.**

```
(domenica sera, nel gruppo)
July:  📸 La settimana in foto: 14 foto da 3 persone.   [Apri l'album]
```

**Come funziona.** Ognuno aggiunge le foto che vuole a un album condiviso di Immich (lo fa Immich, non July). La domenica July conta le aggiunte della settimana con le API degli album e manda il link (D15).
**Riusa:** G10.
**Privacy:** solo le foto che ognuno ha scelto. July non sceglie niente.
**Difficoltà:** ★★.
**Domande aperte:** l'album condiviso esiste già? Le persone hanno tutte un account Immich?

---

## FA16 · "Tutto bene?" per chi vive da solo

**Problema.** Un familiare anziano che vive da solo: sapere che sta bene senza telefonargli ogni mattina.

**Cosa fa.**

```
(alle 10, se nessun sensore ha visto movimento da ieri sera)
July → a lui:      ☀️ Buongiorno! Tutto bene?   [Sì, tutto ok]
(se non risponde entro 30 minuti)
July → famiglia:   ⚠️ Da NOME nessun movimento da ieri sera e nessuna risposta. Provate a chiamarlo.
```

**Come funziona.** Sensori di movimento e apertura (porta, frigo) **a casa sua**, con un Home Assistant o un collegamento verso il Pi tramite Tailscale. Ogni mattina July controlla l'ultima attività. Prima chiede a lui, poi avvisa la famiglia. Modalità "via" per quando è in viaggio.
**Riusa:** G00 B, G07 (regole), FA11 ("Ci penso io").
**Privacy:** solo con il suo **consenso esplicito**, revocabile quando vuole. July sa solo "c'è stato movimento sì o no", non dove né quanto.
**Difficoltà:** ★★★★ per l'hardware in un'altra casa, la connessione e i falsi allarmi.
**Domande aperte:** non è un dispositivo medico e non sostituisce i servizi di emergenza: va detto chiaramente a tutti. Ha Telegram, o la domanda "tutto bene?" deve arrivare in un altro modo?
