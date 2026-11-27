import crypto from 'crypto';

export class CryptoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoConfigurationError';
  }
}

export class CryptoDecryptionError extends Error {
  constructor(message = 'فشل فك تشفير بيانات الهوية أو تم التلاعب بها.') {
    super(message);
    this.name = 'CryptoDecryptionError';
  }
}

export interface EncryptedIdentityEnvelope {
  ciphertext: string; // Base64
  iv: string;         // Base64 (12 bytes)
  authTag: string;    // Base64 (16 bytes)
  keyId: string;
  encryptionVersion: number;
  lastFour: string;
}

export interface EncryptIdentityParams {
  plaintext: string;
  partyId: string;
  identificationType: string;
  keyId?: string;
  overrideKey?: string | Buffer;
}

export interface DecryptIdentityParams {
  ciphertext: string;
  iv: string;
  authTag: string;
  partyId: string;
  identificationType: string;
  keyId: string;
  encryptionVersion?: number;
  overrideKeys?: Record<string, string | Buffer>;
}

/**
 * Parses a 256-bit (32 bytes) encryption key from hex or base64 string or Buffer.
 */
export function parseKeyBuffer(raw: string | Buffer): Buffer {
  if (Buffer.isBuffer(raw)) {
    if (raw.length !== 32) {
      throw new CryptoConfigurationError(`Encryption key must be exactly 32 bytes (256 bits). Received ${raw.length} bytes.`);
    }
    return raw;
  }

  const trimmed = raw.trim();
  // 64 hex characters = 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // Base64 (44 characters with '=' padding or 43 unpadded) with strict canonical round-trip check
  if (/^[A-Za-z0-9+/]{43}=?$/.test(trimmed) || /^[A-Za-z0-9+/]{44}$/.test(trimmed)) {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 32) {
      const canonical = buf.toString('base64');
      if (trimmed === canonical || trimmed === canonical.replace(/=+$/, '')) {
        return buf;
      }
    }
  }

  throw new CryptoConfigurationError('Invalid encryption key format. Expected 32 bytes as 64-char hex or 44-char base64 string.');
}

function parsePreviousKeysEnv(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) {
    return {};
  }

  const trimmed = raw.trim();
  const parsedMap: Record<string, string> = {};

  if (trimmed.startsWith('{')) {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      throw new CryptoConfigurationError('Invalid PARTY_IDENTITY_PREVIOUS_KEYS JSON format.');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      throw new CryptoConfigurationError('PARTY_IDENTITY_PREVIOUS_KEYS must be a JSON object mapping keyId to key.');
    }
    for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
      const cleanId = k.trim();
      if (!cleanId || typeof v !== 'string' || !v.trim()) {
        throw new CryptoConfigurationError('PARTY_IDENTITY_PREVIOUS_KEYS entries must have non-empty string keyId and key.');
      }
      parsedMap[cleanId] = v.trim();
    }
    return parsedMap;
  }

  for (const part of trimmed.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const colonIdx = entry.indexOf(':');
    if (colonIdx <= 0) {
      throw new CryptoConfigurationError('Invalid PARTY_IDENTITY_PREVIOUS_KEYS entry; expected keyId:key.');
    }
    const cleanId = entry.slice(0, colonIdx).trim();
    const keyVal = entry.slice(colonIdx + 1).trim();
    if (!cleanId || !keyVal) {
      throw new CryptoConfigurationError('Invalid PARTY_IDENTITY_PREVIOUS_KEYS entry; expected non-empty keyId and key.');
    }
    parsedMap[cleanId] = keyVal;
  }

  return parsedMap;
}

/**
 * Resolves the active encryption key and keyId from explicit overrides or environment.
 */
export function resolveEncryptionKey(
  targetKeyId?: string,
  overrideKey?: string | Buffer
): { keyBuffer: Buffer; keyId: string } {
  if (overrideKey) {
    const keyBuffer = parseKeyBuffer(overrideKey);
    const keyId = targetKeyId || process.env.PARTY_IDENTITY_KEY_ID || 'k_override';
    return { keyBuffer, keyId };
  }

  const envKey = process.env.PARTY_IDENTITY_ENCRYPTION_KEY;
  const envKeyId = process.env.PARTY_IDENTITY_KEY_ID || 'k2026_01';

  if (targetKeyId && targetKeyId !== envKeyId) {
    const previousKeys = parsePreviousKeysEnv(process.env.PARTY_IDENTITY_PREVIOUS_KEYS);
    if (Object.hasOwn(previousKeys, targetKeyId)) {
      return { keyBuffer: parseKeyBuffer(previousKeys[targetKeyId]), keyId: targetKeyId };
    }
    throw new CryptoConfigurationError(`Key ID '${targetKeyId}' is not available in current key configuration.`);
  }

  if (!envKey) {
    throw new CryptoConfigurationError('Missing required encryption key: PARTY_IDENTITY_ENCRYPTION_KEY is not configured.');
  }

  const keyBuffer = parseKeyBuffer(envKey);
  return { keyBuffer, keyId: envKeyId };
}

