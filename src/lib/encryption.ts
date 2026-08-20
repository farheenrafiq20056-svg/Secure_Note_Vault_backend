/**
 * Cryptographic Subsystem for Secure Notes Vault.
 * 
 * Implements:
 * 1. Key Derivation Function (PBKDF2-HMAC-SHA256) for deriving 256-bit symmetric keys from user credentials.
 * 2. Authenticated Encryption with Associated Data (AEAD) using AES-256-GCM.
 * 3. Nonce generation (12-byte IV per encryption operation) and 16-byte authentication tag verification.
 * 
 * Security Guarantee:
 * Note plaintext is NEVER written to the database or logged in application logs.
 * Decryption fails immediately if ciphertext or authentication tag is tampered with.
 */

import crypto from 'crypto';

// AES-256-GCM parameters
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // Standard 96-bit IV for AES-GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128-bit authentication tag
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BYTES = 32; // 256 bits

export interface EncryptedPayload {
  contentEncrypted: string; // Hex string: [authTag (16 bytes)][ciphertext]
  nonce: string;            // Hex string: [IV (12 bytes)]
}

/**
 * Derives a deterministic 256-bit key from a user's password and salt (user's ID or unique salt)
 * Uses PBKDF2 with SHA-256 and 100,000 iterations.
 */
export function deriveKeyFromPassword(password: string, salt: string): Buffer {
  return crypto.pbkdf2Sync(
    password,
    Buffer.from(salt, 'utf-8'),
    PBKDF2_ITERATIONS,
    KEY_LENGTH_BYTES,
    'sha256'
  );
}

/**
 * Encrypts a UTF-8 string payload using AES-256-GCM with a 256-bit key.
 * Generates a unique 12-byte IV for every encryption call.
 */
export function encryptNoteContent(plaintext: string, key: Buffer): EncryptedPayload {
  // Generate cryptographically secure random 12-byte initialization vector (IV / Nonce)
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });

  const encryptedBuffer = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  // Retrieve the 16-byte authentication tag produced by GCM mode
  const authTag = cipher.getAuthTag();

  // Combine authTag + ciphertext into contentEncrypted string
  const combinedPayload = Buffer.concat([authTag, encryptedBuffer]);

  return {
    contentEncrypted: combinedPayload.toString('hex'),
    nonce: iv.toString('hex')
  };
}

/**
 * Decrypts an AES-256-GCM encrypted payload using the user's derived 256-bit key.
 * Verifies the authentication tag before returning the decrypted string.
 */
export function decryptNoteContent(encryptedPayload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(encryptedPayload.nonce, 'hex');
  const combined = Buffer.from(encryptedPayload.contentEncrypted, 'hex');

  if (combined.length < AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Malformed encrypted payload: insufficient bytes for authentication tag.');
  }

  // Extract the 16-byte tag and the ciphertext
  const authTag = combined.subarray(0, AUTH_TAG_LENGTH_BYTES);
  const ciphertext = combined.subarray(AUTH_TAG_LENGTH_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES
  });

  decipher.setAuthTag(authTag);

  const decryptedBuffer = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decryptedBuffer.toString('utf8');
}
