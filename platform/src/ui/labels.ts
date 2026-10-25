import type { Panel, Role } from '../api';

export const ROLE_LABEL: Record<Role, string> = {
  spectator: 'Platform Spectator', organiser: 'Competition Organiser', chair: 'Chair of Judges', lead_judge: 'Lead Judge', judge: 'Judge',
  scrutineer: 'Scrutineer', race_official: 'Race official', team_manager: 'Team manager',
};

export const PANEL_LABEL: Record<Panel, string> = {
  scrutineering: 'Specification & Scrutineering', design_engineering: 'Design & Engineering',
  project_management: 'Project Management', enterprise: 'Enterprise', verbal: 'Verbal Presentation',
};

/** Roles that can be invited into an event. Organisers can only be invited by existing Organisers. */
export const INVITABLE: Role[] = ['organiser', 'chair', 'lead_judge', 'judge', 'scrutineer', 'race_official', 'team_manager'];
