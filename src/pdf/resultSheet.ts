import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CarSummary, Result, RuleClass, Status } from '../engine';

export interface SheetInput {
  eventName: string;
  teamNumber: string;
  teamName: string;
  school: string;
  carLabel: 'A' | 'B';
  scrutineer: string;
  date: string;
  rulesetName: string;
  rulesetIssued: string;
  summary: CarSummary;
  logoDataUrl?: string;
}

type RGB = [number, number, number];

// Brand colours (design system tokens) as RGB for jsPDF.
const CARBON_SHADOW: RGB = [5, 0, 11];
const CHICANE_VIOLET: RGB = [150, 27, 129];
const PITLANE_PINK: RGB = [230, 0, 126];
const SURFACE_LIGHT: RGB = [243, 243, 247];
const CARBON_100: RGB = [215, 214, 227];

const CLASS_LABEL: Record<RuleClass, string> = { GEN: 'General', SAF: 'Safety', PERF: 'Performance' };
const STATUS_LABEL: Record<Status, string> = { pending: 'To do', pass: 'Pass', fail: 'Fail', invalid: 'Invalid' };

export function sheetRows(results: Result[]): string[][] {
  return results.map((r) => [
    r.article,
    r.name,
    STATUS_LABEL[r.status] + (r.status === 'pass' && r.atRisk ? ', at risk' : ''),
    CLASS_LABEL[r.cls],
    r.status === 'fail' ? String(r.penalty) : '',
  ]);
}

const safe = (s: string): string =>
  s.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';

export function sheetFileName(i: Pick<SheetInput, 'eventName' | 'teamNumber' | 'carLabel'>): string {
  return `STEM-Racing-Scrutineering_${safe(i.eventName)}_Team-${safe(i.teamNumber)}${i.carLabel}.pdf`;
}

/** jsPDF's built-in fonts only cover Latin-1: replace anything else so text never garbles. */
const pdfText = (s: string): string => s.replace(/[^\x20-\x7E -ÿ]/g, '?');

export function buildResultSheet(i: SheetInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 12;

  // Header band: official full-colour white logo on carbon-shadow, 12 mm high with 6 mm clear space.
  doc.setFillColor(...CARBON_SHADOW);
  doc.rect(0, 0, W, 24, 'F');
  if (i.logoDataUrl) doc.addImage(i.logoDataUrl, 'PNG', M, 6, 24.2, 12);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(16);
  doc.text('Scrutineering result sheet', W - M, 15, { align: 'right' });

  doc.setTextColor(...CARBON_SHADOW);
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(20);
  const title = doc.splitTextToSize(pdfText(`Team ${i.teamNumber}, Car ${i.carLabel}`), W - 2 * M) as string[];
  doc.text(title, M, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const info = [
    pdfText(`Team: ${i.teamName}${i.school ? ` (${i.school})` : ''}`),
    pdfText(`Event: ${i.eventName}`),
    pdfText(`Date: ${i.date}    Scrutineer: ${i.scrutineer || 'not recorded'}`),
    pdfText(`Rules: ${i.rulesetName}, issued ${i.rulesetIssued}`),
  ].flatMap((line) => doc.splitTextToSize(line, W - 2 * M) as string[]);
  doc.text(info, M, 44);
  let y = 44 + info.length * 5 + 3;

  // Totals panel.
  const s = i.summary;
  doc.setFillColor(...SURFACE_LIGHT);
  doc.roundedRect(M, y, W - 2 * M, 22, 2, 2, 'F');
  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(26);
  doc.setTextColor(...CARBON_SHADOW);
  doc.text(String(s.total), M + 5, y + 14);
  const totalWidth = doc.getTextWidth(String(s.total));
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('penalty points for this car', M + 5 + totalWidth + 3, y + 13.5);
  doc.setFontSize(9);
  doc.text(
    `${s.perfFailures.length} Performance, ${s.safetyFailures.length} Safety, ${s.generalFailures.length} General infringements; ${s.pending.length} rows still to do`,
    M + 5, y + 19,
  );
  y += 28;

  const notes: string[] = [];
  if (!s.started) notes.push('Nothing has been entered for this car.');
  if (s.ineligibleFor.length) notes.push(`Not eligible for ${s.ineligibleFor.join(' or ')} (T2.4.2).`);
  if (s.safetyFailures.length) notes.push('Safety infringements: fix in the single 20-minute service session, or the car is not safe to race.');
  for (const r of s.results) if (r.status === 'fail') for (const n of r.notes) notes.push(`${r.article}: ${n}`);
  if (s.atRisk.length) notes.push(`At risk (within 0.5 of a limit): ${s.atRisk.map((r) => r.article).join(', ')}.`);
  doc.setFontSize(9.5);
  doc.setTextColor(...CARBON_SHADOW);
  doc.setFont('helvetica', 'bold');
  for (const n of notes) {
    const lines = doc.splitTextToSize(pdfText(n), W - 2 * M - 4) as string[];
    doc.text(lines, M + 2, y);
    y += lines.length * 4.6 + 1.5;
  }

  autoTable(doc, {
    startY: y + 2,
    head: [['Article', 'Rule', 'Result', 'Class', 'Pts']],
    body: sheetRows(s.results).map((r) => r.map(pdfText)),
    margin: { left: M, right: M, bottom: 18 },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.6, textColor: CARBON_SHADOW, lineColor: CARBON_100, lineWidth: 0.1 },
    headStyles: { fillColor: CHICANE_VIOLET, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 28 }, 3: { cellWidth: 26 }, 4: { cellWidth: 12, halign: 'right' } },
    didParseCell: (data) => {
      if (data.section === 'body' && (data.row.raw as string[])[2] === 'Fail') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [253, 232, 243];
        if (data.column.index === 2) data.cell.styles.textColor = PITLANE_PINK;
      }
    },
  });

  const last = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  let sy = last + 14;
  if (sy > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    sy = 30;
  }
  doc.setDrawColor(...CARBON_SHADOW);
  doc.line(M, sy, M + 80, sy);
  doc.line(W - M - 60, sy, W - M, sy);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...CARBON_SHADOW);
  doc.text('Scrutineer signature', M, sy + 4.5);
  doc.text('Team representative', W - M - 60, sy + 4.5);

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(91, 83, 118);
    doc.text(pdfText(`${i.rulesetName}. Regulation text governs; this sheet is a record of measurements taken at the bench.`), M, 290);
    doc.text(`Page ${p} of ${pages}`, W - M, 290, { align: 'right' });
  }
  return doc;
}

async function loadLogo(): Promise<string | undefined> {
  try {
    const res = await fetch('/brand/logo-full-colour-white.png');
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function downloadSheet(i: SheetInput): Promise<void> {
  const logoDataUrl = i.logoDataUrl ?? (await loadLogo());
  buildResultSheet({ ...i, logoDataUrl }).save(sheetFileName(i));
}
