import type { Id, MaterialCite } from '@meetless/core';

/**
 * Where something in a reply, a chip or a lineage row opens. Screens map it onto the router or an
 * overlay; the models never know about either.
 */
export type Target =
  | { kind: 'need'; projectId: Id; needId: Id }
  | { kind: 'confirm'; projectId: Id }
  | { kind: 'handoff'; projectId: Id; needId: Id; toId: Id | null }
  | { kind: 'link'; projectId: Id; needId: Id }
  | { kind: 'input'; projectId: Id; inputId: Id; paraId?: Id }
  | { kind: 'artifact'; projectId: Id; artifactId: Id; versionId?: Id; page?: number }
  | { kind: 'dash'; scope: 'home' | Id };

/** Where a material cite of an answer opens: the input at its paragraph, or the artifact at its version and page. */
export function materialTarget(m: Pick<MaterialCite, 'kind' | 'id' | 'projectId' | 'versionId' | 'page' | 'paraId'>): Target {
  if (m.kind === 'artifact') {
    return { kind: 'artifact', projectId: m.projectId, artifactId: m.id, ...(m.versionId ? { versionId: m.versionId } : {}), ...(m.page != null ? { page: m.page } : {}) };
  }
  return { kind: 'input', projectId: m.projectId, inputId: m.id, ...(m.paraId ? { paraId: m.paraId } : {}) };
}
