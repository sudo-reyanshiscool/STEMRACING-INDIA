import { ApiError, type NewTeam } from './types';

export const MAX_IMPORT_TEAMS = 1000;

export function cleanTeam(input: NewTeam): NewTeam & {school:string} {
  if (!input || typeof input !== 'object' || typeof input.number !== 'string' || typeof input.name !== 'string'
    || (input.school !== undefined && typeof input.school !== 'string') || (input.managerEmail !== undefined && typeof input.managerEmail !== 'string')) throw new ApiError('invalid', 'Invalid team');
  const team = { number: input.number.trim(), name: input.name.trim(), school: (input.school ?? '').trim() };
  if (!team.number || team.number.length > 12 || !team.name || team.name.length > 80 || team.school.length > 120) {
    throw new ApiError('invalid', 'Invalid team number, name or school');
  }
  const managerEmail=(input.managerEmail??'').trim().toLowerCase();
  if(managerEmail && !validManagerEmail(managerEmail))throw new ApiError('invalid','Enter a valid manager email address');
  return {...team,...(managerEmail?{managerEmail}:{})};
}

export const validManagerEmail=(email:string)=>email.length<=254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
