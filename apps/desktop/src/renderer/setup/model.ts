import type { AgentCall, InviteInfo } from '@meetless/api';
import { membersOf, type Id, type IsoDate, type Round, type RoundKind, type State, type User } from '@meetless/core';
import type { Translator } from '@meetless/i18n';
import type { U1Command } from '../chat/model';
import { newId } from '../model/ids';

/** The invite form's fields (contract §4 `redeemInvite`). The server URL's own validity is checked by the bridge. */
export interface InviteForm {
  server: string;
  name: string;
  code: string;
}

/**
 * The invite form's validation error, or null when both the name and the code have more than
 * whitespace. Checked client-side so a blank field never reaches the bridge; the URL itself is
 * checked by the bridge (it trims and upper-cases the code, so padding and case are not errors
 * here).
 */
export function inviteFormError(t: Translator['t'], f: InviteForm): string | null {
  if (!f.name.trim()) return t('signin.nameMissing');
  if (!f.code.trim()) return t('signin.codeMissing');
  return null;
}

interface SignInDetails {
  url?: string;
  message?: string;
  seconds?: number;
  retryAfter?: unknown;
}

/**
 * The message shown for a failed sign-in or invite redemption (contract §12.8), behind
 * `SignIn.tsx`'s `signInError`: `signin.failed` names the URL that was tried (`details.url`, else
 * the server the user typed) and a reason.
 * - `RATE_LIMITED` shows `error.RATE_LIMITED` with `Math.ceil(details.retryAfter)` seconds. The
 *   client puts the server's `retryAfter` there for `api()`, `signIn` and `redeemInvite` alike
 *   (R49). Without a numeric `retryAfter` it shows `error.generic` with the code, never a made-up wait.
 * - `HTTP_404` means this server does not implement the route yet (`error.NOT_IMPLEMENTED`).
 * - Any other code with its own `error.<code>` entry uses it (`TIMEOUT` reads `details.seconds`);
 *   the rest fall back to `errorText`.
 * A `details.message` from the bridge (a transport detail, not a reason on its own) is appended in brackets.
 */
export function signInMessage(t: Translator['t'], tr: Translator, errorText: (code: string) => string, r: { code: string; details?: unknown }, server: string): string {
  const d = (r.details ?? {}) as SignInDetails;
  let reason: string;
  if (r.code === 'RATE_LIMITED') {
    const s = d.retryAfter;
    reason = typeof s === 'number' && Number.isFinite(s) && s >= 0 ? t('error.RATE_LIMITED', { seconds: Math.ceil(s) }) : t('error.generic', { code: r.code });
  } else if (r.code === 'HTTP_404') reason = t('error.NOT_IMPLEMENTED');
  else reason = tr.has(`error.${r.code}`) ? tr.tDynamic(`error.${r.code}`, { seconds: d.seconds ?? 10 }) : errorText(r.code);
  return t('signin.failed', { url: d.url ?? server, reason: d.message ? `${reason} (${d.message})` : reason });
}

/**
 * The error text for a failed api route inside its own section (ruling R22). `HTTP_404` means the
 * server has no such route (S has not shipped it yet, or the server is older than this client), so
 * it reads as a plain sentence, `pj.unsupported`, never as a raw status code. Every other code keeps
 * `errorText(code)` (contract: a failed route shows its error through `errorText`).
 */
export function routeErrorText(t: Translator['t'], errorText: (code: string) => string, code: string): string {
  return code === 'HTTP_404' ? t('pj.unsupported') : errorText(code);
}

/** The commands a new project's form produces: `project.created` with the trimmed name, or none when it is blank. */
export function newProjectCommands(a: { projectId: Id; name: string; description: string }): U1Command[] {
  const name = a.name.trim();
  if (!name) return [];
  const description = a.description.trim();
  return [{ type: 'project.created', payload: { projectId: a.projectId, name, ...(description ? { description } : {}) } }];
}

