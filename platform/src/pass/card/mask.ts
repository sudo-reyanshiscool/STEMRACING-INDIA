/**
 * The picture the shader cuts its foil from, drawn once per card:
 *   red   = the team number
 *   green = the holder's ghost portrait inside the hologram patch (the team number when there is no portrait)
 *   blue  = the STEM Racing track shape: filled inside the hologram patch, and as a large outline across the card
 */
export const MASK_W = 640, MASK_H = 1024;
/** The hologram patch: centre as a share of the card's width and height, radius as a share of its height. */
export const PATCH = { x: 0.73, y: 0.415, r: 0.085 } as const;
/** The brand track shape, from public/brand/track-shape-pink.svg (viewBox 801 by 878). */
export const TRACK_PATH = 'M782.36,318.68c33.88-96.9,22.07-193.22-31.18-256.78-50.09-59.79-125.1-76.01-200.82-49.76l-216.73,75.14-105.27,36.5-33.23,11.52-110.93,38.46C44.11,187.67,12.03,246.08,3.24,314.64c-5.85,45.69-1.18,91.36,13.03,127.06,14.65,36.8,37.91,59.23,64.84,60.71l37.42,2.07v-.05s23.75,1.31,23.75,1.31c9.14.5,14.46,9.46,16.83,14.79,2.37,5.35,5.97,16.55,3.28,31.01-2.83,15.21-11.63,24.83-21.25,23.54L0,556.09l104.47,140.13,34.52,9.83c48,13.68,96.15-28.4,113.11-106.83,12.17-56.28,5.53-117.6-17.82-165.17-22.45-45.74-55.68-69.09-89.73-65.65l-63.09,6.39c-7.34.18-11.61-6.99-13.52-11.39-1.97-4.55-4.97-14.22-2.93-28.14,2.18-14.9,9.5-26.44,17.93-27.99l89.5-16.45h0s35.59-6.54,35.59-6.54h0l329.58-60.57c19.74-3.63,30.82,7.53,35.68,14.56,4.88,7.09,12.13,22.61,5.37,46.02-7.09,24.52-26.78,42.94-47.41,45.03l-174.48,17.66c-31.17,3.16-58.52,30.19-70.8,68.07-11.92,36.77-7.85,78.36,10.53,107.58l184.93,280.97,261.12,74.39-267.6-353.84,44.41,2.45c103.57,5.72,216.89-76.08,263-207.95Z';
const TRACK_W = 801.43, TRACK_H = 878.01;
const FONT = 'italic 700 150px Magistral, "Arial Narrow", Arial, sans-serif';

/** Null where a canvas cannot be drawn on (an old browser, or a test), in which case the card uses its plain version. */
export function drawMask(number: string, portrait: CanvasImageSource | null): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = MASK_W; canvas.height = MASK_H;
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d', { willReadFrequently: true }); } catch { ctx = null; }
  if (!ctx || typeof Path2D === 'undefined') return null;
  const track = new Path2D(TRACK_PATH), cx = MASK_W * PATCH.x, cy = MASK_H * PATCH.y, r = MASK_H * PATCH.r;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, MASK_W, MASK_H);
  ctx.globalCompositeOperation = 'lighter';

  // The team number, shrunk to fit beside the portrait however long it is.
  ctx.font = FONT; ctx.textAlign = 'right'; ctx.fillStyle = '#f00';
  const room = MASK_W * 0.46, wide = ctx.measureText(number).width || 1, scale = Math.min(1, room / wide);
  ctx.save(); ctx.translate(MASK_W * 0.945, MASK_H * 0.30); ctx.scale(scale, scale); ctx.fillText(number, 0, 0); ctx.restore();

  // The track shape as a large outline, running off the right-hand edge behind the lower half of the card.
  ctx.save(); ctx.translate(MASK_W * 0.45, MASK_H * 0.465); ctx.scale(0.5, 0.5); ctx.strokeStyle = '#00f'; ctx.lineWidth = 6; ctx.lineJoin = 'round'; ctx.stroke(track); ctx.restore();

  // Inside the hologram patch: the track shape (blue) and the ghost portrait (green).
  const fit = (1.8 * r) / Math.hypot(TRACK_W, TRACK_H);
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx - (TRACK_W * fit) / 2, cy - (TRACK_H * fit) / 2); ctx.scale(fit, fit); ctx.fillStyle = '#00f'; ctx.fill(track); ctx.restore();
  if (portrait) ghost(ctx, portrait, cx, cy, r);
  else {
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.font = FONT; ctx.textAlign = 'center'; ctx.fillStyle = '#0f0';
    const s = Math.min((1.5 * r) / wide, 0.6); ctx.translate(cx, cy + 50 * s); ctx.scale(s, s); ctx.fillText(number, 0, 0); ctx.restore();
  }
  return canvas;
}

/** The portrait as brightness only, written into the green channel inside the patch. */
function ghost(ctx: CanvasRenderingContext2D, portrait: CanvasImageSource, cx: number, cy: number, r: number): void {
  const size = Math.ceil(r * 2), tmp = document.createElement('canvas');
  tmp.width = size; tmp.height = size;
  const t = tmp.getContext('2d', { willReadFrequently: true });
  if (!t) return;
  const w = (portrait as HTMLImageElement).naturalWidth || (portrait as HTMLCanvasElement).width || size, h = (portrait as HTMLImageElement).naturalHeight || (portrait as HTMLCanvasElement).height || size;
  // Cover the circle, keeping the face (upper middle of a portrait) in view.
  const k = Math.max(size / w, size / h);
  try {
    t.drawImage(portrait, (size - w * k) / 2, Math.min(0, (size - h * k) * 0.25), w * k, h * k);
    const src = t.getImageData(0, 0, size, size), x0 = Math.round(cx - r), y0 = Math.round(cy - r), dst = ctx.getImageData(x0, y0, size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (Math.hypot(x - r, y - r) > r) continue;
      const i = (y * size + x) * 4, luma = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];
      dst.data[i + 1] = Math.max(0, Math.min(255, (luma - 128) * 1.25 + 128));
    }
    ctx.putImageData(dst, x0, y0);
  } catch { /* a picture the canvas may not read: the patch keeps its track shape */ }
}
