import type { Ctx } from './ctx';

/** Refresh read-only views when another device writes. No edits are replaced by background rendering. */
export function liveRefresh(ctx: Ctx, refresh: () => Promise<void>, failed: (e: unknown) => void): void {
  let active = true, running = false;
  const run = async () => {
    if (!active || running || document.visibilityState === 'hidden') return;
    running = true;
    try { await refresh(); } catch (e) { if (active) failed(e); }
    finally { running = false; }
  };
  const interval = setInterval(() => { void run(); }, 10_000);
  const visible = () => { void run(); };
  window.addEventListener('focus', visible);
  window.addEventListener('online', visible);
  document.addEventListener('visibilitychange', visible);
  ctx.onLeave(() => {
    active = false; clearInterval(interval);
    window.removeEventListener('focus', visible); window.removeEventListener('online', visible);
    document.removeEventListener('visibilitychange', visible);
  });
}
