const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '50mb' }));

let sock = null;
let isReady = false;

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    sock = makeWASocket({
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n=== SCAN THIS QR CODE WITH WHATSAPP ===');
            qrcode.generate(qr, { small: true });
            console.log('=========================================\n');
        }

        if (connection === 'close') {
            isReady = false;
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startWhatsApp, 3000);
            }
        } else if (connection === 'open') {
            isReady = true;
            console.log('✅ WhatsApp connected!');
        }
    });
}

startWhatsApp();

// Send invitation (text + image)
app.post('/send-invitation', async (req, res) => {
    if (!isReady) return res.status(503).json({ success: false, message: 'Not connected' });

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
        res.status(500).json({ success: false, message: error.message });
    }
});

// Check status
app.get('/status', (req, res) => {
    res.json({ connected: isReady });
});

// Keep alive endpoint
app.get('/', (req, res) => {
    res.json({ status: 'running', connected: isReady });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhatsApp API on port ${PORT}`));
