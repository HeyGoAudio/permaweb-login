import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CROP_PRESETS,
  MIN_ZOOM,
  MAX_ZOOM,
  TARGET_MEDIA_BYTES,
  MAX_MEDIA_BYTES,
  loadImageFromFile,
  getCropSize,
  clampCenter,
  getCropRect,
  cropAndCompress,
  formatBytes,
} from '../utils/imageCompression';
import './ImageCropper.css';

const clampZoom = (z) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
const KEY_PAN_PX = 12;

/**
 * Modal image cropper. Lets the user drag (pan) and zoom an image inside a fixed
 * aspect-ratio frame, then crops + compresses it to WebP under the byte budget.
 *
 * @param {object} props
 * @param {File} props.file - The image selected by the user
 * @param {'avatar'|'banner'} props.preset - Which frame to crop for
 * @param {(result: { blob: Blob, mimeType: string, width: number|null, height: number|null, quality: number|null, bytes: number, original?: boolean }) => void} props.onConfirm
 *   `original: true` means the user chose "Upload Only" and `blob` is the untouched source file.
 * @param {() => void} props.onCancel
 * @param {number} [props.maxBytes] - Override encoded size ceiling
 */
export default function ImageCropper({ file, preset = 'avatar', onConfirm, onCancel, maxBytes = TARGET_MEDIA_BYTES }) {
  const config = CROP_PRESETS[preset] || CROP_PRESETS.avatar;
  const { aspect, outputWidth, shape, label } = config;

  const dialogRef = useRef(null);
  const frameRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  const [source, setSource] = useState(null); // { image, url }
  const [loadError, setLoadError] = useState('');
  const [frameWidth, setFrameWidth] = useState(0);
  const [view, setView] = useState({ zoom: 1, center: { x: 0, y: 0 } });
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState('');

  const imgW = source?.image.naturalWidth || 1;
  const imgH = source?.image.naturalHeight || 1;
  const frameHeight = frameWidth / aspect;

  // Latest values for native event listeners (wheel) and pointer handlers.
  const latest = useRef({ imgW, imgH, frameWidth, view });
  useLayoutEffect(() => {
    latest.current = { imgW, imgH, frameWidth, view };
  });

  // ---- Open as a native modal dialog (top layer, focus trap, Esc handling) ----
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.open && dialog.close();
  }, []);

  // ---- Decode the image (component is keyed per file by the parent) ----
  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    loadImageFromFile(file)
      .then((loaded) => {
        objectUrl = loaded.url;
        if (cancelled) {
          URL.revokeObjectURL(loaded.url);
          return;
        }
        setSource(loaded);
        setView({
          zoom: 1,
          center: { x: loaded.image.naturalWidth / 2, y: loaded.image.naturalHeight / 2 },
        });
      })
      .catch((err) => !cancelled && setLoadError(err.message));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  // ---- Track frame size so the preview stays correct on resize ----
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- View helpers ----
  const panBy = useCallback((dxPx, dyPx) => {
    setView((prev) => {
      const { imgW: w, imgH: h, frameWidth: fw } = latest.current;
      if (!fw) return prev;
      const crop = getCropSize(w, h, aspect, prev.zoom);
      const scale = fw / crop.width; // display px per image px
      const center = clampCenter(w, h, aspect, prev.zoom, {
        x: prev.center.x - dxPx / scale,
        y: prev.center.y - dyPx / scale,
      });
      return { ...prev, center };
    });
  }, [aspect]);

  /**
   * Zoom while keeping the image point under (offsetX, offsetY) fixed.
   * Offsets are in display px relative to the frame center.
   */
  const zoomTo = useCallback((nextZoom, offsetX = 0, offsetY = 0) => {
    setView((prev) => {
      const { imgW: w, imgH: h, frameWidth: fw } = latest.current;
      const zoom = clampZoom(nextZoom);
      if (!fw || zoom === prev.zoom) return prev;
      const oldScale = fw / getCropSize(w, h, aspect, prev.zoom).width;
      const newScale = fw / getCropSize(w, h, aspect, zoom).width;
      const anchor = { x: prev.center.x + offsetX / oldScale, y: prev.center.y + offsetY / oldScale };
      const center = clampCenter(w, h, aspect, zoom, {
        x: anchor.x - offsetX / newScale,
        y: anchor.y - offsetY / newScale,
      });
      return { zoom, center };
    });
  }, [aspect]);

  const offsetFromFrameCenter = (clientX, clientY) => {
    const rect = frameRef.current.getBoundingClientRect();
    return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
  };

  // ---- Mouse wheel / trackpad zoom (needs a non-passive listener) ----
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const { x, y } = offsetFromFrameCenter(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomTo(latest.current.view.zoom * factor, x, y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  // ---- Pointer drag (mouse / touch / pen) + two-finger pinch ----
  const handlePointerDown = (e) => {
    if (!source || isProcessing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setIsDragging(true);
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: latest.current.view.zoom };
    }
  };

  const handlePointerMove = (e) => {
    const pointers = pointersRef.current;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, next);

    if (pointers.size === 1) {
      panBy(next.x - prev.x, next.y - prev.y);
    } else if (pointers.size === 2 && pinchRef.current) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = offsetFromFrameCenter((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomTo(pinchRef.current.zoom * (distance / pinchRef.current.distance), mid.x, mid.y);
    }
  };

  const handlePointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) setIsDragging(false);
  };

  // ---- Keyboard support on the frame ----
  const handleFrameKeyDown = (e) => {
    const map = {
      ArrowLeft: () => panBy(KEY_PAN_PX, 0),
      ArrowRight: () => panBy(-KEY_PAN_PX, 0),
      ArrowUp: () => panBy(0, KEY_PAN_PX),
      ArrowDown: () => panBy(0, -KEY_PAN_PX),
      '+': () => zoomTo(view.zoom * 1.1),
      '=': () => zoomTo(view.zoom * 1.1),
      '-': () => zoomTo(view.zoom / 1.1),
      '0': () => handleReset(),
    };
    if (map[e.key]) {
      e.preventDefault();
      map[e.key]();
    }
  };

  const handleReset = () => setView({ zoom: 1, center: { x: imgW / 2, y: imgH / 2 } });

  // ---- Confirm: crop + compress ----
  const handleConfirm = async () => {
    if (!source) return;
    setIsProcessing(true);
    setProcessError('');
    try {
      const result = await cropAndCompress(source.image, {
        aspect,
        outputWidth,
        zoom: view.zoom,
        center: view.center,
        maxBytes,
      });
      console.log(
        `🗜️ ${label} compressed: ${formatBytes(file.size)} → ${formatBytes(result.bytes)} ` +
        `(${result.width}×${result.height}, ${result.mimeType}, q=${result.quality})`,
      );
      onConfirm(result);
    } catch (err) {
      console.error('Image crop/compress failed:', err);
      setProcessError(err.message || 'Failed to process image.');
      setIsProcessing(false);
    }
  };

  // ---- Upload Only: bypass crop + compression, send the original bytes ----
  const handleUploadOriginal = () => {
    if (!file) return;
    console.log(`⏭️ ${label} uploading original without compression: ${formatBytes(file.size)} (${file.type})`);
    onConfirm({
      blob: file,
      mimeType: file.type,
      width: source?.image.naturalWidth ?? null,
      height: source?.image.naturalHeight ?? null,
      quality: null,
      bytes: file.size,
      original: true,
    });
  };

  // Esc / close request
  const handleCancelEvent = (e) => {
    e.preventDefault();
    if (!isProcessing) onCancel();
  };

  const originalExceedsLimit = file.size > MAX_MEDIA_BYTES;

  // ---- Derived render values ----
  const crop = source ? getCropRect(imgW, imgH, aspect, view.zoom, view.center) : null;
  const scale = crop && frameWidth ? frameWidth / crop.width : 0;
  const tx = frameWidth / 2 - view.center.x * scale;
  const ty = frameHeight / 2 - view.center.y * scale;
  const outW = crop ? Math.round(Math.min(outputWidth, crop.width)) : 0;
  const outH = Math.round(outW / aspect);

  return (
    <dialog
      ref={dialogRef}
      className="cropper-dialog"
      data-preset={preset}
      aria-labelledby="cropper-title"
      onCancel={handleCancelEvent}
    >
      <div className="cropper-header">
        <h3 id="cropper-title" className="cropper-title">
          <i className="icon-image"></i> Adjust {label}
        </h3>
        <button
          type="button"
          className="cropper-close"
          onClick={onCancel}
          disabled={isProcessing}
          aria-label="Close image editor"
        >
          ✕
        </button>
      </div>

      <div className="cropper-body">
        <div
          ref={frameRef}
          className={`cropper-frame ${isDragging ? 'is-dragging' : ''}`}
          data-shape={shape}
          style={{ '--crop-aspect': aspect }}
          tabIndex={0}
          role="application"
          aria-label={`${label} crop area. Drag or use arrow keys to move, scroll or plus/minus to zoom.`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleFrameKeyDown}
        >
          {source && scale > 0 && (
            <img
              src={source.url}
              alt=""
              draggable={false}
              className="cropper-image"
              style={{
                width: imgW,
                height: imgH,
                transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
              }}
            />
          )}

          {!source && !loadError && (
            <div className="cropper-placeholder">
              <i className="icon-spinner-double animate-spin"></i>
            </div>
          )}

          {loadError && <div className="cropper-placeholder cropper-error-text">{loadError}</div>}

          <div className="cropper-grid" aria-hidden="true"></div>
          <div className="cropper-mask" aria-hidden="true"></div>
        </div>

        <div className="cropper-controls">
          <button
            type="button"
            className="cropper-icon-btn"
            onClick={() => zoomTo(view.zoom / 1.2)}
            disabled={!source || view.zoom <= MIN_ZOOM || isProcessing}
            aria-label="Zoom out"
          >
            −
          </button>
          <input
            id={`cropper-zoom-${preset}`}
            type="range"
            className="cropper-zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={view.zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            disabled={!source || isProcessing}
            aria-label="Zoom"
            style={{ '--zoom-pct': `${((view.zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100}%` }}
          />
          <button
            type="button"
            className="cropper-icon-btn"
            onClick={() => zoomTo(view.zoom * 1.2)}
            disabled={!source || view.zoom >= MAX_ZOOM || isProcessing}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="cropper-reset"
            onClick={handleReset}
            disabled={!source || isProcessing}
          >
            Reset
          </button>
        </div>

        <div className="cropper-meta">
          {source ? (
            <>
              <span>Original {imgW}×{imgH} · {formatBytes(file.size)}</span>
              <span className="cropper-meta-arrow">→</span>
              <span>Output {outW}×{outH} WebP · ≤ {Math.round(maxBytes / 1024)} KB</span>
            </>
          ) : (
            <span>Loading image…</span>
          )}
        </div>

        {processError && <div className="cropper-error">{processError}</div>}

        {originalExceedsLimit && (
          <div className="cropper-warning">
            The original is {formatBytes(file.size)}. <strong>Upload Only</strong> skips compression and exceeds the
            free {MAX_MEDIA_BYTES / 1024} KB limit, so it may require a funded wallet.
          </div>
        )}
      </div>

      <div className="cropper-footer">
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={isProcessing}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={handleUploadOriginal}
          disabled={!file || isProcessing}
          title="Upload the original image without cropping or compression"
        >
          <i className="icon-cloud-upload"></i> Upload Only
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleConfirm}
          disabled={!source || isProcessing}
        >
          {isProcessing ? (
            <><i className="icon-spinner-double animate-spin"></i> Compressing…</>
          ) : (
            <><i className="icon-cloud-upload"></i> Crop &amp; Upload</>
          )}
        </button>
      </div>
    </dialog>
  );
}
