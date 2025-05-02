// Required: Import the crypto module
const crypto = global.crypto || require("crypto");
// Make crypto globally available
global.crypto = crypto;

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode-terminal");

// Create auth directory if it doesn't exist
const AUTH_FOLDER = './auth_info';
if (!fs.existsSync(AUTH_FOLDER)) {
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  console.log('Created auth folder. Ready for QR code authentication.');
}

// Clear any existing session to force new QR code generation
// Comment this out if you want to reuse existing session
/*
if (fs.existsSync(path.join(AUTH_FOLDER, 'creds.json'))) {
  fs.unlinkSync(path.join(AUTH_FOLDER, 'creds.json'));
  console.log('Removed existing session. Will generate new QR code.');
}
*/

// Start the WhatsApp bot
async function startBot() {
  try {
    // Use multiFileAuthState for authentication
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    
    // Fetch the latest version
    const { version } = await fetchLatestBaileysVersion();
    console.log(`Using WA version ${version}`);

    // Minimal logger to reduce console noise
    const logger = pino({ 
      level: 'silent',  // Change to 'warn' or 'info' for more logs
      transport: {
        target: 'pino-pretty'
      }
    });
    
    // Initialize the socket with QR code focus
    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: true,  // This will print QR in terminal
      auth: state,
      browser: ['WhatsApp Bot', 'Chrome', '104.0.0.0'],
      // Increase timeout for connecting
      connectTimeoutMs: 60000,
      // Retry connection when failed
      retryRequestDelayMs: 5000
    });

    // Track if we're connected
    let isConnected = false;

    // Handle credential updates
    sock.ev.on("creds.update", saveCreds);

    // Custom QR code handler for better visibility
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      // If QR code is received, display it clearly
      if (qr) {
        console.log('\n\n==== SCAN THIS QR CODE WITH YOUR WHATSAPP ====\n');
        qrcode.generate(qr, { small: false });
        console.log('\n==== WAITING FOR QR CODE SCAN ====\n');
      }
      
      // Handle connection status
      if (connection === 'open') {
        isConnected = true;
        console.log('\n✅ CONNECTED! Your WhatsApp bot is now online.\n');
        
        // Get connected user's number
        const userJid = sock.user.id.replace(/:.+@/, '@');
        console.log(`Connected as: ${userJid}`);
      }
      
      // Handle disconnection
      if (connection === 'close') {
        isConnected = false;
        
        // Check if we should reconnect
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) ? 
          lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut : true;
        
        console.log('⚠️ Connection closed due to:', lastDisconnect?.error?.message || 'unknown reason');
        console.log('Will reconnect:', shouldReconnect ? 'Yes' : 'No');
        
        if (shouldReconnect) {
          console.log('Reconnecting...');
          setTimeout(startBot, 3000);
        } else {
          console.log('Session logged out. Please restart the bot to scan a new QR code.');
        }
      }
    });

    // Listen for messages
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" || !isConnected) return;
      
      try {
        const msg = messages[0];
        if (!msg.message) return;

        // Skip status messages and your own messages
        if (msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        
        // Extract the message text
        const messageTypes = Object.keys(msg.message);
        let text = '';
        
        if (msg.message.conversation) {
          text = msg.message.conversation;
        } else if (msg.message.extendedTextMessage) {
          text = msg.message.extendedTextMessage.text;
        } else if (msg.message.buttonsResponseMessage) {
          text = msg.message.buttonsResponseMessage.selectedButtonId;
        } else if (msg.message.listResponseMessage) {
          text = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
        }

        // Show message in console
        const sender = msg.key.participant || msg.key.remoteJid;
        console.log(`📩 Message from ${sender}: ${text}`);

        // Process commands
        const command = text.toLowerCase().trim();

        if (command === "hi") {
          await sock.sendMessage(from, { text: "Hello! I'm a bot 🤖" });
        } else if (command === "help") {
          await sock.sendMessage(from, {
            text: "Available commands:\n• hi\n• help\n• ping\n• info"
          });
        } else if (command === "ping") {
          await sock.sendMessage(from, { text: "Pong! ✅" });
        } else if (command === "info") {
          await sock.sendMessage(from, { 
            text: "WhatsApp Bot v1.0\nRunning on Baileys library\nCreated with ❤️" 
          });
        }
      } catch (err) {
        console.error('Error processing message:', err);
      }
    });

  } catch (err) {
    console.error('Failed to start the bot:', err);
    console.log('Retrying in 10 seconds...');
    setTimeout(startBot, 10000);
  }
}

// Initialize the bot
console.log('Starting WhatsApp bot with QR authentication...');
console.log('Please wait for QR code to appear...\n');
startBot();