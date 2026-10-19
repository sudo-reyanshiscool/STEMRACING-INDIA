import type { CarStatus, RuleClass, Status } from '../technical';
import { h } from './dom';

const CLASS_LABEL: Record<RuleClass, string> = { GEN: 'General', SAF: 'Safety', PERF: 'Performance' };

export const classTag = (cls: RuleClass) => h('span', { class: 'tag tag--class' }, CLASS_LABEL[cls]);
export const classLabel = (cls: RuleClass): string => CLASS_LABEL[cls];

/** Status is always a word, never colour alone. */
export function statusTag(status: Status, atRisk = false) {
  if (status === 'fail') return h('span', { class: 'tag tag--fail' }, 'Fail');
  if (status === 'pass') return atRisk ? h('span', { class: 'tag tag--risk' }, 'Pass, at risk') : h('span', { class: 'tag tag--pass' }, 'Pass');
  if (status === 'invalid') return h('span', { class: 'tag tag--fail' }, 'Enter a number');
  return h('span', { class: 'tag tag--todo' }, 'To do');
}

const CAR_LABEL: Record<CarStatus, string> = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  clean: 'No penalties',
  penalties: 'Penalties',
};

export function carStatusTag(status: CarStatus) {
  const cls = status === 'penalties' ? 'tag--fail' : status === 'clean' ? 'tag--pass' : 'tag--todo';
  return h('span', { class: `tag ${cls}` }, CAR_LABEL[status]);
}
