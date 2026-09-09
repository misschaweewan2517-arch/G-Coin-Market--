const crypto = require('crypto');

function getKey() {
  const hex = process.env.SECRET_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'SECRET_ENCRYPTION_KEY must be set in .env as a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

// Encrypts a plaintext string (e.g. "username: foo\npassword: bar") into a single
// storable string: iv:authTag:ciphertext (all hex encoded).
function encryptSecret(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptSecret(stored) {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
