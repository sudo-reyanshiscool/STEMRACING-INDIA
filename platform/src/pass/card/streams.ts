/**
 * Flat flag colours for the stream band, in stream order (A, B, C…). They are chosen to be told apart across a room.
 * The stream's name is always written on the band as well, so nobody has to rely on colour alone.
 */
const PALETTE: ReadonlyArray<{ fill: string; ink: string }> = [
  { fill: '#2F6FDE', ink: '#FFFFFF' },   // blue
  { fill: '#F2C230', ink: '#0B0B0D' },   // yellow
  { fill: '#D8432F', ink: '#FFFFFF' },   // red
  { fill: '#2E9E5B', ink: '#FFFFFF' },   // green
  { fill: '#F2F2F4', ink: '#0B0B0D' },   // white
  { fill: '#F08A24', ink: '#0B0B0D' },   // orange
  { fill: '#1FA6A0', ink: '#0B0B0D' },   // teal
  { fill: '#8A8D96', ink: '#0B0B0D' },   // grey
];
const UNKNOWN = { fill: '#4A4C55', ink: '#FFFFFF' };

export function streamColour(index: number | null | undefined): { fill: string; ink: string } {
  if (index === null || index === undefined || !Number.isInteger(index) || index < 0) return UNKNOWN;
  return PALETTE[index % PALETTE.length];
}

/** The sync pulse: six shapes and six colours. Which pair shows is decided by the event's key and the clock. */
export const PULSE_COLOURS: readonly string[] = ['#FFFFFF', '#F2C230', '#4C8DF0', '#E5533D', '#3DBE7B', '#F08A24'];
export const PULSE_COLOUR_NAMES: readonly string[] = ['white', 'yellow', 'blue', 'red', 'green', 'orange'];
export const PULSE_GLYPH_NAMES: readonly string[] = ['chevron', 'diamond', 'ring', 'triangle', 'blocks', 'bar'];
const GLYPHS: readonly string[] = [
  '<path d="M4 20 16 6l12 14h-7l-5-6-5 6z"/>',
  '<path d="M16 3 29 16 16 29 3 16z"/>',
  '<circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="5"/>',
  '<path d="M16 4 29 27H3z"/>',
  '<path d="M5 5h9v9H5zM18 18h9v9h-9zM18 5h9v9h-9z"/>',
  '<path d="M3 12h26v8H3z"/>',
];

/** The pulse mark as an inline SVG. The shapes are fixed strings from this file, never anything a person typed. */
export function pulseMark(glyph: number, colour: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Sync pulse: ${PULSE_COLOUR_NAMES[colour % 6]} ${PULSE_GLYPH_NAMES[glyph % 6]}`);
  svg.style.color = PULSE_COLOURS[colour % 6];
  svg.innerHTML = GLYPHS[glyph % 6];
  return svg;
}
