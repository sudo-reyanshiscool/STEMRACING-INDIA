import { ApiError, validateReview, type Api, type CardReview } from '../api';
import type { Area } from '../engine';

/** A per-user, per-card draft. Writes are serialised so a slow earlier save cannot replace a newer edit. */
export class ReviewDraft {
  value: CardReview;
  pending = false;
  saving = false;
  storageFailed = false;
  error: unknown = null;
  private revision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<boolean>;
  private disposed = false;
  private key: string;

  constructor(private api: Api, private userId: string, private cardId: string, reopened: number,
    value: CardReview, private area: Area, private demo: boolean, private changed: () => void, editable: boolean) {
    this.value = structuredClone(value);
    this.key = `stem-review:${userId}:${cardId}:${reopened}`;
    if (editable && !demo) {
      try {
        const raw = localStorage.getItem(this.key);
        if (raw) { this.value = validateReview(JSON.parse(raw), area); this.pending = true; this.revision++; }
      } catch { this.storageFailed = true; }
    }
  }

  edit(update: (value: CardReview) => void) {
    if (this.disposed) return;
    update(this.value);
    validateReview(this.value, this.area);
    this.pending = true;
    this.error = null;
    this.revision++;
    if (!this.demo) {
      try { localStorage.setItem(this.key, JSON.stringify(this.value)); this.storageFailed = false; }
      catch { this.storageFailed = true; }
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 600);
    this.changed();
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.flight) return this.flight;
    this.flight = this.send().finally(() => { this.flight = undefined; });
    return this.flight;
  }

  private async send(): Promise<boolean> {
    this.saving = true;
    this.changed();
    try {
      while (this.pending && !this.disposed) {
        const revision = this.revision;
        const value = structuredClone(this.value);
        const session = await this.api.getSession();
        if (session?.userId !== this.userId) throw new ApiError('unauthenticated', 'Sign in as the judge who wrote this feedback');
        await this.api.saveReview(this.cardId, value);
        if (revision === this.revision) {
          this.pending = false;
          if (!this.demo) {
            try { localStorage.removeItem(this.key); this.storageFailed = false; }
            catch { this.storageFailed = true; }
          }
        }
      }
      this.error = null;
      return !this.pending;
    } catch (e) {
      this.error = e;
      return false;
    } finally {
      this.saving = false;
      this.changed();
    }
  }

  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
