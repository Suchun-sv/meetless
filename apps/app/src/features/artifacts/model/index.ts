import { isWebUrl, noDots, SEP, type Artifact, type ArtifactKind, type ArtifactVersion, type DerivedPreview, type Id, type State } from '@meetless/core';
import type { Locale, MessageKey, Params } from '@meetless/i18n';
import { acceptFor, artifactList, fileKinds, shareState, versionLine } from '@renderer/artifacts/model';
import { OFFICE_LOAD_TIMEOUT_MS, type OfficeEvent, type OfficeState } from '@renderer/artifacts/office';
import { usesSource } from '@renderer/artifacts/source-model';

export * from '@renderer/artifacts/model';
export * from '@renderer/artifacts/office';
export * from '@renderer/artifacts/actions';
export { usesSource, sourceRow, type SourceRow } from '@renderer/artifacts/source-model';

type T = (key: MessageKey, params?: Params) => string;
type FmtDay = (d: string) => string;

export interface ArtifactRow {
  id: Id;
  kind: ArtifactKind;
  title: string;
  fact: string;
  mine: boolean;
  selected: boolean;
}

export function artifactRows(s: State, me: Id, projectId: Id, selectedId: Id | null, fmtDay: FmtDay): ArtifactRow[] {
  return artifactList(s, projectId).map((a) => {
    const v0 = a.versions[0];
    return {
      id: a.id,
      kind: a.kind,
      title: noDots(a.title),
      fact: [noDots(a.where), v0 ? fmtDay(v0.date) : null].filter((x): x is string => !!x).join(SEP),
      mine: a.privateTo === me,
      selected: a.id === selectedId,
    };
  });
}

export interface ArtifactHeader {
  title: string;
  mine: boolean;
  /** 复制给 Agent: shared artifacts only. */
  canCopy: boolean;
  /** 在 {where} 打开, when the url is a web url. */
  openUrl: string | null;
  where: string;
  share: ReturnType<typeof shareState>;
}

export function artifactHeader(s: State, me: Id, a: Artifact): ArtifactHeader {
  return {
    title: noDots(a.title),
    mine: a.privateTo !== null,
    canCopy: a.privateTo === null,
    openUrl: a.url && isWebUrl(a.url) ? a.url : null,
    where: noDots(a.where),
    share: shareState(s, me, a),
  };
}

export interface VersionRow {
  id: Id;
  label: string;
  day: string;
  /** Label, day and round, for a tooltip or a second line. */
  line: string;
  selected: boolean;
}

export function versionRows(t: T, fmtDay: FmtDay, s: State, a: Artifact, selectedId: Id | null): VersionRow[] {
  return a.versions.map((v) => ({ id: v.id, label: noDots(v.label), day: fmtDay(v.date), line: versionLine(t, fmtDay, s, v), selected: v.id === selectedId }));
}

/** What the centre pane shows for this artifact and version. */
export type ViewerMode = 'source' | 'none' | 'office' | 'plain';

export function viewerMode(a: Artifact, v: ArtifactVersion | null): ViewerMode {
  if (usesSource(a, v)) return 'source';
  if (!v) return 'none';
  if (fileKinds.has(a.kind) || (a.kind === 'overleaf' && !!v.blobHash)) return 'office';
  return 'plain';
}

const EXT_BY_MEDIA: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/** The original file's download name: title plus the extension its media type (else its kind) implies. */
export function originalFileName(a: Artifact, v: ArtifactVersion): string {
  const ext = (v.mediaType ? EXT_BY_MEDIA[v.mediaType] : undefined) ?? acceptFor(a.kind) ?? '';
  return `${noDots(a.title)}${ext}`;
}

export interface FallbackView {
  reasonKey: string;
  isPdf: boolean;
  hasFile: boolean;
  /** LibreOffice page images for pptx/docx; null for a pdf or no file. */
  derived: DerivedPreview | null;
  /** 'pending' before conversion, 'failed', or 'pages' with at least one page. */
  pages: 'none' | 'pending' | 'failed' | 'pages';
}

