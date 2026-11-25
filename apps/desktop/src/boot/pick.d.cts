interface HotStateFile {
  current: string | null;
  booting: string | null;
  bad: string[];
}
interface ShellKey {
  electron: string;
  abi: string | number | null;
  fuses: string;
}
export function readState(hotDir: string): HotStateFile;
export function writeState(hotDir: string, s: HotStateFile): void;
export function sameShell(a: ShellKey | null, b: ShellKey | null): boolean;
export function pickHot(hotDir: string, bundledDir: string): { commit: string; main: string } | null;
export function markBad(hotDir: string, commit: string): void;
export function markReady(hotDir: string, commit: string): void;
