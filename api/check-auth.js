// api/check-auth.js
import crypto from 'crypto';

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function getClientIdentifier(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress || 'unknown';
}

function safeCompare(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const { password } = req.body || {};
    const MASTER_PASSWORD = process.env.SILAS_MASTER_PASSWORD;
    const clientId = getClientIdentifier(req);
    const now = Date.now();

    const state = attempts.get(clientId) || { count: 0, firstAttemptAt: now, blockedUntil: 0 };

    if (state.blockedUntil > now) {
        const retryAfter = Math.ceil((state.blockedUntil - now) / 1000);
        return res.status(429).json({ success: false, message: `Zu viele Versuche. Bitte in ${retryAfter}s erneut versuchen.` });
    }

    if (now - state.firstAttemptAt > WINDOW_MS) {
        state.count = 0;
        state.firstAttemptAt = now;
        state.blockedUntil = 0;
    }

    if (!MASTER_PASSWORD || typeof password !== 'string' || password.length === 0) {
        return res.status(400).json({ success: false, message: 'Ungültige Anfrage' });
    }

    if (safeCompare(password, MASTER_PASSWORD)) {
        attempts.delete(clientId);
        return res.status(200).json({ success: true, message: "Zugriff gewährt" });
    } else {
        state.count += 1;
        if (state.count >= MAX_ATTEMPTS) {
            state.blockedUntil = now + BLOCK_MS;
        }
        attempts.set(clientId, state);
        return res.status(401).json({ success: false, message: "Falsches Passwort" });
    }
}
