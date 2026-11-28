import qrcode from 'qrcode-generator';

/** Draws the text as a QR code filling the canvas. Dark on white, with no smoothing, so a phone camera reads it off a screen. */
export function drawQr(canvas: HTMLCanvasElement, text: string): void {
  canvas.dataset.code = text;
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return;
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, cell = Math.max(1, Math.floor(canvas.width / (n + quiet * 2))), offset = Math.floor((canvas.width - cell * n) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
}

/** A link as a QR code, for the manager's "Send to phone". Links have lower-case letters, so this uses byte mode. */
export function drawLinkQr(canvas: HTMLCanvasElement, link: string): void {
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return;
  const qr = qrcode(0, 'L');
  qr.addData(link);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2, cell = Math.max(1, Math.floor(canvas.width / (n + quiet * 2))), offset = Math.floor((canvas.width - cell * n) / 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
}
