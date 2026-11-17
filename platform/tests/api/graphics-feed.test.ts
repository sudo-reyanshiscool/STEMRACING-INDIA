import { describe, expect, it } from 'vitest';
import { graphicsFiles, teamPictures } from '../../src/api/graphics-feed';
import { world } from '../ui/helpers';
import { EMAILS } from '../ui/helpers';

describe('graphics feed', () => {
  it('sends every entered team before any race exists, and nothing that has no record yet', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const event = (await api.getEvent(ev.id))!;
    const { files, teams, skipped } = await graphicsFiles(api, event);
    expect(teams.map((t) => t.number)).toEqual(['1', '2']);
    expect(files.map((f) => f.name)).toEqual(['Heats.json']);
    const heats = JSON.parse(files[0].text);
    expect(heats.kind).toBe('heats');
    expect(heats.heats).toEqual([]);
    expect(heats.teams.map((t: { number: string; name: string }) => [t.number, t.name])).toEqual([['1', 'One'], ['2', 'Two']]);
    expect(skipped).toEqual([]);
  });

  it('gives an unchanged record the same fingerprint, whenever it is built', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const event = (await api.getEvent(ev.id))!;
    const first = await graphicsFiles(api, event);
    await new Promise((r) => setTimeout(r, 5));
    const second = await graphicsFiles(api, event);
    expect(second.files[0].fingerprint).toBe(first.files[0].fingerprint);
    expect(first.files[0].fingerprint).not.toContain('generatedAt');
    await api.createTeam(ev.id, { number: '3', name: 'Three' });
    const third = await graphicsFiles(api, event);
    expect(third.files[0].fingerprint).not.toBe(first.files[0].fingerprint);
  });

  it('leaves out a read that fails and names it, instead of failing the whole feed', async () => {
    const { api, ev } = await world();
    await api.signIn(EMAILS.org);
    const event = (await api.getEvent(ev.id))!;
    const broken = Object.create(api) as typeof api;
    broken.listNominations = async () => { throw new Error('refused'); };
    const { files, skipped } = await graphicsFiles(broken, event);
    expect(skipped).toEqual(['nominations']);
    expect(files.map((f) => f.name)).toContain('Heats.json');
  });

  it('reads a team with no media as a team with no pictures', async () => {
    const { api, ev, t1 } = await world();
    await api.signIn(EMAILS.org);
    const made: string[] = [];
    const got = await teamPictures(api, ev.id, t1, (_bytes, mime) => { made.push(mime); return `blob:test/${made.length}`; });
    expect(got).toEqual({});
    expect(made).toEqual([]);
  });
});
