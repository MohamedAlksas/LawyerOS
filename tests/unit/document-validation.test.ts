import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getEnv, validateEnv } from '@/lib/env';
import type { Actor } from '@/modules/identity/types';
import {
  SCAN_STATUS_BADGE_CLASSES,
  getScanStatusBadgeClassFromLabel,
} from '@/components/documents/document-ui-helpers';
import {
  verifyDocumentReadOrigin,
  verifyDocumentMutationOrigin,
} from '@/modules/documents/document-http';
import {
  ADR_0003_POLICY_CODE,
  ADR_0003_POLICY_VERSION,
  DocumentNotFoundError,
  DocumentScanPolicyUnavailableError,
  DocumentStoragePathError,
  DocumentValidationError,
  MAX_DOCUMENT_BYTES,
  UNSCANNED_POLICY_NOTICE_AR,
  authorizeDownload,
  beginVersionUploadSchema,
  createLocalDocumentStorage,
  documentError,
  documentStatusFromErrorCode,
  evaluateDocumentScanPolicy,
  inspectFileContent,
  pinDocumentVersionsForBackup,
  releaseBackupFilePins,
  resolveSafeKeyPath,
  resolveSafeStorageRoot,
  sanitizeDisplayFilename,
  updateDocumentMetadataSchema,
} from '@/modules/documents';
import {
  buildSyntheticJpeg,
  buildSyntheticPdf,
  buildSyntheticPng,
  makePngChunk,
} from '../helpers/synthetic-files';

