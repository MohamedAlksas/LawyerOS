import crypto from 'node:crypto';
import path from 'node:path';
import {
  ALLOWED_DOCUMENT_MIMES,
  DocumentValidationError,
  MAX_DOCUMENT_BYTES,
  type AllowedDocumentMime,
} from './document-types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND_CRC = Buffer.from([0xae, 0x42, 0x60, 0x82]);
const BIDI_AND_CONTROL_RE = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

export interface SanitizedFilenameResult {
  displayFilename: string;
  extension: '.pdf' | '.jpg' | '.png';
  rawExtension: string;
}

export interface InspectedDocumentContent {
  displayFilename: string;
  extension: '.pdf' | '.jpg' | '.png';
  declaredMime: AllowedDocumentMime;
  detectedMime: AllowedDocumentMime;
  sizeBytes: number;
  sha256: string;
}

export function normalizeDeclaredMime(rawMime: string): AllowedDocumentMime {
  if (typeof rawMime !== 'string') {
    throw new DocumentValidationError('نوع الملف (MIME) مطلوب.', {
      declaredMime: 'نوع الملف مطلوب',
    });
  }
  const base = rawMime.split(';', 1)[0].trim().toLowerCase();
  if (!(ALLOWED_DOCUMENT_MIMES as readonly string[]).includes(base)) {
    throw new DocumentValidationError(
      'صيغة الملف غير مدعومة. الصيغ المسموح بها في هذه المرحلة هي PDF و JPEG و PNG فقط.',
      { declaredMime: 'الصيغة غير مدعومة (المسموح: PDF, JPEG, PNG)' }
    );
  }
  return base as AllowedDocumentMime;
}

/**
 * Validates and normalizes the display filename without trusting it for storage paths.
 * Rejects path traversal segments, separators, drive letters/colons, control chars, bidi overrides, and disallowed extensions.
 */
export function sanitizeDisplayFilename(rawFilename: string): SanitizedFilenameResult {
  if (typeof rawFilename !== 'string') {
    throw new DocumentValidationError('اسم الملف مطلوب.', {
      originalFilename: 'اسم الملف مطلوب',
    });
  }

  if (BIDI_AND_CONTROL_RE.test(rawFilename)) {
    throw new DocumentValidationError('اسم الملف يحتوي على محارف تحكم أو اتجاه غير صالحة.', {
      originalFilename: 'اسم الملف غير صالح',
    });
  }

  const trimmed = rawFilename.trim();
  if (!trimmed || trimmed.length > 255) {
    throw new DocumentValidationError('اسم الملف غير صالح أو يتجاوز الطول المسموح.', {
      originalFilename: 'اسم الملف مطلوب ولا يتجاوز 255 حرفاً',
    });
  }

  if (
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.includes(':')
  ) {
    throw new DocumentValidationError(
      'اسم الملف يحتوي على رموز مسار أو تنقل غير مسموح بها.',
      { originalFilename: 'ممنوع تضمين مسارات أو رموز تنقل داخل اسم الملف' }
    );
  }

  if (trimmed.startsWith('.') || trimmed.endsWith('.')) {
    throw new DocumentValidationError('اسم الملف غير صالح.', {
      originalFilename: 'اسم الملف لا يبدأ ولا ينتهي بنقطة',
    });
  }

  const rawExt = path.posix.extname(trimmed).toLowerCase();
  let canonicalExt: '.pdf' | '.jpg' | '.png';
  if (rawExt === '.pdf') {
    canonicalExt = '.pdf';
  } else if (rawExt === '.jpg' || rawExt === '.jpeg') {
    canonicalExt = '.jpg';
  } else if (rawExt === '.png') {
    canonicalExt = '.png';
  } else {
    throw new DocumentValidationError(
      'امتداد الملف غير مسموح به. الامتدادات المدعومة: .pdf و .jpg و .jpeg و .png فقط.',
      { originalFilename: 'امتداد الملف غير مدعوم' }
    );
  }

  return {
    displayFilename: trimmed,
    extension: canonicalExt,
    rawExtension: rawExt,
  };
}

export function validateMimeAndExtension(
  declaredMime: string,
  canonicalExtension: '.pdf' | '.jpg' | '.png'
): AllowedDocumentMime {
  const mime = normalizeDeclaredMime(declaredMime);
  const expectedExt: Record<AllowedDocumentMime, '.pdf' | '.jpg' | '.png'> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
  };

  if (expectedExt[mime] !== canonicalExtension) {
    throw new DocumentValidationError(
      'امتداد الملف لا يطابق نوع الملف المعلن (MIME).',
      { declaredMime: 'عدم تطابق بين الامتداد ونوع الملف' }
    );
  }

  return mime;
}

function isValidPdfBytes(buffer: Buffer): boolean {
  if (buffer.byteLength < 12) return false;
  // Must start strictly at byte 0 with %PDF-1.x or %PDF-2.x (blocks polyglot HTML/EXE headers)
  const headerSlice = buffer.subarray(0, Math.min(16, buffer.byteLength)).toString('ascii');
  if (!/^%PDF-[12]\.\d/.test(headerSlice)) {
    return false;
  }
  const tailStart = Math.max(0, buffer.byteLength - 2048);
  const tailSlice = buffer.subarray(tailStart).toString('latin1');
  const lastEofIdx = tailSlice.lastIndexOf('%%EOF');
  if (lastEofIdx === -1) {
    return false;
  }
  const afterEof = tailSlice.slice(lastEofIdx + 5);
  // Only optional EOL/whitespace may follow the final %%EOF (rejects trailing scripts/payloads)
  return /^[\r\n\t ]*$/.test(afterEof);
}

