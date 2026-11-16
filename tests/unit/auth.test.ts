import { describe, it, expect } from 'vitest';
import {
  authorize,
  assertAuthorized,
  Actor,
  Permission,
  AuthorizationError,
  AuthenticationError,
} from '@/modules/identity';
import { validateEnv, EnvironmentValidationError } from '@/lib/env';

describe('Identity & Authorization Unit Tests', () => {
  const ownerActor: Actor = {
    id: 'user-owner-123',
    name: 'الأستاذ عادل المالك',
    email: 'adel@example.com',
    role: 'OWNER',
    sessionId: 'session-owner-123',
    twoFactorVerified: true,
  };

  const maintainerActor: Actor = {
    id: 'user-maintainer-456',
    name: 'مهندس الصيانة التقنية',
    email: 'maintainer@example.com',
    role: 'MAINTAINER',
    sessionId: 'session-maintainer-456',
    twoFactorVerified: true,
  };

  describe('Canonical Least-Privilege Authorization (authorize & assertAuthorized)', () => {
    const operationalPermissions: Permission[] = [
      'READ_OPERATIONS',
      'MANAGE_OPERATIONS',
    ];

    const confidentialClientPermissions: Permission[] = [
      'READ_CLIENT_DATA',
      'WRITE_CLIENT_DATA',
      'READ_FINANCE',
      'WRITE_FINANCE',
      'READ_DOCUMENTS',
      'WRITE_DOCUMENTS',
      'MANAGE_SECURITY',
      'EXPORT_DATA',
    ];

    it('grants OWNER role full access across all operational and confidential permissions', () => {
      const allPermissions = [...operationalPermissions, ...confidentialClientPermissions];
      for (const perm of allPermissions) {
        expect(authorize(ownerActor, perm)).toBe(true);
        expect(() => assertAuthorized(ownerActor, perm)).not.toThrow();
      }
    });

    it('grants MAINTAINER role access ONLY to operational diagnostics', () => {
      for (const perm of operationalPermissions) {
        expect(authorize(maintainerActor, perm)).toBe(true);
        expect(() => assertAuthorized(maintainerActor, perm)).not.toThrow();
      }
    });

    it('strictly denies MAINTAINER role from reading or mutating confidential client data, finance, documents, or security', () => {
      for (const perm of confidentialClientPermissions) {
        expect(authorize(maintainerActor, perm)).toBe(false);
        expect(() => assertAuthorized(maintainerActor, perm)).toThrowError(AuthorizationError);
      }
    });

    it('throws AuthorizationError with code FORBIDDEN and Arabic message on unauthorized access', () => {
      try {
        assertAuthorized(maintainerActor, 'READ_CLIENT_DATA');
        expect.unreachable('Should have thrown AuthorizationError');
      } catch (err) {
        expect(err).toBeInstanceOf(AuthorizationError);
        const authErr = err as AuthorizationError;
        expect(authErr.code).toBe('FORBIDDEN');
        expect(authErr.message).toContain('غير مصرح');
      }
    });
  });

  describe('Auth Environment Schema Validation (BETTER_AUTH_SECRET & BETTER_AUTH_URL)', () => {
    const baseValidEnv = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5432/lawoffice_dev',
      TEST_DATABASE_URL: 'postgresql://lawoffice_user:synthetic@127.0.0.1:5433/lawoffice_test',
      CI: 'false',
    };

    it('rejects BETTER_AUTH_SECRET shorter than 32 characters and sanitizes error output', () => {
      const shortSecretEnv = {
        ...baseValidEnv,
        BETTER_AUTH_SECRET: 'short_secret_123',
      };

      expect(() => validateEnv(shortSecretEnv)).toThrowError(EnvironmentValidationError);

      try {
        validateEnv(shortSecretEnv);
      } catch (err) {
        const envErr = err as EnvironmentValidationError;
        expect(envErr.invalidKeys).toContain('BETTER_AUTH_SECRET');
        expect(envErr.message).toContain('BETTER_AUTH_SECRET must be at least 32 characters');
        // Redaction verification: ensure the secret string is not reflected in error
        expect(envErr.message).not.toContain('short_secret_123');
      }
    });

    it('accepts well-formed BETTER_AUTH_SECRET of 32 or more characters', () => {
      const validSecretEnv = {
        ...baseValidEnv,
        BETTER_AUTH_SECRET: 'a_very_strong_synthetic_test_secret_32_characters_minimum',
      };

      const validated = validateEnv(validSecretEnv);
      expect(validated.BETTER_AUTH_SECRET).toBe('a_very_strong_synthetic_test_secret_32_characters_minimum');
      expect(validated.BETTER_AUTH_URL).toBe('http://127.0.0.1:3000');
    });

    it('rejects invalid BETTER_AUTH_URL format', () => {
      const invalidUrlEnv = {
        ...baseValidEnv,
        BETTER_AUTH_SECRET: 'a_very_strong_synthetic_test_secret_32_characters_minimum',
        BETTER_AUTH_URL: 'not-a-valid-http-url',
      };

      expect(() => validateEnv(invalidUrlEnv)).toThrowError(EnvironmentValidationError);
    });
  });

  describe('Authentication Errors & Sanitization', () => {
    it('provides clear Arabic error codes without leaking server internals', () => {
      const unauthErr = new AuthenticationError('UNAUTHENTICATED', 'يجب تسجيل الدخول.');
      expect(unauthErr.code).toBe('UNAUTHENTICATED');
      expect(unauthErr.name).toBe('AuthenticationError');

      const mfaErr = new AuthenticationError('MFA_REQUIRED', 'يلزم استكمال التحقق الثنائي.');
      expect(mfaErr.code).toBe('MFA_REQUIRED');

      const inactiveErr = new AuthenticationError('SESSION_INACTIVE', 'تم قفل الجلسة لعدم النشاط.');
      expect(inactiveErr.code).toBe('SESSION_INACTIVE');
    });
  });
});