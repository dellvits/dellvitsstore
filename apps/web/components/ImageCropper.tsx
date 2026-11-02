'use client';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Crop, LoaderCircle, RotateCcw, RotateCw, X } from 'lucide-react';

/**
 * Every picture uploaded on the site goes through here first: any format the browser can open
 * (and HEIC photos, which the server converts for the preview) can be cropped and turned, and
 * is then sent at full quality. The server stores it as WebP.
 */

type Rect = { x: number; y: number; w: number; h: number };
type Options = {
  /** Width divided by height to start with, such as 1 for square; left out, the crop is free. */
  aspect?: number;
  title?: string;
};
const ratios: { label: string; value: number | undefined }[] = [
  { label: 'Free', value: undefined },
  { label: 'Square', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
];
/** The largest side of the picture that is sent; the server never enlarges it. */
const MAX_SIDE = 4096;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('empty')));
    img.onerror = () => reject(new Error('unreadable'));
    img.src = src;
  });
}

/** Opens the file in the browser, or asks the server for a WebP copy when the browser cannot. */
async function openFile(file: File): Promise<string> {
  const local = URL.createObjectURL(file);
  try {
    await loadImage(local);
    return local;
  } catch {
    URL.revokeObjectURL(local);
  }
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/uploads/preview', { method: 'POST', body: form, credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'This file is not a picture we can read. Try another photo.');
  }
  return URL.createObjectURL(await res.blob());
}

/** A crop of the given shape, as large as fits, in the middle of the picture. */
function centred(aspect: number | undefined, width: number, height: number): Rect {
  if (!aspect) return { x: 0, y: 0, w: 1, h: 1 };
  const pictureAspect = width / height;
  return aspect > pictureAspect
    ? { x: 0, w: 1, h: pictureAspect / aspect, y: (1 - pictureAspect / aspect) / 2 }
    : { y: 0, h: 1, w: aspect / pictureAspect, x: (1 - aspect / pictureAspect) / 2 };
}

/** Draws the cropped part at full resolution and encodes it without visible loss. */
async function render(img: HTMLImageElement, r: Rect, name: string): Promise<File> {
  const sw = Math.round(r.w * img.naturalWidth);
  const sh = Math.round(r.h * img.naturalHeight);
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x * img.naturalWidth, r.y * img.naturalHeight, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // WebP at top quality where the browser can write it; otherwise lossless PNG, or a fine JPEG if that is too big.
  let out = await blob('image/webp', 0.97);
  if (!out || out.type !== 'image/webp') out = await blob('image/png');
  if (!out || out.size > 14 * 1024 * 1024) out = await blob('image/jpeg', 0.95);
  if (!out) throw new Error('The picture could not be prepared. Try another photo.');
  const ext = out.type.split('/')[1].replace('jpeg', 'jpg');
  return new File([out], (name.replace(/\.[^.]+$/, '') || 'picture') + '.' + ext, { type: out.type });
}

