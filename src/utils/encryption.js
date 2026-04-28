const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32-byte key → 64 hex chars

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY environment variable is not set');
  return Buffer.from(key, 'hex');
}

exports.encrypt = (text) => {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as: iv:tag:encrypted (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

exports.decrypt = (stored) => {
  if (!stored) return null;
  
  // Not encrypted yet (legacy plain text) — return as-is
  if (!stored.includes(':')) return stored;
  
  const [ivHex, tagHex, encryptedHex] = stored.split(':');
  if (!ivHex || !tagHex || !encryptedHex) return stored; // malformed, return as-is

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return stored; // fallback
  }
};