# Modello · Guida

Stessa struttura delle guide in `funzioni/`. Copia questo file in `funzioni/NN-nome.md` e riempilo. La guida spiega; il codice lo scrive chi la segue.

---

# NN · Titolo

## Cosa fa

```
Tu:    ...
July:  ...
```

## Cosa impari

I concetti tecnici che porti a casa, in due o tre righe.

## Prerequisiti

- Guide da fare prima.
- Hardware.
- Variabili nuove nel `.env` (e aggiungile al registro in `ARCHITETTURA.md`).
- Librerie da installare (`bun add ...`).

---

## Architettura

```
schema a blocchi: da dove arrivano i dati, chi li elabora, dove finiscono
```

```
funzioni/<nome>/
├── index.ts     gestori grammY e API pubblica per le altre funzioni
└── ...          un file per responsabilità
```

---

## Passo 1 · Titolo

**Obiettivo.** Cosa funziona alla fine del passo, in una frase.

**Cosa fare.** I passaggi, in ordine.

**Perché.** La ragione della scelta, e l'alternativa scartata se ce n'è una ovvia.

**Esempio.** Solo chiamate ad API esterne o a librerie, prese dalla documentazione ufficiale. Non la soluzione del passo.

```ts
// esempio commentato
```

**✅ Verifica.** Un controllo concreto: un comando, un test, un output atteso. Non si passa al passo dopo finché non è verde.

> **Se ti blocchi:** l'idea della soluzione o uno pseudocodice, da leggere solo dopo averci provato.

## Passo 2 · ...

---

## Trappole

Gli errori che quasi tutti fanno, e come accorgersene.

## Per andare oltre

Estensioni per quando la base funziona.

## Fonti

- ✔︎ fonti verificate (con la data della verifica)
- fonti da verificare
