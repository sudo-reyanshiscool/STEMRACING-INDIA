import type { NewTeam, TeamRow } from '../api';
import { MAX_IMPORT_TEAMS } from '../api/team-input';

export const MAX_CSV_BYTES = 1024 * 1024;
export interface CsvProblem { row: number; message: string }
export interface TeamCsvPreview { teams: Required<NewTeam>[]; errors: CsvProblem[]; ignoredColumns: string[] }
interface RecordRow { row: number; cells: string[] }

/** Quoted commas, escaped quotes, CRLF and quoted line breaks are all kept as field content. */
function records(text: string): RecordRow[] {
  const out: RecordRow[] = [];
  let cells: string[] = [], value = '', quoted = false, closed = false, line = 1, start = 1;
  const field = () => { cells.push(value); value = ''; closed = false; };
  const row = () => {
    field(); if (cells.some((c) => c.trim())) out.push({ row: start, cells }); cells = []; start = line + 1;
    if (out.length > MAX_IMPORT_TEAMS + 1) throw new Error('Import at most 1000 teams at a time.');
  };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else { value += c; if (c === '\n') line++; else if (c === '\r' && text[i + 1] !== '\n') line++; }
    } else if (c === ',') field();
    else if (c === '\n' || c === '\r') {
      row(); if (c === '\r' && text[i + 1] === '\n') i++; line++;
    } else if (closed) {
      if (c !== ' ' && c !== '\t') throw new Error(`Row ${line}: unexpected text after a closing quote.`);
    } else if (c === '"') {
      if (value.trim()) throw new Error(`Row ${line}: quote inside an unquoted field. Put the whole field in quotes.`);
      value = ''; quoted = true;
    } else value += c;
  }
  if (quoted) throw new Error(`Row ${start}: a quoted field is missing its closing quote.`);
  if (value || cells.length || closed) row();
  return out;
}

const aliases: Record<string, 'number' | 'name' | 'school'> = {
  number: 'number', teamnumber: 'number', teamno: 'number', 'team#': 'number',
  name: 'name', team: 'name', teamname: 'name',
  school: 'school', schoolname: 'school', club: 'school', schoolorclub: 'school', schoolclub: 'school', institution: 'school',
};
const normalHeader = (s: string) => s.trim().toLowerCase().replace(/[\s_\-/]+/g, '');

export function parseTeamCsv(text: string, existing: readonly Pick<TeamRow, 'number'>[] = []): TeamCsvPreview {
  const result: TeamCsvPreview = { teams: [], errors: [], ignoredColumns: [] };
  const error = (row: number, message: string) => { result.errors.push({ row, message }); };
  if (text.length > MAX_CSV_BYTES) { error(0, 'Choose a CSV file smaller than 1 MB.'); return result; }
  let rows: RecordRow[];
  try { rows = records(text); } catch (e) { error(0, (e as Error).message); return result; }
  if (!rows.length) { error(0, 'The file is empty. Use the CSV template to get started.'); return result; }
  const header = rows.shift()!;
  const indexes: Partial<Record<'number' | 'name' | 'school', number>> = {};
  header.cells.forEach((cell, i) => {
    const normal = normalHeader(cell);
    const key = Object.hasOwn(aliases, normal) ? aliases[normal] : undefined;
    if (!key) { if (cell.trim()) result.ignoredColumns.push(cell.trim()); return; }
    if (indexes[key] !== undefined) error(header.row, `More than one column maps to ${key}. Keep just one.`);
    else indexes[key] = i;
  });
  if (indexes.number === undefined || indexes.name === undefined) error(header.row, 'Include number and name column headings (or Team Number and Team Name). School is optional. Use commas between columns.');
  if (result.errors.length) return result;
  const numbers = new Map(existing.map((t) => [t.number.trim().toLowerCase(), 'already exists in this event']));
  for (const { row, cells } of rows) {
    if (cells.length !== header.cells.length) { error(row, `Expected ${header.cells.length} columns but found ${cells.length}. Put values containing commas inside double quotes.`); continue; }
    const team = { number: cells[indexes.number!]!.trim(), name: cells[indexes.name!]!.trim(), school: indexes.school === undefined ? '' : cells[indexes.school].trim() };
    const before = result.errors.length;
    if (!team.number) error(row, 'Team number is required.'); else if (team.number.length > 12) error(row, 'Team number must be 12 characters or fewer.');
    if (!team.name) error(row, 'Team name is required.'); else if (team.name.length > 80) error(row, 'Team name must be 80 characters or fewer.');
    if (team.school.length > 120) error(row, 'School or club must be 120 characters or fewer.');
    const number = team.number.toLowerCase();
    if (team.number && numbers.has(number)) error(row, `Team number “${team.number}” ${numbers.get(number)}.`);
    else if (team.number) numbers.set(number, `is repeated from row ${row}`);
    if (before === result.errors.length) result.teams.push(team);
  }
  if (!rows.length) error(0, 'The file has headings but no teams.');
  return result;
}
