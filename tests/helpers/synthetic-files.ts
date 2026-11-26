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

export function buildSyntheticPng(options: number | SyntheticPngColorOptions = 0xff): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);

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
