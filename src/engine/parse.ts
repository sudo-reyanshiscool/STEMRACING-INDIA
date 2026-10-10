/**
 * Parse text typed into a measurement field.
 * Returns undefined for blank input and NaN for anything that is not a plain decimal number.
 */
export function parseMeasurement(text: string, opts: { allowNegative?: boolean } = {}): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const normalised = t.replace(',', '.');
  const pattern = opts.allowNegative ? /^[+-]?(\d+(\.\d*)?|\.\d+)$/ : /^\+?(\d+(\.\d*)?|\.\d+)$/;
  if (!pattern.test(normalised)) return NaN;
  const n = Number(normalised);
  return Number.isFinite(n) ? n : NaN;
}
