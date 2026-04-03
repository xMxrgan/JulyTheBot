export type User = {
  id: number
  isBot: boolean
  firstName: string
  lastName?: string
  username?: string
  language?: string
  isPremium?: boolean
  canReadAllGroupMessages?: boolean
}

export type Location = {
    latitude: number
    longitude: number
    horizontalAccuracy: number
    livePeriod: number
    headingToDirection?:	number
    proximityAlertRadius: number
}

export type PhotoSize = {
    fileId: string
    fileUniqueId: string
    width: number
    height: number
    fileSize?: number
}

export type Animation = {
    fileId: string
    fileUniqueId: string
    width: number
height: number
duration: number
    thumbnail?: PhotoSize
                fileName?: string
    fileSize?: number
}

export type Audio = {
    fileId: string
    fileUniqueId: string
    duration: number
    title?: string
    fileSize?: number
    thumbnail?: PhotoSize
}
export type Document = {
    fileId: string
    fileUniqueId: string
    fileName?: string
fileSize?: number
    thumbnail?: PhotoSize
 }
