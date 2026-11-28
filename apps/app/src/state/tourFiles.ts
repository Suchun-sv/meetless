import { File, Paths } from 'expo-file-system';

/** Native: the tour's handshake files in the app's Documents (read by the build script on the host). */
export function tourReport(state: object): void {
  try {
    new File(Paths.document, 'tour-state.json').write(JSON.stringify(state));
  } catch {
    // Not fatal: the script times out on this step.
  }
}

export function tourAck(): number {
  try {
    const f = new File(Paths.document, 'tour-ack');
    return f.exists ? Number(f.textSync().trim()) : -1;
  } catch {
    return -1;
  }
}
