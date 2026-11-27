import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptPartyIdentity,
  decryptPartyIdentity,
  parseKeyBuffer,
  resolveEncryptionKey,
  formatMaskedIdentity,
  CryptoConfigurationError,
  CryptoDecryptionError,
} from '@/lib/crypto/party-identity';

const TEST_KEY_HEX = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_KEY_ID = 'k2026_01';

describe('T05-07: Party Identity Authenticated Envelope Crypto (Unit)', () => {
  const originalEnvKey = process.env.PARTY_IDENTITY_ENCRYPTION_KEY;
  const originalEnvKeyId = process.env.PARTY_IDENTITY_KEY_ID;

  beforeEach(() => {
    process.env.PARTY_IDENTITY_ENCRYPTION_KEY = TEST_KEY_HEX;
    process.env.PARTY_IDENTITY_KEY_ID = TEST_KEY_ID;
  });

  afterEach(() => {
    if (originalEnvKey === undefined) {
      delete process.env.PARTY_IDENTITY_ENCRYPTION_KEY;
    } else {
      process.env.PARTY_IDENTITY_ENCRYPTION_KEY = originalEnvKey;
    }
    if (originalEnvKeyId === undefined) {
      delete process.env.PARTY_IDENTITY_KEY_ID;
    } else {
      process.env.PARTY_IDENTITY_KEY_ID = originalEnvKeyId;
    }
  });

  describe('Key Configuration & Resolution', () => {
    it('parses valid 64-character hex key to exactly 32 bytes Buffer', () => {
      const buf = parseKeyBuffer(TEST_KEY_HEX);
      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBe(32);
    });

    it('parses valid base64 32-byte key', () => {
      const b64 = Buffer.from(TEST_KEY_HEX, 'hex').toString('base64');
      const buf = parseKeyBuffer(b64);
      expect(buf.length).toBe(32);
    });

    it('rejects keys that are not 32 bytes', () => {
      expect(() => parseKeyBuffer('short_key')).toThrowError(CryptoConfigurationError);
      expect(() => parseKeyBuffer(Buffer.from('too_short'))).toThrowError(CryptoConfigurationError);
    });

    it('throws CryptoConfigurationError when key is not configured in environment', () => {
      delete process.env.PARTY_IDENTITY_ENCRYPTION_KEY;
      expect(() => resolveEncryptionKey()).toThrowError(CryptoConfigurationError);
    });

    it('enforces strict canonical Base64 round-trip in parseKeyBuffer', () => {
      const canonicalPadded = Buffer.from('fbef'.repeat(16), 'hex').toString('base64');
      const canonicalUnpadded = canonicalPadded.replace(/=+$/, '');
      expect(parseKeyBuffer(canonicalPadded)).toHaveLength(32);
      expect(parseKeyBuffer(canonicalUnpadded)).toHaveLength(32);

      // Non-canonical trailing padding bits in final Base64 character must fail closed
      const nonCanonicalBits = 'A'.repeat(42) + 'B=';
      expect(() => parseKeyBuffer(nonCanonicalBits)).toThrowError(CryptoConfigurationError);

      // URL-safe Base64 characters, internal whitespace, or invalid padding must fail closed
      const urlSafe = canonicalPadded.replace(/\+/g, '-').replace(/\//g, '_');
      expect(urlSafe).not.toBe(canonicalPadded);
      expect(() => parseKeyBuffer(urlSafe)).toThrowError(CryptoConfigurationError);
      expect(() => parseKeyBuffer(canonicalPadded.slice(0, 42) + '==')).toThrowError(
        CryptoConfigurationError
      );
      expect(() => parseKeyBuffer('ABCD '.repeat(8) + 'AAAA')).toThrowError(
        CryptoConfigurationError
      );
    });
  });

  describe('Encryption & Nonce Randomness', () => {
    it('encrypts valid national ID and produces distinct ciphertexts and IVs for identical input', () => {
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const type = 'NATIONAL_ID';

      const env1 = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: type,
      });

      const env2 = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: type,
      });

      // Different random 12-byte IVs
      expect(env1.iv).not.toBe(env2.iv);
      // Different resulting ciphertexts due to distinct IV
      expect(env1.ciphertext).not.toBe(env2.ciphertext);
      // Key metadata preserved
      expect(env1.keyId).toBe(TEST_KEY_ID);
      expect(env1.encryptionVersion).toBe(1);
      // Last 4 digits extracted
      expect(env1.lastFour).toBe('4567');
      expect(env2.lastFour).toBe('4567');
    });

    it('correctly masks last four digits for UI presentation', () => {
      expect(formatMaskedIdentity('4567')).toBe('****4567');
      expect(formatMaskedIdentity('98')).toBe('****98');
    });
  });

  describe('Round-Trip Decryption & Fail-Closed Security', () => {
    it('successfully decrypts encrypted national ID when key and context match', () => {
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const type = 'NATIONAL_ID';

      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: type,
      });

      const decrypted = decryptPartyIdentity({
        ciphertext: env.ciphertext,
        iv: env.iv,
        authTag: env.authTag,
        partyId,
        identificationType: type,
        keyId: env.keyId,
      });

      expect(decrypted).toBe(nationalId);
    });

    it('fails closed when attempting to decrypt with a different partyId (Context Binding Violation)', () => {
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const attackerPartyId = '99999999-9999-4999-8999-999999999999';
      const type = 'NATIONAL_ID';

      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: type,
      });

      // Attempting to move ciphertext to attacker's party
      expect(() =>
        decryptPartyIdentity({
          ciphertext: env.ciphertext,
          iv: env.iv,
          authTag: env.authTag,
          partyId: attackerPartyId, // altered context!
          identificationType: type,
          keyId: env.keyId,
        })
      ).toThrowError(CryptoDecryptionError);
    });

    it('fails closed when identificationType is altered', () => {
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';

      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: 'NATIONAL_ID',
      });

      expect(() =>
        decryptPartyIdentity({
          ciphertext: env.ciphertext,
          iv: env.iv,
          authTag: env.authTag,
          partyId,
          identificationType: 'PASSPORT', // altered context!
          keyId: env.keyId,
        })
      ).toThrowError(CryptoDecryptionError);
    });

    it('fails closed when ciphertext is tampered', () => {
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const type = 'NATIONAL_ID';

      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: type,
      });

      // Tamper ciphertext
      const tamperedBuf = Buffer.from(env.ciphertext, 'base64');
      tamperedBuf[0] ^= 0xff;
      const tamperedCiphertext = tamperedBuf.toString('base64');

      expect(() =>
        decryptPartyIdentity({
          ciphertext: tamperedCiphertext,
          iv: env.iv,
          authTag: env.authTag,
          partyId,
          identificationType: type,
          keyId: env.keyId,
        })
      ).toThrowError(CryptoDecryptionError);
    });

    it('fails closed when authTag is tampered', () => {
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const type = 'NATIONAL_ID';

      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: type,
      });

      const tamperedTag = Buffer.from(env.authTag, 'base64');
      tamperedTag[0] ^= 0x01;

      expect(() =>
        decryptPartyIdentity({
          ciphertext: env.ciphertext,
          iv: env.iv,
          authTag: tamperedTag.toString('base64'),
          partyId,
          identificationType: type,
          keyId: env.keyId,
        })
      ).toThrowError(CryptoDecryptionError);
    });

    it('fails closed when wrong key is provided', () => {
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const type = 'NATIONAL_ID';

      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: type,
      });

      const wrongKeyHex = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

      expect(() =>
        decryptPartyIdentity({
          ciphertext: env.ciphertext,
          iv: env.iv,
          authTag: env.authTag,
          partyId,
          identificationType: type,
          keyId: env.keyId,
          overrideKeys: { [env.keyId]: wrongKeyHex },
        })
      ).toThrowError(CryptoDecryptionError);
    });
  });

  describe('PARTY_IDENTITY_PREVIOUS_KEYS key rotation support', () => {
    const OLD_KEY_HEX = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const OLD_KEY_ID = 'k2025_01';
    const originalPrevKeys = process.env.PARTY_IDENTITY_PREVIOUS_KEYS;

    afterEach(() => {
      if (originalPrevKeys === undefined) {
        delete process.env.PARTY_IDENTITY_PREVIOUS_KEYS;
      } else {
        process.env.PARTY_IDENTITY_PREVIOUS_KEYS = originalPrevKeys;
      }
    });

    it('decrypts ciphertext encrypted with older key when previous keys configured as JSON object', () => {
      process.env.PARTY_IDENTITY_ENCRYPTION_KEY = OLD_KEY_HEX;
      process.env.PARTY_IDENTITY_KEY_ID = OLD_KEY_ID;
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: 'NATIONAL_ID',
      });
      expect(env.keyId).toBe(OLD_KEY_ID);

      process.env.PARTY_IDENTITY_ENCRYPTION_KEY = TEST_KEY_HEX;
      process.env.PARTY_IDENTITY_KEY_ID = TEST_KEY_ID;
      process.env.PARTY_IDENTITY_PREVIOUS_KEYS = JSON.stringify({ [OLD_KEY_ID]: OLD_KEY_HEX });

      const decrypted = decryptPartyIdentity({
        ciphertext: env.ciphertext,
        iv: env.iv,
        authTag: env.authTag,
        partyId,
        identificationType: 'NATIONAL_ID',
        keyId: env.keyId,
      });
      expect(decrypted).toBe(nationalId);
    });

    it('decrypts ciphertext encrypted with older key when previous keys configured as comma-separated pairs', () => {
      process.env.PARTY_IDENTITY_ENCRYPTION_KEY = OLD_KEY_HEX;
      process.env.PARTY_IDENTITY_KEY_ID = OLD_KEY_ID;
      const nationalId = '29501011234567';
      const partyId = '11111111-1111-4111-8111-111111111111';
      const env = encryptPartyIdentity({
        plaintext: nationalId,
        partyId,
        identificationType: 'NATIONAL_ID',
      });

      process.env.PARTY_IDENTITY_ENCRYPTION_KEY = TEST_KEY_HEX;
      process.env.PARTY_IDENTITY_KEY_ID = TEST_KEY_ID;
      process.env.PARTY_IDENTITY_PREVIOUS_KEYS = `${OLD_KEY_ID}:${OLD_KEY_HEX},k2024_99:0102030405060708010203040506070801020304050607080102030405060708`;

      const decrypted = decryptPartyIdentity({
        ciphertext: env.ciphertext,
        iv: env.iv,
        authTag: env.authTag,
        partyId,
        identificationType: 'NATIONAL_ID',
        keyId: env.keyId,
      });
      expect(decrypted).toBe(nationalId);
    });
  });
});

