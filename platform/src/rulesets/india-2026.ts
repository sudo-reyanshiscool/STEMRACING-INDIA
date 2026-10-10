import type { Area, Band, CategoryId, Criterion, PanelId, Ruleset } from '../engine/types';

// Band ranges as printed on the India National Finals 2026 scorecards.
const BANDS: Record<number, Band[]> = {
  20: [{ min: 0, max: 5 }, { min: 6, max: 10 }, { min: 11, max: 15 }, { min: 16, max: 20 }],
  15: [{ min: 0, max: 3 }, { min: 4, max: 7 }, { min: 8, max: 11 }, { min: 12, max: 15 }],
  10: [{ min: 0, max: 2 }, { min: 3, max: 4 }, { min: 5, max: 7 }, { min: 8, max: 10 }],
};

const crit = (id: string, name: string, max: 20 | 15 | 10): Criterion => ({
  id, name, max, bands: BANDS[max].map((b) => ({ ...b })),
});

const card = (id: string, name: string, categoryId: CategoryId, panel: PanelId, criteria: Criterion[]): Area => ({
  id, name, categoryId, kind: 'scorecard', panel, max: criteria.reduce((s, c) => s + c.max, 0), criteria,
});

const derived = (id: string, name: string, categoryId: CategoryId, max: number): Area => ({
  id, name, categoryId, kind: 'derived', panel: null, max, criteria: [],
});

export const INDIA_2026: Ruleset = {
  id: 'india-national-finals-2026',
  name: 'STEM Racing India National Finals 2026',
  version: 1,
  issued: '2026',
  source: 'STEM Racing India National Finals 2026 Competition Regulations (STEM Racing at The British School, New Delhi)',
  categories: [
    { id: 'specification', name: 'Specification & Scrutineering' },
    { id: 'design-engineering', name: 'Design & Engineering' },
    { id: 'project-management', name: 'Project Management' },
    { id: 'enterprise', name: 'Enterprise' },
    { id: 'verbal', name: 'Verbal Presentation' },
    { id: 'racing', name: 'Racing' },
  ],
  areas: [
    derived('specifications', 'Specifications', 'specification', 100),
    card('engineering-drawings', 'Engineering Drawings', 'specification', 'scrutineering', [
      crit('engineering-drawings', 'Engineering Drawings', 20),
    ]),
    card('renders', '3D Renders', 'specification', 'scrutineering', [crit('renders', 'Rendering', 20)]),
    card('finish-assembly', 'Quality of Finish and Assembly', 'specification', 'scrutineering', [
      crit('finish-assembly', 'Quality of Finish and Assembly', 20),
    ]),

    card('de-portfolio', 'Design & Engineering Portfolio', 'design-engineering', 'design_engineering', [
      crit('design-concepts', 'Design Concepts', 20),
      crit('3d-modelling', '3D Modelling', 20),
      crit('computer-aided-analysis', 'Application of Computer Aided Analysis', 20),
      crit('cam-cnc', 'Use of CAM/CNC', 20),
      crit('manufacturing-assembly', 'Other Manufacturing & Assembly', 20),
      crit('research-development', 'Research & Development', 20),
      crit('testing', 'Testing', 20),
      crit('design-process-evaluation', 'Design Process Evaluation', 20),
      crit('document-presentation', 'Document Presentation', 20),
    ]),

    card('pm-initiating', 'Project Management: Initiating', 'project-management', 'project_management', [
      crit('initiation-process', 'Initiation Process', 20),
      crit('project-schedule', 'Project Schedule', 15),
    ]),
    card('pm-planning', 'Project Management: Planning', 'project-management', 'project_management', [
      crit('budget-resource', 'Budget and Resource Management', 15),
      crit('roles-responsibilities', 'Roles and Responsibilities', 10),
    ]),
    card('pm-executing', 'Project Management: Executing', 'project-management', 'project_management', [
      crit('team-stakeholder-communications', 'Team & Stakeholder Communications', 10),
      crit('risk-management', 'Risk Management', 10),
    ]),
    card('pm-monitoring', 'Project Management: Monitoring and Controlling', 'project-management', 'project_management', [
      crit('monitoring-controlling', 'Monitoring & Controlling', 10),
    ]),

    card('enterprise-portfolio', 'Enterprise Portfolio', 'enterprise', 'enterprise', [
      crit('marketing-strategy', 'Marketing Strategy & Materials', 20),
      crit('sponsorship-return', 'Sponsorship & Return on Investment (ROI)', 20),
      crit('digital-media-proficiency', 'Digital Media Proficiency', 20),
      crit('sustainability', 'Sustainability', 20),
      crit('document-presentation', 'Document Presentation', 20),
    ]),
    card('team-identity', 'Team Identity', 'enterprise', 'enterprise', [
      crit('overall-team-identity', 'Overall Team Identity', 20),
    ]),
    card('pit-display', 'Pit Display', 'enterprise', 'enterprise', [
      crit('pit-display-design', 'Pit Display Design Process (Documented in Enterprise portfolio)', 20),
      crit('pit-display-content', 'Pit Display Content Clarity and Impact', 20),
      crit('functionality-user-experience', 'Functionality & User Experience execution', 20),
    ]),

    card('verbal-technique', 'Verbal Presentation: Technique', 'verbal', 'verbal', [
      crit('engagement-presentation-dynamics', 'Engagement & Presentation Dynamics', 20),
      crit('team-contribution', 'Team Contribution', 20),
    ]),
    card('verbal-composition', 'Verbal Presentation: Composition', 'verbal', 'verbal', [
      crit('content-quality', 'Content Quality, Relevance & Subject Understanding', 20),
      crit('time-clarity-structure', 'Time, Clarity and Structure of Content', 20),
    ]),
    card('verbal-subject', 'Verbal Presentation: Subject', 'verbal', 'verbal', [
      crit('innovation', 'Innovation', 20),
      crit('collaboration', 'Collaboration', 20),
      crit('stem-racing-learning-journey', 'STEM Racing™ learning journey', 20),
    ]),

    derived('reaction', 'Reaction Racing', 'racing', 105),
    derived('knockout', 'Knock-Out Racing', 'racing', 135),
    derived('fastest-car', 'Fastest Car Bonus', 'racing', 10),
  ],
  tieBreakAreaId: 'knockout',
  protestPenalty: 15,
};
