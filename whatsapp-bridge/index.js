const express = require('express');
const cors = require('cors');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const fs = require('fs');

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// State variables
let sock = null;
let currentQR = null;
let connectionStatus = 'disconnected';
let currentUserPhone = null;

/**
 * Initialize WhatsApp connection using Baileys
 */
async function connectToWhatsApp() {
    try {
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        
        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'info' }), // Change to info to debug disconnects
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false
        });

        // Save credentials when updated
        sock.ev.on('creds.update', saveCreds);

        // Handle connection events
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    // Convert raw QR string to base64 data URL
                    currentQR = await qrcode.toDataURL(qr);
                    console.log('QR Code generated. Call GET /qr to fetch it.');
                } catch (err) {
                    console.error("Error generating QR code base64:", err);
                }
            }

            if (connection === 'close') {
                currentQR = null;
                connectionStatus = 'disconnected';
                currentUserPhone = null;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('Connection closed. Reconnecting:', shouldReconnect);
                
                if (shouldReconnect) {
                    // Attempt reconnect with 5s delay
                    setTimeout(connectToWhatsApp, 5000);
                } else {
                    console.log('Logged out. Removing auth info.');
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                }
            } else if (connection === 'open') {
                currentQR = null;
                connectionStatus = 'connected';
                currentUserPhone = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0];
                console.log('Opened connection. Connected as:', currentUserPhone);
            } else if (connection === 'connecting') {
                connectionStatus = 'connecting';
                console.log('Connecting to WhatsApp...');
            }
        });

        // Handle incoming messages
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            
            for (const msg of m.messages) {
                // Ignore messages sent by self
                if (msg.key.fromMe) continue;
                
                try {
                    const senderJid = msg.key.remoteJid;
                    
                    // Skip group messages for now
                    if (senderJid.endsWith('@g.us')) continue; 
                    
                    const senderPhone = senderJid.split('@')[0];
                    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const timestamp = new Date(msg.messageTimestamp * 1000).toISOString();
                    const messageId = msg.key.id;
                    const pushName = msg.pushName || 'Unknown';

                    // Only process text messages
                    if (!messageText) continue;

                    const payload = {
                        from: senderPhone,
                        message: messageText,
                        timestamp: timestamp,
                        message_id: messageId,
                        push_name: pushName
                    };

                    // Forward to Python backend webhook
                    fetch('http://localhost:8000/whatsapp/webhook', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload)
                    }).catch(err => {
                        console.error("Error sending webhook to Python backend (might be unreachable):", err.message);
                    });

                } catch (err) {
                    console.error("Error processing incoming message:", err);
                }
            }
        });
    } catch (err) {
        console.error("Error initializing WhatsApp connection:", err);
    }
}

// --- Endpoints ---

/**
 * GET /status
 * Returns current connection status
 */
app.get('/status', (req, res) => {
    try {
        res.json({
            status: connectionStatus,
            phone: currentUserPhone
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /qr
 * Returns base64 QR code for scanning
 */
app.get('/qr', (req, res) => {
    try {
        if (connectionStatus === 'connected') {
            return res.json({ status: 'connected', qr: null });
        }
        
        if (currentQR) {
            return res.json({ status: 'waiting', qr: currentQR });
        }
        
        if (connectionStatus === 'disconnected') {
            // Trigger connection if not already connecting
            connectToWhatsApp();
        }
        
        res.json({ status: 'waiting', qr: null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /send
 * Sends a single WhatsApp message
 */
app.post('/send', async (req, res) => {
    try {
        if (connectionStatus !== 'connected' || !sock) {
            return res.status(503).json({ success: false, error: 'WhatsApp is not connected' });
        }

        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Missing phone or message in request body' });
        }

        // Format phone to WhatsApp JID
        const jid = `${phone}@s.whatsapp.net`;
        const result = await sock.sendMessage(jid, { text: message });
        
        res.json({
            success: true,
            messageId: result.key.id,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("Error sending message:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /send-bulk
 * Sends multiple messages with a configurable delay
 */
app.post('/send-bulk', async (req, res) => {
    try {
        if (connectionStatus !== 'connected' || !sock) {
            return res.status(503).json({ success: false, error: 'WhatsApp is not connected' });
        }

        const { messages, delay = 3000 } = req.body;
        if (!Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: 'messages must be an array' });
        }

        const results = [];
        
        // Execute sequentially to respect the delay and avoid rate limits
        for (const item of messages) {
            const { phone, message } = item;
            try {
                const jid = `${phone}@s.whatsapp.net`;
                const result = await sock.sendMessage(jid, { text: message });
                results.push({ phone, success: true, messageId: result.key.id });
                
                // Wait for the delay
                await new Promise(resolve => setTimeout(resolve, delay));
            } catch (err) {
                results.push({ phone, success: false, error: err.message });
            }
        }
        
        res.json({
            success: true,
            results
        });
    } catch (err) {
        console.error("Error sending bulk messages:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /disconnect
 * Disconnects session and clears auth
 */
app.post('/disconnect', async (req, res) => {
    try {
        if (sock) {
            sock.logout();
        }
        res.json({ success: true });
    } catch (err) {
        console.error("Error disconnecting:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`WhatsApp Bridge server running on port ${port}`);
    
    // Attempt initial connection on startup if auth info exists
    if (fs.existsSync('./auth_info')) {
        console.log('Found existing auth info, attempting to connect...');
        connectToWhatsApp();
    }
});
