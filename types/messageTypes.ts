import { MESSAGE_ENTITY_TYPE, MESSAGE_ORIGIN_TYPE } from "../enums"
import { Chat } from "./chatTypes"
import { CheckList } from "./checkListTypes"
import {
  User,
  Location,
  PhotoSize,
  Animation,
  Audio, Document
} from "./generalTypes"

export type Message = {
  messageId: number
  chat: Chat
  directMessagesTopic?: DirectMessagesTopic
  senderUser?: User
  senderChat?: Chat
  senderTag?: string
  date: number
  forwardOrigin?: MessageOrigin
  isTopicMessage?: boolean
  isAutomaticForward?: boolean
  replyToMessage?: Message
  externalReply?: ExternalReplyInfo
  quote?: TextQuote
  replyToStory?: Story
  replyToChecklistTaskId?: number

  // Bot metadata
  viaBot?: User
  editDate?: number
  hasProtectedContent?: boolean
  isFromOffline?: boolean

  // Payment / post flags
  isPaidPost?: boolean
  paidStarCount?: number

  // Grouping / author
  mediaGroupId?: string
  authorSignature?: string

  // Text + entities
  text?: string
  entities?: MessageEntity[]
  caption?: string
  captionEntities?: MessageEntity[]

  // Link preview / suggested post
  linkPreviewOptions?: LinkPreviewOptions
  suggestedPostInfo?: SuggestedPostInfo

  // Effects / media
  effectId?: string
  animation?: Animation
  audio?: Audio
  document?: Document
  paidMedia?: PaidMediaInfo
  photo?: PhotoSize[]
  sticker?: Sticker
  story?: Story
  video?: Video
  videoNote?: VideoNote
  voice?: Voice

  // Caption display flags
  showCaptionAboveMedia?: boolean
  hasMediaSpoiler?: boolean

  // Misc attachments / content
  checklist?: CheckList
  contact?: Contact
  dice?: Dice
  game?: Game
  poll?: Poll
  venue?: Venue
  location?: Location

  // Service messages and chat events
  newChatMembers?: User[]
  leftChatMember?: User
  chatOwnerLeft?: ChatOwnerLeft
  chatOwnerChanged?: ChatOwnerChanged
  newChatTitle?: string
  newChatPhoto?: PhotoSize[]
  deleteChatPhoto?: boolean
  groupChatCreated?: boolean
  supergroupChatCreated?: boolean
  channelChatCreated?: boolean
  messageAutoDeleteTimerChanged?: MessageAutoDeleteTimerChanged
  migrateToChatId?: number
  migrateFromChatId?: number
  pinnedMessage?: MaybeInaccessibleMessage

  // Payments / invoices
  invoice?: Invoice
  successfulPayment?: SuccessfulPayment
  refundedPayment?: RefundedPayment

  // Various service payloads (kept optional and loosely typed)
  usersShared?: UsersShared
  chatShared?: ChatShared
  gift?: GiftInfo
  uniqueGift?: UniqueGiftInfo
  giftUpgradeSent?: GiftInfo
  connectedWebsite?: string
  writeAccessAllowed?: WriteAccessAllowed
  passportData?: PassportData
  proximityAlertTriggered?: ProximityAlertTriggered
  boostAdded?: ChatBoostAdded
  chatBackgroundSet?: ChatBackground
  checklistTasksDone?: ChecklistTasksDone
  checklistTasksAdded?: ChecklistTasksAdded
  directMessagePriceChanged?: DirectMessagePriceChanged

  forumTopicCreated?: ForumTopicCreated
  forumTopicEdited?: ForumTopicEdited
  forumTopicClosed?: ForumTopicClosed
  forumTopicReopened?: ForumTopicReopened
  generalForumTopicHidden?: GeneralForumTopicHidden
  generalForumTopicUnhidden?: GeneralForumTopicUnhidden
  giveawayCreated?: GiveawayCreated
  giveaway?: Giveaway
  giveawayWinners?: GiveawayWinners
  giveawayCompleted?: GiveawayCompleted
  paidMessagePriceChanged?: PaidMessagePriceChanged
  suggestedPostApproved?: SuggestedPostApproved
  suggestedPostApprovalFailed?: SuggestedPostApprovalFailed
  suggestedPostDeclined?: SuggestedPostDeclined
  suggestedPostPaid?: SuggestedPostPaid
  suggestedPostRefunded?: SuggestedPostRefunded
  videoChatScheduled?: VideoChatScheduled
  videoChatStarted?: VideoChatStarted
  videoChatEnded?: VideoChatEnded
  videoChatParticipantsInvited?: VideoChatParticipantsInvited
  webAppData?: WebAppData
  replyMarkup?: InlineKeyboardMarkup
}

/**
 * MessageEntity - formatted text parts inside messages
 */
export type MessageEntity = {
  type: MESSAGE_ENTITY_TYPE
  offset: number
  length: number
  url?: string
  mention?: User
  unixTime?: number
  dateTimeFormat?: string
}

/**
 * Message origin variants (union)
 */
export type MessageOrigin =
  | MessageOriginUser
  | MessageOriginHiddenUser
  | MessageOriginChat
  | MessageOriginChannel

export type MessageOriginUser = {
  type: MESSAGE_ORIGIN_TYPE.USER
  date: number
  senderName: User
}

