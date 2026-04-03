import { Chat } from "./chatTypes"
import { User } from "./generalTypes"
import { MessageEntity } from "./messageTypes"

export type CheckList = {
    title: string
    titleEntities: MessageEntity[]
    tasks: CheckListTask[]
    othersCanAddTasks?: true
    othersCanMarkTasksAsDone?: true
}

export type CheckListTask = {
  id: number
  task: string
  textEntities	: MessageEntity[]
  completedByUser: User
  completedByChat?:	Chat
  completionDate: number
}
