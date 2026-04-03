import {KEYBOARD_BUTTON_STYLE } from "../enums"

export type KeyboardButton = {
    text: string
    iconCustomEmojiId: string
    style: KEYBOARD_BUTTON_STYLE
    //requestUsers?: KeyboardButtonRequestUsers
    // request_chat	KeyboardButtonRequestChat
    requestContact?:	boolean
    requestLocation?: boolean
    // requestPoll?: KeyboardButtonPollType
    // web_app	WebAppInfo	Optional. If specified, the described Web App will be launched when the button is pressed. The Web App will be able to send a “web_app_data” service message. Available in private chats only.
}
