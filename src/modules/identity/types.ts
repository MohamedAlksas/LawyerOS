export type UserRole = 'OWNER' | 'MAINTAINER';

export type Permission =
  | 'READ_OPERATIONS'
  | 'MANAGE_OPERATIONS'
  | 'READ_CLIENT_DATA'
  | 'WRITE_CLIENT_DATA'
  | 'READ_FINANCE'
  | 'WRITE_FINANCE'
  | 'READ_DOCUMENTS'
  | 'WRITE_DOCUMENTS'
  | 'MANAGE_SECURITY'
  | 'EXPORT_DATA';

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  sessionId: string;
  twoFactorVerified: boolean;
}

export type AuthErrorCode =
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'SESSION_INACTIVE'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED';

export class AuthenticationError extends Error {
  public readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

export class AuthorizationError extends Error {
  public readonly code: 'FORBIDDEN';

  constructor(message = 'غير مصرح للقيام بهذه العملية.') {
    super(message);
    this.name = 'AuthorizationError';
    this.code = 'FORBIDDEN';
  }
}

export class ProvisioningError extends Error {
  public readonly code: 'OWNER_ALREADY_EXISTS' | 'INVALID_INPUT';

  constructor(code: 'OWNER_ALREADY_EXISTS' | 'INVALID_INPUT', message: string) {
    super(message);
    this.name = 'ProvisioningError';
    this.code = code;
  }
}

export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}