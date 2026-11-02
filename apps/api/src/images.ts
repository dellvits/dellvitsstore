import sharp from 'sharp';
import decodeHeic from 'heic-decode';

/** HEIC/HEIF photos (iPhones, many Android cameras): sharp's build cannot read these itself. */
const heif = (b: Buffer) =>
  /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(b.subarray(4, 12).toString('latin1'));

/** A decoder for the picture: sharp for JPEG, PNG, WebP, AVIF, GIF, TIFF and SVG, else HEIC. */
async function open(buffer: Buffer) {
  try {
    const image = sharp(buffer, { limitInputPixels: 50_000_000 });
    await image.metadata();
    return image;
  } catch (error) {
    if (!heif(buffer)) throw error;
    const { width, height, data } = await decodeHeic({ buffer });
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
      limitInputPixels: 50_000_000,
    });
  }
}

/**
 * Converts any picture a browser or phone sends into WebP. It is turned upright, made no larger
 * than `max` pixels on its longest side (never enlarged), and saved at a high quality setting so
 * it looks the same as the original.
 */
export async function toWebp(buffer: Buffer, { max = 2048 } = {}): Promise<Buffer> {
  try {
    return await (await open(buffer))
      .rotate()
      .resize(max, max, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 92, alphaQuality: 100, smartSubsample: true, effort: 5 })
      .toBuffer();
  } catch {
    throw Object.assign(new Error('This file is not a picture we can read. Try another photo.'), {
      status: 400,
    });
  }
}

/** The first frames of a file tell MP4 and WebM videos apart from anything else. */
export function videoType(b: Buffer): 'mp4' | 'webm' | null {
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return heif(b) ? null : 'mp4';
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'webm';
  return null;
}
