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

function getRuntimeCwd(): string {
  // Indirect lookup avoids Turbopack static-tracer whole-project bundling warnings on process.cwd()
  return process['cwd']();
}

function normalizeForComparison(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** lstat (not existsSync) so dangling symlinks count as existing and fail realpath below. */
function pathEntryExists(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new DocumentStoragePathError('تعذر التحقق من المسار الحقيقي لمجلد التخزين.');
  }
}

/**
 * Resolves symlinks along the deepest existing ancestor of `targetPath`
 * so symlinked roots or parent directories cannot escape security boundaries.
 */
function resolveRealPathWithSuffix(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const trailingSegments: string[] = [];
  let cursor = resolved;

  while (!pathEntryExists(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return resolved;
    }
    trailingSegments.unshift(path.basename(cursor));
    cursor = parent;
  }

  let realBase: string;
  try {
    realBase = fs.realpathSync(cursor);
  } catch {
    throw new DocumentStoragePathError('تعذر التحقق من المسار الحقيقي لمجلد التخزين.');
  }

  return trailingSegments.length > 0
    ? path.resolve(realBase, ...trailingSegments)
    : realBase;
}

/** True when `rel` (from path.relative) stays inside its base; a segment merely starting with .. (e.g. ..uploads) is inside. */
function isRelInside(rel: string, allowSame: boolean): boolean {
  if (rel === '') return allowSame;
  return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function isSameOrInside(candidate: string, forbiddenDir: string): boolean {
  const rel = path.relative(
    normalizeForComparison(forbiddenDir),
    normalizeForComparison(candidate)
  );
  return isRelInside(rel, true);
}

export function resolveSafeStorageRoot(overrideRoot?: string): string {
  const runtimeCwd = getRuntimeCwd();
  const configured = overrideRoot?.trim() || process.env.DOCUMENTS_STORAGE_ROOT?.trim();
  const rawRoot = configured
    ? path.resolve(configured)
    : path.resolve(runtimeCwd, 'storage');

  if (!rawRoot || rawRoot.includes('\0')) {
    throw new DocumentStoragePathError('مسار مجلد التخزين الخاص غير صالح.');
  }

  const realRoot = resolveRealPathWithSuffix(rawRoot);
  const realAppRoot = resolveRealPathWithSuffix(runtimeCwd);
  const forbiddenDirs = [
    resolveRealPathWithSuffix(path.resolve(runtimeCwd, 'public')),
    resolveRealPathWithSuffix(path.resolve(runtimeCwd, '.next')),
    resolveRealPathWithSuffix(path.resolve(runtimeCwd, 'src')),
  ];

  for (const forbidden of forbiddenDirs) {
    if (isSameOrInside(realRoot, forbidden) || isSameOrInside(rawRoot, forbidden)) {
      throw new DocumentStoragePathError(
        'ممنوع تعيين مجلد تخزين المستندات داخل المجلدات العامة أو ملفات البناء.'
      );
    }
  }

  if (
    isSameOrInside(realAppRoot, realRoot) ||
    isSameOrInside(runtimeCwd, rawRoot)
  ) {
    throw new DocumentStoragePathError(
      'يجب أن يكون مجلد تخزين المستندات في مجلد مخصص ومنفصل عن جذر التطبيق.'
    );
  }

  return realRoot;
}

/**
 * Validates a relative storage key and resolves it inside baseDir.
 * Rejects traversal segments, backslashes, leading slashes, colons/drive letters, null bytes, and symlink escapes.
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

  const realBase = resolveRealPathWithSuffix(baseDir);
  const resolvedTarget = path.resolve(realBase, ...segments);
  const rel = path.relative(
    normalizeForComparison(realBase),
    normalizeForComparison(resolvedTarget)
  );

  if (!isRelInside(rel, false)) {
    throw new DocumentStoragePathError('تم رفض محاولة الخروج عن مسار التخزين الخاص.');
  }

  // Also verify existing ancestors/target do not follow a symlink outside realBase
  const realTarget = resolveRealPathWithSuffix(resolvedTarget);
  const realRel = path.relative(
    normalizeForComparison(realBase),
    normalizeForComparison(realTarget)
  );
  if (!isRelInside(realRel, false)) {
    throw new DocumentStoragePathError('تم رفض محاولة الخروج عن مسار التخزين الخاص عبر رابط رمزي.');
  }

  return realTarget;
}

export type DocumentStorageSource = Buffer | Uint8Array | Readable | AsyncIterable<Uint8Array>;

export interface WriteQuarantineResult {
  bytesWritten: number;
  sha256: string;
}

export interface StoredZoneFile {
  key: string;
  sizeBytes: number;
  mtimeMs: number;
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
  writeReadyBytes(readyKey: string, bytes: Buffer): Promise<void>;
  promoteToReady(quarantineKey: string, readyKey: string): Promise<void>;
  readReadyStream(readyKey: string): Promise<Readable>;
  readReadyBytes(readyKey: string): Promise<Buffer>;
  exists(zone: 'quarantine' | 'ready', key: string): Promise<boolean>;
  stat(zone: 'quarantine' | 'ready', key: string): Promise<{ sizeBytes: number } | null>;
  deleteQuarantine(quarantineKey: string): Promise<boolean>;
  deleteReady(readyKey: string): Promise<boolean>;
  listKeys?(zone: 'quarantine' | 'ready'): Promise<StoredZoneFile[]>;
  computeSha256?(zone: 'quarantine' | 'ready', key: string): Promise<string | null>;
}

/** FileHandle.write may write fewer bytes than requested; loop until the whole buffer is written. */
async function writeAll(handle: fs.promises.FileHandle, buf: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buf.byteLength) {
    const { bytesWritten } = await handle.write(buf, offset, buf.byteLength - offset);
    if (bytesWritten <= 0) {
      throw new DocumentStoragePathError('تعذر كتابة الملف كاملاً في التخزين الخاص.');
    }
    offset += bytesWritten;
  }
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

async function ensurePrivateDir(dirPath: string, stopAtDir?: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  let current = path.resolve(dirPath);
  const boundary = stopAtDir ? path.resolve(stopAtDir) : null;
  while (true) {
    await fs.promises.chmod(current, 0o700).catch(() => {});
    if (!boundary || current === boundary) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function ensurePrivateFileMode(handle: fs.promises.FileHandle): Promise<void> {
  if (process.platform !== 'win32') {
    await handle.chmod(0o600);
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
      await ensurePrivateDir(targetDir, rootDir);

      const tempPartPath = `${targetPath}.part-${crypto.randomUUID()}`;
      const hash = crypto.createHash('sha256');
      let bytesWritten = 0;
      let handle: fs.promises.FileHandle | null = null;

      try {
        handle = await fs.promises.open(tempPartPath, 'wx', 0o600);
        await ensurePrivateFileMode(handle);

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
          await writeAll(handle, buf);
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
            await writeAll(handle, buf);
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

    async writeReadyBytes(readyKey: string, bytes: Buffer): Promise<void> {
      const destPath = resolveSafeKeyPath(readyDir, readyKey);
      const destDir = path.dirname(destPath);
      await ensurePrivateDir(destDir, rootDir);

      const tempPartPath = `${destPath}.part-${crypto.randomUUID()}`;
      let handle: fs.promises.FileHandle | null = null;
      try {
        handle = await fs.promises.open(tempPartPath, 'wx', 0o600);
        await ensurePrivateFileMode(handle);
        await writeAll(handle, bytes);
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.promises.rename(tempPartPath, destPath);
      } catch (err) {
        if (handle) {
          await handle.close().catch(() => {});
          handle = null;
        }
        await unlinkIfExists(tempPartPath).catch(() => {});
        throw err;
      }
    },

    async promoteToReady(quarantineKey: string, readyKey: string): Promise<void> {
      const srcPath = resolveSafeKeyPath(quarantineDir, quarantineKey);
      const destPath = resolveSafeKeyPath(readyDir, readyKey);
      const destDir = path.dirname(destPath);
      await ensurePrivateDir(destDir, rootDir);

      const tempPartPath = `${destPath}.part-${crypto.randomUUID()}`;
      let handle: fs.promises.FileHandle | null = null;
      try {
        await fs.promises.copyFile(srcPath, tempPartPath, fs.constants.COPYFILE_EXCL);
        handle = await fs.promises.open(tempPartPath, 'r+');
        await ensurePrivateFileMode(handle);
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.promises.rename(tempPartPath, destPath);
      } catch (err) {
        if (handle) {
          await handle.close().catch(() => {});
          handle = null;
        }
        await unlinkIfExists(tempPartPath).catch(() => {});
        throw err;
      }
    },

    async readReadyStream(readyKey: string): Promise<Readable> {
      const targetPath = resolveSafeKeyPath(readyDir, readyKey);
      let handle: fs.promises.FileHandle;
      try {
        handle = await fs.promises.open(targetPath, 'r');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          throw new DocumentNotFoundError('ملف المستند غير متاح في التخزين الخاص.');
        }
        throw err;
      }

      try {
        const st = await handle.stat();
        if (!st.isFile() || st.size <= 0) {
          throw new DocumentNotFoundError('ملف المستند غير متاح في التخزين الخاص.');
        }
        return handle.createReadStream({ autoClose: true });
      } catch (err) {
        await handle.close().catch(() => {});
        throw err;
      }
    },

    async readReadyBytes(readyKey: string): Promise<Buffer> {
      const targetPath = resolveSafeKeyPath(readyDir, readyKey);
      let handle: fs.promises.FileHandle;
      try {
        handle = await fs.promises.open(targetPath, 'r');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
          throw new DocumentNotFoundError('ملف المستند غير متاح في التخزين الخاص.');
        }
        throw err;
      }

      try {
        const st = await handle.stat();
        if (!st.isFile() || st.size <= 0) {
          throw new DocumentNotFoundError('ملف المستند غير متاح في التخزين الخاص.');
        }
        return await handle.readFile();
      } finally {
        await handle.close().catch(() => {});
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

    async listKeys(zone: 'quarantine' | 'ready'): Promise<StoredZoneFile[]> {
      const base = resolveRealPathWithSuffix(zoneBase(zone));
      const results: StoredZoneFile[] = [];

      async function walk(currentDir: string, relPrefix: string): Promise<void> {
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw err;
        }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const fullPath = path.join(currentDir, entry.name);
          const relKey = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(fullPath, relKey);
          } else if (entry.isFile()) {
            let st: fs.Stats;
            try {
              st = await fs.promises.lstat(fullPath);
            } catch (err) {
              const code = (err as NodeJS.ErrnoException).code;
              if (code === 'ENOENT' || code === 'ENOTDIR') continue;
              throw err;
            }
            if (st.isFile()) {
              results.push({
                key: relKey,
                sizeBytes: st.size,
                mtimeMs: st.mtimeMs,
              });
            }
          }
        }
      }

      await walk(base, '');
      results.sort((a, b) => a.key.localeCompare(b.key));
      return results;
    },

    async computeSha256(zone: 'quarantine' | 'ready', key: string): Promise<string | null> {
      const targetPath = resolveSafeKeyPath(zoneBase(zone), key);
      try {
        const st = await fs.promises.lstat(targetPath);
        if (!st.isFile()) return null;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }

      return await new Promise<string | null>((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(targetPath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', (err) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            resolve(null);
            return;
          }
          reject(err);
        });
        stream.on('end', () => resolve(hash.digest('hex')));
      });
    },
  };
}

export function getDocumentStorage(overrideRoot?: string): DocumentStorageAdapter {
  return createLocalDocumentStorage(overrideRoot);
}
