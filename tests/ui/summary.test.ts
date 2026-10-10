import { describe, expect, it } from 'vitest';
import { summarise } from '../../src/engine';
import { WF26 } from '../../src/rules';
import { summaryView } from '../../src/ui/summary';

describe('summaryView', () => {
  it('shows the total, the award warning and performance failures first', () => {
    const s = summarise(WF26.rules, { 'T3.6': 46.5, 'T5.1': 17 });
    const el = summaryView(s, { carLabel: 'A', actions: [] });
    const text = el.textContent!;
    expect(text).toContain('25');
    expect(text).toContain('Not eligible for Fastest Car or Best Engineered Car');
    expect(text.indexOf('T3.6')).toBeLessThan(text.indexOf('T5.1'));
    expect(text).toContain('20-minute service session');
  });

  it('omits the award warning when there are no performance failures', () => {
    const s = summarise(WF26.rules, { 'T5.1': 17 });
    expect(summaryView(s, { carLabel: 'A', actions: [] }).textContent).not.toContain('Not eligible');
  });

  it('says so when nothing has been entered', () => {
    const el = summaryView(summarise(WF26.rules, {}), { carLabel: 'B', actions: [] });
    expect(el.textContent).toContain('Nothing has been entered for this car yet');
    expect(el.textContent).toContain('0');
  });

  it('lists at-risk margins and unfinished rows', () => {
    const s = summarise(WF26.rules, { 'T3.4': 84.9 });
    const text = summaryView(s, { carLabel: 'A', actions: [] }).textContent!;
    expect(text).toContain('Within 0.5 of a limit');
    expect(text).toContain('T3.4');
    expect(text).toMatch(/\d+ rows? still to do/);
  });
});
