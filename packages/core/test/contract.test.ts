import { describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { EVENT_TYPES } from '../src/index';

/**
 * The Phase 0 freeze (contract §1, §2). Phase 1 blocks build on these names.
 * A change here is a core change: additive only, in its own `core:` commit,
 * and a new event type or a changed signature needs the base owner's sign-off.
 */

// The 44 event types of contract §2 (project.renamed: §12.23), sorted.
const FROZEN_EVENT_TYPES = [
  'artifact.created', 'artifact.linked', 'artifact.shared', 'artifact.version_added',
  'artifactVersion.derived', 'chat.asked', 'chat.cleared', 'conflict.resolved',
  'dashboard.set', 'extract.accepted', 'extract.ignored', 'handoff.confirmed',
  'handoff.context_fetched', 'handoff.created', 'handoff.refresh_requested', 'handoff.reopened',
  'handoff.responded', 'handoff.returned', 'handoff.started', 'input.imported',
  'input.shared', 'need.created', 'need.revised', 'need.shared',
  'need.status_set', 'need.updated', 'project.created', 'project.member_added', 'project.renamed',
  'proposal.accepted', 'proposal.created', 'proposal.rejected', 'role.created',
  'role.member_assigned', 'role.member_removed', 'round.created', 'round.delivered',
  'round.started', 'round.updated', 'user.locale_changed', 'user.registered',
  'work.ignored', 'work.linked', 'work.recorded',
];

// Every runtime export of @meetless/core, sorted. Types are erased and not listed.
const FROZEN_EXPORTS = [
  'ARTIFACT_KINDS', 'CLOSED_STATUSES', 'DEFAULT_HOME_CARDS', 'DEFAULT_PROJECT_CARDS', 'DETECTOR_ID',
  'DOMAIN_ERROR_CODES', 'DOT_CHARS', 'DOT_RE', 'DomainError', 'EVENT_TYPES',
  'EXT_STATUSES', 'HANDOFF_STATES', 'HOME_CARDS', 'HYP_STATUSES', 'INPUT_KINDS',
  'PROJECT_CARDS', 'RULES_PROVIDER_ID', 'SEP', 'SERVICE_ONLY_EVENTS', 'SOURCE_KINDS',
  'STALE_DUE_DAYS', 'STALE_IDLE_DAYS', 'WIDE_CARDS', 'WORK_EFFECTS', 'activityCard',
  'allRisks', 'answer', 'applyEvent', 'cardFromText', 'cardsFor',
  'chatMessages', 'clip', 'codesIn', 'contextVersionOf', 'currentOrLatestRound',
  'currentRound', 'cutoffSeqAtTime', 'dashboardKey', 'daysBetween', 'daysLeft',
  'deliveryCard', 'detectExtracts', 'emptyState', 'eventScope', 'groupByNeed',
  'handoffForNeed', 'handoffStaleness', 'homeItems', 'hypothesesCard', 'inputStatus',
  'isDomainError', 'isFreeQuestion', 'isOpen', 'isProgress', 'isSystemActor', 'isWebUrl', 'lastFetchedVersion',
  'looksLikeAdd', 'looksLikeInput', 'looksLikeQuestion', 'matchNeed', 'materialHits', 'membersCard', 'membersOf', 'myProjectIds',
  'needByCode', 'needContext', 'needLink', 'needVersion', 'nextRound',
  'noDots', 'openConflicts', 'openProposals', 'orderBySeq', 'overlap',
  'parseNeedLink', 'pendingExtracts', 'pendingExtractsFor', 'progressCard', 'projectBadges',
  'projectInputs', 'projectNeeds', 'projectRounds', 'projectWork', 'projectsCard',
  'questionId', 'questions', 'readableProjectIds', 'refreshPending', 'replay',
  'riskList', 'rolesOf', 'roundFeedback', 'rulesProvider', 'search',
  'shareableView', 'snippet', 'sourcesCard', 'stateAt', 'stateAtTime', 'suggestions',
  'toConfirm', 'toItems', 'toParagraphs', 'tokenSet', 'tokens', 'userName',
  'viewFor', 'waitingCount', 'weeklyCard', 'workFor',
];

describe('the core contract is frozen', () => {
  it('event types are frozen', () => {
    expect(FROZEN_EVENT_TYPES).toHaveLength(44);
    expect([...EVENT_TYPES].sort()).toEqual(FROZEN_EVENT_TYPES);
  });

  it('runtime exports are frozen', () => expect(Object.keys(core).sort()).toEqual(FROZEN_EXPORTS));
});
