const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
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

        // Handle QR code
        if (qr) {
            currentQR = qr;
            console.log('🔐 New QR code generated. Visit /qr to scan it.');
        }

        if (connection === 'close') {
            isReady = false;
            currentQR = null;
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log('Connection closed. Reason:', reason);
            
            if (reason !== DisconnectReason.loggedOut) {
                console.log('Reconnecting in 3 seconds...');
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

// Serve QR code as scannable image
app.get('/qr', async (req, res) => {
    if (isReady) {
        res.send('<h1>✅ WhatsApp is already connected!</h1><p>You can now send messages via the API.</p>');
        return;
    }

    if (!currentQR) {
        res.send('<h1>⏳ Waiting for QR code...</h1><p>Please wait a few seconds and refresh this page.</p>');
        return;
    }

    try {
        const qrImage = await QRCode.toDataURL(currentQR);
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp QR Code</title>
                <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
                    .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); display: inline-block; }
                    h1 { color: #25D366; }
                    img { max-width: 300px; margin: 20px 0; }
                    .instructions { background: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: left; }
                    .refresh { background: #25D366; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; }
                </style>
                <meta http-equiv="refresh" content="10">
            </head>
            <body>
                <div class="container">
                    <h1>📱 Scan QR Code with WhatsApp</h1>
                    <img src="${qrImage}" alt="QR Code">
                    <div class="instructions">
                        <h3>How to scan:</h3>
                        <ol>
                            <li>Open <strong>WhatsApp</strong> on your phone</li>
                            <li>Go to <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                            <li>Tap <strong>Link a Device</strong></li>
                            <li>Point your phone at this QR code</li>
                        </ol>
                        <p><strong>⚠️ Use a SECONDARY WhatsApp number!</strong></p>
                        <p>This page auto-refreshes every 10 seconds.</p>
                    </div>
                    <button class="refresh" onclick="location.reload()">🔄 Refresh Now</button>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send('Error generating QR code: ' + error.message);
    }
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
