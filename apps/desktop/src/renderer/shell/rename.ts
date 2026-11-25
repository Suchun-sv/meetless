import { noDots, type Id } from '@meetless/core';

/**
 * Core's project-name rule for `project.renamed` (contract 12.23): dot symbols cleaned with
 * `noDots`, trimmed, 1 to 80 code points. The reducer keeps this constant private, so it is
 * repeated here; `test/shell/rename.test.tsx` checks that both agree.
 */
export const PROJECT_NAME_MAX = 80;

export type RenameOutcome =
  | { kind: 'none' }
  | { kind: 'error'; key: 'pj.nameEmpty' | 'pj.nameTooLong' }
  | { kind: 'cmd'; type: 'project.renamed'; payload: { projectId: Id; name: string } };

/** What a rename draft does: nothing (unchanged once cleaned), an error notice, or one `project.renamed` with the cleaned name. */
export function renameCommand(projectId: Id, current: string, draft: string): RenameOutcome {
  const name = noDots(draft).trim();
  if (name.length === 0) return { kind: 'error', key: 'pj.nameEmpty' };
  if ([...name].length > PROJECT_NAME_MAX) return { kind: 'error', key: 'pj.nameTooLong' };
  if (name === current) return { kind: 'none' };
  return { kind: 'cmd', type: 'project.renamed', payload: { projectId, name } };
}
