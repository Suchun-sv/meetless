/**
 * The U2 submit lock. `useApp().submit` answers a refusal itself (a `rejected` result with its
 * notice), but `bridge.submit` can also throw: the preload's `ipcRenderer.invoke` or the dev
 * bridge's `fetch` failing. A lock taken around such a submit must still be released, and the
 * user must see why nothing happened.
 */
import { useApp } from '../app/AppContext';

/**
 * Runs `fn` with `setBusy(true)`, then always `setBusy(false)` once it settles. A throw does not
 * escape as an unhandled rejection: `onThrow` raises the notice and the result is undefined.
 */
export async function withBusy<T>(setBusy: (b: boolean) => void, fn: () => Promise<T>, onThrow: () => void): Promise<T | undefined> {
  setBusy(true);
  try {
    return await fn();
  } catch {
    onThrow();
    return undefined;
  } finally {
    setBusy(false);
  }
}

/** The notice for a submit that threw instead of answering: the team service could not be reached. */
export function useThrowNotice(): () => void {
  const { notify, errorText } = useApp();
  return () => notify('error', errorText('NETWORK'));
}
