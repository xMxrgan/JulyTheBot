import { CHAT_TYPE } from "../enums"

export type Chat = {
    id: number
  type: CHAT_TYPE
  title?: string                    // For groups and supergroups
  username?: string
  firstName?: string                // First name of the other party in a private chat
  lastName?: string                 // Last name of the other party in a private chat
  isTopic?: boolean                 // Topic in groups
  isDirectMessages?: boolean        // Channel messages
}
