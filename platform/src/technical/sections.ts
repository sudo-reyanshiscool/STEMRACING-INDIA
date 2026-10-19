import type { SectionId } from './types';

/** Bench order, as a scrutineering bay works. */
export const SECTIONS: { id: SectionId; title: string }[] = [
  { id: 'registration', title: 'Registration and identity' },
  { id: 'scales', title: 'Scales and gauges' },
  { id: 'chamber', title: 'Chamber and cartridge' },
  { id: 'tethers', title: 'Tether guides' },
  { id: 'wheels', title: 'Wheels' },
  { id: 'nose', title: 'Nose and front wing' },
  { id: 'rear', title: 'Rear wing' },
  { id: 'halo', title: 'Halo, helmet and virtual cargo' },
  { id: 'drawings', title: 'Engineering drawings' },
];
