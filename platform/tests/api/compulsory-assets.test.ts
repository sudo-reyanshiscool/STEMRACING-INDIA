import {readFileSync} from 'node:fs';
const portrait={fileName:'portrait.png',photoMime:'image/png',photoBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='};
import { describe, expect, it } from 'vitest';
import { COMPULSORY_ASSET_SPECS, normalizeHexColor, validateTeamColours, computeCompulsoryAssetStatus, extractPngDimensionsFromBase64 } from '../../src/api';
import { MemoryApi } from '../../src/api/memory';
import { watchGuide } from '../guide-helper';

describe('Compulsory Submission Assets', () => {
  it('defines all 10 compulsory assets with required specifications', () => {
    expect(COMPULSORY_ASSET_SPECS).toHaveLength(10);
    expect(COMPULSORY_ASSET_SPECS.slice(8).map((s) => s.key)).toEqual(['school_logo', 'school_name']);
    const keys = COMPULSORY_ASSET_SPECS.map((s) => s.key);
    expect(keys).toEqual([
      'team_logo',
      'car_render_fl',
      'car_render_fr',
      'car_model_3d',
      'model_materials',
      'official_photo',
      'team_colours',
      'member_portraits',
      'school_logo',
      'school_name',
    ]);

    for (const spec of COMPULSORY_ASSET_SPECS) {
      expect(spec.compulsory).toBe(true);
      expect(spec.format).toBeTruthy();
      expect(spec.specifications).toBeTruthy();
    }

    expect(COMPULSORY_ASSET_SPECS[0].name).toBe('Team logo');
    expect(COMPULSORY_ASSET_SPECS[0].format).toContain('SVG');
    expect(COMPULSORY_ASSET_SPECS[1].name).toContain('Front-left');
    expect(COMPULSORY_ASSET_SPECS[1].specifications).toContain('3840 × 2160');
    expect(COMPULSORY_ASSET_SPECS[2].name).toContain('Front-right');
    expect(COMPULSORY_ASSET_SPECS[2].specifications).toContain('3840 × 2160');
    expect(COMPULSORY_ASSET_SPECS[3].format).toBe('OBJ');
    expect(COMPULSORY_ASSET_SPECS[4].format).toContain('MTL');
    expect(COMPULSORY_ASSET_SPECS[5].name).toBe('Official team photograph');
    expect(COMPULSORY_ASSET_SPECS[6].format).toBe('HEX codes');
    expect(COMPULSORY_ASSET_SPECS[7].name).toBe('Individual team member portraits');
  });

  it('validates and normalizes team colours', () => {
    expect(normalizeHexColor('#e6007e')).toBe('#E6007E');
    expect(normalizeHexColor('fcbc00')).toBe('#FCBC00');
    expect(normalizeHexColor('#fff')).toBe('#FFFFFF');
    expect(() => normalizeHexColor('not-a-color')).toThrow('Invalid hex color');

    const colours = validateTeamColours({
      primary: '#e6007e',
      secondary: '#312783',
      accent: '#fcbc00',
    });
    expect(colours).toEqual({
      primary: '#E6007E',
      secondary: '#312783',
      accent: '#FCBC00',
    });
  });

  it('computes completion status across all 10 compulsory assets', () => {
    const emptyStatus = computeCompulsoryAssetStatus('event-1', 'team-1', {});
    expect(emptyStatus.completedCount).toBe(0);
    expect(emptyStatus.totalCount).toBe(10);
    expect(emptyStatus.isAllCompleted).toBe(false);
    expect(emptyStatus.missingKeys).toHaveLength(10);

    const fullStatus = computeCompulsoryAssetStatus('event-1', 'team-1', {
      teamLogo: { name: 'logo.svg', mime: 'image/svg+xml', size: 1000, updatedAt: '' },
      carRenderFL: { name: 'fl.png', mime: 'image/png', size: 2000, updatedAt: '' },
      carRenderFR: { name: 'fr.png', mime: 'image/png', size: 2000, updatedAt: '' },
      carModel3D: { name: 'car.obj', mime: 'model/obj', size: 5000, updatedAt: '' },
      modelMaterials: { name: 'materials.zip', mime: 'application/zip', size: 4000, updatedAt: '' },
      officialPhoto: { id: 'p1' } as any,
      teamColours: { primary: '#E6007E', secondary: '#312783', accent: '#FCBC00' },
      memberPortraits: [{ id: 'm1', name: 'Aarav', role: 'Driver',...portrait }],
      schoolLogo: { name: 'school.png', mime: 'image/png', size: 900, updatedAt: '' },
      schoolName: 'The British School',
    });
    expect(computeCompulsoryAssetStatus('event-1', 'team-1', { schoolName: '   ' }).missingKeys).toContain('school_name');
    expect(fullStatus.completedCount).toBe(10);
    expect(fullStatus.isAllCompleted).toBe(true);
    expect(fullStatus.missingKeys).toHaveLength(0);
  });

  it('allows saving colours, portraits, and uploading renders in MemoryApi', async () => {
    const api = new MemoryApi();
    await api.signIn('owner@platform.invalid');
    const event = await api.createEvent({ name: 'Nationals 2026' });
    const team = await api.createTeam(event.id, { number: '101', name: 'Apex Velocity' });

    // Save team colours
    const colours = await api.saveTeamColours(event.id, team.id, {
      primary: '#e6007e',
      secondary: '#312783',
      accent: '#fcbc00',
    });
    expect(colours.primary).toBe('#E6007E');

    // Save member portraits
    const members = await api.saveTeamMemberPortraits(event.id, team.id, [
      { id: '1', name: 'Aarav Sharma', role: 'Team Principal',...portrait },
      { id: '2', name: 'Ananya Patel', role: 'Chief Engineer',...portrait },
    ]);
    expect(members).toHaveLength(2);

    // Upload car render
    const dummyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const uploaded = await api.uploadCompulsoryAsset(event.id, team.id, 'car_render_fl', {
      name: 'render_fl.png',
      mime: 'image/png',
      base64: readFileSync(new URL('../fixtures/car-render.png',import.meta.url)).toString('base64'),
    });
    expect(uploaded.name).toBe('render_fl.png');

    const status = await api.getCompulsoryAssets(event.id, team.id);
    expect(status.carRenderFL).toBeDefined();
    expect(status.teamColours?.primary).toBe('#E6007E');
    expect(status.memberPortraits).toHaveLength(2);
  });

  it('collects a school logo and school name from the team, and feeds both into the branding profile', async () => {
    const api = new MemoryApi();
    api.setCreatorAllowlist(['org@x.test']);
    await api.signIn('org@x.test');
    const event = await api.createEvent({ name: 'Nationals' });
    const team = await api.createTeam(event.id, { number: '7', name: 'Apex' });
    await api.invite(event.id, { email: 'mgr@x.test', role: 'team_manager', teamId: team.id });
    const other = await api.createTeam(event.id, { number: '8', name: 'Rival' });
    await api.signIn('mgr@x.test'); await api.claimInvitations(); await watchGuide(api, event.id);

    const before = await api.getCompulsoryAssets(event.id, team.id);
    expect(before.missingKeys).toEqual(expect.arrayContaining(['school_logo', 'school_name']));

    await expect(api.saveSchoolName(event.id, team.id, '   ', before.revision)).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.saveSchoolName(event.id, team.id, 'x'.repeat(121), before.revision)).rejects.toMatchObject({ code: 'invalid' });
    expect(await api.saveSchoolName(event.id, team.id, '  The British School  ', before.revision)).toBe('The British School');
    await expect(api.saveSchoolName(event.id, team.id, 'Stale', before.revision)).rejects.toMatchObject({ code: 'conflict' });
    await expect(api.saveSchoolName(event.id, other.id, 'Not mine')).rejects.toMatchObject({ code: 'forbidden' });

    await expect(api.uploadCompulsoryAsset(event.id, team.id, 'school_logo', { name: 'school.jpg', mime: 'image/jpeg', base64: portrait.photoBase64 }, 0)).rejects.toMatchObject({ code: 'invalid' });
    await api.uploadCompulsoryAsset(event.id, team.id, 'school_logo', { name: 'school.png', mime: 'image/png', base64: portrait.photoBase64 }, 0);

    const after = await api.getCompulsoryAssets(event.id, team.id);
    expect(after.schoolName).toBe('The British School');
    expect(after.schoolLogo).toMatchObject({ name: 'school.png', mime: 'image/png', revision: 1 });
    expect(after.schoolLogo?.base64).toBeUndefined();
    expect(after.missingKeys).not.toEqual(expect.arrayContaining(['school_logo', 'school_name']));
    expect((await api.listTeams(event.id)).find((t) => t.id === team.id)?.school).toBe('The British School');

    const profile = await api.teamBrandingProfile(event.id, team.id);
    expect(profile.totalCount).toBe(10);
    expect(profile.team.school).toBe('The British School');
    expect(profile.assets.map((a) => a.key)).toContain('school_logo');
    expect((await api.downloadTeamBrandAsset(event.id, team.id, 'school_logo', profile.version)).base64).toBe(portrait.photoBase64);

    await api.deleteCompulsoryAsset(event.id, team.id, 'school_logo');
    await api.deleteCompulsoryAsset(event.id, team.id, 'school_name');
    expect((await api.getCompulsoryAssets(event.id, team.id)).missingKeys).toEqual(expect.arrayContaining(['school_logo', 'school_name']));
  });
});
