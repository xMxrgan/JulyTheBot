import QRCode from 'qrcode'

/**
 * Generates a QR code image as a Buffer.
 * Using Buffers is ideal for performance as it avoids writing to the disk (SSD).
 */
export const qrCodeGenerator = async (url: string): Promise<Buffer> => {
  try {
    // Create the QR code with high error correction and custom scaling
    // No division operators used here, just pure configuration.
    const qrCodeBuffer = await QRCode.toBuffer(url, {
      margin: 2,                 // Border size around the QR code
      scale: 10,                 // Resolution/Size multiplier
      errorCorrectionLevel: 'H'  // High resilience (readable even if 30% is damaged)
    })

    return qrCodeBuffer
  } catch (err) {
    // Log the error and re-throw it so the bot can handle it
    console.error("Error in qrCodeGenerator:", err)
    throw err
  }
}
