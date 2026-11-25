import type { ContextLabels } from '../src/index';

/** Plain English labels for context tests (the product uses @meetless/i18n). */
export const LABELS: ContextLabels = {
  kind: (k) => (k === 'ext' ? 'External need' : 'Hypothesis'),
  status: (s) => s,
  effect: (e) => e,
  round: (n, t) => `Round ${n} ${t}`,
  due: (d) => `Due ${d}`,
  version: (v) => `v${v}`,
  date: (d) => d,
  accept: 'Done when',
  expect: 'Expected',
  verify: 'Test',
  verdict: 'Result',
  source: 'Source',
  revisions: 'Changes',
  work: 'Activity',
  children: 'Hypotheses',
  parent: 'From',
  artifacts: 'Artifacts',
  refuted: 'Rejected hypotheses (don’t retry)',
  owner: 'Owner',
  requester: 'Requested by',
  handoff: 'Handoff',
  captured: 'captured, reference only',
  fetchHint: (link) => `Refresh with get_need_context("${link}").`,
  report: 'Report progress with record_work.',
};
