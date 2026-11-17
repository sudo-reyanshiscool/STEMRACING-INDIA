import type { Inspection } from '../technical';
import { heatsExport } from '../racing/heats-export';
import { carsExport } from './cars-export';
import { awardsExport, nominationsExport, resultsExport } from './results-export';
import type { Api, EventRow, TeamRow } from './types';

/** One file for the graphics control page: the same JSON as the matching download. */
export interface GraphicsFile { name: string; text: string; /** The content without its timestamp, so an unchanged record is not sent again. */ fingerprint: string }

type FeedApi = Pick<Api, 'listTeams' | 'listRaces' | 'listInspections' | 'listNominations' | 'resultMailState' | 'latestSnapshot'>;

const file = (name: string, data: unknown): GraphicsFile => ({
  name: `${name}.json`,
  text: JSON.stringify(data),
  fingerprint: JSON.stringify(data, (key, value) => (key === 'generatedAt' ? undefined : value)),
});

/**
 * Everything the graphics need, read fresh: teams and race order with results, car sizes, nominations, award winners and
 * the standings. A record that does not exist yet is left out. A read this account may not make is left out too and
 * named in `skipped`, so one refusal never empties the screens.
 */
export async function graphicsFiles(api: FeedApi, event: EventRow): Promise<{ files: GraphicsFile[]; teams: TeamRow[]; skipped: string[] }> {
  const id = event.id, skipped: string[] = [];
  const teams = await api.listTeams(id);
  const attempt = async <T>(label: string, read: () => Promise<T>): Promise<T | null> => {
    try { return await read(); } catch (e) { console.error(e); skipped.push(label); return null; }
  };
  const [races, inspections, nominations, mail, snapshot] = await Promise.all([
    attempt('race heats', () => api.listRaces(id)),
    attempt('car sizes', () => api.listInspections(id)),
    attempt('nominations', () => api.listNominations(id)),
    attempt('award winners', () => api.resultMailState(id)),
    attempt('standings', () => api.latestSnapshot(id)),
  ]);
  const files: GraphicsFile[] = [];
  // With no heats yet the teams still go across, as an empty race order, so walk-ons and awards can be set up early.
  // Every entered team rides along too, so a team that has not raced yet still has a walk-on card and can win an award.
  const entered = teams.filter((t) => t.number).map((t) => ({ id: t.id, number: t.number, name: t.name, school: t.school || null }));
  files.push(file('Heats', { ...heatsExport({ event, teams, races: races ?? [] }), teams: entered }));
  if (inspections) {
    const cars = carsExport({ event, inspections: inspections as Inspection[], teams });
    if (cars.cars.some((c) => c.widthMm !== null || c.heightMm !== null)) files.push(file('Cars', cars));
  }
  if (nominations) {
    const data = nominationsExport({ event, rows: nominations, teams });
    if (data.awards.some((a) => a.nominees.length)) files.push(file('Nominations', data));
  }
  if (mail?.awards.length) files.push(file('Awards', awardsExport({ event, awards: mail.awards, confirmed: mail.confirmed, teams })));
  if (snapshot) files.push(file('Results', resultsExport({ event, released: event.resultsReleased, ruleset: event.ruleset, snapshot, teams })));
  return { files, teams, skipped };
}

/** What the graphics show for one team. Addresses are object URLs made in this browser; nothing is published. */
export interface TeamPictures { logo?: string; schoolLogo?: string; car?: string; photo?: string; colors?: string[] }

const PICTURE_KEYS: Array<[string, keyof Omit<TeamPictures, 'colors'>]> = [
  ['team_logo', 'logo'], ['school_logo', 'schoolLogo'], ['car_render_fl', 'car'], ['official_photo_approved', 'photo'],
];
const HEX = /^#[0-9a-f]{6}$/i;
/** Kept for the life of the page: opening the Graphics tab again does not download the same picture twice. */
const pictureCache = new Map<string, string>();

type PictureApi = Pick<Api, 'teamBrandingProfile' | 'downloadTeamBrandAsset'>;

/** A team's logo, school logo, front-left car render and approved photograph, plus its three colours. Missing ones are simply absent. */
export async function teamPictures(api: PictureApi, eventId: string, team: TeamRow, makeUrl: (bytes: Uint8Array<ArrayBuffer>, mime: string) => string): Promise<TeamPictures> {
  const profile = await api.teamBrandingProfile(eventId, team.id);
  const out: TeamPictures = {};
  const colours = profile.colours;
  if (colours && [colours.primary, colours.secondary, colours.accent].every((c) => HEX.test(c))) out.colors = [colours.primary, colours.secondary, colours.accent];
  for (const [key, field] of PICTURE_KEYS) {
    const asset = profile.assets.find((a) => a.key === key);
    if (!asset || !/^image\//.test(asset.mime)) continue;
    const cacheKey = [eventId, team.id, key, asset.revision, asset.updatedAt, asset.size].join('|');
    let url = pictureCache.get(cacheKey);
    if (!url) {
      const got = await api.downloadTeamBrandAsset(eventId, team.id, key, profile.version);
      url = makeUrl(Uint8Array.from(atob(got.base64), (c) => c.charCodeAt(0)), got.mime);
      pictureCache.set(cacheKey, url);
    }
    out[field] = url;
  }
  return out;
}
