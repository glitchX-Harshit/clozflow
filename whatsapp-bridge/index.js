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
let isConnecting = false;       // Lock to prevent duplicate connection attempts
let reconnectTimer = null;      // Track reconnect timer so we can cancel it
let reconnectAttempt = 0;       // Track consecutive reconnect attempts

/**
 * Cleanly close the existing socket before making a new one.
 * This is the KEY fix — without this, WhatsApp sees two sessions
 * from the same device and kills both with a "conflict" error,
 * which triggers another reconnect, creating an infinite loop.
 */
function cleanupSocket() {
    if (sock) {
        try {
            // Remove all listeners first to prevent ghost event handlers
            sock.ev.removeAllListeners('creds.update');
            sock.ev.removeAllListeners('connection.update');
            sock.ev.removeAllListeners('messages.upsert');
            // Close the websocket
            sock.ws?.close();
            sock.end(undefined);
        } catch (e) {
            // Ignore cleanup errors — socket might already be dead
        }
        sock = null;
    }
}

/**
 * Initialize WhatsApp connection using Baileys
 */
async function connectToWhatsApp() {
    // Connection lock — prevent multiple simultaneous connect attempts
    if (isConnecting) {
        console.log('[Bridge] Connection attempt already in progress, skipping.');
        return;
    }
    isConnecting = true;

    // Clear any pending reconnect timer
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    // IMPORTANT: Clean up the old socket BEFORE creating a new one
    cleanupSocket();

    try {
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`[Bridge] Using WA v${version.join('.')}, isLatest: ${isLatest}`);
        const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
        
        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            // Suppress ALL Baileys internal logs
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            syncFullHistory: false,
            markOnlineOnConnect: true,
            getMessage: async (key) => {
                return { conversation: '' };
            },
            // Give WhatsApp plenty of time to respond
            defaultQueryTimeoutMs: 120_000,
            connectTimeoutMs: 60_000,
            keepAliveIntervalMs: 25_000,
            // Retry failed requests up to 3 times
            retryRequestDelayMs: 500,
        });

        // Save credentials when updated
        sock.ev.on('creds.update', saveCreds);

        // Handle connection events
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                try {
                    currentQR = await qrcode.toDataURL(qr);
                    console.log('[Bridge] QR Code generated. Scan it via GET /qr or your frontend.');
                } catch (err) {
                    console.error("[Bridge] Error generating QR code:", err.message);
                }
            }

            if (connection === 'close') {
                currentQR = null;
                connectionStatus = 'disconnected';
                currentUserPhone = null;
                isConnecting = false;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMsg = lastDisconnect?.error?.message || 'unknown';

                // Only reconnect if we weren't explicitly logged out
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('[Bridge] Logged out by user. Clearing auth and stopping.');
                    fs.rmSync('./auth_info', { recursive: true, force: true });
                    return;
                }

                // Exponential backoff: 10s, 20s, 30s, max 60s
                reconnectAttempt++;
                const delay = Math.min(10_000 * reconnectAttempt, 60_000);
                console.log(`[Bridge] Connection closed (${errorMsg}). Reconnecting in ${delay / 1000}s (attempt #${reconnectAttempt})...`);
                
                reconnectTimer = setTimeout(() => {
                    connectToWhatsApp();
                }, delay);

            } else if (connection === 'open') {
                currentQR = null;
                connectionStatus = 'connected';
                reconnectAttempt = 0; // Reset backoff on successful connect
                isConnecting = false;
                currentUserPhone = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0];
                console.log('[Bridge] ✅ Connected successfully as:', currentUserPhone);
            } else if (connection === 'connecting') {
                connectionStatus = 'connecting';
                console.log('[Bridge] Connecting to WhatsApp...');
            }
        });

        // Handle incoming messages
        sock.ev.on('messages.upsert', async (m) => {
            if (m.type !== 'notify') return;
            
            for (const msg of m.messages) {
                if (msg.key.fromMe) continue;
                
                try {
                    const senderJid = msg.key.remoteJid;
                    if (senderJid.endsWith('@g.us')) continue; 
                    
                    const senderPhone = senderJid.split('@')[0];
                    const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                    const timestamp = new Date(msg.messageTimestamp * 1000).toISOString();
                    const messageId = msg.key.id;
                    const pushName = msg.pushName || 'Unknown';

                    if (!messageText) continue;

                    const payload = {
                        from: senderPhone,
                        message: messageText,
                        timestamp: timestamp,
                        message_id: messageId,
                        push_name: pushName
                    };

                    fetch('http://localhost:8000/whatsapp/webhook', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    }).catch(err => {
                        console.error("[Bridge] Webhook forward failed:", err.message);
                    });

                } catch (err) {
                    console.error("[Bridge] Error processing message:", err.message);
                }
            }
        });

        // Listen for message ACKs (Delivery Receipts)
        sock.ev.on('messages.update', (updates) => {
            for (const update of updates) {
                if (update.update.status) {
                    const statusMap = {
                        1: 'Server Received',
                        2: 'Delivered',
                        3: 'Read',
                        4: 'Played'
                    };
                    const statusStr = statusMap[update.update.status] || update.update.status;
                    console.log(`[Bridge] 📡 Message ACK [${update.key.id}]: ${statusStr}`);
                }
            }
        });
        
    } catch (err) {
        console.error("[Bridge] Fatal error initializing connection:", err.message);
        isConnecting = false;
        // Retry after 15 seconds on fatal init error
        reconnectTimer = setTimeout(() => connectToWhatsApp(), 15_000);
    }
}

