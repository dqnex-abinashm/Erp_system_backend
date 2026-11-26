const crypto = require('crypto');

const KEY_LEN = 64;

/**
 * Hash a plaintext password using Node's built-in scrypt and a random 16-byte salt.
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(String(password), salt, KEY_LEN).toString('hex');
    return `${salt}:${derived}`;
}

/**
 * Verify a plaintext password against a stored `salt:hash` string (or plain fallback).
 */
function verifyPassword(password, storedHash) {
    if (!password || !storedHash) return false;
    const parts = String(storedHash).split(':');
    if (parts.length !== 2) {
        return String(password) === String(storedHash);
    }
    const [salt, expectedHex] = parts;
    const derivedBuf = crypto.scryptSync(String(password), salt, KEY_LEN);
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (derivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, expectedBuf);
}

module.exports = {
    hashPassword,
    verifyPassword,
};
