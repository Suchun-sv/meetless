/**
 * What the host can do beyond the network bridge. Only the desktop app (apps/desktop preload,
 * `window.meetlessShell`) has any; native and the web have none. Screens show a button for one of
 * these only when `hasCapability(name)` from `@/bridge` is true.
 * - localGit: pickRepo / listRepos / repoLog / repoDiff / repoPatch / repoSnapshot / captureBindRepo, captureRun on local repos
 * - overleafGit: overleafSetToken / overleafSync
 * - notionMcp: notionConnect / notionDisconnect / notionPage
 * - pickDirectory: pickRepo opens the OS folder dialog
 * - appUpdates: updatesCheck / updatesInstall and `update` events
 * - openLogs: openLogs
 */
export type Capability = 'localGit' | 'overleafGit' | 'notionMcp' | 'pickDirectory' | 'appUpdates' | 'openLogs';

export interface DesktopShell {
  host: 'electron';
  platform: string;
  capabilities: Capability[];
}
