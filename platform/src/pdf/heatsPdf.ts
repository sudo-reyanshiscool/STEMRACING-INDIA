import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { RaceHeat, RaceLane } from '../racing';
import type { TeamRow } from '../api';
import { REGIONAL_FINALS_LOGO, BRAND_GRADIENT, MAGISTRAL_BOLD_ITALIC_FONT } from './heats-branding';

export type HeatsPhaseFilter = 'reaction' | 'knockout' | 'all';

export interface HeatsPdfInput {
  eventName: string;
  startsOn?: string | null;
  teams: TeamRow[];
  races: RaceHeat[];
  phase?: HeatsPhaseFilter;
  generatedAt?: string;
}

type RGB = [number, number, number];

// Brand colour tokens
const CARBON_SHADOW: RGB = [5, 0, 11];
const CARBON_800: RGB = [38, 26, 61];
const CARBON_500: RGB = [91, 83, 118];
const CARBON_100: RGB = [215, 214, 227];
const SURFACE_LIGHT: RGB = [248, 248, 252];
const PITLANE_PINK: RGB = [230, 0, 126];

const safe = (s: string): string =>
  s.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'Event';

export function heatsFileName(eventName: string, phase: HeatsPhaseFilter = 'reaction'): string {
  const phaseLabel = phase === 'reaction' ? 'Reaction-Heats' : phase === 'knockout' ? 'Knockout-Heats' : 'Heats-Schedule';
  return `STEM-Racing_${safe(eventName)}_${phaseLabel}.pdf`;
}

/** Sanitize non-Latin1 characters for PDF text */
const pdfText = (s: string): string => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function formatLaneTeam(lane: RaceLane, teams: TeamRow[]): string {
  const t = teams.find((item) => item.id === lane.teamId);
  const teamLabel = t ? `#${t.number} ${t.name}` : (lane.teamId ? 'TBD' : '—');
  return `${teamLabel} (Car ${lane.car})`;
}

/** Formats heat numbering: RR-H01 for reaction; KR-H01 for knockout races */
export function formatHeatNumber(heat: RaceHeat, fallbackIndex: number): string {
  if (heat.phase === 'reaction') {
    const m = heat.label.match(/RR-(?:H)?(\d+)/i);
    if (m) return `RR-H${m[1].padStart(2, '0')}`;
    return `RR-H${String(fallbackIndex + 1).padStart(2, '0')}`;
  }
  // Knockout heats start from KR-H01
  const m = heat.label.match(/KR-(?:H)?(\d+)/i);
  if (m) return `KR-H${m[1].padStart(2, '0')}`;
  const slot = heat.bracket?.slot;
  if (typeof slot === 'number' && slot >= 1) return `KR-H${String(slot).padStart(2, '0')}`;
  return `KR-H${String(fallbackIndex + 1).padStart(2, '0')}`;
}

function registerFonts(doc: jsPDF): void {
  doc.addFileToVFS('Magistral-BoldItalic.ttf', MAGISTRAL_BOLD_ITALIC_FONT);
  doc.addFont('Magistral-BoldItalic.ttf', 'Magistral', 'bolditalic');
  doc.addFont('Magistral-BoldItalic.ttf', 'Magistral', 'normal');
  doc.addFont('Magistral-BoldItalic.ttf', 'Magistral', 'bold');
  doc.addFont('Magistral-BoldItalic.ttf', 'Magistral', 'italic');
}

function drawHeroBanner(doc: jsPDF, W: number, M: number, title: string, subtitle: string): void {
  const bannerHeight = 32;
  doc.addImage(BRAND_GRADIENT, 'PNG', 0, 0, W, bannerHeight, 'GRADIENT', 'FAST');
  doc.setFillColor(...PITLANE_PINK);
  doc.rect(0, bannerHeight, W, 1.4, 'F');
  doc.addImage(REGIONAL_FINALS_LOGO, 'PNG', M, 5.5, 38, 19, 'LOGO', 'FAST');

  doc.setFont('Magistral', 'bolditalic');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(title, W - M, 17, { align: 'right' });

  doc.setFont('Magistral', 'bolditalic');
  doc.setFontSize(9.5);
  doc.setTextColor(235, 235, 245);
  doc.text(subtitle, W - M, 24, { align: 'right' });
}

function drawContinuationBanner(doc: jsPDF, W: number, M: number, label: string): void {
  doc.addImage(BRAND_GRADIENT, 'PNG', 0, 0, W, 20, 'GRADIENT', 'FAST');
  doc.setFillColor(...PITLANE_PINK);
  doc.rect(0, 20, W, 1, 'F');
  doc.addImage(REGIONAL_FINALS_LOGO, 'PNG', M, 3.5, 26, 13, 'LOGO', 'FAST');

  doc.setFont('Magistral', 'bolditalic');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(label, W - M, 12.5, { align: 'right' });
}