/**
 * Helper: send a message with 1 automatic retry.
 * If the first attempt fails (e.g. due to a brief timeout), wait 3s and retry once.
 */
async function sendWithRetry(jid, content, retries = 1) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await sock.sendMessage(jid, content);
        } catch (err) {
            console.error(`[Bridge] Send attempt ${attempt + 1} failed for ${jid}: ${err.message}`);
            if (attempt < retries) {
                console.log(`[Bridge] Retrying in 3s...`);
                await new Promise(r => setTimeout(r, 3000));
            } else {
                throw err;
            }
        }
    }
}

// --- Endpoints ---

/**
 * GET /status
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
 */
app.get('/qr', (req, res) => {
    try {
        if (connectionStatus === 'connected') {
            return res.json({ status: 'connected', qr: null });
        }
        
        if (currentQR) {
            return res.json({ status: 'waiting', qr: currentQR });
        }
        
        if (connectionStatus === 'disconnected' && !isConnecting) {
            connectToWhatsApp();
        }
        
        res.json({ status: 'waiting', qr: null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /send
 */
app.post('/send', async (req, res) => {
    try {
        console.log(`[Bridge] POST /send received — phone: ${req.body.phone}, connectionStatus: ${connectionStatus}, sock: ${!!sock}`);
        
        if (connectionStatus !== 'connected' || !sock) {
            console.log(`[Bridge] Cannot send — not connected (status: ${connectionStatus})`);
            return res.status(503).json({ success: false, error: 'WhatsApp is not connected. Current status: ' + connectionStatus });
        }

        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Missing phone or message in request body' });
        }

        let cleanPhone = String(phone).replace(/\D/g, '');
        // If 10 digits starting with 6,7,8,9 (standard Indian mobile format without country code), prepend 91
        if (cleanPhone.length === 10 && /^[6-9]/.test(cleanPhone)) {
            cleanPhone = '91' + cleanPhone;
        }

        const jid = `${cleanPhone}@s.whatsapp.net`;
        
        // Verify if the number is actually on WhatsApp!
        console.log(`[Bridge] Checking if ${cleanPhone} is on WhatsApp...`);
        const [waStatus] = await sock.onWhatsApp(jid);
        console.log(`[Bridge] onWhatsApp result for ${cleanPhone}:`, JSON.stringify(waStatus));
        
        if (!waStatus || !waStatus.exists) {
            console.warn(`[Bridge] ⚠️ Number ${cleanPhone} is not registered on WhatsApp.`);
            return res.status(404).json({ success: false, error: 'Phone number is not registered on WhatsApp' });
        }

        console.log(`[Bridge] Sending message to ${jid}...`);
        
        // Force the WhatsApp server to acknowledge us interacting with a new contact
        try {
            await sock.presenceSubscribe(waStatus.jid);
            await sock.sendPresenceUpdate('composing', waStatus.jid);
            // Wait 1 second to simulate typing before sending
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sock.sendPresenceUpdate('paused', waStatus.jid);
        } catch (presenceErr) {
            console.log(`[Bridge] Presence update failed (ignoring): ${presenceErr.message}`);
        }

        const result = await sendWithRetry(waStatus.jid, { text: message });
        console.log(`[Bridge] ✅ Message sent successfully. ID: ${result.key.id}`);
        
        res.json({
            success: true,
            messageId: result.key.id,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error(`[Bridge] ❌ Error sending message: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /send-bulk
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
        
        for (const item of messages) {
            const { phone, message } = item;
            try {
                const jid = `${phone}@s.whatsapp.net`;
                const result = await sendWithRetry(jid, { text: message });
                results.push({ phone, success: true, messageId: result.key.id });
                await new Promise(resolve => setTimeout(resolve, delay));
            } catch (err) {
                results.push({ phone, success: false, error: err.message });
            }
        }
        
        res.json({ success: true, results });
    } catch (err) {
        console.error("[Bridge] Error sending bulk:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /disconnect
 */
app.post('/disconnect', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
        }
        cleanupSocket();
        connectionStatus = 'disconnected';
        currentUserPhone = null;
        currentQR = null;
        res.json({ success: true });
    } catch (err) {
        console.error("[Bridge] Error disconnecting:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`[Bridge] WhatsApp Bridge running on http://localhost:${port}`);
    
    if (fs.existsSync('./auth_info')) {
        console.log('[Bridge] Found existing auth, attempting auto-connect...');
        connectToWhatsApp();
    } else {
        console.log('[Bridge] No auth found. Call GET /qr to start pairing.');
    }
});
