import { Bot, InputFile } from 'grammy'
import { qrCodeGenerator } from './methods'

// Initialize the bot with your token from environment variables
// Bun automatically loads the .env file for you
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || '')

// Use the onStart callback to see when the bot is officially online
bot.start({
  onStart: (me) => {
    console.log(`--- BOT STATUS ---`)
    console.log(`User: @${me.username}`)
    console.log(`ID: ${me.id}`)
    console.log(`Status: Running and listening for links...`)
    console.log(`------------------`)
  }
})

// Listen for the /start command
bot.command('start', (cfx) => {
  return cfx.reply('Welcome home faggot! \nSend me any link and I will turn it into a QR code.')
})

// Listen for messages that Telegram identifies as containing a URL
bot.on('message::url', async (cfx) => {
  // Use the grammY helper to extract the first URL found in the message
  const url = cfx.entities('url')[0]?.text

  // Safety check: verify the URL exists before proceeding
  if (!url) {
    return cfx.reply("Oops! I couldn't find a valid link in your message.")
  }

  try {
    // Call our generator and wait for the Buffer
    const qrBuffer = await qrCodeGenerator(url)

    // Send the image back to the user
    // InputFile handles the Buffer and uploads it to Telegram's servers
    return await cfx.replyWithPhoto(new InputFile(qrBuffer), {
      caption: `Done! Here is your QR for:\n${url}`
    })
  } catch (error) {
    console.error("Bot logic error:", error)
    return cfx.reply("Sorry, I failed to generate that QR code. Try another link.")
  }
})

// Global error handler to prevent the process from crashing
bot.catch((err) => {
  const cfx = err.ctx
  console.error(`Error while handling update ${cfx.update.update_id}:`)
  console.error(err.error)
})

// Start the bot using Long Polling
bot.start({
  onStart: (me) => console.log(`Bot @${me.username} is running on Bun!`)
})