export function buildHeatsPdf(input: HeatsPdfInput): jsPDF {
  const phase = input.phase ?? 'reaction';
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210;
  const M = 14;

  registerFonts(doc);

  const phaseTitle = phase === 'knockout' ? 'OFFICIAL KNOCKOUT HEATS SCHEDULE' : phase === 'reaction' ? 'OFFICIAL REACTION HEATS SCHEDULE' : 'OFFICIAL HEATS SCHEDULE';
  const phaseSub = phase === 'knockout' ? 'KNOCKOUT BRACKET · REGIONAL FINALS' : 'REACTION RACING · REGIONAL FINALS';

  doc.setProperties({
    title: `${input.eventName} - ${phaseTitle}`,
    author: 'STEM Racing India',
    subject: 'Official Heats Schedule and Pairing List',
  });

  // Filter races based on phase requested
  const filteredRaces = phase === 'all'
    ? [...input.races].sort((a, b) => a.number - b.number)
    : input.races.filter((r) => r.phase === phase).sort((a, b) => a.number - b.number);

  // If separate phases requested or single phase
  drawHeroBanner(doc, W, M, phaseTitle, phaseSub);

  // Event Details Box
  doc.setFont('Magistral', 'bolditalic');
  doc.setFontSize(16);
  doc.setTextColor(...CARBON_SHADOW);
  doc.text(pdfText(input.eventName.toUpperCase()), M, 43);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...CARBON_500);

  const summaryText = phase === 'reaction'
    ? `Reaction Racing (Four runs per team · Car A & B in Lanes 1 & 2)`
    : phase === 'knockout'
    ? `Knockout Racing Bracket (Seeded Head-to-Head Eliminations)`
    : `Reaction & Knockout Racing Schedule`;

  const infoLine = `Date: ${input.startsOn || 'Competition Day'}   ·   Total Heats: ${filteredRaces.length}   ·   Teams: ${input.teams.length}   ·   ${summaryText}`;
  doc.text(pdfText(infoLine), M, 50);

  // Divider
  doc.setDrawColor(...CARBON_100);
  doc.setLineWidth(0.35);
  doc.line(M, 54, W - M, 54);

  // Table rows
  const rows = filteredRaces.map((heat, idx) => [
    formatHeatNumber(heat, idx),
    heat.phase === 'reaction' ? 'Reaction' : (heat.bracket ? `Knockout R${heat.bracket.round}` : 'Knockout'),
    pdfText(formatLaneTeam(heat.lane1, input.teams)),
    pdfText(formatLaneTeam(heat.lane2, input.teams)),
  ]);

  if (rows.length === 0) {
    const emptyMsg = phase === 'knockout' ? 'No knockout heats scheduled yet.' : 'No reaction heats scheduled yet.';
    rows.push(['—', '—', emptyMsg, '—']);
  }

  autoTable(doc, {
    startY: 59,
    margin: { left: M, right: M, top: 26, bottom: 22 },
    head: [['Heat', 'Phase', 'Lane 1 (Team & Car)', 'Lane 2 (Team & Car)']],
    body: rows,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      textColor: CARBON_SHADOW,
      lineColor: CARBON_100,
      lineWidth: 0.18,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: CARBON_800,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9.5,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: SURFACE_LIGHT,
    },
    columnStyles: {
      0: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
      1: { cellWidth: 30, halign: 'center' },
      2: { cellWidth: 64, halign: 'left' },
      3: { cellWidth: 64, halign: 'left' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        const contLabel = phase === 'knockout' ? 'KNOCKOUT HEATS (CONT.)' : 'REACTION HEATS (CONT.)';
        drawContinuationBanner(doc, W, M, contLabel);
      }
    },
  });

  // Footers
  const totalPages = doc.getNumberOfPages();
  const dateStr = input.generatedAt || new Date().toISOString().slice(0, 10);
  const footerLabel = phase === 'knockout' ? 'Official Knockout Heats Schedule' : 'Official Reaction Heats Schedule';

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...PITLANE_PINK);
    doc.setLineWidth(0.4);
    doc.line(M, 283, W - M, 283);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...CARBON_500);
    doc.text(
      pdfText(`${input.eventName} · STEM Racing India Regional Finals · ${footerLabel}`),
      M,
      288.5,
    );
    doc.text(`Page ${p} of ${totalPages}`, W - M, 288.5, { align: 'right' });

    doc.setFontSize(7);
    doc.text(`Generated ${dateStr} · Official race pairing schedule`, M, 292.5);
  }

  return doc;
}