/** Turns the picture a quarter turn and answers the new picture's address. */
async function turn(img: HTMLImageElement, clockwise: boolean): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalHeight;
  canvas.height = img.naturalWidth;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(((clockwise ? 90 : -90) * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return URL.createObjectURL(blob!);
}

type Drag = { mode: string; startX: number; startY: number; start: Rect; box: DOMRect };

function Cropper({
  file,
  options,
  onDone,
}: {
  file: File;
  options: Options;
  onDone: (result: File | null, error?: Error) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState('');
  const [aspect, setAspect] = useState<number | undefined>(options.aspect);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    dialog.current?.showModal();
    let alive = true;
    openFile(file).then(
      (url) => alive && setSrc(url),
      (e) => onDone(null, e),
    );
    return () => {
      alive = false;
    };
  }, [file, onDone]);
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  const img = picture.current;
  const ready = () => {
    const i = picture.current;
    if (i) setRect(centred(aspect, i.naturalWidth, i.naturalHeight));
  };
  const chooseAspect = (value: number | undefined) => {
    setAspect(value);
    if (img) setRect(centred(value, img.naturalWidth, img.naturalHeight));
  };
  function start(mode: string, e: ReactPointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const box = picture.current!.getBoundingClientRect();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: rect, box };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d || !img) return;
    const dx = (e.clientX - d.startX) / d.box.width;
    const dy = (e.clientY - d.startY) / d.box.height;
    const s = d.start;
    const min = 0.04;
    if (d.mode === 'move') {
      setRect({ ...s, x: Math.min(1 - s.w, Math.max(0, s.x + dx)), y: Math.min(1 - s.h, Math.max(0, s.y + dy)) });
      return;
    }
    let { x, y, w, h } = s;
    if (d.mode.includes('w')) {
      x = Math.min(s.x + s.w - min, Math.max(0, s.x + dx));
      w = s.x + s.w - x;
    }
    if (d.mode.includes('e')) w = Math.min(1 - s.x, Math.max(min, s.w + dx));
    if (d.mode.includes('n')) {
      y = Math.min(s.y + s.h - min, Math.max(0, s.y + dy));
      h = s.y + s.h - y;
    }
    if (d.mode.includes('s')) h = Math.min(1 - s.y, Math.max(min, s.h + dy));
    if (aspect) {
      // Keep the shape: the height follows the width, within the picture.
      const k = aspect * (img.naturalHeight / img.naturalWidth);
      h = w / k;
      if (d.mode.includes('n')) y = s.y + s.h - h;
      if (y < 0 || y + h > 1) {
        h = d.mode.includes('n') ? s.y + s.h : 1 - y;
        w = h * k;
        if (d.mode.includes('n')) y = s.y + s.h - h;
        if (d.mode.includes('w')) x = s.x + s.w - w;
      }
    }
    setRect({ x, y, w, h });
  }
  async function rotate(clockwise: boolean) {
    if (!img) return;
    setSrc(await turn(img, clockwise));
  }
  async function finish(whole: boolean) {
    if (!img) return;
    setBusy(true);
    setError('');
    try {
      onDone(await render(img, whole ? { x: 0, y: 0, w: 1, h: 1 } : rect, file.name));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const pct = (v: number) => v * 100 + '%';
  const size =
    img && `${Math.round(rect.w * img.naturalWidth)} × ${Math.round(rect.h * img.naturalHeight)} px`;
  return (
    <dialog
      ref={dialog}
      className="modal modal-lg cropper-modal"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onDone(null);
      }}
    >
      <div className="modal-inner">
        <header className="modal-head">
          <h2>{options.title || 'Crop your picture'}</h2>
          <button className="icon-button" onClick={() => onDone(null)} aria-label="Close" disabled={busy}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body cropper-body">
          {!src ? (
            <div className="cropper-loading">
              <LoaderCircle className="spin" size={22} /> Opening picture…
            </div>
          ) : (
            <div className="cropper-stage" onPointerMove={move} onPointerUp={() => (drag.current = null)}>
              <div className="cropper-frame">
                <img ref={picture} src={src} alt="Picture to crop" onLoad={ready} draggable={false} />
                <div
                  className="crop-box"
                  style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
                  onPointerDown={(e) => start('move', e)}
                >
                  {['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map((h) => (
                    <span key={h} className={'crop-handle ' + h} onPointerDown={(e) => start(h, e)} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="cropper-tools">
            <div className="chip-list" role="group" aria-label="Shape">
              {ratios.map((r) => (
                <button
                  type="button"
                  key={r.label}
                  className={'ratio-chip' + (aspect === r.value ? ' active' : '')}
                  onClick={() => chooseAspect(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="cropper-turn">
              <button type="button" className="icon-action" onClick={() => rotate(false)} aria-label="Turn left" title="Turn left">
                <RotateCcw size={16} />
              </button>
              <button type="button" className="icon-action" onClick={() => rotate(true)} aria-label="Turn right" title="Turn right">
                <RotateCw size={16} />
              </button>
              {size && <small className="muted">{size}</small>}
            </div>
          </div>
          {error && <div className="alert error">{error}</div>}
        </div>
        <footer className="form-foot">
          <button type="button" className="button ghost" onClick={() => finish(true)} disabled={!src || busy}>
            Use whole picture
          </button>
          <button type="button" className="button" onClick={() => finish(false)} disabled={!src || busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Crop size={16} />} Crop & upload
          </button>
        </footer>
      </div>
    </dialog>
  );
}

/**
 * Shows the cropper for a picture the visitor chose and answers the picture to upload, or null
 * when they closed it. Throws when the file is not a picture.
 */
export function prepareImage(file: File, options: Options = {}): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (result: File | null, error?: Error) => {
      root.unmount();
      host.remove();
      if (error) reject(error);
      else resolve(result);
    };
    root.render(<Cropper file={file} options={options} onDone={done} />);
  });
}

/** Prepares several pictures one after another; closed ones are skipped. */
export async function prepareImages(files: File[], options: Options = {}) {
  const out: File[] = [];
  for (const [i, f] of files.entries()) {
    const ready = await prepareImage(f, {
      ...options,
      title: files.length > 1 ? `Crop picture ${i + 1} of ${files.length}` : options.title,
    });
    if (ready) out.push(ready);
  }
  return out;
}

/** What the file pickers accept: every kind of picture, including iPhone photos. */
export const IMAGE_ACCEPT = 'image/*,.heic,.heif,.avif,.tif,.tiff,.bmp';