function isValidJpegBytes(buffer: Buffer): boolean {
  if (buffer.byteLength < 8) return false;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return false;
  }

  let pos = 2;
  let seenSegment = false;

  while (pos < buffer.byteLength) {
    if (buffer[pos] !== 0xff) {
      return false;
    }
    while (pos < buffer.byteLength && buffer[pos] === 0xff) {
      pos++;
    }
    if (pos >= buffer.byteLength) {
      return false;
    }

    const marker = buffer[pos++];
    if (marker === 0x00 || marker === 0xd8) {
      return false;
    }

    // EOI (End of Image)
    if (marker === 0xd9) {
      if (!seenSegment) return false;
      const trailingLen = buffer.byteLength - pos;
      if (trailingLen > 16) return false;
      for (let i = pos; i < buffer.byteLength; i++) {
        const b = buffer[i];
        if (b !== 0x00 && b !== 0x20 && b !== 0x0a && b !== 0x0d) {
          return false;
        }
      }
      return true;
    }

    // Standalone markers without payload length (TEM / RST0..RST7)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (pos + 2 > buffer.byteLength) {
      return false;
    }
    const segLen = buffer.readUInt16BE(pos);
    if (segLen < 2 || pos + segLen > buffer.byteLength) {
      return false;
    }
    seenSegment = true;
    pos += segLen;

    // SOS (Start of Scan): skip entropy-coded scan stream until the next non-RST marker
    if (marker === 0xda) {
      while (pos < buffer.byteLength) {
        const nextFf = buffer.indexOf(0xff, pos);
        if (nextFf === -1 || nextFf + 1 >= buffer.byteLength) {
          return false;
        }
        const nextByte = buffer[nextFf + 1];
        if (nextByte === 0x00 || (nextByte >= 0xd0 && nextByte <= 0xd7)) {
          pos = nextFf + 2;
          continue;
        }
        pos = nextFf;
        break;
      }
    }
  }

  return false;
}

function isValidPngBytes(buffer: Buffer): boolean {
  if (buffer.byteLength < 33) return false;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }

  let offset = 8;
  let hasIhdr = false;
  let hasIdat = false;

  while (offset + 12 <= buffer.byteLength) {
    const length = buffer.readUInt32BE(offset);
    if (length > 0x7fffffff) {
      return false;
    }
    const chunkType = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (!/^[A-Za-z]{4}$/.test(chunkType)) {
      return false;
    }

    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.byteLength) {
      return false;
    }

    if (offset === 8) {
      if (chunkType !== 'IHDR' || length !== 13) {
        return false;
      }
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) {
        return false;
      }
      hasIhdr = true;
    } else if (chunkType === 'IDAT') {
      hasIdat = true;
    } else if (chunkType === 'IEND') {
      if (length !== 0) {
        return false;
      }
      if (!buffer.subarray(offset + 8, offset + 12).equals(PNG_IEND_CRC)) {
        return false;
      }
      // Must terminate cleanly at buffer end with no trailing bytes
      return hasIhdr && hasIdat && chunkEnd === buffer.byteLength;
    }

    offset = chunkEnd;
  }

  return false;
}

export function detectDocumentMimeFromBytes(buffer: Buffer): AllowedDocumentMime | null {
  if (isValidPdfBytes(buffer)) {
    return 'application/pdf';
  }
  if (isValidJpegBytes(buffer)) {
    return 'image/jpeg';
  }
  if (isValidPngBytes(buffer)) {
    return 'image/png';
  }
  return null;
}

export function inspectFileContent(
  buffer: Buffer,
  options: {
    originalFilename: string;
    declaredMime: string;
    maxBytes?: number;
  }
): InspectedDocumentContent {
  const maxBytes = options.maxBytes ?? MAX_DOCUMENT_BYTES;
  const { displayFilename, extension } = sanitizeDisplayFilename(options.originalFilename);
  const declaredMime = validateMimeAndExtension(options.declaredMime, extension);

  if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
    throw new DocumentValidationError('الملف فارغ (0 بايت) ولا يمكن قبوله.');
  }

  if (buffer.byteLength > maxBytes) {
    throw new DocumentValidationError(
      'حجم الملف يتجاوز الحد الأقصى المسموح به (25 ميجابايت).',
      { file: 'حجم الملف يتجاوز 25 ميجابايت' },
      'PAYLOAD_TOO_LARGE'
    );
  }

  const detectedMime = detectDocumentMimeFromBytes(buffer);
  if (!detectedMime) {
    throw new DocumentValidationError(
      'محتوى الملف الفعلي لا يطابق صيغة PDF أو JPEG أو PNG صالحة (تم رفض الملف لحماية الأرشيف).',
      { file: 'توقيع الملف الداخلي غير صالح أو تالف' }
    );
  }

  if (detectedMime !== declaredMime) {
    throw new DocumentValidationError(
      'محتوى الملف الفعلي لا يطابق الصيغة المعلنة أو الامتداد.',
      { declaredMime: 'عدم تطابق بين توقيع الملف الفعلي والصيغة المعلنة' }
    );
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    displayFilename,
    extension,
    declaredMime,
    detectedMime,
    sizeBytes: buffer.byteLength,
    sha256,
  };
}
