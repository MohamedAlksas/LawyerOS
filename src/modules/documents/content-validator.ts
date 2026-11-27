import crypto from 'node:crypto';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import {
  ALLOWED_DOCUMENT_MIMES,
  DocumentValidationError,
  MAX_DOCUMENT_BYTES,
  type AllowedDocumentMime,
} from './document-types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_DIMENSION = 16_384;
const BIDI_AND_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

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
    trimmed === '.' ||
    trimmed === '..' ||
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

const PDF_OBJ_TOKEN = Buffer.from('obj', 'ascii');
const PDF_ENDOBJ_TOKEN = Buffer.from('endobj', 'ascii');

function isAsciiWordByte(b: number): boolean {
  return (
    (b >= 0x30 && b <= 0x39) || // 0-9
    (b >= 0x41 && b <= 0x5a) || // A-Z
    b === 0x5f || // _
    (b >= 0x61 && b <= 0x7a) // a-z
  );
}

function findWordToken(buffer: Buffer, token: Buffer, startOffset = 0): number {
  let pos = startOffset;
  while (pos <= buffer.byteLength - token.byteLength) {
    const idx = buffer.indexOf(token, pos);
    if (idx === -1) return -1;
    const beforeOk = idx === 0 || !isAsciiWordByte(buffer[idx - 1]);
    const afterPos = idx + token.byteLength;
    const afterOk = afterPos === buffer.byteLength || !isAsciiWordByte(buffer[afterPos]);
    if (beforeOk && afterOk) return idx;
    pos = idx + 1;
  }
  return -1;
}

/**
 * PDF structural gate (not a full parser): `%PDF-1.x|2.x` + EOL at byte 0, at least one
 * ordered `obj`..`endobj` pair, `startxref` and a final `%%EOF` in the tail followed only by whitespace.
 */
function isValidPdfBytes(buffer: Buffer): boolean {
  if (buffer.byteLength < 12) return false;
  const headerSlice = buffer.subarray(0, Math.min(16, buffer.byteLength)).toString('ascii');
  if (!/^%PDF-[12]\.\d(?:\r\n|\r|\n)/.test(headerSlice)) {
    return false;
  }
  const tailStart = Math.max(0, buffer.byteLength - 2048);
  const tailSlice = buffer.subarray(tailStart).toString('latin1');
  const lastEofIdx = tailSlice.lastIndexOf('%%EOF');
  if (lastEofIdx === -1) {
    return false;
  }
  // Only optional EOL/whitespace may follow the final %%EOF (rejects trailing scripts/payloads)
  if (!/^[\r\n\t ]*$/.test(tailSlice.slice(lastEofIdx + 5))) {
    return false;
  }
  if (!tailSlice.slice(0, lastEofIdx).includes('startxref')) {
    return false;
  }
  const objIdx = findWordToken(buffer, PDF_OBJ_TOKEN);
  if (objIdx === -1) return false;
  return findWordToken(buffer, PDF_ENDOBJ_TOKEN, objIdx + PDF_OBJ_TOKEN.byteLength) !== -1;
}

function isJpegSof(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

/** Structural JPEG walk: needs SOI, a SOF and an SOS before EOI; entropy data may contain RSTn markers. */
function isValidJpegBytes(buffer: Buffer): boolean {
  if (buffer.byteLength < 8) return false;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return false;
  }

  let pos = 2;
  let seenSegment = false;
  let seenSof = false;
  let seenSos = false;

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
      if (!seenSegment || !seenSof || !seenSos) return false;
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
    if (isJpegSof(marker)) {
      if (segLen < 8) return false;
      const height = buffer.readUInt16BE(pos + 3);
      const width = buffer.readUInt16BE(pos + 5);
      if (height === 0 || width === 0) return false;
      seenSof = true;
    }
    pos += segLen;

    // SOS: skip entropy-coded data; FF00 is a stuffed byte and (fill FFs +) RST0..RST7 stay in the scan (T.81 B.1.1.2)
    if (marker === 0xda) {
      if (!seenSof) return false;
      seenSos = true;
      while (pos < buffer.byteLength) {
        const nextFf = buffer.indexOf(0xff, pos);
        if (nextFf === -1 || nextFf + 1 >= buffer.byteLength) {
          return false;
        }
        if (buffer[nextFf + 1] === 0x00) {
          pos = nextFf + 2;
          continue;
        }
        let markerPos = nextFf + 1;
        while (markerPos < buffer.byteLength && buffer[markerPos] === 0xff) {
          markerPos++;
        }
        if (markerPos < buffer.byteLength && buffer[markerPos] >= 0xd0 && buffer[markerPos] <= 0xd7) {
          pos = markerPos + 1;
          continue;
        }
        pos = nextFf;
        break;
      }
    }
  }

  return false;
}

const PNG_VALID_BIT_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

function isValidPngIhdr(buffer: Buffer, dataStart: number): boolean {
  const width = buffer.readUInt32BE(dataStart);
  const height = buffer.readUInt32BE(dataStart + 4);
  if (
    width === 0 ||
    width > MAX_PNG_DIMENSION ||
    height === 0 ||
    height > MAX_PNG_DIMENSION
  ) {
    return false;
  }
  const bitDepth = buffer[dataStart + 8];
  const colorType = buffer[dataStart + 9];
  return (
    (PNG_VALID_BIT_DEPTHS[colorType]?.includes(bitDepth) ?? false) &&
    buffer[dataStart + 10] === 0 && // compression
    buffer[dataStart + 11] === 0 && // filter
    buffer[dataStart + 12] <= 1 // interlace
  );
}

/** Walks every chunk: CRC-32 of type+data, single valid IHDR first, non-empty IDAT, IEND last with no trailing bytes. */
function isValidPngBytes(buffer: Buffer): boolean {
  if (buffer.byteLength < 33) return false;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }

  let offset = 8;
  let idatBytes = 0;
  let colorType = -1;
  let hasPlte = false;

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
    if (crc32(buffer.subarray(offset + 4, chunkEnd - 4)) !== buffer.readUInt32BE(chunkEnd - 4)) {
      return false;
    }

    if (offset === 8) {
      if (chunkType !== 'IHDR' || length !== 13 || !isValidPngIhdr(buffer, offset + 8)) {
        return false;
      }
      colorType = buffer[offset + 8 + 9];
    } else if (chunkType === 'IHDR') {
      return false;
    } else if (chunkType === 'PLTE') {
      if (length < 3 || length > 768 || length % 3 !== 0) {
        return false;
      }
      hasPlte = true;
    } else if (chunkType === 'IDAT') {
      idatBytes += length;
    } else if (chunkType === 'IEND') {
      // Must terminate cleanly at buffer end with no trailing bytes
      return (
        length === 0 &&
        idatBytes > 0 &&
        (colorType !== 3 || hasPlte) &&
        chunkEnd === buffer.byteLength
      );
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