/** The fallback body: reason, then PDF note or page images, and the original download when there is a file. */
export function fallbackView(state: Extract<OfficeState, { phase: 'fallback' }>, a: Artifact, v: ArtifactVersion): FallbackView {
  const isPdf = a.kind === 'pdf' || v.mediaType === 'application/pdf';
  const hasFile = !!v.blobHash;
  const derived = !isPdf && hasFile ? v.derived : null;
  const pages: FallbackView['pages'] =
    isPdf || !hasFile ? 'none' : !derived ? 'pending' : derived.status === 'failed' ? 'failed' : derived.pageHashes.length > 0 ? 'pages' : 'pending';
  return { reasonKey: `af.reason.${state.reason}`, isPdf, hasFile, derived, pages };
}

export interface PageCard {
  index: number;
  hash: string;
  text: string | null;
  on: boolean;
  slide: boolean;
}

export function pageCards(kind: ArtifactKind, derived: DerivedPreview, page: number | undefined): PageCard[] {
  return derived.pageHashes.map((hash, i) => ({ index: i, hash, text: derived.texts[i] ? noDots(derived.texts[i]!) : null, on: page === i, slide: kind === 'pptx' }));
}

/* ---------- OnlyOffice inside a WebView (native) or an iframe srcdoc (web) ---------- */

export const OFFICE_MSG_SOURCE = 'meetless-office';

/**
 * A self-contained page that loads the DocumentServer `api.js`, mounts the read-only editor and
 * posts `{ source, type }` back: `app_ready`, `editor_error`, `script_failed` or `timeout`. It
 * posts through `ReactNativeWebView` when present, else to `window.parent` (iframe on web). The
 * same timeouts as the desktop frame: one for the script, one for `onAppReady`.
 */
/** The office.config answer as the viewer mounts it: full size, read-only type by layout, the UI language. */
export function officeEditorConfig(config: Record<string, unknown>, locale: Locale, mobile: boolean): Record<string, unknown> {
  const editorConfig = (config.editorConfig ?? {}) as Record<string, unknown>;
  return { ...config, width: '100%', height: '100%', type: mobile ? 'mobile' : 'desktop', editorConfig: { ...editorConfig, lang: locale } };
}

export function officeHtml(documentServerUrl: string, config: Record<string, unknown>, locale: Locale, mobile: boolean, timeoutMs: number = OFFICE_LOAD_TIMEOUT_MS): string {
  const full = officeEditorConfig(config, locale, mobile);
  const json = (x: unknown) => JSON.stringify(x).replace(/</g, '\\u003c').split('\u2028').join('\\u2028').split('\u2029').join('\\u2029');
  const src = `${documentServerUrl.replace(/\/+$/, '')}/web-apps/apps/api/documents/api.js`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body,#ed{margin:0;padding:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="ed"></div>
<script>
(function(){
  var done=false, timer=null;
  function post(type){ var m=JSON.stringify({source:${json(OFFICE_MSG_SOURCE)},type:type});
    if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(m)} else if(window.parent&&window.parent!==window){window.parent.postMessage(m,'*')} }
  function settle(type){ if(timer){clearTimeout(timer);timer=null} if(type==='app_ready'){done=true} post(type) }
  timer=setTimeout(function(){ if(!done) settle('timeout') }, ${timeoutMs});
  var s=document.createElement('script'); s.src=${json(src)}; s.async=true;
  s.onerror=function(){ settle('script_failed') };
  s.onload=function(){
    if(!window.DocsAPI){ settle('script_failed'); return }
    clearTimeout(timer); timer=setTimeout(function(){ if(!done) settle('timeout') }, ${timeoutMs});
    var cfg=${json(full)};
    cfg.events={ onAppReady:function(){ settle('app_ready') }, onError:function(){ settle('editor_error') } };
    try { new window.DocsAPI.DocEditor('ed', cfg) } catch(e) { settle('editor_error') }
  };
  document.head.appendChild(s);
})();
</script></body></html>`;
}

/** Parses a message from `officeHtml`'s page into an office event; anything else is null. */
export function officeMessage(data: unknown): OfficeEvent | null {
  let m: unknown = data;
  if (typeof data === 'string') {
    try {
      m = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object') return null;
  const { source, type } = m as { source?: unknown; type?: unknown };
  if (source !== OFFICE_MSG_SOURCE) return null;
  if (type === 'app_ready' || type === 'editor_error' || type === 'script_failed' || type === 'timeout') return { type };
  return null;
}

/* ---------- blobs as data URIs (no object URLs on native) ---------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function dataUri(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
}
