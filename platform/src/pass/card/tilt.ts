/**
 * Where the card is tilted to, from -1 to 1 on each axis.
 * On a phone it follows the phone itself. Without that, it follows a finger or the pointer, and when nothing is
 * moving it drifts very slowly so the foil is never dead (unless the person has asked for reduced motion).
 */
export interface Tilt {
  readonly x: number;
  readonly y: number;
  /** Moves towards the target. Returns true when the tilt changed enough to be worth drawing again. */
  step(seconds: number): boolean;
  /**
   * Call from a completed tap (a click), not from the finger landing: an iPhone only puts the question when asked
   * from inside a tap, and does not count the moment of touching down as one.
   */
  arm(): void;
  destroy(): void;
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
type OrientationCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };

export function createTilt(target: HTMLElement, options: { reduce: boolean }): Tilt {
  let x = 0, y = 0, px = 0, py = 0, pointerAt = -99, gx = 0, gy = 0, gyro = false, beta0: number | null = null, gamma0 = 0, listening = false, asked = false, asking = false, last = 0;

  const onPointer = (e: PointerEvent) => {
    const r = target.getBoundingClientRect();
    if (!r.width || !r.height) return;
    px = clamp(((e.clientX - r.left) / r.width - 0.5) * 2.2);
    py = clamp(((e.clientY - r.top) / r.height - 0.5) * 2.2);
    pointerAt = last;
  };
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    // However the phone is being held becomes "flat": the resting angle follows slowly, quick moves show as tilt.
    if (beta0 === null) { beta0 = e.beta; gamma0 = e.gamma; }
    beta0 += (e.beta - beta0) * 0.012; gamma0 += (e.gamma - gamma0) * 0.012;
    gx = clamp((e.gamma - gamma0) / 18); gy = clamp((e.beta - beta0) / 18); gyro = true;
  };
  const listen = () => { if (listening) return; listening = true; window.addEventListener('deviceorientation', onOrientation); };
  const Orientation = (globalThis as { DeviceOrientationEvent?: OrientationCtor }).DeviceOrientationEvent;
  if (Orientation && typeof Orientation.requestPermission !== 'function') listen();
  target.addEventListener('pointermove', onPointer);
  target.addEventListener('pointerdown', onPointer);

  return {
    get x() { return x; },
    get y() { return y; },
    step(seconds) {
      last = seconds;
      let tx = 0, ty = 0;
      if (seconds - pointerAt < 2.5) { tx = px; ty = py; }
      else if (gyro) { tx = gx; ty = gy; }
      else if (!options.reduce) { tx = Math.sin(seconds * 0.34) * 0.3; ty = Math.cos(seconds * 0.25) * 0.16; }
      const dx = (tx - x) * 0.09, dy = (ty - y) * 0.09;
      x += dx; y += dy;
      return Math.abs(dx) + Math.abs(dy) > 0.0015;
    },
    arm() {
      if (asked || asking || listening || !Orientation || typeof Orientation.requestPermission !== 'function') return;
      asking = true;
      // Only a real answer settles it. If the phone would not put the question this time, the next tap tries again.
      Orientation.requestPermission().then((answer) => { asked = true; if (answer === 'granted') listen(); })
        .catch(() => { /* not asked: touch still tilts the card meanwhile */ })
        .finally(() => { asking = false; });
    },
    destroy() {
      window.removeEventListener('deviceorientation', onOrientation);
      target.removeEventListener('pointermove', onPointer);
      target.removeEventListener('pointerdown', onPointer);
    },
  };
}
