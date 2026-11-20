# T06 Interface Contract: Matters, Proceedings, Relationships & Reference Settings

**Author:** Coordinator & Lead Specialist Team  
**Task:** T06  
**Status:** FROZEN  
**Date:** 2026-11-18  

---

## 1. Routes & Accessible Screen Names

| Route | View Mode | Accessible Arabic Title (`<title>` / `h1`) | Primary Operational Goal |
|---|---|---|---|
| `/matters` | Operate | `ملفات القضايا والخدمات القانونية` | Search, filter, and inspect internal office matter files |
| `/matters/new` | Operate | `فتح ملف قضية جديد` | Create a new internal matter (Draft or Active with Client) |
| `/matters/[id]` | Operate | `ملف: [رقم الملف] — [عنوان الملف]` | Comprehensive file view: parties, court proceedings, authorizations, paper location, audit log |
| `/matters/[id]/edit` | Operate | `تعديل بيانات الملف: [رقم الملف]` | Edit file metadata, kind, status, summary, and paper storage location |
| `/matters/[id]/proceedings/new` | Operate | `إضافة قيد قضائي جديد` | Register a court proceeding (first instance or appeal) linked to matter |
| `/matters/[id]/proceedings/[proceedingId]` | Operate | `قيد قضائي: [رقم الدعوى] — [المحكمة]` | Inspect court registration, docket details, parent proceeding, and legal capacities |
| `/matters/[id]/proceedings/[proceedingId]/edit` | Operate | `تعديل بيانات القيد القضائي` | Edit docket number, court, circuit, instance, or status |
| `/settings/reference` | Operate | `إعدادات الجداول المرجعية وبيانات المكتب` | Maintain courts, practice areas, paper storage locations, and office profile |

---

## 2. Enums and Domain State Machines

### 2.1 Enums

```prisma
enum MatterKind {
  LITIGATION    // قضايا ومنازعات قضائية
  CONSULTATION  // استشارات قانونية
  CONTRACT      // عقود وصياغة اتفاقيات
  OTHER         // أعمال قانونية أخرى
}

enum MatterStatus {
  DRAFT         // مسودة قيد الفتح
  ACTIVE        // نشط وساري
  ON_HOLD       // معلق / موقوف مؤقتاً
  CLOSED        // منتهي ومغلق
  ARCHIVED      // مؤرشف
}

enum MatterPartyRole {
  CLIENT        // موكل
  OPPONENT      // خصم
  OTHER         // طرف آخر / شاهد / خبير
}

enum ProceedingInstance {
  FIRST_INSTANCE  // أول درجة / جزئي / ابتدائي
  APPEAL          // استئناف
  CASSATION       // نقض / محكمة عليا
  OTHER           // أخرى / لجان فض منازعات
}

enum ProceedingStatus {
  DRAFT             // مسودة قيد لم يقيد بعد بالمحكمة
  ACTIVE            // متداول ومتصل بالجلسات
  AWAITING_JUDGMENT // محجوز للحكم
  DECIDED           // صدر فيه حكم
  CLOSED            // منتهي ومغلق
}

enum ProceedingLegalCapacity {
  PLAINTIFF     // مدعي / رافع الدعوى
  DEFENDANT     // مدعى عليه
  APPELLANT     // مستأنف
  APPELLEE      // مستأنف ضده
  INTERVENOR    // متدخل / منضم
  OTHER         // صفة أخرى
}

enum ReferenceItemType {
  COURT             // محكمة
  PRACTICE_AREA     // دائرة تخصص قانوني
  STORAGE_LOCATION  // مكان حفظ ورقي (دولاب / رف / ملف)
}
```

### 2.2 Matter State Transitions
- `DRAFT -> ACTIVE`: Strictly requires at least one linked active `CLIENT` party.
- `ACTIVE -> ON_HOLD` / `ACTIVE -> CLOSED`: Allowed with version check. Does NOT delete or alter proceedings.
- `ON_HOLD -> ACTIVE`: Requires at least one linked active `CLIENT` party.
- `* -> ARCHIVED` / `* -> DELETED`: REJECTED in T06 (`UNSUPPORTED_TRANSITION`).

### 2.3 Proceeding Invariants
- `courtId` is mandatory even in `DRAFT`. If court is unknown, the matter is saved without a proceeding.
- `ACTIVE` proceeding requires `numberText`, `yearLabel`, and `registerType`. If missing, status remains `DRAFT` and UI displays badge: `الرقم غير مستكمل`.
- `parentProceedingId` must belong to the same `matterId`. Cycles of any length ($A \to B \to A$ or $A \to B \to C \to A$) are strictly rejected.

