/**
 * Image crop + compression utilities for profile media (avatar / banner).
 *
 * Pipeline:
 *   1. Load the user's file into an <img> (EXIF orientation is honoured by the browser).
 *   2. Compute a crop rectangle (in natural image pixels) from aspect ratio, zoom and focal center.
 *   3. Draw that rectangle onto a canvas at the target output size (never upscaling).
 *   4. Encode to WebP, binary-searching the quality so the blob fits under the byte budget.
 *      If even the minimum quality is too large, downscale the canvas and retry.
 */

/** Hard ceiling for a free ANS-104 upload (100 KiB). */
export const MAX_MEDIA_BYTES = 100 * 1024;

/**
 * Target size for the encoded image itself. The ANS-104 envelope (signature, owner,
 * tags, headers) adds ~1.2 KB, so we leave ~2 KB of headroom under MAX_MEDIA_BYTES.
 */
export const TARGET_MEDIA_BYTES = 98 * 1024;

/** Largest source file we will attempt to decode (protects memory on mobile). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/**
 * Crop presets matching how the images are displayed in the profile card.
 * - avatar: 1:1, displayed as a circle (object-fit: cover)
 * - banner: 3:1, displayed full-width at ~200px tall (background-size: cover)
 */
export const CROP_PRESETS = {
  avatar: { aspect: 1, outputWidth: 400, shape: 'circle', label: 'Avatar' },
  banner: { aspect: 3, outputWidth: 1500, shape: 'rect', label: 'Banner' },
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

/**
 * Decodes an image File/Blob into an HTMLImageElement.
 * Caller is responsible for calling URL.revokeObjectURL(url) when done.
 *
 * @param {File|Blob} file
 * @returns {Promise<{ image: HTMLImageElement, url: string }>}
 */
export async function loadImageFromFile(file) {
  if (!file) throw new Error('No image file provided.');
  if (!file.type.startsWith('image/')) throw new Error('Selected file is not an image.');
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`Image is too large to process (max ${MAX_SOURCE_BYTES / 1024 / 1024} MB).`);
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;

  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Unable to read this image. Try a PNG, JPEG or WebP file.');
  }

  if (!image.naturalWidth || !image.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error('Image has no readable dimensions.');
  }

  return { image, url };
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Size of the crop window (in natural image pixels) at a given zoom.
 * At zoom 1 the window is the largest rectangle of `aspect` that fits inside the image
 * (i.e. the "cover" crop). Higher zoom shrinks the window.
 */
export function getCropSize(imgW, imgH, aspect, zoom) {
  let w;
  let h;
  if (imgW / imgH > aspect) {
    h = imgH;
    w = imgH * aspect;
  } else {
    w = imgW;
    h = imgW / aspect;
  }
  return { width: w / zoom, height: h / zoom };
}

/**
 * Clamps a focal center so the crop window never leaves the image bounds.
 */
export function clampCenter(imgW, imgH, aspect, zoom, center) {
  const { width, height } = getCropSize(imgW, imgH, aspect, zoom);
  return {
    x: clamp(center.x, width / 2, imgW - width / 2),
    y: clamp(center.y, height / 2, imgH - height / 2),
  };
}

/**
 * Returns the crop rectangle in natural image pixels.
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function getCropRect(imgW, imgH, aspect, zoom, center) {
  const { width, height } = getCropSize(imgW, imgH, aspect, zoom);
  const c = clampCenter(imgW, imgH, aspect, zoom, center);
  return { x: c.x - width / 2, y: c.y - height / 2, width, height };
}

/**
 * Draws the crop rectangle onto a new canvas at the requested width,
 * never upscaling beyond the source crop's real resolution.
 */
export function renderCropToCanvas(image, cropRect, aspect, maxOutputWidth) {
  const outW = Math.max(1, Math.round(Math.min(maxOutputWidth, cropRect.width)));
  const outH = Math.max(1, Math.round(outW / aspect));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    image,
    cropRect.x, cropRect.y, cropRect.width, cropRect.height,
    0, 0, outW, outH,
  );
  return canvas;
}

let webpEncodeSupported = null;

/**
 * Some browsers (older Safari) silently fall back to PNG when asked for WebP.
 */
export function supportsWebPEncoding() {
  if (webpEncodeSupported === null) {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    webpEncodeSupported = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpEncodeSupported;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image encoding failed.'))),
      type,
      quality,
    );
  });
}

function downscaleCanvas(source, factor) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * factor));
  canvas.height = Math.max(1, Math.round(source.height * factor));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Encodes a canvas to WebP (JPEG fallback) at the highest quality that fits `maxBytes`.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [opts]
 * @returns {Promise<{ blob: Blob, mimeType: string, width: number, height: number, quality: number, bytes: number }>}
 */
export async function compressCanvas(canvas, {
  maxBytes = TARGET_MEDIA_BYTES,
  minQuality = 0.4,
  maxQuality = 0.92,
  searchSteps = 6,
  maxDownscales = 6,
  scaleStep = 0.85,
} = {}) {
  const mimeType = supportsWebPEncoding() ? 'image/webp' : 'image/jpeg';
  let current = canvas;

  for (let pass = 0; pass <= maxDownscales; pass++) {
    // Fast path: highest quality already fits.
    const top = await canvasToBlob(current, mimeType, maxQuality);
    if (top.size <= maxBytes) {
      return result(top, current, maxQuality);
    }

    // If even the lowest acceptable quality is too large, shrink and retry.
    const floor = await canvasToBlob(current, mimeType, minQuality);
    if (floor.size > maxBytes) {
      current = downscaleCanvas(current, scaleStep);
      continue;
    }

    // Binary search for the highest quality that still fits.
    let lo = minQuality;
    let hi = maxQuality;
    let best = floor;
    let bestQ = minQuality;
    for (let i = 0; i < searchSteps; i++) {
      const mid = (lo + hi) / 2;
      const blob = await canvasToBlob(current, mimeType, mid);
      if (blob.size <= maxBytes) {
        best = blob;
        bestQ = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return result(best, current, bestQ);
  }

  throw new Error(`Unable to compress image below ${Math.round(maxBytes / 1024)} KB.`);

  function result(blob, c, quality) {
    return {
      blob,
      mimeType,
      width: c.width,
      height: c.height,
      quality: Math.round(quality * 100) / 100,
      bytes: blob.size,
    };
  }
}

/**
 * Convenience: crop + compress in one call.
 */
export async function cropAndCompress(image, { aspect, outputWidth, zoom, center, maxBytes = TARGET_MEDIA_BYTES }) {
  const rect = getCropRect(image.naturalWidth, image.naturalHeight, aspect, zoom, center);
  const canvas = renderCropToCanvas(image, rect, aspect, outputWidth);
  return compressCanvas(canvas, { maxBytes });
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
