// features/users.ts
// Elenco delle persone che possono parlare con July.
// Telegram allega a ogni messaggio l'ID di chi scrive e non si può falsificare,
// quindi l'ID è un modo sicuro per riconoscere le persone.

// "admin" vede lo stato del server, "member" no.
export type Role = 'admin' | 'member'

export interface User {
  id: number         // Telegram ID della persona
  name: string       // nome con cui July la chiama
  role: Role
  immichKey?: string // facoltativo (il ? significa questo): chiave API di Immich creata da quella persona
}

const USERS: User[] = [
  { id: 120075267, name: 'Morgan', role: 'admin' },
  // Per aggiungere qualcuno togli "//" dalla riga qui sotto e completa i dati:
  // { id: 987654321, name: 'NOME', role: 'member', immichKey: process.env.IMMICH_KEY_NOME },
]

// Restituisce la persona con quell'ID, oppure undefined se non è nell'elenco.
export function getUser(telegramId: number | undefined): User | undefined {
  return USERS.find((user) => user.id === telegramId)
}