---

## 3. Command and Query DTO Specifications

### 3.1 Commands

#### `openMatter`
```typescript
interface OpenMatterInput {
  title: string;                 // 1-255 chars
  kind: MatterKind;
  practiceAreaId?: string | null;
  openingDate?: string | null;   // YYYY-MM-DD
  summary?: string | null;       // max 2000 chars
  notes?: string | null;         // max 5000 chars
  paperLocationId?: string | null;
  initialClientId?: string | null; // optional partyId to link as CLIENT
  idempotencyKey: string;
}

interface OpenMatterResult {
  matter: MatterDTO;
  fileCode: string;
  operationVersion: number;
}
```

#### `updateMatter`
```typescript
interface UpdateMatterInput {
  id: string;
  expectedVersion: number;
  title: string;
  kind: MatterKind;
  status: MatterStatus;
  practiceAreaId?: string | null;
  openingDate?: string | null;
  closingDate?: string | null;
  summary?: string | null;
  notes?: string | null;
  paperLocationId?: string | null;
  idempotencyKey: string;
}
```

#### `linkMatterParty` & `updateMatterParty`
```typescript
interface LinkMatterPartyInput {
  matterId: string;
  partyId: string;
  role: MatterPartyRole;
  isPrimaryContact?: boolean;
  billingEnabled?: boolean;
  notes?: string | null;
  idempotencyKey: string;
}

interface UpdateMatterPartyInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  role: MatterPartyRole;
  isPrimaryContact?: boolean;
  billingEnabled?: boolean;
  notes?: string | null;
  idempotencyKey: string;
}

interface UnlinkMatterPartyInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
```

#### `linkMatterAuthorization` & `unlinkMatterAuthorization`
```typescript
interface LinkMatterAuthorizationInput {
  matterId: string;
  powerOfAttorneyId: string;
  idempotencyKey: string;
}

interface UnlinkMatterAuthorizationInput {
  id: string;
  matterId: string;
  idempotencyKey: string;
}
```

#### `addProceeding` & `updateProceeding`
```typescript
interface AddProceedingInput {
  matterId: string;
  courtId: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  registerType?: string | null;   // e.g. "مدني كلي", "عمال جزئي"
  circuit?: string | null;        // e.g. "الدائرة 7 تعويضات"
  numberText?: string | null;     // e.g. "1234/ب", "0045"
  yearLabel?: string | null;      // e.g. "2026", "1447هـ"
  filingDate?: string | null;     // YYYY-MM-DD
  claimAmount?: string | null;    // stored as text / decimal representation
  status?: ProceedingStatus;
  parties?: ProceedingPartyInput[]; // atomic bundled proceeding parties
  idempotencyKey: string;
}

interface UpdateProceedingInput {
  id: string;
  matterId: string;
  expectedVersion: number;
  courtId: string;
  instance: ProceedingInstance;
  parentProceedingId?: string | null;
  registerType?: string | null;
  circuit?: string | null;
  numberText?: string | null;
  yearLabel?: string | null;
  filingDate?: string | null;
  claimAmount?: string | null;
  status: ProceedingStatus;
  parties?: ProceedingPartyInput[]; // atomic bundled proceeding party reconciliation
  idempotencyKey: string;
}
```

#### `linkProceedingParty` & `unlinkProceedingParty`
```typescript
interface ProceedingPartyInput {
  matterPartyId: string;
  capacityText?: string;
  legalCapacity?: ProceedingLegalCapacity | null;
  notes?: string | null;
}

interface LinkProceedingPartyInput {
  proceedingId: string;
  matterPartyId: string;
  expectedVersion: number;
  capacityText?: string;
  legalCapacity?: ProceedingLegalCapacity | null;
  notes?: string | null;
  idempotencyKey: string;
}

interface UnlinkProceedingPartyInput {
  id: string;
  proceedingId: string;
  expectedVersion: number;
  idempotencyKey: string;
}
```

#### Reference Settings Commands
```typescript
interface UpdateOfficeSettingsInput {
  officeName: string;            // required 1-255 chars
  lawyerName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  taxNumber?: string | null;
  expectedVersion: number;
  idempotencyKey: string;
}

interface CreateReferenceItemInput {
  type: ReferenceItemType;
  name: string;
  code?: string | null;
  notes?: string | null;
  idempotencyKey: string;
}

interface UpdateReferenceItemInput {
  type: ReferenceItemType;
  id: string;
  expectedVersion: number;
  name: string;
  code?: string | null;
  notes?: string | null;
  isActive: boolean;
  idempotencyKey: string;
}
```

---

## 4. Atomic FileCode Generation Strategy