describe('T11 & T12 Unit Tests: Document Content Validation, Storage Safety & ADR 0003 Policy', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempStorageRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawoffice-t11-unit-'));
    tempDirs.push(dir);
    return dir;
  }

  describe('Valid magic bytes & MIME cross-checks', () => {
    it('accepts valid synthetic PDF, JPEG (.jpg/.jpeg), and PNG with accurate SHA-256', () => {
      const pdf = buildSyntheticPdf();
      const pdfRes = inspectFileContent(pdf, {
        originalFilename: 'عريضة_دعوى_2026.pdf',
        declaredMime: 'application/pdf',
      });
      expect(pdfRes.detectedMime).toBe('application/pdf');
      expect(pdfRes.extension).toBe('.pdf');
      expect(pdfRes.sizeBytes).toBe(pdf.byteLength);
      expect(pdfRes.sha256).toBe(crypto.createHash('sha256').update(pdf).digest('hex'));

      const jpeg = buildSyntheticJpeg();
      const jpgRes = inspectFileContent(jpeg, {
        originalFilename: 'صورة_توكيل.jpeg',
        declaredMime: 'image/jpeg',
      });
      expect(jpgRes.detectedMime).toBe('image/jpeg');
      expect(jpgRes.extension).toBe('.jpg');
      expect(jpgRes.sha256).toBe(crypto.createHash('sha256').update(jpeg).digest('hex'));

      const png = buildSyntheticPng();
      const pngRes = inspectFileContent(png, {
        originalFilename: 'إيصال_سداد.png',
        declaredMime: 'image/png',
      });
      expect(pngRes.detectedMime).toBe('image/png');
      expect(pngRes.extension).toBe('.png');
      expect(pngRes.sha256).toBe(crypto.createHash('sha256').update(png).digest('hex'));
    });
  });

  describe('Disguised, polyglot, malformed & oversized files', () => {
    it('rejects HTML, SVG, EXE, ZIP, and polyglot HTML+PDF files disguised as PDF/JPEG/PNG', () => {
      const htmlBytes = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');
      expect(() =>
        inspectFileContent(htmlBytes, {
          originalFilename: 'contract.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);

      const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8');
      expect(() =>
        inspectFileContent(svgBytes, {
          originalFilename: 'scan.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      const exeBytes = Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(64, 0x90)]);
      expect(() =>
        inspectFileContent(exeBytes, {
          originalFilename: 'photo.jpg',
          declaredMime: 'image/jpeg',
        })
      ).toThrow(DocumentValidationError);

      const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 0)]);
      expect(() =>
        inspectFileContent(zipBytes, {
          originalFilename: 'archive.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);

      const polyglotBytes = Buffer.from('<html>%PDF-1.4\n%%EOF</html>', 'ascii');
      expect(() =>
        inspectFileContent(polyglotBytes, {
          originalFilename: 'polyglot.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);
    });

    it('rejects mismatched MIME/extension/signature and truncated files', () => {
      const png = buildSyntheticPng();
      expect(() =>
        inspectFileContent(png, {
          originalFilename: 'wrong.jpg',
          declaredMime: 'image/jpeg',
        })
      ).toThrow(DocumentValidationError);

      const jpeg = buildSyntheticJpeg();
      expect(() =>
        inspectFileContent(jpeg, {
          originalFilename: 'wrong.png',
          declaredMime: 'image/jpeg',
        })
      ).toThrow(DocumentValidationError);

      expect(() =>
        inspectFileContent(Buffer.from('%PDF-1.4\n1 0 obj', 'ascii'), {
          originalFilename: 'truncated.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);

      expect(() =>
        inspectFileContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 0, 0, 0, 0, 0]), {
          originalFilename: 'no-iend.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      expect(() =>
        inspectFileContent(Buffer.alloc(0), {
          originalFilename: 'empty.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);

      // Rejects truncated JPEG without EOI, JPEG with trailing script payload after EOI
      expect(() =>
        inspectFileContent(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), {
          originalFilename: 'truncated.jpg',
          declaredMime: 'image/jpeg',
        })
      ).toThrow(DocumentValidationError);

      expect(() =>
        inspectFileContent(
          Buffer.concat([buildSyntheticJpeg(), Buffer.from('<script>alert(1)</script>', 'ascii')]),
          {
            originalFilename: 'trailing-payload.jpg',
            declaredMime: 'image/jpeg',
          }
        )
      ).toThrow(DocumentValidationError);

      // Rejects PNG missing IDAT, PNG with trailing bytes after IEND, or fake embedded IEND
      const pngWithoutIdat = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        makePngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
        makePngChunk('IEND', Buffer.alloc(0)),
      ]);
      expect(() =>
        inspectFileContent(pngWithoutIdat, {
          originalFilename: 'no-idat.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      expect(() =>
        inspectFileContent(
          Buffer.concat([buildSyntheticPng(), Buffer.from('TRAILING', 'ascii')]),
          {
            originalFilename: 'trailing.png',
            declaredMime: 'image/png',
          }
        )
      ).toThrow(DocumentValidationError);

      // Rejects PDF with trailing HTML/script/binary after %%EOF (while allowing trailing EOL whitespace)
      expect(() =>
        inspectFileContent(
          Buffer.concat([buildSyntheticPdf(), Buffer.from('\n<script>alert(1)</script>', 'ascii')]),
          {
            originalFilename: 'trailing-script.pdf',
            declaredMime: 'application/pdf',
          }
        )
      ).toThrow(DocumentValidationError);

      const pdfWithTrailingNewline = Buffer.concat([buildSyntheticPdf(), Buffer.from('\r\n', 'ascii')]);
      expect(
        inspectFileContent(pdfWithTrailingNewline, {
          originalFilename: 'clean-eol.pdf',
          declaredMime: 'application/pdf',
        }).detectedMime
      ).toBe('application/pdf');
    });

    it('accepts JPEG with 0xFF fill bytes before RST0 inside SOS and rejects structurally invalid PDF/JPEG/PNG', () => {
      // Valid JPEG with stuffed 0xFF 0x00 and 0xFF fill byte before RST0 (0xFF 0xFF 0xD0) inside SOS
      const jpegWithFillRst0 = buildSyntheticJpeg([
        0x12, 0xff, 0x00, 0x34, 0xff, 0xff, 0xd0, 0x56, 0x78,
      ]);
      expect(
        inspectFileContent(jpegWithFillRst0, {
          originalFilename: 'scan_rst0.jpg',
          declaredMime: 'image/jpeg',
        }).detectedMime
      ).toBe('image/jpeg');

      // JPEG missing SOF/SOS (APP0 -> EOI only) is rejected
      const jpegWithoutSofSos = Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
        0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
      ]);
      expect(() =>
        inspectFileContent(jpegWithoutSofSos, {
          originalFilename: 'no-sof.jpg',
          declaredMime: 'image/jpeg',
        })
      ).toThrow(DocumentValidationError);

      // PNG with truncated chunk, bad CRC-32, or zero-length IDAT is rejected
      const validPng = buildSyntheticPng();
      const truncatedPng = validPng.subarray(0, validPng.byteLength - 6);
      expect(() =>
        inspectFileContent(truncatedPng, {
          originalFilename: 'truncated.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      const badCrcPng = Buffer.from(validPng);
      badCrcPng[badCrcPng.byteLength - 1] ^= 0xff;
      expect(() =>
        inspectFileContent(badCrcPng, {
          originalFilename: 'bad-crc.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      const zeroIdatPng = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        makePngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
        makePngChunk('IDAT', Buffer.alloc(0)),
        makePngChunk('IEND', Buffer.alloc(0)),
      ]);
      expect(() =>
        inspectFileContent(zeroIdatPng, {
          originalFilename: 'zero-idat.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      // PNG with width or height > 16,384 (MAX_PNG_DIMENSION) is rejected
      const oversizedPngWidth = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        makePngChunk('IHDR', Buffer.from([0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 8, 2, 0, 0, 0])),
        makePngChunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
        makePngChunk('IEND', Buffer.alloc(0)),
      ]);
      expect(() =>
        inspectFileContent(oversizedPngWidth, {
          originalFilename: 'oversized-width.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      // Indexed-color PNG (colorType === 3) passes with valid PLTE chunk and rejects missing or invalid PLTE
      const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const indexedIhdr = makePngChunk(
        'IHDR',
        Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 3, 0, 0, 0])
      );
      const indexedIdat = makePngChunk(
        'IDAT',
        Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x03, 0x00, 0x01])
      );
      const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

      const validIndexedPng = Buffer.concat([
        pngSig,
        indexedIhdr,
        makePngChunk('PLTE', Buffer.from([0x14, 0x56, 0x6b])),
        indexedIdat,
        iendChunk,
      ]);
      expect(
        inspectFileContent(validIndexedPng, {
          originalFilename: 'indexed-valid.png',
          declaredMime: 'image/png',
        }).detectedMime
      ).toBe('image/png');

      const missingPltePng = Buffer.concat([pngSig, indexedIhdr, indexedIdat, iendChunk]);
      expect(() =>
        inspectFileContent(missingPltePng, {
          originalFilename: 'indexed-no-plte.png',
          declaredMime: 'image/png',
        })
      ).toThrow(DocumentValidationError);

      for (const badPlteBytes of [Buffer.alloc(0), Buffer.alloc(4, 0x11), Buffer.alloc(771, 0x22)]) {
        const badPltePng = Buffer.concat([
          pngSig,
          indexedIhdr,
          makePngChunk('PLTE', badPlteBytes),
          indexedIdat,
          iendChunk,
        ]);
        expect(() =>
          inspectFileContent(badPltePng, {
            originalFilename: 'indexed-bad-plte.png',
            declaredMime: 'image/png',
          })
        ).toThrow(DocumentValidationError);
      }

      // JPEG with 0x0 dimensions (height=0 or width=0) in SOF0 segment is rejected
      const jpegZeroDim = Buffer.from([
        0xff, 0xd8, // SOI
        0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00, 0x03, // SOF0 height=0, width=0
        0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
        0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00, // SOS
        0x11, 0x22,
        0xff, 0xd9, // EOI
      ]);
      expect(() =>
        inspectFileContent(jpegZeroDim, {
          originalFilename: 'zero-dim.jpg',
          declaredMime: 'image/jpeg',
        })
      ).toThrow(DocumentValidationError);

      // PDF without EOL after header version, without obj/endobj, or without startxref is rejected
      const pdfNoHeaderEol = Buffer.from(
        '%PDF-1.4<script>alert(1)</script>\n1 0 obj\n<<>>\nendobj\nstartxref\n9\n%%EOF\n',
        'ascii'
      );
      expect(() =>
        inspectFileContent(pdfNoHeaderEol, {
          originalFilename: 'no-eol.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);

      // PDF without ordered obj before endobj is rejected
      const pdfReversedObj = Buffer.from(
        '%PDF-1.4\nendobj\n1 0 obj\n<<>>\nstartxref\n9\n%%EOF\n',
        'ascii'
      );
      expect(() =>
        inspectFileContent(pdfReversedObj, {
          originalFilename: 'reversed-obj.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);

      const pdfNoObjects = Buffer.from('%PDF-1.4\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n', 'ascii');
      expect(() =>
        inspectFileContent(pdfNoObjects, {
          originalFilename: 'no-obj.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);

      const pdfNoStartxref = Buffer.from(
        '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n',
        'ascii'
      );
      expect(() =>
        inspectFileContent(pdfNoStartxref, {
          originalFilename: 'no-startxref.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);
    });

    it('accepts exact 25 MiB (26,214,400 bytes) and rejects 25 MiB + 1 byte (26,214,401 bytes)', () => {
      const overhead = buildSyntheticPdf(0).byteLength;
      const exact25MiB = buildSyntheticPdf(MAX_DOCUMENT_BYTES - overhead);
      expect(exact25MiB.byteLength).toBe(MAX_DOCUMENT_BYTES);

      const exactResult = inspectFileContent(exact25MiB, {
        originalFilename: 'boundary-25mib.pdf',
        declaredMime: 'application/pdf',
      });
      expect(exactResult.sizeBytes).toBe(MAX_DOCUMENT_BYTES);

      const overLimit = buildSyntheticPdf(MAX_DOCUMENT_BYTES - overhead + 1);
      expect(overLimit.byteLength).toBe(MAX_DOCUMENT_BYTES + 1);
      expect(() =>
        inspectFileContent(overLimit, {
          originalFilename: 'over-25mib.pdf',
          declaredMime: 'application/pdf',
        })
      ).toThrow(DocumentValidationError);
    });
  });

  describe('Path traversal & private storage isolation', () => {
    it('rejects filenames containing path separators, traversal, colons, null bytes, or disallowed extensions', () => {
      const unsafeNames = [
        '../secret.pdf',
        '..\\secret.pdf',
        'nested/doc.pdf',
        'nested\\doc.pdf',
        'C:\\Windows\\System32\\cmd.exe',
        'C:drive-relative.pdf',
        'file\0name.pdf',
        '.hidden.pdf',
        'trailingdot.pdf.',
        'macro.docx',
        'page.html',
        'vector.svg',
        'invoice\u202efdp.exe',
        'doc\u2066test\u2069.pdf',
        'dir\u200fmark.png',
        'file\u061cmark.pdf',
      ];
      for (const name of unsafeNames) {
        expect(() => sanitizeDisplayFilename(name)).toThrow(DocumentValidationError);
      }

      const safe = sanitizeDisplayFilename('  حكم_محكمة_النقض_123.PDF  ');
      expect(safe.displayFilename).toBe('حكم_محكمة_النقض_123.PDF');
      expect(safe.extension).toBe('.pdf');
    });

    it('rejects unsafe storage keys and forbids storage roots inside public/, .next/, or src/', () => {
      const root = makeTempStorageRoot();
      const quarantineDir = path.join(root, 'quarantine');

      expect(resolveSafeKeyPath(quarantineDir, 'q/2026/11/safe-file.pdf')).toBe(
        path.resolve(quarantineDir, 'q', '2026', '11', 'safe-file.pdf')
      );

      const badKeys = [
        '',
        '../escape.pdf',
        'q/../../escape.pdf',
        'q\\windows\\style.pdf',
        '/leading/slash.pdf',
        'C:/drive.pdf',
        'q/null\0byte.pdf',
        'q//double.pdf',
        'q/./dot.pdf',
      ];
      for (const key of badKeys) {
        expect(() => resolveSafeKeyPath(quarantineDir, key)).toThrow(DocumentStoragePathError);
      }

      expect(() => resolveSafeStorageRoot(path.resolve(process.cwd(), 'public'))).toThrow(
        DocumentStoragePathError
      );
      expect(() => resolveSafeStorageRoot(path.resolve(process.cwd(), 'public', 'uploads'))).toThrow(
        DocumentStoragePathError
      );
      expect(() =>
        resolveSafeStorageRoot(path.resolve(process.cwd(), 'public', '..uploads'))
      ).toThrow(DocumentStoragePathError);
      expect(() => resolveSafeStorageRoot(path.resolve(process.cwd(), '.next', 'cache'))).toThrow(
        DocumentStoragePathError
      );
      expect(() => resolveSafeStorageRoot(path.resolve(process.cwd(), 'src'))).toThrow(
        DocumentStoragePathError
      );

      // Symlink / NTFS junction pointing into public/ must also be blocked fail-closed
      const symlinkContainer = makeTempStorageRoot();
      const linkToPublic = path.join(symlinkContainer, 'linked-public');
      let linkCreated = false;
      try {
        fs.symlinkSync(
          path.resolve(process.cwd(), 'public'),
          linkToPublic,
          process.platform === 'win32' ? 'junction' : 'dir'
        );
        linkCreated = true;
      } catch (error) {
        if (process.env.CI && process.env.CI !== 'false') {
          throw error;
        }
      }
      if (linkCreated) {
        expect(() => resolveSafeStorageRoot(linkToPublic)).toThrow(DocumentStoragePathError);
      }
    });

    it('aborts stream upload exceeding maxBytes without leaving partial files on disk', async () => {
      const root = makeTempStorageRoot();
      const storage = createLocalDocumentStorage(root);
      const qKey = storage.generateQuarantineKey('attempt-1', '.pdf');

      const oversizedStream = Readable.from([
        Buffer.alloc(16 * 1024 * 1024, 0x41),
        Buffer.alloc(10 * 1024 * 1024 + 1, 0x42),
      ]);

      await expect(
        storage.writeQuarantineStream(qKey, oversizedStream, MAX_DOCUMENT_BYTES)
      ).rejects.toThrow(DocumentValidationError);

      expect(await storage.exists('quarantine', qKey)).toBe(false);
      expect(fs.existsSync(storage.quarantineDir)).toBe(true);
      const files = fs.readdirSync(storage.quarantineDir, { recursive: true });
      expect(files.filter((f) => String(f).includes('.part-'))).toHaveLength(0);
    });

    it('builds safe ASCII Content-Disposition fallback (document.pdf, never .pdf) for pure-Arabic filenames', async () => {
      const root = makeTempStorageRoot();
      const storage = createLocalDocumentStorage(root);
      const docId = crypto.randomUUID();
      const verId = crypto.randomUUID();
      const readyKey = storage.generateReadyKey(docId, 1, '.pdf');
      const pdfBytes = buildSyntheticPdf();
      await storage.writeReadyBytes(readyKey, pdfBytes);

      const now = new Date('2026-11-24T12:00:00.000Z');
      const fakeActor: Actor = {
        id: crypto.randomUUID(),
        email: 'owner@lawoffice.test',
        name: 'المحامي',
        role: 'OWNER',
        sessionId: crypto.randomUUID(),
        twoFactorVerified: true,
      };
      const fakeVersion = {
        id: verId,
        documentId: docId,
        versionNumber: 1,
        objectKey: readyKey,
        originalFilename: 'عقد_بيع.pdf',
        declaredMime: 'application/pdf',
        detectedMime: 'application/pdf',
        sizeBytes: pdfBytes.byteLength,
        sha256: crypto.createHash('sha256').update(pdfBytes).digest('hex'),
        uploadStatus: 'READY',
        scanStatus: 'NOT_SCANNED_POLICY',
        scanPolicyCode: ADR_0003_POLICY_CODE,
        scanPolicyVersion: ADR_0003_POLICY_VERSION,
        scanCheckedAt: now,
        scanError: null,
        createdAt: now,
        createdById: fakeActor.id,
      };
      const fakeDoc = {
        id: docId,
        matterId: crypto.randomUUID(),
        partyId: null,
        proceedingId: null,
        hearingId: null,
        matter: { id: crypto.randomUUID(), fileCode: 'LO-2026-0001', title: 'قضية' },
        party: null,
        proceeding: null,
        hearing: null,
        title: 'عقد بيع',
        titleNormalized: 'عقد بيع',
        documentType: 'CONTRACT',
        documentDate: null,
        description: null,
        tags: [],
        originalLocation: null,
        originalPresent: 'UNKNOWN',
        sensitivity: 'CONFIDENTIAL',
        currentVersionId: verId,
        currentVersion: fakeVersion,
        versions: [fakeVersion],
        archivedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdById: fakeActor.id,
        updatedById: fakeActor.id,
      };
      const mockPrisma = {
        document: {
          findUnique: async () => fakeDoc,
        },
        auditEvent: {
          create: async () => ({ id: crypto.randomUUID() }),
        },
      } as unknown as PrismaClient;

      const authorized = await authorizeDownload(fakeActor, docId, undefined, {
        disposition: 'attachment',
        storage,
        prismaOverride: mockPrisma,
      });
      const cd = authorized.headers['Content-Disposition'];
      expect(cd).toContain('attachment; filename="document.pdf";');
      expect(cd).not.toContain('filename=".pdf"');
      expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('عقد_بيع.pdf')}`);
    });
  });

  describe('ADR 0003 scan policy & env compatibility', () => {
    it('records NOT_SCANNED_POLICY under INITIAL_DEFERRED and fails closed under REQUIRED', () => {
      const fixedNow = new Date('2026-11-24T12:00:00.000Z');
      const deferred = evaluateDocumentScanPolicy('INITIAL_DEFERRED', fixedNow);
      expect(deferred.scanStatus).toBe('NOT_SCANNED_POLICY');
      expect(deferred.policyCode).toBe(ADR_0003_POLICY_CODE);
      expect(deferred.policyVersion).toBe(ADR_0003_POLICY_VERSION);
      expect(deferred.detailArabic).toContain(UNSCANNED_POLICY_NOTICE_AR);

      expect(() => evaluateDocumentScanPolicy('REQUIRED', fixedNow)).toThrow(
        DocumentScanPolicyUnavailableError
      );
      expect(() => evaluateDocumentScanPolicy('UNEXPECTED_MODE', fixedNow)).toThrow(
        DocumentScanPolicyUnavailableError
      );
    });

    it('preserves optional DOCUMENTS_STORAGE_ROOT and defaults DOCUMENT_SCAN_POLICY_MODE in validateEnv', () => {
      const env = validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://lawoffice_user:secret@127.0.0.1:5432/lawoffice_dev',
        BETTER_AUTH_SECRET: 'synthetic_development_secret_32_bytes_minimum_length_required',
      });
      expect(env.DOCUMENTS_STORAGE_ROOT).toBeUndefined();
      expect(env.DOCUMENT_SCAN_POLICY_MODE).toBe('INITIAL_DEFERRED');
    });

    it('maps domain errors cleanly with Arabic messages and HTTP codes', () => {
      const scanErr = documentError(new DocumentScanPolicyUnavailableError());
      expect(scanErr.success).toBe(false);
      if (!scanErr.success) {
        expect(scanErr.code).toBe('SCAN_POLICY_UNAVAILABLE');
        expect(documentStatusFromErrorCode(scanErr.code)).toBe(503);
      }

      const oversizeErr = documentError(
        new DocumentValidationError('حجم الملف يتجاوز الحد.', { file: 'كبير جداً' }, 'PAYLOAD_TOO_LARGE')
      );
      expect(oversizeErr.success).toBe(false);
      if (!oversizeErr.success) {
        expect(oversizeErr.code).toBe('PAYLOAD_TOO_LARGE');
        expect(documentStatusFromErrorCode(oversizeErr.code)).toBe(413);
      }

      const internal = documentError(new Error('secret db string leaked?'));
      expect(internal.success).toBe(false);
      if (!internal.success) {
        expect(internal.code).toBe('INTERNAL_ERROR');
        expect(internal.error).not.toContain('secret db string');
        expect(documentStatusFromErrorCode(internal.code)).toBe(500);
      }
    });

    it('verifies sec-fetch-site whitespace and case normalization in document HTTP helpers', () => {
      // Read origin checks
      const crossSitePadded = new Request('http://127.0.0.1:3000/api/documents/1', {
        headers: { 'sec-fetch-site': ' Cross-Site ' },
      });
      const res1 = verifyDocumentReadOrigin(crossSitePadded);
      expect(res1?.status).toBe(403);

      const crossSiteUpper = new Request('http://127.0.0.1:3000/api/documents/1', {
        headers: { 'sec-fetch-site': 'CROSS-SITE' },
      });
      const res2 = verifyDocumentReadOrigin(crossSiteUpper);
      expect(res2?.status).toBe(403);

      const sameOriginPadded = new Request('http://127.0.0.1:3000/api/documents/1', {
        headers: { 'sec-fetch-site': ' same-origin ' },
      });
      expect(verifyDocumentReadOrigin(sameOriginPadded)).toBeNull();

      // Mutation origin checks
      const trustedOrigin = new URL(getEnv().BETTER_AUTH_URL).origin;
      const mutCrossSitePadded = new Request(`${trustedOrigin}/api/documents`, {
        method: 'POST',
        headers: { origin: trustedOrigin, 'sec-fetch-site': ' Cross-Site ' },
      });
      const res3 = verifyDocumentMutationOrigin(mutCrossSitePadded);
      expect(res3?.status).toBe(403);

      const mutCrossSiteUpper = new Request(`${trustedOrigin}/api/documents`, {
        method: 'POST',
        headers: { origin: trustedOrigin, 'sec-fetch-site': 'CROSS-SITE' },
      });
      const res4 = verifyDocumentMutationOrigin(mutCrossSiteUpper);
      expect(res4?.status).toBe(403);

      const mutSameOriginPadded = new Request(`${trustedOrigin}/api/documents`, {
        method: 'POST',
        headers: { origin: trustedOrigin, 'sec-fetch-site': ' same-origin ' },
      });
      expect(verifyDocumentMutationOrigin(mutSameOriginPadded)).toBeNull();
    });
  });

  describe('T12 version upload & paper-original metadata schemas', () => {
    it('validates beginVersionUploadSchema and enforces strict types & positive bounds', () => {
      const valid = beginVersionUploadSchema.safeParse({
        documentId: crypto.randomUUID(),
        expectedDocumentVersion: 1,
        originalFilename: '  updated_contract_v2.pdf  ',
        declaredMime: 'application/pdf',
        expectedSizeBytes: 2048,
        idempotencyKey: 'ver-begin-1',
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.originalFilename).toBe('updated_contract_v2.pdf');
      }

      expect(
        beginVersionUploadSchema.safeParse({
          documentId: 'not-uuid',
          expectedDocumentVersion: 1,
          originalFilename: 'v2.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 100,
          idempotencyKey: 'k1',
        }).success
      ).toBe(false);

      expect(
        beginVersionUploadSchema.safeParse({
          documentId: crypto.randomUUID(),
          expectedDocumentVersion: 0,
          originalFilename: 'v2.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 100,
          idempotencyKey: 'k2',
        }).success
      ).toBe(false);

      expect(
        beginVersionUploadSchema.safeParse({
          documentId: crypto.randomUUID(),
          expectedDocumentVersion: 1,
          originalFilename: 'v2.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: MAX_DOCUMENT_BYTES + 1,
          idempotencyKey: 'k3',
        }).success
      ).toBe(false);

      expect(
        beginVersionUploadSchema.safeParse({
          documentId: crypto.randomUUID(),
          expectedDocumentVersion: 1,
          originalFilename: 'v2.pdf',
          declaredMime: 'application/pdf',
          expectedSizeBytes: 100,
          idempotencyKey: 'k4',
          extraField: 'rejected',
        }).success
      ).toBe(false);
    });

    it('validates updateDocumentMetadataSchema for paper original state/location and metadata', () => {
      const validOriginal = updateDocumentMetadataSchema.safeParse({
        documentId: crypto.randomUUID(),
        expectedVersion: 2,
        idempotencyKey: 'meta-upd-1',
        originalPresent: 'YES',
        originalLocation: '  خزنة المكتب الرئيسية — رف 2  ',
      });
      expect(validOriginal.success).toBe(true);
      if (validOriginal.success) {
        expect(validOriginal.data.originalLocation).toBe('خزنة المكتب الرئيسية — رف 2');
        expect(validOriginal.data.originalPresent).toBe('YES');
      }

      const validUnknownCleared = updateDocumentMetadataSchema.safeParse({
        documentId: crypto.randomUUID(),
        expectedVersion: 3,
        idempotencyKey: 'meta-upd-2',
        originalPresent: 'UNKNOWN',
        originalLocation: null,
        documentDate: '2026-11-26',
      });
      expect(validUnknownCleared.success).toBe(true);

      expect(
        updateDocumentMetadataSchema.safeParse({
          documentId: crypto.randomUUID(),
          expectedVersion: 0,
          idempotencyKey: 'meta-bad-ver',
          originalPresent: 'NO',
        }).success
      ).toBe(false);

      expect(
        updateDocumentMetadataSchema.safeParse({
          documentId: crypto.randomUUID(),
          expectedVersion: 1,
          idempotencyKey: 'meta-bad-date',
          documentDate: '2026-02-30',
        }).success
      ).toBe(false);

      expect(
        updateDocumentMetadataSchema.safeParse({
          documentId: crypto.randomUUID(),
          expectedVersion: 1,
          idempotencyKey: 'meta-bad-present',
          originalPresent: 'MAYBE',
        }).success
      ).toBe(false);

      expect(
        updateDocumentMetadataSchema.safeParse({
          documentId: crypto.randomUUID(),
          expectedVersion: 1,
          idempotencyKey: 'meta-bad-extra',
          sha256: 'cannot-override-bytes',
        }).success
      ).toBe(false);

      // Empty no-op payload without any mutable metadata field must reject
      const emptyNoOp = updateDocumentMetadataSchema.safeParse({
        documentId: crypto.randomUUID(),
        expectedVersion: 1,
        idempotencyKey: 'meta-empty-noop',
      });
      expect(emptyNoOp.success).toBe(false);
    });

    it('maps UI scan status labels to expected ADR 0003 badge classes', () => {
      expect(getScanStatusBadgeClassFromLabel('بانتظار الفحص')).toBe(
        SCAN_STATUS_BADGE_CLASSES.PENDING
      );
      expect(getScanStatusBadgeClassFromLabel('قيد الفحص')).toBe(
        SCAN_STATUS_BADGE_CLASSES.PENDING
      );
      expect(getScanStatusBadgeClassFromLabel('مفحوص وسليم')).toBe(
        SCAN_STATUS_BADGE_CLASSES.CLEAN
      );
      expect(getScanStatusBadgeClassFromLabel('مرفوض أمنياً')).toBe(
        SCAN_STATUS_BADGE_CLASSES.INFECTED
      );
      expect(getScanStatusBadgeClassFromLabel('لم يُفحص ضد الفيروسات')).toBe(
        SCAN_STATUS_BADGE_CLASSES.NOT_SCANNED_POLICY
      );
    });

    it('validates backup pin & release inputs (backupId bounds, UUID version IDs, deduplication, audit, missing IDs & RESTORE_MODE)', async () => {
      // Note: document-types.ts does not export Zod schemas for backup pins; validation is enforced
      // directly in pinDocumentVersionsForBackup / releaseBackupFilePins via assertValidBackupId & assertUuidOrThrow.
      const ownerActor: Actor = {
        id: crypto.randomUUID(),
        name: 'مالك اختبار',
        email: 'owner.pin@office.eg',
        role: 'OWNER',
        sessionId: crypto.randomUUID(),
        twoFactorVerified: true,
      };

      await expect(
        pinDocumentVersionsForBackup({ backupId: '   ', documentVersionIds: [], actor: ownerActor })
      ).rejects.toThrow(DocumentValidationError);

      await expect(
        pinDocumentVersionsForBackup({
          backupId: 'b'.repeat(129),
          documentVersionIds: [],
          actor: ownerActor,
        })
      ).rejects.toThrow(DocumentValidationError);

      await expect(
        pinDocumentVersionsForBackup({
          backupId: 'backup-valid-1',
          documentVersionIds: ['not-a-uuid'],
          actor: ownerActor,
        })
      ).rejects.toThrow(DocumentValidationError);

      await expect(
        releaseBackupFilePins({ backupId: '', actor: ownerActor })
      ).rejects.toThrow(DocumentValidationError);

      await expect(
        releaseBackupFilePins({ backupId: 'r'.repeat(129), actor: ownerActor })
      ).rejects.toThrow(DocumentValidationError);

      const verA = crypto.randomUUID();
      const verB = crypto.randomUUID();
      let capturedFindManyIds: string[] = [];
      let capturedCreateManyIds: string[] = [];
      const auditEvents: Array<{ action: string; entityType: string; entityId: string }> = [];

      const mockTx = {
        documentVersion: {
          findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
            capturedFindManyIds = args.where?.id?.in ?? [];
            return capturedFindManyIds.map((id) => ({ id }));
          },
        },
        backupFilePin: {
          createMany: async (args: { data: Array<{ documentVersionId: string }> }) => {
            capturedCreateManyIds = args.data.map((d) => d.documentVersionId);
            return { count: args.data.length };
          },
          updateMany: async (args: { where?: { releasedAt?: unknown } }) => ({
            count: args?.where?.releasedAt === null ? 2 : 0,
          }),
        },
        auditEvent: {
          create: async (args: { data: { action: string; entityType: string; entityId: string } }) => {
            auditEvents.push({
              action: args.data.action,
              entityType: args.data.entityType,
              entityId: args.data.entityId,
            });
            return { id: crypto.randomUUID() };
          },
        },
      };
      const mockPrisma = {
        $transaction: async <T>(fn: (tx: typeof mockTx) => Promise<T>) => fn(mockTx),
      } as unknown as PrismaClient;

      const pinRes = await pinDocumentVersionsForBackup(
        {
          backupId: '  backup-2026-11-26  ',
          documentVersionIds: [verA, verB, verA],
          actor: ownerActor,
        },
        { prismaOverride: mockPrisma, now: new Date('2026-11-26T00:00:00.000Z') }
      );
      expect(pinRes.backupId).toBe('backup-2026-11-26');
      expect(pinRes.pinnedCount).toBe(2);
      expect(pinRes.documentVersionIds).toEqual([verA, verB]);
      expect(capturedFindManyIds).toEqual([verA, verB]);
      expect(capturedCreateManyIds).toEqual([verA, verB]);

      const relRes = await releaseBackupFilePins(
        {
          backupId: '  backup-2026-11-26  ',
          actor: ownerActor,
        },
        { prismaOverride: mockPrisma, now: new Date('2026-11-26T01:00:00.000Z') }
      );
      expect(relRes.backupId).toBe('backup-2026-11-26');
      expect(relRes.releasedCount).toBe(2);
      expect(relRes.releasedAt).toBe('2026-11-26T01:00:00.000Z');
      expect(auditEvents).toEqual([
        {
          action: 'PIN_DOCUMENT_VERSIONS_FOR_BACKUP',
          entityType: 'BackupFilePin',
          entityId: 'backup-2026-11-26',
        },
        {
          action: 'RELEASE_BACKUP_FILE_PINS',
          entityType: 'BackupFilePin',
          entityId: 'backup-2026-11-26',
        },
      ]);

      // Missing version ID in DB rejects with DocumentNotFoundError
      const missingMockPrisma = {
        $transaction: async <T>(
          fn: (tx: {
            documentVersion: { findMany: () => Promise<Array<{ id: string }>> };
          }) => Promise<T>
        ) =>
          fn({
            documentVersion: {
              findMany: async () => [{ id: verA }],
            },
          }),
      } as unknown as PrismaClient;
      await expect(
        pinDocumentVersionsForBackup(
          {
            backupId: 'backup-missing-ver',
            documentVersionIds: [verA, verB],
            actor: ownerActor,
          },
          { prismaOverride: missingMockPrisma }
        )
      ).rejects.toThrow(DocumentNotFoundError);

      // RESTORE_MODE blocks pin & release
      const prevRestore = process.env.RESTORE_MODE;
      process.env.RESTORE_MODE = 'true';
      try {
        await expect(
          pinDocumentVersionsForBackup(
            { backupId: 'backup-restore-block', documentVersionIds: [verA], actor: ownerActor },
            { prismaOverride: mockPrisma }
          )
        ).rejects.toThrow(DocumentValidationError);
        await expect(
          releaseBackupFilePins(
            { backupId: 'backup-restore-block', actor: ownerActor },
            { prismaOverride: mockPrisma }
          )
        ).rejects.toThrow(DocumentValidationError);
      } finally {
        if (prevRestore === undefined) delete process.env.RESTORE_MODE;
        else process.env.RESTORE_MODE = prevRestore;
      }
    });
  });
});
