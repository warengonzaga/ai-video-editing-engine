const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Read the dimensions from a PNG buffer's IHDR header. */
export function pngDimensions(image, label) {
  if (!Buffer.isBuffer(image) || image.length < 24
      || !image.subarray(0, 8).equals(PNG_SIGNATURE)
      || image.toString('ascii', 12, 16) !== 'IHDR') {
    throw new TypeError(`Sprite ${label} must be a valid PNG image.`);
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width === 0 || height === 0) throw new TypeError(`Sprite ${label} has invalid dimensions.`);
  return { width, height };
}
