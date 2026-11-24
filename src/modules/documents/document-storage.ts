import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DocumentNotFoundError,
  DocumentStoragePathError,
  DocumentValidationError,
  MAX_DOCUMENT_BYTES,
} from './document-types';

const SAFE_KEY_SEGMENT_RE = /^[a-zA-Z0-9._-]+$/;

function normalizeForComparison(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSameOrInside(candidate: string, forbiddenDir: string): boolean {
  const rel = path.relative(
    normalizeForComparison(forbiddenDir),
    normalizeForComparison(candidate)
  );
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveSafeStorageRoot(overrideRoot?: string): string {
  const configured = overrideRoot?.trim() || process.env.DOCUMENTS_STORAGE_ROOT?.trim();
  const rootDir = configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), 'storage');

  if (!rootDir || rootDir.includes('\0')) {
    throw new DocumentStoragePathError('مسار مجلد التخزين الخاص غير صالح.');
  }

  const appRoot = path.resolve(process.cwd());
  const forbiddenDirs = [
    path.resolve(appRoot, 'public'),
    path.resolve(appRoot, '.next'),
    path.resolve(appRoot, 'src'),
  ];

  for (const forbidden of forbiddenDirs) {
    if (isSameOrInside(rootDir, forbidden)) {
      throw new DocumentStoragePathError(
        'ممنوع تعيين مجلد تخزين المستندات داخل المجلدات العامة أو ملفات البناء.'
      );
    }
  }

  if (normalizeForComparison(rootDir) === normalizeForComparison(appRoot)) {
    throw new DocumentStoragePathError(
      'يجب أن يكون مجلد تخزين المستندات في مجلد مخصص ومنفصل عن جذر التطبيق.'
    );
  }

  return rootDir;
}

/**
 * Validates a relative storage key and resolves it inside baseDir.
 * Rejects traversal segments, backslashes, leading slashes, colons/drive letters, and null bytes.
 */
export function resolveSafeKeyPath(baseDir: string, key: string): string {
  if (typeof key !== 'string' || key.length === 0 || key.trim() !== key) {
    throw new DocumentStoragePathError('مفتاح التخزين غير صالح.');
  }
  if (
    key.includes('\0') ||
    key.includes('\\') ||
    key.includes(':') ||
    key.startsWith('/') ||
    key.endsWith('/')
  ) {
    throw new DocumentStoragePathError('مفتاح التخزين يحتوي على محارف مسار غير مسموح بها.');
  }

  const segments = key.split('/');
  if (segments.length === 0) {
    throw new DocumentStoragePathError('مفتاح التخزين فارغ.');
  }

  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || !SAFE_KEY_SEGMENT_RE.test(seg)) {
      throw new DocumentStoragePathError('مفتاح التخزين يحتوي على مقطع غير آمن.');
    }
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, ...segments);
  const rel = path.relative(
    normalizeForComparison(resolvedBase),
    normalizeForComparison(resolvedTarget)
  );

  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new DocumentStoragePathError('تم رفض محاولة الخروج عن مسار التخزين الخاص.');
  }

  return resolvedTarget;
}

export type DocumentStorageSource = Buffer | Uint8Array | Readable | AsyncIterable<Uint8Array>;

export interface WriteQuarantineResult {
  bytesWritten: number;
  sha256: string;
}

export interface DocumentStorageAdapter {
  readonly rootDir: string;
  readonly quarantineDir: string;
  readonly readyDir: string;
  generateQuarantineKey(attemptId: string, canonicalExtension: string, now?: Date): string;
  generateReadyKey(documentId: string, versionNumber: number, canonicalExtension: string, now?: Date): string;
  writeQuarantineStream(
    quarantineKey: string,
    source: DocumentStorageSource,
    maxBytes?: number
  ): Promise<WriteQuarantineResult>;
  readQuarantineBytes(quarantineKey: string, maxBytes?: number): Promise<Buffer>;
  promoteToReady(quarantineKey: string, readyKey: string): Promise<void>;
  readReadyStream(readyKey: string): Readable;
  readReadyBytes(readyKey: string): Promise<Buffer>;
  exists(zone: 'quarantine' | 'ready', key: string): Promise<boolean>;
  stat(zone: 'quarantine' | 'ready', key: string): Promise<{ sizeBytes: number } | null>;
  deleteQuarantine(quarantineKey: string): Promise<boolean>;
  deleteReady(readyKey: string): Promise<boolean>;
}