- **Format:** `YYYY/NNNN` (e.g. `2026/0001`, `2026/0002`).
- **Year Source:** Gregorian year evaluated in `Africa/Cairo` time zone.
- **Sequence Mechanism:** Dedicated table `file_code_sequence` with columns `(year INT PRIMARY KEY, nextValue INT NOT NULL)`.
- **Concurrency Isolation:** `SELECT next_val FROM file_code_sequence WHERE year = $1 FOR UPDATE`.
  - If row absent, insert with `1` and lock.
  - Return formatted code `YYYY/LPAD(nextValue, 4, '0')` and increment.
  - Guaranteed atomic, zero race conditions under concurrent requests.
  - Complemented by a `UNIQUE(fileCode)` constraint on the `matter` table.

---

## 5. Relational Constraints & Locking Order

1. **Matter Party Uniqueness:** `UNIQUE(matterId, partyId, role)` prevents duplicate roles for the same party in a matter.
2. **Primary Contact:** At most one `isPrimaryContact = true` per matter. Enforced with partial unique index: `CREATE UNIQUE INDEX idx_matter_party_primary ON matter_party(matter_id) WHERE is_primary_contact = true;`.
3. **Last Active Client Invariant:**
   - On updating or unlinking a `matter_party` where role was `CLIENT`:
   - Enforce lock on parent `matter` via `SELECT id, status FROM matter WHERE id = $1 FOR UPDATE`.
   - If `matter.status === ACTIVE`, count remaining `CLIENT` parties with `SELECT COUNT(*) FROM matter_party WHERE matter_id = $1 AND role = 'CLIENT' AND id != $2`.
   - If count is 0, transaction aborts with `LAST_CLIENT_REQUIRED`.
4. **Parent Proceeding Hierarchy & Cycle Prevention:**
   - When setting `parentProceedingId`:
   - Assert `parent.matterId === child.matterId`. If not, abort with `CROSS_MATTER_LINK_FORBIDDEN`.
   - Traverse ancestor chain. If ancestor matches child id, abort with `PROCEEDING_CYCLE_DETECTED`.
   - Lock both proceedings in deterministic ID order (`ORDER BY id`) to avoid deadlocks.
5. **POA Linking Invariant:**
   - `powerOfAttorney.partyId` must match a `party_id` currently linked as `CLIENT` in `matter_party` for this `matter_id`.
   - If party is demoted or unlinked, check dependent `matter_authorization` rows; if found, abort with `CLIENT_POA_DEPENDENCY_ERROR` or remove atomically.

---

## 6. Error Codes & Arabic UI Messages

| Error Code | HTTP Status | Arabic Error Message |
|---|---|---|
| `UNAUTHENTICATED` | 401 | `يجب تسجيل الدخول أولاً للمتابعة.` |
| `MFA_REQUIRED` | 401 | `التحقق الثنائي مطلوب لإتمام هذه العملية.` |
| `UNAUTHORIZED` | 403 | `ليس لديك الصلاحية الكافية لإجراء هذه العملية.` |
| `VALIDATION_ERROR` | 400 | `البيانات المدخلة غير صحيحة، يرجى مراجعة الحقول.` |
| `LAST_CLIENT_REQUIRED` | 422 | `لا يمكن إلغاء أو تغيير صفة الموكل الأخير في ملف نشط.` |
| `PRIMARY_CONTACT_CONFLICT` | 409 | `يوجد بالفعل جهة اتصال رئيسية محددة لهذا الملف.` |
| `CROSS_MATTER_LINK_FORBIDDEN` | 422 | `لا يمكن ربط قيد قضائي بقيد تابع لملف آخر.` |
| `PROCEEDING_CYCLE_DETECTED` | 422 | `تعذر حفظ القيد: تم اكتشاف حلقة تسلسل غير صالحة في درجات التقاضي.` |
| `CLIENT_POA_DEPENDENCY_ERROR` | 422 | `لا يمكن إزالة صفة الموكل لوجود توكيلات مرتبطة بهذا الملف.` |
| `INACTIVE_REFERENCE_SELECTED` | 422 | `العنصر المرجعي المختار غير نشط ولا يمكن استخدامه لقيود جديدة.` |
| `CONCURRENCY_CONFLICT` | 409 | `تم تعديل هذا السجل بواسطة مستخدم آخر. يرجى تحديث الصفحة والمحاولة مجدداً.` |
| `NOT_FOUND` | 404 | `السجل المطلوب غير موجود.` |
| `IDEMPOTENCY_CONFLICT` | 409 | `تم إرسال طلب مكرر بحمولة مختلفة لنفس المفتاح.` |
