import zlib from 'node:zlib';

/**
 * Shared deterministic synthetic file builders for T11/T12 unit, integration, and E2E tests.
 */
export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function buildSyntheticPdf(markerOrPadBytes: string | number = 'SYNTHETIC', padBytes = 0): Buffer {
  const marker = typeof markerOrPadBytes === 'string' ? markerOrPadBytes : 'SYNTHETIC';
  const padCount = typeof markerOrPadBytes === 'number' ? markerOrPadBytes : padBytes;
  const header = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Marker (${marker}) >>\nendobj\n`,
    'ascii'
  );
  const footer = Buffer.from('\ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n', 'ascii');
  if (padCount <= 0) {
    return Buffer.concat([header, footer]);
  }
  return Buffer.concat([header, Buffer.alloc(padCount, 0x20), footer]);
}

export interface SyntheticPngColorOptions {
  r: number;
  g: number;
  b: number;
  width?: number;
  height?: number;
}

export function buildSyntheticPng(
  options: number | SyntheticPngColorOptions = 0xff,
  marker?: string
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  const textChunk = marker ? makePngChunk('tEXt', Buffer.from(`Comment\0${marker}`, 'ascii')) : null;

  if (typeof options === 'number') {
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const idat = zlib.deflateSync(Buffer.from([0x00, options & 0xff, 0x10, 0x20]));
    return Buffer.concat([
      signature,
      makePngChunk('IHDR', ihdr),
      makePngChunk('IDAT', idat),
      ...(textChunk ? [textChunk] : []),
      makePngChunk('IEND', Buffer.alloc(0)),
    ]);
  }

  const width = options.width ?? 100;
  const height = options.height ?? 70;
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const rowStride = 1 + width * 3;
  const rawPixels = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride;
    rawPixels[rowStart] = 0x00;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowStart + 1 + x * 3;
      rawPixels[pxOffset] = options.r & 0xff;
      rawPixels[pxOffset + 1] = options.g & 0xff;
      rawPixels[pxOffset + 2] = options.b & 0xff;
    }
  }

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', zlib.deflateSync(rawPixels)),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const BASE_1X1_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

export function buildSyntheticJpeg(markerOrEntropy: string | number | number[] = 0x1122): Buffer {
  if (typeof markerOrEntropy === 'string') {
    const base = Buffer.from(BASE_1X1_JPEG_B64, 'base64');
    const commentData = Buffer.from(markerOrEntropy, 'ascii');
    const comHeader = Buffer.alloc(4);
    comHeader[0] = 0xff;
    comHeader[1] = 0xfe; // COM marker
    comHeader.writeUInt16BE(commentData.byteLength + 2, 2);
    return Buffer.concat([base.subarray(0, 2), comHeader, commentData, base.subarray(2)]);
  }
  const entropy: number[] = Array.isArray(markerOrEntropy)
    ? markerOrEntropy
    : [markerOrEntropy & 0xff, (markerOrEntropy >> 8) & 0xff, 0x11, 0x22];
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, // SOF0
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00, // SOS
    ...entropy,
    0xff, 0xd9, // EOI
  ]);
}
