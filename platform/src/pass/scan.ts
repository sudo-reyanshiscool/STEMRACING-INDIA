/** Reads QR codes from the camera: the browser's own detector where there is one, a bundled decoder where there is not. */
export interface Scanner { stop(): void }
type Detector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> };

/** A plain sentence for why the camera did not start. */
export function cameraFault(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera is blocked for this site. Allow it in your browser’s settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
  return 'The camera could not be started on this device.';
}

export async function startScanner(video: HTMLVideoElement, onCode: (text: string) => void): Promise<Scanner> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  let running = true, timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { running = false; clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  try {
    video.srcObject = stream; video.muted = true; video.setAttribute('playsinline', '');
    await video.play();
    let detector: Detector | null = null;
    const Native = (globalThis as { BarcodeDetector?: { new (init: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
    if (Native) { try { if (!Native.getSupportedFormats || (await Native.getSupportedFormats()).includes('qr_code')) detector = new Native({ formats: ['qr_code'] }); } catch { detector = null; } }
    const decode = detector ? null : (await import('jsqr')).default;
    const canvas = document.createElement('canvas'), context = decode ? canvas.getContext('2d', { willReadFrequently: true }) : null;
    const tick = async () => {
      if (!running) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          if (detector) { const found = await detector.detect(video); if (found[0]?.rawValue) onCode(found[0].rawValue); }
          else if (decode && context) {
            // A frame around 640 pixels wide is plenty for a code held up to the camera, and keeps older phones responsive.
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const found = decode(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
            if (found?.data) onCode(found.data);
          }
        }
      } catch { /* a bad frame: try the next */ }
      if (running) timer = setTimeout(() => void tick(), detector ? 120 : 180);
    };
    void tick();
  } catch (e) { stop(); throw e; }
  return { stop };
}
