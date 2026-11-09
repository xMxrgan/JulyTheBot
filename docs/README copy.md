# Documentazione di July

Qui sta tutto quello che riguarda il **futuro** di July: idee, progetti, decisioni, guide. Come funziona July **oggi** (comandi, deploy, Ollama, risoluzione problemi) è nel `README.md` nella cartella principale del repository.

---

## Com'è organizzata

```
JulyTheBot/
├── README.md              July oggi: usarlo, modificarlo, rimetterlo in piedi
└── docs/
    ├── README.md          questo file: la mappa
    ├── ROADMAP.md         tutti i progetti, con stato, fase e dipendenze
    ├── ARCHITETTURA.md    come sarà fatto July: strati, persone, dati, servizi, registri
    ├── DECISIONI.md       le scelte importanti e il perché
    ├── idee/
    │   ├── inbox.md       idee al volo, ancora da valutare
    │   └── famiglia.md    le schede delle funzioni per la famiglia
    ├── funzioni/          guide passo passo, pronte per scrivere il codice (00–11)
    └── modelli/           schemi da copiare per idee, guide e decisioni
```

| Ti chiedi… | Apri |
| --- | --- |
| "Cosa faccio dopo?" | `ROADMAP.md`, sezione *Prossimi passi* |
| "Questa idea c'è già?" | `ROADMAP.md`, poi `idee/` |
| "Dove metto questo codice? Che nome do a questo comando?" | `ARCHITETTURA.md` |
| "Perché avevamo scelto così?" | `DECISIONI.md` |
| "Come si costruisce?" | `funzioni/` |

---

## La vita di un'idea

```
💡 idea ──► 📝 scheda ──► 📘 guida ──► 🔨 sviluppo ──► ✅ fatto
 inbox.md    idee/*.md     funzioni/     branch git      ROADMAP
                                                         aggiornata
         ╲                                  ╱
          ──────── ⏸ in pausa / ❌ scartata ─
```

1. **💡 Idea.** La scrivi in `idee/inbox.md`, in una riga, anche dal telefono. Nessun dettaglio, nessun impegno.
2. **📝 Scheda.** Quando l'idea ti convince, copi `modelli/idea.md` nel file di `idee/` giusto e rispondi alle domande: che problema risolve, cosa fa, cosa riusa, quanto è difficile, cosa non sai ancora. Aggiungi una riga in `ROADMAP.md`.
3. **📘 Guida.** Prima di scrivere codice, la scheda diventa una guida in `funzioni/` (schema in `modelli/guida.md`): architettura, interfacce, passi con verifica.
4. **🔨 Sviluppo.** Un branch git per progetto (`git checkout -b nome-progetto`). Aggiorna lo stato nella roadmap.
5. **✅ Fatto.** Aggiorna `ROADMAP.md`, il `README.md` principale (nuovi comandi, variabili, problemi noti), i registri in `ARCHITETTURA.md`, e la lista per @BotFather se hai aggiunto comandi.

Un'idea può fermarsi a ogni passo. **⏸ In pausa** se ci tornerai, **❌ Scartata** se no: in quel caso scrivi una riga sul perché, così tra sei mesi non la riproponi uguale.

---

## Quando scrivere una decisione

In `DECISIONI.md` va una scelta che:

- sarebbe costosa da cambiare dopo (un database, un protocollo, dove stanno i dati);
- scarta alternative ragionevoli (perché Home Assistant e non solo MQTT);
- riguarda privacy o sicurezza.

Non serve per le cose piccole (il nome di una variabile). Schema in `modelli/decisione.md`.

---

## Regole di manutenzione

- **La documentazione vive con il codice.** Stesso repository, stessi commit. Se cambi un comando, nello stesso commit aggiorni il README.
- **Una fonte per ogni cosa.** I registri (comandi, variabili, porte) stanno solo in `ARCHITETTURA.md`: le guide li citano, non li ricopiano.
- **Revisione una volta al mese**, dieci minuti: svuota `inbox.md` (scheda, pausa o scarta), controlla che gli stati della roadmap siano veri.
- **Niente segreti.** Token, password, chiavi e ID Telegram veri non vanno mai in questi file. Negli esempi usa `NOME`, `LA_TUA_CHIAVE`, `123456789`.