/**
 * Builds deterministic context-binding Additional Authenticated Data (AAD) string.
 * Binds ciphertext strictly to partyId and identificationType.
 */
export function buildContextAad(partyId: string, identificationType: string): string {
  if (!partyId || !identificationType) {
    throw new CryptoConfigurationError('Context binding requires valid partyId and identificationType.');
  }
  return `partyId:${partyId}:type:${identificationType}`;
}

/**
 * Encrypts party identification number using AES-256-GCM authenticated encryption.
 * Generates fresh 12-byte random IV per operation.
 * Binds partyId + identificationType via AAD.
 */
export function encryptPartyIdentity(params: EncryptIdentityParams): EncryptedIdentityEnvelope {
  const { plaintext, partyId, identificationType, keyId, overrideKey } = params;

  if (!plaintext || plaintext.trim().length === 0) {
    throw new CryptoConfigurationError('Plaintext identity number cannot be empty.');
  }

  const { keyBuffer, keyId: resolvedKeyId } = resolveEncryptionKey(keyId, overrideKey);
  const iv = crypto.randomBytes(12);
  const aad = buildContextAad(partyId, identificationType);

  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertextBuf = Buffer.concat([
    cipher.update(plaintext.trim(), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Extract last 4 characters for display masking
  const trimmed = plaintext.trim();
  const characters = Array.from(trimmed);
  const lastFour = characters.length > 4 ? characters.slice(-4).join('') : '';

  return {
    ciphertext: ciphertextBuf.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyId: resolvedKeyId,
    encryptionVersion: 1,
    lastFour,
  };
}

/**
 * Decrypts party identification number using AES-256-GCM.
 * Validates auth tag and context-bound AAD.
 * Fails closed on key mismatch, corrupted ciphertext, altered IV/tag, or wrong party/type.
 */
export function decryptPartyIdentity(params: DecryptIdentityParams): string {
  const {
    ciphertext,
    iv,
    authTag,
    partyId,
    identificationType,
    keyId,
    encryptionVersion = 1,
    overrideKeys,
  } = params;

  if (encryptionVersion !== 1) {
    throw new CryptoDecryptionError(`Unsupported encryption version: ${encryptionVersion}`);
  }

  let keyBuffer: Buffer;
  if (overrideKeys && Object.hasOwn(overrideKeys, keyId) && overrideKeys[keyId]) {
    keyBuffer = parseKeyBuffer(overrideKeys[keyId]);
  } else {
    try {
      const resolved = resolveEncryptionKey(keyId);
      keyBuffer = resolved.keyBuffer;
    } catch (err) {
      if (err instanceof CryptoConfigurationError) {
        throw new CryptoDecryptionError(`Cannot decrypt identity: ${err.message}`);
      }
      throw err;
    }
  }

  try {
    const ivBuf = Buffer.from(iv, 'base64');
    const authTagBuf = Buffer.from(authTag, 'base64');
    const ciphertextBuf = Buffer.from(ciphertext, 'base64');

    if (ivBuf.length !== 12 || authTagBuf.length !== 16) {
      throw new CryptoDecryptionError('Malformed cryptographic envelope: invalid IV or authTag length.');
    }

    const aad = buildContextAad(partyId, identificationType);

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuf);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTagBuf);

    const decrypted = Buffer.concat([
      decipher.update(ciphertextBuf),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    if (error instanceof CryptoDecryptionError) {
      throw error;
    }
    throw new CryptoDecryptionError();
  }
}

/**
 * Formats display mask string (e.g. "****1234").
 */
// Older envelopes could store the whole value as their suffix. GCM preserves the
// plaintext byte length, so a suffix is safe only when some bytes are omitted.
export function getIdentityMaskSuffix(envelope: { ciphertext: string; lastFour: string }): string {
  const ciphertextBytes = Buffer.from(envelope.ciphertext, 'base64').length;
  return ciphertextBytes > Buffer.byteLength(envelope.lastFour, 'utf8') ? envelope.lastFour : '';
}

export function formatMaskedIdentity(lastFour: string): string {
  return `****${lastFour}`;
}

