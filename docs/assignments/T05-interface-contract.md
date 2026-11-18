# LawOffice OS — Task T05 Interface & Architecture Contract

- **Version:** 1.0.0 (Pre-Implementation Frozen Contract)
- **Date:** 2026-11-17
- **Governing Task:** T05 (Parties, client profiles, communication, and powers of attorney)
- **Base SHA:** `63388fd4d17b92ddbda40906c16dfeda155fa9bf`
- **Application Test Port:** `3205` (`http://127.0.0.1:3205`)
- **Dedicated PostgreSQL Database:** `postgresql://lawoffice_user:lawoffice_dev_secret@127.0.0.1:5433/lawoffice_t05_test?schema=public`

---

## 1. Domain Entities & Database Schema

The Prisma schema (`prisma/schema.prisma`) is extended with the following core entities:

```prisma
enum PartyKind {
  PERSON
  ORGANIZATION
}

enum IdentificationType {
  NATIONAL_ID
  PASSPORT
  COMMERCIAL_REG
  TAX_CARD
  OTHER
}

enum CommunicationChannel {
  PHONE
  IN_PERSON
  WHATSAPP
  EMAIL
  OTHER
}

enum PoAType {
  GENERAL
  SPECIAL
  LITIGATION
  COMMERCIAL
  OTHER
}

enum PoAReviewStatus {
  UNREVIEWED
  VALID
  EXPIRED
  REVOKED
  DEFECTIVE
}

enum IdempotencyStatus {
  IN_PROGRESS
  COMPLETED
}

model Party {
  id                      String              @id @default(uuid())
  kind                    PartyKind
  name                    String
  nameNormalized          String
  primaryPhone            String?
  primaryPhoneNormalized  String?
  additionalPhones        String[]            @default([])
  email                   String?
  address                 String?
  notes                   String?
  archivedAt              DateTime?
  version                 Int                 @default(1)
  createdAt               DateTime            @default(now())
  updatedAt               DateTime            @updatedAt
  createdById             String
  updatedById             String

  identities              PartyIdentity[]
  communicationNotes      CommunicationNote[]
  powersOfAttorney        PowerOfAttorney[]

  @@index([nameNormalized])
  @@index([primaryPhoneNormalized])
  @@index([archivedAt])
  @@map("party")
}

model PartyIdentity {
  id                 String             @id @default(uuid())
  partyId            String
  identificationType IdentificationType
  ciphertext         String             // Base64 encoded encrypted payload
  iv                 String             // Base64 encoded 12-byte initialization vector
  authTag            String             // Base64 encoded 16-byte authentication tag
  keyId              String
  encryptionVersion  Int                @default(1)
  lastFour           String             // Trailing 4 digits for display masking
  createdAt          DateTime           @default(now())
  createdById        String

  party              Party              @relation(fields: [partyId], references: [id], onDelete: Cascade)

  @@index([partyId])
  @@map("party_identity")
}

model CommunicationNote {
  id                 String               @id @default(uuid())
  partyId            String
  matterId           String?              // Optional reference reserved for T06; unlinked in T05
  communicationAt    DateTime             // Absolute instant (timestamptz)
  channel            CommunicationChannel
  summary            String
  followUpRequired   Boolean              @default(false)
  followUpDate       DateTime?            // Date-only representation for follow up
  createdAt          DateTime             @default(now())
  createdById        String

  party              Party                @relation(fields: [partyId], references: [id], onDelete: Cascade)

  @@index([partyId, communicationAt])
  @@map("communication_note")
}

model PowerOfAttorney {
  id                 String          @id @default(uuid())
  partyId            String
  poaNumberText      String          // Case/record number preserving leading zeros
  poaYearLabel       String          // e.g. "2026"
  notarizationOffice String          // Issuing Real Estate Registration / Notarization office
  poaType            PoAType
  issueDate          DateTime?       // Date-only stored as midnight UTC
  humanReviewStatus  PoAReviewStatus @default(UNREVIEWED)
  humanReviewedAt    DateTime?
  humanReviewedById  String?
  notes              String?
  version            Int             @default(1)
  createdAt          DateTime        @default(now())
  updatedAt          DateTime        @updatedAt
  createdById        String
  updatedById        String

  party              Party           @relation(fields: [partyId], references: [id], onDelete: Cascade)

  @@index([partyId])
  @@index([poaNumberText, poaYearLabel])
  @@map("power_of_attorney")
}

model AuditEvent {
  id                 String   @id @default(uuid())
  userId             String
  action             String   // e.g. "CREATE_PARTY", "UPDATE_PARTY", "REVEAL_IDENTITY"
  entityType         String   // e.g. "Party", "PartyIdentity"
  entityId           String
  changedFields      Json?    // Redacted payload changes (never full identity, never keys)
  reason             String?
  requestId          String?
  createdAt          DateTime @default(now())

  @@index([entityType, entityId, createdAt])
  @@index([userId, createdAt])
  @@map("audit_event")
}

model IdempotencyRecord {
  id                 String            @id @default(uuid())
  actorId            String
  commandType        String            // e.g. "saveParty", "savePowerOfAttorney"
  key                String
  payloadHash        String            // SHA-256 of canonical normalized payload
  status             IdempotencyStatus @default(IN_PROGRESS)
  resultType         String?
  resultId           String?
  resultPayload      Json?             // Redacted result summary (never raw secrets)
  createdAt          DateTime          @default(now())
  completedAt        DateTime?

  @@unique([actorId, commandType, key])
  @@index([createdAt])
  @@map("idempotency_record")
}
```