/** Everyone not already a member of `projectId`, sorted by display name (the "Add member" picker). */
export function addableUsers(s: State, projectId: Id): User[] {
  const members = new Set(membersOf(s, projectId));
  return Object.values(s.users)
    .filter((u) => !members.has(u.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** One row per member, in membership order, with the ids of every role they hold. */
export function memberRows(s: State, projectId: Id): { userId: Id; name: string; roleIds: Id[] }[] {
  const roles = Object.values(s.roles).filter((r) => r.projectId === projectId);
  return membersOf(s, projectId).map((userId) => ({
    userId,
    name: s.users[userId]?.displayName ?? userId,
    roleIds: roles.filter((r) => r.memberIds.includes(userId)).map((r) => r.id),
  }));
}

/** Adding a member: `project.member_added`, then `role.member_assigned` when a role was picked. */
export function addMemberCommands(projectId: Id, userId: Id, roleId: Id | null): U1Command[] {
  const cmds: U1Command[] = [{ type: 'project.member_added', payload: { projectId, userId } }];
  if (roleId) cmds.push({ type: 'role.member_assigned', payload: { roleId, userId } });
  return cmds;
}

/** Role commands: create (empty name sends nothing), assign and remove. */
export const roleCommands = {
  create(projectId: Id, name: string): U1Command[] {
    const n = name.trim();
    if (!n) return [];
    return [{ type: 'role.created', payload: { roleId: newId('r'), projectId, name: n } }];
  },
  assign(roleId: Id, userId: Id): U1Command[] {
    return [{ type: 'role.member_assigned', payload: { roleId, userId } }];
  },
  remove(roleId: Id, userId: Id): U1Command[] {
    return [{ type: 'role.member_removed', payload: { roleId, userId } }];
  },
};

/** An invite's status: revoked wins over used, used over open. */
export function inviteStatus(i: InviteInfo): 'open' | 'used' | 'revoked' {
  if (i.revokedAt) return 'revoked';
  if (i.usedBy) return 'used';
  return 'open';
}

/**
 * Whether a "create role" submit should proceed: a non-blank name, and not already in flight.
 * Guards both the button's `disabled` and the handler itself, so a fast double-click (the
 * handler fires again while the first submit is still pending, `roleName` still populated) does
 * not mint two roles with the same name under two different ids.
 */
export function canCreateRole(name: string, busy: boolean): boolean {
  return !busy && name.trim().length > 0;
}

/** A round's draft fields in the rounds setup page's add form and inline edit. */
export interface RoundDraft {
  title: string;
  kind: RoundKind;
  start: IsoDate;
  due: IsoDate;
}

const DAY_MS = 86_400_000;
/** Noon UTC, like core `daysBetween`, so a day shift never depends on the local time zone. */
const dayMs = (d: IsoDate) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
const addDays = (d: IsoDate, n: number): IsoDate => new Date(dayMs(d) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The next round's default draft: the title is empty and the kind is `hard`; `start` is the day
 * after the latest `due` among `rounds`, or `today` when there are none; `due` is `start` plus
 * 13 days (a two-week round, start and due both inclusive).
 */
export function nextRoundDraft(rounds: Round[], today: IsoDate): RoundDraft {
  const latestDue = rounds.reduce<IsoDate | null>((max, r) => (max === null || r.due > max ? r.due : max), null);
  const start = latestDue ? addDays(latestDue, 1) : today;
  return { title: '', kind: 'hard', start, due: addDays(start, 13) };
}

/** Whether `d` is a real calendar day in `YYYY-MM-DD` form (what a date input gives; '' once cleared). */
function isDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ms = Date.parse(`${d}T12:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
}

/**
 * The round draft's validation error, or null (contract Review Focus 3): a blank title, a missing
 * or invalid start or due date (a cleared date input gives ''), then a due date before the start.
 * Checked client-side, before anything is sent, so core never has to reject it.
 */
export function roundDraftError(t: Translator['t'], d: RoundDraft): string | null {
  if (!d.title.trim()) return t('pj.titleMissing');
  if (!isDay(d.start)) return t('pj.startMissing');
  if (!isDay(d.due)) return t('pj.dueMissing');
  if (d.due < d.start) return t('pj.dueBeforeStart');
  return null;
}

/**
 * Whether a round draft submit should proceed: `roundDraftError` is null, and not already in
 * flight. Guards the submit handler itself (the same pattern as `canCreateRole`), for
 * `round-add` and the inline edit's `round-edit-save` alike, so a fast double-click does not
 * create or update a round twice. The button's own `disabled` stays tied to `busy` alone (not
 * to this), so an invalid draft can still be submitted once to reveal its `round-error`.
 */
export function canSubmitRound(t: Translator['t'], d: RoundDraft, busy: boolean): boolean {
  return !busy && roundDraftError(t, d) === null;
}

/** `round.created` for a new round from its draft (the title trimmed); `roundId` is minted by the caller. */
export function roundCreateCommand(projectId: Id, d: RoundDraft, roundId: Id): U1Command {
  return { type: 'round.created', payload: { roundId, projectId, title: d.title.trim(), kind: d.kind, start: d.start, due: d.due } };
}

/**
 * `round.updated` carrying only the fields that changed between the round `r` and the draft `d`,
 * or null when nothing changed or `r` is delivered (contract Review Focus 3: delivered rounds
 * are frozen). This freeze on `title`/`kind`/`start`/`due` is enforced only here, on the client
 * (this null return, plus the hidden edit control in `RoundsPage`): core's `round.updated`
 * handler applies those fields unconditionally, whatever the round's status — it only guards
 * delivered status for `items`. Core never sees an edit to a delivered round's title or dates
 * from this page, but nothing in the reducer itself would refuse one.
 */
export function roundUpdateCommand(r: Round, d: RoundDraft): U1Command | null {
  if (r.status === 'delivered') return null;
  const title = d.title.trim();
  const patch: { roundId: Id; title?: string; kind?: RoundKind; start?: IsoDate; due?: IsoDate } = { roundId: r.id };
  if (title !== r.title) patch.title = title;
  if (d.kind !== r.kind) patch.kind = d.kind;
  if (d.start !== r.start) patch.start = d.start;
  if (d.due !== r.due) patch.due = d.due;
  if (Object.keys(patch).length === 1) return null;
  return { type: 'round.updated', payload: patch };
}

/**
 * The env line Codex is told to run before it reads `MEETLESS_TOKEN` (contract §12.1): Codex's
 * `bearer_token_env_var` names the variable, so the TOML itself never carries the token.
 */
export const CODEX_ENV = 'export MEETLESS_TOKEN=<TOKEN>';

/**
 * Replaces every `<TOKEN>` placeholder in `text` with `token`, or leaves the placeholder as-is
 * while there is no token yet (before a token has been created, or after this page's own copy
 * of it is gone). The agent setup snippets (contract §12.1 `claudeCommand`, `CODEX_ENV`) are the
 * only callers; `codexToml` never carries `<TOKEN>` at all, so it is shown as given.
 */
export function withToken(text: string, token: string | null): string {
  return token === null ? text : text.split('<TOKEN>').join(token);
}

/**
 * The agent calls log's client column (contract §12.1 `CLIENT_HEADER`): the two known clients
 * get a product name, any other header value is shown as given (an unrecognised but real
 * client), and a call with no client at all (an older agent token with no header) falls back to
 * the generic "MCP".
 */
export function clientLabel(c: AgentCall): string {
  if (c.client === 'claude-code') return 'Claude Code';
  if (c.client === 'codex') return 'Codex';
  return c.client ?? 'MCP';
}

/**
 * The agents page's token section error after a `tokens.create` attempt, factored out as a pure
 * function so the fix it encodes is unit-testable without rendering (`AgentsPage` never runs its
 * effects or handlers under `renderToStaticMarkup`): a success clears whatever error an earlier
 * `tokens.list` or `tokens.create` left behind, the same way `Invites.tsx`'s `create()` calls
 * `setError(null)` on success; a failure replaces it with the new one. Before this existed,
 * `AgentsPage.createToken`'s success branch left a stale `tokensError` in place, so a create
 * that followed an earlier failure still rendered the `agents-error` block over `TokenList`
 * instead of the new token.
 */
export function tokenSectionErrorAfterCreate(result: { ok: true } | { ok: false; error: string }): string | null {
  return result.ok ? null : result.error;
}
