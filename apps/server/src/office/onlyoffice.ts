import { DomainError, noDots } from '@meetless/core';
import type { ApiRequest, ApiResponse } from '@meetless/api';
import type { ApiDeps } from '../api/frame';
import type { Principal } from '../auth';
import { OFFICE_PROXY_PREFIX } from '../web/office-proxy';
import { signHs256 } from './jwt';
import type { OfficeTickets, OfficeTicketExt } from './tickets';

const HEALTH_TIMEOUT_MS = 2_000;
const AVAILABLE_CACHE_MS = 30_000;

/** Artifact kinds OnlyOffice can view, and their file extension (identical to the kind, kept as its own map for clarity at the call site). */
const EXT_BY_KIND: Partial<Record<string, OfficeTicketExt>> = { docx: 'docx', pptx: 'pptx', pdf: 'pdf' };
const DOC_TYPE_BY_EXT: Record<OfficeTicketExt, 'word' | 'slide' | 'pdf'> = { docx: 'word', pptx: 'slide', pdf: 'pdf' };

/**
 * Builds a view-only OnlyOffice `config` for one artifact version, and tells whether
 * DocumentServer is reachable at all (contract §12.6, §12.13: view only, never edit;
 * `/v1/office-files` stays on the Unix socket, never the TCP listener).
 *
 * `available()` is cheap to call on every `office.config` request because its result is
 * cached for `AVAILABLE_CACHE_MS`: a DocumentServer outage does not turn into one slow
 * health-check fetch per viewer per request.
 */
export class OfficeViewer {
  private cachedAt: number | null = null;
  private cachedValue = false;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly deps: ApiDeps,
    private readonly tickets: OfficeTickets,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  /** `GET <url>/healthcheck`, body `true`, 2s timeout; the result is cached for 30s. */
  async available(): Promise<boolean> {
    const url = this.deps.cfg.onlyoffice.url;
    if (!url) return false;
    const now = this.deps.cfg.now().getTime();
    if (this.cachedAt !== null && now - this.cachedAt < AVAILABLE_CACHE_MS) return this.cachedValue;

    let ok: boolean;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      try {
        const res = await this.fetchImpl(`${url}/healthcheck`, { signal: controller.signal });
        ok = res.ok && (await res.text()).trim() === 'true';
      } finally {
        clearTimeout(timer);
      }
    } catch {
      ok = false;
    }
    this.cachedAt = now;
    this.cachedValue = ok;
    return ok;
  }

  /**
   * `webOrigin`: the caller's page origin (`<protocol>://<host>`) when it is a web session; the
   * browser then loads DocumentServer through the server's `/office` proxy (design 2026-11-25 §5).
   * Null (the desktop, an agent) keeps `MEETLESS_ONLYOFFICE_URL` as before.
   */
  async config(p: Principal, req: ApiRequest<'office.config'>, webOrigin: string | null = null): Promise<ApiResponse<'office.config'>> {
    // Privacy first (contract §12.9 pattern): an artifact or version the caller cannot see
    // in their own view answers NOT_FOUND, exactly like `artifacts.read` — before any
    // question of OnlyOffice configuration or kind is even asked, so none of that ever
    // leaks to someone who should not know the artifact exists at all.
    const view = this.deps.service.view(p.userId);
    const artifact = view.artifacts[req.artifactId];
    if (!artifact || artifact.projectId !== req.projectId) {
      throw new DomainError('NOT_FOUND', 'artifact not found', { what: 'artifact', projectId: req.projectId, artifactId: req.artifactId });
    }
    const version = artifact.versions.find((v) => v.id === req.versionId);
    if (!version) {
      throw new DomainError('NOT_FOUND', 'artifact version not found', {
        what: 'artifactVersion',
        projectId: req.projectId,
        artifactId: req.artifactId,
        versionId: req.versionId,
      });
    }

    const oo = this.deps.cfg.onlyoffice;
    if (!oo.url || !oo.jwtSecret || !oo.filesSocket) return { available: false, reason: 'not_configured' };

    const ext = EXT_BY_KIND[artifact.kind];
    if (!ext) return { available: false, reason: 'unsupported_kind' };
    if (!version.blobHash) return { available: false, reason: 'no_file' };

    if (!(await this.available())) return { available: false, reason: 'unavailable' };

    const mediaType = version.mediaType ?? 'application/octet-stream';
    const ticket = this.tickets.issue({ hash: version.blobHash, mediaType, ext });
    const u = Object.prototype.hasOwnProperty.call(this.deps.service.current.users, p.userId) ? this.deps.service.current.users[p.userId]! : null;
    const key = `ml-${version.blobHash.replace(/^sha256:/, '')}`;
    // No dot symbols anywhere in the UI (plan global constraint): the title is DocumentServer's
    // own on-screen label for the document, so it goes through `noDots` same as any other
    // visible text.
    const title = `${noDots(artifact.title)} ${noDots(version.label)}.${ext}`;
    const url = `${oo.publicUrl}/v1/office-files/${ticket}.${ext}`;

    const configWithoutToken = {
      documentType: DOC_TYPE_BY_EXT[ext],
      type: 'desktop' as const,
      document: {
        fileType: ext,
        key,
        title,
        url,
        permissions: {
          edit: false,
          comment: false,
          review: false,
          fillForms: false,
          modifyContentControl: false,
          modifyFilter: false,
          download: false,
          print: false,
          copy: true,
        },
      },
      editorConfig: {
        mode: 'view' as const,
        lang: u?.locale ?? 'en',
        user: { id: p.userId, name: u?.displayName ?? p.userId },
      },
    };
    const token = signHs256(configWithoutToken, oo.jwtSecret);
    const documentServerUrl = webOrigin ? `${webOrigin}${OFFICE_PROXY_PREFIX}` : oo.url;
    return { available: true, documentServerUrl, config: { ...configWithoutToken, token } };
  }
}
