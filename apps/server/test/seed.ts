import type { EventPayloads, EventType, Id } from '@meetless/core';
import { cmd, http, IDS, TODAY, TOKENS } from './helpers';

/** What `seedTeam` created. `needs` and `artifacts` map a name (the need's code) to its id. */
export interface Team {
  projectId: 'p1';
  roundId: Id;
  roleId: Id;
  needs: { N1: Id; H1: Id; Hp1: Id };
  handoffId: Id;
  artifacts: { deck: Id; secret: Id };
}

/** The word only Alex's private items carry: no shared item, id or title contains it. */
export const PRIVATE_WORD = 'zebrafish';

const TEAM: Team = {
  projectId: 'p1',
  roundId: 'round-p1-1',
  roleId: 'r-dev',
  needs: { N1: 'need-p1-n1', H1: 'need-p1-h1', Hp1: 'need-p1-hp1' },
  handoffId: 'handoff-p1-1',
  artifacts: { deck: 'art-p1-deck', secret: 'art-p1-secret' },
};

/**
 * A small team on a running server, through `/v1/commands` with dev tokens only:
 * - Alex creates project p1, adds Lin and Zhou, creates role r-dev with Lin, and a round (the current one).
 * - Alex creates shared needs N1 (ext) and H1 (hyp), and a private hypothesis Hp1 "zebrafish dosing".
 * - Alex hands N1 to Lin.
 * - Alex creates a shared pdf artifact `deck` linked to N1, and a private docx artifact `secret` linked to Hp1;
 *   neither has a version (file) yet.
 * - Eve is in no project.
 * Call it once per server (the ids are fixed).
 */
export async function seedTeam(base: string): Promise<Team> {
  const t = TEAM;
  const p = t.projectId;
  const source = (quote: string) => ({ src: 'meeting' as const, date: TODAY, quote, ref: 'kickoff notes' });
  const as = async <K extends EventType>(type: K, payload: EventPayloads[K]) => {
    const r = await http(base, TOKENS.alex, 'POST', '/v1/commands', cmd(type, payload));
    if (r.status !== 201) throw new Error(`seedTeam: ${type} answered ${r.status} ${JSON.stringify(r.json)}`);
  };

  await as('project.created', { projectId: p, name: 'Client portal first delivery' });
  await as('project.member_added', { projectId: p, userId: IDS.lin });
  await as('project.member_added', { projectId: p, userId: IDS.zhou });
  await as('role.created', { roleId: t.roleId, projectId: p, name: 'Developer' });
  await as('role.member_assigned', { roleId: t.roleId, userId: IDS.lin });
  await as('round.created', { roundId: t.roundId, projectId: p, title: 'Round 1', kind: 'hard', start: '2026-11-18', due: '2026-11-28' });

  await as('need.created', { needId: t.needs.N1, projectId: p, kind: 'ext', title: 'Export customer data to CSV', roundId: t.roundId, source: source('Customers need a CSV export') });
  await as('need.created', {
    needId: t.needs.H1,
    projectId: p,
    kind: 'hyp',
    title: 'Caching the list halves load time',
    roundId: t.roundId,
    expect: 'List loads in under one second',
    source: source('The list feels slow'),
  });
  await as('need.created', { needId: t.needs.Hp1, projectId: p, kind: 'hyp', title: `${PRIVATE_WORD} dosing`, roundId: t.roundId, source: source(`${PRIVATE_WORD} dosing idea`), private: true });

  await as('handoff.created', { handoffId: t.handoffId, projectId: p, needId: t.needs.N1, toId: IDS.lin, ask: 'Draft the export format', due: null });

  await as('artifact.created', { artifactId: t.artifacts.deck, projectId: p, kind: 'pdf', title: 'Kickoff deck', where: 'local', needIds: [t.needs.N1] });
  await as('artifact.created', { artifactId: t.artifacts.secret, projectId: p, kind: 'docx', title: 'Dosing notes', where: 'local', needIds: [t.needs.Hp1], private: true });
  return structuredClone(t);
}
