import { ApiError, type NewTeam } from './types';

export const MAX_IMPORT_TEAMS = 1000;

export function cleanTeam(input: NewTeam): Required<NewTeam> {
  if (!input || typeof input !== 'object' || typeof input.number !== 'string' || typeof input.name !== 'string'
    || (input.school !== undefined && typeof input.school !== 'string')) throw new ApiError('invalid', 'Invalid team');
  const team = { number: input.number.trim(), name: input.name.trim(), school: (input.school ?? '').trim() };
  if (!team.number || team.number.length > 12 || !team.name || team.name.length > 80 || team.school.length > 120) {
    throw new ApiError('invalid', 'Invalid team number, name or school');
  }
  return team;
}
