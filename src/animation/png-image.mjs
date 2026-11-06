import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_DECODED_PNG_BYTES = 512 * 1024 * 1024;
const CRC_TABLE = createCrcTable();

/** Validate PNG chunks and decoded scanlines, then return the image dimensions. */
export function pngDimensions(image, label) {
  try {
    return inspectPng(image);
  } catch (error) {
    throw new TypeError(`Sprite ${label} must be a complete, readable PNG image: ${error.message}`);
  }
}

function inspectPng(image) {
  if (!Buffer.isBuffer(image) || image.length < 8 || !image.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError('invalid PNG signature');
  }
  let offset = 8;
  let dimensions;
  let channels;
  let bitDepth;
  let colorType;
  let interlace;
  let paletteSeen = false;
  let idatEnded = false;
  let endSeen = false;
  const imageData = [];

  while (offset < image.length) {
    if (image.length - offset < 12) throw new TypeError('truncated PNG chunk');
    const length = image.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const chunkEnd = crcOffset + 4;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > image.length) throw new TypeError('truncated PNG chunk data');
    const type = image.toString('ascii', typeOffset, dataOffset);
    const data = image.subarray(dataOffset, crcOffset);
    if (readCrc(image, typeOffset, crcOffset) !== image.readUInt32BE(crcOffset)) {
      throw new TypeError(`PNG ${type} chunk has an invalid checksum`);
    }
    if (!dimensions && type !== 'IHDR') throw new TypeError('IHDR must be the first PNG chunk');

    if (type === 'IHDR') {
      if (dimensions || length !== 13 || offset !== 8) throw new TypeError('PNG must contain one valid IHDR chunk');
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      interlace = data[12];
      channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
      const validDepths = new Map([[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]);
      if (!width || !height || !channels || !validDepths.get(colorType).includes(bitDepth)
          || compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) {
        throw new TypeError('PNG IHDR fields are invalid or unsupported');
      }
      dimensions = { width, height };
    } else if (type === 'PLTE') {
      if (paletteSeen || imageData.length || colorType === 0 || colorType === 4
          || length === 0 || length > 768 || length % 3 !== 0
          || (colorType === 3 && length / 3 > 2 ** bitDepth)) {
        throw new TypeError('PNG palette chunk is invalid');
      }
      paletteSeen = true;
    } else if (type === 'IDAT') {
      if (idatEnded) throw new TypeError('PNG image data chunks must be consecutive');
      imageData.push(data);
    } else if (type === 'IEND') {
      if (length !== 0 || imageData.length === 0 || chunkEnd !== image.length) throw new TypeError('PNG IEND chunk is invalid');
      endSeen = true;
      offset = chunkEnd;
      break;
    } else {
      if (imageData.length) idatEnded = true;
      if (isCriticalChunk(type) && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) {
        throw new TypeError(`unsupported critical PNG chunk ${type}`);
      }
    }

    if (imageData.length && type !== 'IDAT') idatEnded = true;
    offset = chunkEnd;
  }

  if (!endSeen || offset !== image.length || !dimensions || (colorType === 3 && !paletteSeen)) {
    throw new TypeError('PNG is missing required image chunks');
  }
  const expectedLength = scanlineDataLength(dimensions, channels, bitDepth, interlace);
  if (expectedLength > MAX_DECODED_PNG_BYTES) throw new TypeError('PNG decoded data exceeds the 512 MiB validation limit');
  const decoded = inflateSync(Buffer.concat(imageData), { maxOutputLength: expectedLength });
  if (decoded.length !== expectedLength || !validScanlineFilters(decoded, dimensions, channels, bitDepth, interlace)) {
    throw new TypeError('PNG image data has invalid scanline structure');
  }
  return dimensions;
}

function scanlineDataLength({ width, height }, channels, bitDepth, interlace) {
  const passes = interlace === 0
    ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let length = 0;
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep);
    const passHeight = height <= yStart ? 0 : Math.ceil((height - yStart) / yStep);
    if (passWidth && passHeight) length += (Math.ceil(passWidth * channels * bitDepth / 8) + 1) * passHeight;
    if (!Number.isSafeInteger(length)) throw new TypeError('PNG decoded dimensions are too large');
  }
  return length;
}

function validScanlineFilters(decoded, { width, height }, channels, bitDepth, interlace) {
  const passes = interlace === 0
    ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  let offset = 0;
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep);
    const passHeight = height <= yStart ? 0 : Math.ceil((height - yStart) / yStep);
    if (!passWidth || !passHeight) continue;
    const rowLength = Math.ceil(passWidth * channels * bitDepth / 8) + 1;
    for (let row = 0; row < passHeight; row += 1) {
      if (decoded[offset] > 4) return false;
      offset += rowLength;
    }
  }
  return offset === decoded.length;
}

function readCrc(image, typeOffset, dataEnd) {
  let crc = 0xffffffff;
  for (let offset = typeOffset; offset < dataEnd; offset += 1) {
    crc = CRC_TABLE[(crc ^ image[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    return crc >>> 0;
  });
}

function isCriticalChunk(type) {
  return type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
}
