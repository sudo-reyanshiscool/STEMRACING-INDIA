/** The small portrait a card and the door list carry: a JPEG 320 pixels wide, cropped to the card's photo frame. */
export const PORTRAIT_WIDTH = 320, PORTRAIT_HEIGHT = 460, PORTRAIT_MAX_BYTES = 65_536;

const base64Bytes = (b64: string) => Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img); img.onerror = () => reject(new Error('The picture could not be read.'));
    img.src = src;
  });
}

/** Null where the device cannot draw the picture; the pass then simply has no portrait until a device that can opens the page. */
export async function makePortrait(source: string | Blob, mime = 'image/jpeg'): Promise<string | null> {
  const url = typeof source === 'string' ? `data:${mime};base64,${source}` : URL.createObjectURL(source);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = PORTRAIT_WIDTH; canvas.height = PORTRAIT_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context || !img.naturalWidth || !img.naturalHeight) return null;
    // Fill the frame, keeping the top of the picture, where the face is.
    const scale = Math.max(PORTRAIT_WIDTH / img.naturalWidth, PORTRAIT_HEIGHT / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    context.fillStyle = '#2a2b31'; context.fillRect(0, 0, PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    context.drawImage(img, (PORTRAIT_WIDTH - w) / 2, (PORTRAIT_HEIGHT - h) * 0.22, w, h);
    for (const quality of [0.82, 0.72, 0.6, 0.48, 0.36, 0.25]) {
      const b64 = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
      if (b64 && base64Bytes(b64) <= PORTRAIT_MAX_BYTES) return b64;
    }
    return null;
  } catch { return null; }
  finally { if (typeof source !== 'string') URL.revokeObjectURL(url); }
}