---

## 2. Public Module API (`src/modules/parties/`)

All operations accept a validated `ActorContext` derived strictly from server-side session cookies.

### 2.1 `saveParty`
```typescript
export interface SavePartyInput {
  id?: string; // If present, operation is UPDATE; otherwise CREATE
  kind: 'PERSON' | 'ORGANIZATION';
  name: string; // Required, 1..200 chars
  primaryPhone?: string | null; // Optional, 7..25 chars if present
  additionalPhones?: string[]; // Optional array of phone numbers
  email?: string | null; // Optional, valid email format, max 254 chars
  address?: string | null; // Optional, max 500 chars
  notes?: string | null; // Optional, max 2000 chars
  identity?: {
    identificationType: 'NATIONAL_ID' | 'PASSPORT' | 'COMMERCIAL_REG' | 'TAX_CARD' | 'OTHER';
    number: string; // 1..50 chars
  } | null;
  expectedVersion?: number; // Strictly required for updates
  idempotencyKey: string; // Required UUID / idempotency token
}

export interface DuplicateWarningDTO {
  id: string;
  name: string;
  primaryPhone: string | null;
  matchType: 'NAME' | 'PHONE' | 'BOTH';
}

export interface SavePartyResult {
  success: true;
  party: PartySummaryDTO;
  duplicateWarnings: DuplicateWarningDTO[];
  isReplay?: boolean;
}
```

### 2.2 `searchParties`
```typescript
export interface SearchPartiesParams {
  query?: string; // Text search normalized across name and phone
  kind?: 'PERSON' | 'ORGANIZATION';
  page?: number; // 1-based, default 1
  limit?: number; // default 20, max 50
}

export interface SearchPartiesResult {
  parties: PartySummaryDTO[];
  totalCount: number;
  page: number;
  totalPages: number;
}
```

### 2.3 `getClientProfile`
```typescript
export interface ClientProfileDTO {
  id: string;
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  primaryPhone: string | null;
  additionalPhones: string[];
  email: string | null;
  address: string | null;
  notes: string | null;
  version: number;
  createdAt: string; // ISO string
  updatedAt: string;
  identityMask: {
    identificationType: string;
    lastFour: string;
  } | null;
  communicationNotes: CommunicationNoteSummaryDTO[];
  powersOfAttorney: PoASummaryDTO[];
}
```

### 2.4 `addCommunicationNote`
```typescript
export interface AddCommunicationNoteInput {
  partyId: string;
  communicationAt: string; // ISO instant string
  channel: 'PHONE' | 'IN_PERSON' | 'WHATSAPP' | 'EMAIL' | 'OTHER';
  summary: string; // 1..1000 chars
  followUpRequired?: boolean;
  followUpDate?: string | null; // YYYY-MM-DD
  idempotencyKey: string;
}
```

### 2.5 `savePowerOfAttorney`
```typescript
export interface SavePowerOfAttorneyInput {
  id?: string;
  partyId: string;
  poaNumberText: string; // Preserves leading zeros, e.g. "0045"
  poaYearLabel: string; // e.g. "2026"
  notarizationOffice: string;
  poaType: 'GENERAL' | 'SPECIAL' | 'LITIGATION' | 'COMMERCIAL' | 'OTHER';
  issueDate?: string | null; // YYYY-MM-DD
  humanReviewStatus: 'UNREVIEWED' | 'VALID' | 'EXPIRED' | 'REVOKED' | 'DEFECTIVE';
  notes?: string | null;
  expectedVersion?: number;
  idempotencyKey: string;
}
```

---

## 3. Cryptography & Identity Envelope Contract

1. **Algorithm:** Authenticated symmetric encryption using `AES-256-GCM`.
2. **Key Custody:** 256-bit key passed via environment variable `PARTY_IDENTITY_ENCRYPTION_KEY` (hex or base64) with key ID `PARTY_IDENTITY_KEY_ID` (e.g. `k2026_01`).
3. **Envelope Properties:**
   - `iv`: 12 random bytes generated via `crypto.randomBytes(12)` per encryption operation (never reused).
   - `authTag`: 16 bytes generated by GCM.
   - `AAD`: Context-bound additional authenticated data: `partyId:${partyId}:type:${identificationType}`. Moving ciphertext to another party or changing the type fails authentication.
4. **Display Masking:** `lastFour` extracts the trailing 4 characters (e.g. `****3456`). Plaintext is never stored, indexed, or emitted in default DTOs, HTML, or logs.

---

## 4. UI Routes & Accessible Arabic Presentation (S09)

1. `/parties`: Main party directory with bounded search input, kind filters (الكل، أفراد، شركات), responsive card list/table, advisory duplicate warnings, and primary CTA (`إضافة طرف جديد`).
2. `/parties/new`: Create party form with client-side & server-side validation, Arabic error summaries, and duplicate advisory banner allowing intentional confirmation.
3. `/parties/[id]`: Full profile view showing party summary, masked identity badge, communication notes timeline with Cairo timestamps, and powers of attorney list with human review badge.
4. `/parties/[id]/edit`: Edit form with optimistic version protection.

---

## 5. Viewports, Test Configuration & Ports

- **Application Port:** `3205`
- **T05 Playwright Config:** `playwright.t05.config.ts` matching `tests/e2e/t05-*.spec.ts`.
- **Viewports Matrix:** `desktop-1440` (1440×900), `tablet-768` (768×1024), `mobile-390` (390×844).
