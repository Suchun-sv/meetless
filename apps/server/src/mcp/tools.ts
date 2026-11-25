import { z, type ZodRawShape } from 'zod';
import { MCP_TOOL_ROUTE, type ApiName, type McpToolName } from '@meetless/api';
import { EXT_STATUSES, HYP_STATUSES, parseNeedLink, WORK_EFFECTS } from '@meetless/core';

/** The tools whose input is a `NeedRef`: a `meetless://` link, or `projectId` plus `code`. */
const NEED_REF_TOOLS: ReadonlySet<McpToolName> = new Set<McpToolName>(['get_need_context', 'record_work', 'set_verdict']);

const INVALID_REF = { error: 'INVALID_REF' } as const;

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** `parseNeedLink`, or null for a link that does not parse (including a malformed %-escape). */
function parseLink(link: unknown): { projectId: string; ref: string } | null {
  if (typeof link !== 'string') return null;
  try {
    const r = parseNeedLink(link);
    return r && r.projectId !== '' && r.ref !== '' ? r : null;
  } catch {
    return null;
  }
}

/**
 * The route an MCP tool call runs (`MCP_TOOL_ROUTE`) and its request. For the `NeedRef` tools,
 * `link` resolves through `parseNeedLink` to `{ projectId, code: ref }` (a link wins over a
 * `projectId` and `code` given alongside it), else `projectId` and `code` are used as given;
 * a link that does not parse, or neither form, is `INVALID_REF`. `link` is never part of the
 * request. Nothing else is renamed: the other fields go to the route as they are.
 */
export function toRoute(
  tool: McpToolName,
  args: Record<string, unknown>,
): { name: ApiName; req: Record<string, unknown> } | { error: 'INVALID_REF' } {
  const name = MCP_TOOL_ROUTE[tool];
  if (!NEED_REF_TOOLS.has(tool)) return { name, req: { ...args } };
  const { link, ...rest } = args;
  if (link !== undefined) {
    const parsed = parseLink(link);
    if (!parsed) return INVALID_REF;
    return { name, req: { ...rest, projectId: parsed.projectId, code: parsed.ref } };
  }
  if (!nonEmpty(rest.projectId) || !nonEmpty(rest.code)) return INVALID_REF;
  return { name, req: rest };
}

const needRef = {
  link: z.string().optional().describe('The meetless:// link of the need, as given in a handoff. Or pass projectId and code.'),
  projectId: z.string().optional().describe('Project id, together with code, when there is no link.'),
  code: z.string().optional().describe('Need code such as N1 or H2, together with projectId.'),
};

const needKind = z.enum(['ext', 'hyp']).describe('ext: an external need. hyp: your own hypothesis.');

/** Each tool's input schema (`McpToolSpec`): the `NeedRef` fields are all optional strings; enums are zod enums. */
export const TOOL_INPUT: Record<McpToolName, ZodRawShape> = {
  get_need_context: {
    ...needRef,
    locale: z.enum(['zh-CN', 'en']).optional().describe('Language of the labels. Defaults to your own.'),
  },
  list_needs: {
    projectId: z.string().describe('Project id.'),
    kind: needKind.optional(),
    status: z.enum([...EXT_STATUSES, ...HYP_STATUSES]).optional(),
    round: z.union([z.literal('current'), z.number().int()]).optional().describe('current, or a round number.'),
  },
  search: {
    q: z.string().describe('Words to look for.'),
    projectId: z.string().optional().describe('Search only this project.'),
    limit: z.number().int().optional(),
  },
  read_artifact: {
    projectId: z.string(),
    artifactId: z.string(),
    versionId: z.string().optional().describe('A version id. Defaults to the latest version.'),
  },
  record_work: {
    ...needRef,
    text: z.string().describe('What you did, in one or two sentences.'),
    why: z.string().optional().describe('Why, when it is not obvious.'),
    effect: z.enum(WORK_EFFECTS).optional().describe('What the work did to the need.'),
    date: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
  },
  propose_need: {
    projectId: z.string(),
    kind: needKind,
    title: z.string().describe('The need in one line.'),
    accept: z.string().optional().describe('For ext: how to tell it is met.'),
    expect: z.string().optional().describe('For hyp: the expected result.'),
    verify: z.string().optional().describe('For hyp: how to test it.'),
    why: z.string().optional(),
    parentCode: z.string().optional().describe('Code of the need this one belongs under.'),
  },
  set_verdict: {
    ...needRef,
    status: z.enum(['testing', 'held', 'refuted', 'parked']),
    verdict: z.string().describe('What the evidence shows, in one or two sentences.'),
  },
};

/** Short English descriptions the agent reads when choosing a tool. No dot symbols. */
export const TOOL_DESCRIPTION: Record<McpToolName, string> = {
  get_need_context:
    'Get the live context of one need as markdown: what is asked, its round and status, sources, related work and handoffs. Call it before starting work on a need. Pass the meetless:// link from a handoff, or projectId and code.',
  list_needs: 'List the needs of a project that you can see, with code, title, kind, status and round. Filter by kind, status or round.',
  search: 'Search the needs, inputs, artifacts and work you can see, in all your projects or in one. Each hit names its need code when it has one.',
  read_artifact: "Read an artifact: its details, the need codes it is linked to and the text of its latest version, or of the version you name.",
  record_work:
    'Report work you did on a need, in the name of the person who owns this token. The report counts as progress on the need and shows in the project activity. Pass the link, or projectId and code.',
  propose_need:
    "Propose a new need for a project: ext for an external need, hyp for a hypothesis. The proposal goes to the team's 「待确认」 (To confirm) list for a person to accept; it is not created directly.",
  set_verdict:
    'Set the status and verdict of a hypothesis: testing, held, refuted or parked, with what the evidence shows. Pass the link, or projectId and code.',
};