export type MessageOriginHiddenUser = {
  type: MESSAGE_ORIGIN_TYPE.HIDDEN_USER
  date: number
  senderUsername: string
}

export type MessageOriginChat = {
  type: MESSAGE_ORIGIN_TYPE.CHAT
  date: number
  senderChat: Chat
  authorSignature?: string
}

export type MessageOriginChannel = {
  type: MESSAGE_ORIGIN_TYPE.CHANNEL
  date: number
  senderChannel: Chat
  messageId?: number
  authorSignature?: string
}

export type DirectMessagesTopic = {
  topicId: number
  topicCreator?: User
}

export type ExternalReplyInfo = {
  origin: MessageOrigin
  chat?: Chat
  messageId?: number
  linkPreviewOptions?: LinkPreviewOptions
  animation?: Animation
  audio?: Audio
  document?: Document
  paidMedia?: PaidMediaInfo
  photo?: PhotoSize[]
  sticker?: Sticker
  story?: Story
  video?: Video
  videoNote?: VideoNote
  voice?: Voice
  hasMediaSpoiler?: boolean
  checklist?: CheckList
  contact?: Contact
  dice?: Dice
  game?: Game
  giveaway?: Giveaway
  giveawayWinners?: GiveawayWinners
  invoice?: Invoice
  location?: Location
  poll?: Poll
  venue?: Venue
}

// TODO fix all the types
/**
 * Small supporting types below.
 * Many of these are minimal placeholders so the project type-checks cleanly.
 * You can expand them later as you need more precise fields.
 */
export type LinkPreviewOptions = {
  isDisabled: boolean
  url?: string
  preferSmallMedia?: boolean
  preferLargeMedia?: boolean
  showAboveText?: boolean
}

export type SuggestedPostInfo = {
  postId?: string
  author?: User
  title?: string
  description?: string
  thumbnail?: PhotoSize
  // any additional metadata returned by Telegram about suggested posts
  [key: string]: any
}

export type TextQuote = {
  text: string
  // optional metadata about which portion was quoted
  offset?: number
  length?: number
}

export type Story = {
  id?: number
  // minimal placeholder
  author?: User
}

export type PaidMediaInfo = {
  // loosely typed for now
  [key: string]: any
}

export type Sticker = {
  fileId?: string
  emoji?: string
}

export type Video = {
  fileId?: string
  duration?: number
  width?: number
  height?: number
  thumbnail?: PhotoSize
}

export type VideoNote = {
  fileId?: string
  length?: number
  duration?: number
  thumbnail?: PhotoSize
}

export type Voice = {
  fileId?: string
  duration?: number
  mimeType?: string
}

export type Contact = {
  phoneNumber?: string
  firstName?: string
  lastName?: string
  userId?: number
}

export type Dice = {
  value?: number
  emoji?: string
}

export type Game = {
  title?: string
  description?: string
}

export type Poll = {
  id?: string
  question?: string
  options?: { text: string; voterCount?: number }[]
}

export type Venue = {
  location?: Location
  title?: string
  address?: string
}

export type MaybeInaccessibleMessage = Message | { id?: number }

/** Service / event placeholders */
export type ChatOwnerLeft = { /* minimal */ }
export type ChatOwnerChanged = { /* minimal */ }
export type MessageAutoDeleteTimerChanged = { /* minimal */ }
export type Invoice = { /* minimal */ }
export type SuccessfulPayment = { /* minimal */ }
export type RefundedPayment = { /* minimal */ }
export type UsersShared = { /* minimal */ }
export type ChatShared = { /* minimal */ }
export type GiftInfo = { /* minimal */ }
export type UniqueGiftInfo = { /* minimal */ }
export type WriteAccessAllowed = { /* minimal */ }
export type PassportData = { /* minimal */ }
export type ProximityAlertTriggered = { /* minimal */ }
export type ChatBoostAdded = { /* minimal */ }
export type ChatBackground = { /* minimal */ }
export type ChecklistTasksDone = { /* minimal */ }
export type ChecklistTasksAdded = { /* minimal */ }
export type DirectMessagePriceChanged = { /* minimal */ }
export type ForumTopicCreated = { /* minimal */ }
export type ForumTopicEdited = { /* minimal */ }
export type ForumTopicClosed = { /* minimal */ }
export type ForumTopicReopened = { /* minimal */ }
export type GeneralForumTopicHidden = { /* minimal */ }
export type GeneralForumTopicUnhidden = { /* minimal */ }
export type GiveawayCreated = { /* minimal */ }
export type Giveaway = { /* minimal */ }
export type GiveawayWinners = { /* minimal */ }
export type GiveawayCompleted = { /* minimal */ }
export type PaidMessagePriceChanged = { /* minimal */ }
export type SuggestedPostApproved = { /* minimal */ }
export type SuggestedPostApprovalFailed = { /* minimal */ }
export type SuggestedPostDeclined = { /* minimal */ }
export type SuggestedPostPaid = { /* minimal */ }
export type SuggestedPostRefunded = { /* minimal */ }
export type VideoChatScheduled = { /* minimal */ }
export type VideoChatStarted = { /* minimal */ }
export type VideoChatEnded = { /* minimal */ }
export type VideoChatParticipantsInvited = { /* minimal */ }
export type WebAppData = { /* minimal */ }
export type InlineKeyboardMarkup = { /* minimal */ }