function normalizeCanonicalExt(ext: string): string {
  const clean = ext.trim().toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(clean)) {
    throw new DocumentStoragePathError('امتداد الملف غير صالح للتخزين.');
  }
  return clean;
}

async function unlinkIfExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

export function createLocalDocumentStorage(overrideRoot?: string): DocumentStorageAdapter {
  const rootDir = resolveSafeStorageRoot(overrideRoot);
  const quarantineDir = path.join(rootDir, 'quarantine');
  const readyDir = path.join(rootDir, 'ready');

  function zoneBase(zone: 'quarantine' | 'ready'): string {
    return zone === 'quarantine' ? quarantineDir : readyDir;
  }

  return {
    rootDir,
    quarantineDir,
    readyDir,

    generateQuarantineKey(attemptId: string, canonicalExtension: string, now: Date = new Date()): string {
      const ext = normalizeCanonicalExt(canonicalExtension);
      const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const safeAttempt = attemptId.replace(/[^a-zA-Z0-9_-]/g, '');
      if (!safeAttempt) {
        throw new DocumentStoragePathError('معرف محاولة الرفع غير صالح.');
      }
      return `q/${yyyy}/${mm}/${safeAttempt}-${crypto.randomUUID()}${ext}`;
    },

    generateReadyKey(
      _documentId: string,
      versionNumber: number,
      canonicalExtension: string,
      now: Date = new Date()
    ): string {
      const ext = normalizeCanonicalExt(canonicalExtension);
      const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const ver = Number.isInteger(versionNumber) && versionNumber >= 1 ? versionNumber : 1;
      return `v${ver}/${yyyy}/${mm}/${crypto.randomUUID()}${ext}`;
    },

    async writeQuarantineStream(
      quarantineKey: string,
      source: DocumentStorageSource,
      maxBytes: number = MAX_DOCUMENT_BYTES
    ): Promise<WriteQuarantineResult> {
      const targetPath = resolveSafeKeyPath(quarantineDir, quarantineKey);
      const targetDir = path.dirname(targetPath);
      await fs.promises.mkdir(targetDir, { recursive: true });

      const tempPartPath = `${targetPath}.part-${crypto.randomUUID()}`;
      const hash = crypto.createHash('sha256');
      let bytesWritten = 0;
      let handle: fs.promises.FileHandle | null = null;

      try {
        handle = await fs.promises.open(tempPartPath, 'w');

        if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
          const buf = Buffer.isBuffer(source)
            ? source
            : Buffer.from(source.buffer, source.byteOffset, source.byteLength);
          if (buf.byteLength === 0) {
            throw new DocumentValidationError('الملف فارغ (0 بايت) ولا يمكن رفعه.');
          }
          if (buf.byteLength > maxBytes) {
            throw new DocumentValidationError(
              'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).',
              { file: 'حجم الملف يتجاوز 25 ميجابايت' },
              'PAYLOAD_TOO_LARGE'
            );
          }
          await handle.write(buf);
          hash.update(buf);
          bytesWritten = buf.byteLength;
        } else {
          for await (const chunk of source) {
            const buf = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            if (buf.byteLength === 0) continue;

            bytesWritten += buf.byteLength;
            if (bytesWritten > maxBytes) {
              throw new DocumentValidationError(
                'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).',
                { file: 'حجم الملف يتجاوز 25 ميجابايت' },
                'PAYLOAD_TOO_LARGE'
              );
            }
            await handle.write(buf);
            hash.update(buf);
          }

          if (bytesWritten === 0) {
            throw new DocumentValidationError('الملف فارغ (0 بايت) ولا يمكن رفعه.');
          }
        }

        await handle.sync();
        await handle.close();
        handle = null;

        await fs.promises.rename(tempPartPath, targetPath);

        return {
          bytesWritten,
          sha256: hash.digest('hex'),
        };
      } catch (err) {
        if (handle) {
          await handle.close().catch(() => {});
          handle = null;
        }
        await unlinkIfExists(tempPartPath).catch(() => {});
        throw err;
      }
    },

    async readQuarantineBytes(
      quarantineKey: string,
      maxBytes: number = MAX_DOCUMENT_BYTES
    ): Promise<Buffer> {
      const targetPath = resolveSafeKeyPath(quarantineDir, quarantineKey);
      let stat: fs.Stats;
      try {
        stat = await fs.promises.stat(targetPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new DocumentValidationError('تعذر العثور على بيانات الملف المؤقتة في الحجر.');
        }
        throw err;
      }
      if (!stat.isFile() || stat.size <= 0) {
        throw new DocumentValidationError('ملف الحجر غير صالح أو فارغ.');
      }
      if (stat.size > maxBytes) {
        throw new DocumentValidationError(
          'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).',
          { file: 'حجم الملف يتجاوز 25 ميجابايت' },
          'PAYLOAD_TOO_LARGE'
        );
      }
      return await fs.promises.readFile(targetPath);
    },

    async promoteToReady(quarantineKey: string, readyKey: string): Promise<void> {
      const srcPath = resolveSafeKeyPath(quarantineDir, quarantineKey);
      const destPath = resolveSafeKeyPath(readyDir, readyKey);
      const destDir = path.dirname(destPath);
      await fs.promises.mkdir(destDir, { recursive: true });

      const tempPartPath = `${destPath}.part-${crypto.randomUUID()}`;
      try {
        await fs.promises.copyFile(srcPath, tempPartPath);
        await fs.promises.rename(tempPartPath, destPath);
      } catch (err) {
        await unlinkIfExists(tempPartPath).catch(() => {});
        throw err;
      }
    },

    readReadyStream(readyKey: string): Readable {
      const targetPath = resolveSafeKeyPath(readyDir, readyKey);
      if (!fs.existsSync(targetPath)) {
        throw new DocumentNotFoundError('ملف المستند غير متاح في التخزين الخاص.');
      }
      return fs.createReadStream(targetPath);
    },

    async readReadyBytes(readyKey: string): Promise<Buffer> {
      const targetPath = resolveSafeKeyPath(readyDir, readyKey);
      try {
        return await fs.promises.readFile(targetPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new DocumentNotFoundError('ملف المستند غير متاح في التخزين الخاص.');
        }
        throw err;
      }
    },

    async exists(zone: 'quarantine' | 'ready', key: string): Promise<boolean> {
      const targetPath = resolveSafeKeyPath(zoneBase(zone), key);
      try {
        const stat = await fs.promises.stat(targetPath);
        return stat.isFile();
      } catch {
        return false;
      }
    },

    async stat(zone: 'quarantine' | 'ready', key: string): Promise<{ sizeBytes: number } | null> {
      const targetPath = resolveSafeKeyPath(zoneBase(zone), key);
      try {
        const st = await fs.promises.stat(targetPath);
        if (!st.isFile()) return null;
        return { sizeBytes: st.size };
      } catch {
        return null;
      }
    },

    async deleteQuarantine(quarantineKey: string): Promise<boolean> {
      const targetPath = resolveSafeKeyPath(quarantineDir, quarantineKey);
      return await unlinkIfExists(targetPath);
    },

    async deleteReady(readyKey: string): Promise<boolean> {
      const targetPath = resolveSafeKeyPath(readyDir, readyKey);
      return await unlinkIfExists(targetPath);
    },
  };
}

export function getDocumentStorage(overrideRoot?: string): DocumentStorageAdapter {
  return createLocalDocumentStorage(overrideRoot);
}
