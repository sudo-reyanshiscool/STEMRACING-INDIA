import type { Measurements } from '../engine';

export interface EventRec { id: string; name: string; date: string; venue: string; rulesetId: string; createdAt: number }
export interface Team { id: string; eventId: string; number: string; name: string; school: string; createdAt: number }
export interface Car { id: string; teamId: string; label: 'A' | 'B' }
export interface Inspection {
  carId: string;
  scrutineer: string;
  startedAt: number;
  updatedAt: number;
  measurements: Measurements;
  notes: Record<string, string>;
}

export class StoreError extends Error {
  constructor(public code: 'duplicate-team-number' | 'invalid-input' | 'invalid-backup' | 'not-found', message: string) {
    super(message);
    this.name = 'StoreError';
  }
}
