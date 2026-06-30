const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

let sock = null;
let isReady = false;
let currentQR = null;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log('Connection update:', connection);

        if (qr) {
            currentQR = qr;
            console.log('🔐 New QR code generated. Visit /qr to scan it.');
        }

        if (connection === 'close') {
            isReady = false;
            currentQR = null;
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startWhatsApp, 3000);
            } else {
                console.log('❌ Logged out. Delete auth_info folder and restart.');
            }
        } else if (connection === 'open') {
            isReady = true;
            currentQR = null;
            console.log('✅ WhatsApp connected and ready!');
        }
    });
}

startWhatsApp();

// Serve QR code using a free public API (No extra npm packages needed!)
app.get('/qr', (req, res) => {
    if (isReady) {
        res.send('<h1 style="text-align:center; font-family:Arial; color:green;">✅ WhatsApp is already connected!</h1><p style="text-align:center;">You can now send messages via your PHP app.</p>');
        return;
    }

    if (!currentQR) {
        res.send('<h1 style="text-align:center; font-family:Arial;">⏳ Waiting for QR code... Please refresh in a few seconds.</h1>');
        return;
    }

    // Generate QR code image URL using free public API
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQR)}`;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp QR Code</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
                .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); display: inline-block; max-width: 500px; }
                h1 { color: #25D366; }
                img { max-width: 300px; margin: 20px 0; border: 5px solid #25D366; border-radius: 10px; }
                .instructions { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left; }
                .warning { color: red; font-weight: bold; }
            </style>
            <meta http-equiv="refresh" content="20">
        </head>
        <body>
            <div class="container">
                <h1>📱 Scan QR Code with WhatsApp</h1>
                <img src="${qrImageUrl}" alt="QR Code">
                <div class="instructions">
                    <h3>How to scan:</h3>
                    <ol>
                        <li>Open <strong>WhatsApp</strong> on your phone</li>
                        <li>Go to <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                        <li>Tap <strong>Link a Device</strong></li>
                        <li>Point your phone at this QR code</li>
                    </ol>
                    <p class="warning">⚠️ Use a SECONDARY WhatsApp number!</p>
                    <p><em>This page auto-refreshes every 20 seconds.</em></p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Send invitation (text + image)
app.post('/send-invitation', async (req, res) => {
    if (!isReady) {
        return res.status(503).json({ 
            success: false, 
            message: 'WhatsApp not connected. Scan QR code at /qr first.' 
        });
    }

    try {
        const { phone, name, imageUrl, eventDate } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        const caption = `🎉 *Hello ${name}!*\n\nYou are invited to our event on *${eventDate}*. We can't wait to celebrate with you!`;

        if (imageUrl) {
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const imageBuffer = Buffer.from(response.data, 'binary');
            await sock.sendMessage(jid, { image: imageBuffer, caption });
        } else {
            await sock.sendMessage(jid, { text: caption });
        }

        res.json({ success: true, message: 'Invitation sent' });
    } catch (error) {
        console.error('Send error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Check status
app.get('/status', (req, res) => {
    res.json({ 
        connected: isReady,
        message: isReady ? 'WhatsApp is connected' : 'WhatsApp not connected. Visit /qr to scan QR code.'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        connected: isReady,
        endpoints: {
            'QR Code': '/qr',
            'Status': '/status',
            'Send Invitation': 'POST /send-invitation'
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhatsApp API on port ${PORT}`));
