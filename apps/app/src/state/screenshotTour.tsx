import { useEffect, useRef } from 'react';
import { usePathname, useRouter, type Href } from 'expo-router';
import { tourAck, tourReport } from './tourFiles';

/**
 * Screenshot builds only (bundle-time env, never in committed config). EXPO_PUBLIC_SCREENSHOT_TOUR is
 * `name=path,name=path,...`. After sign-in the app visits each path; once the pathname matches and
 * the page has settled it reports the step as ready (Documents/tour-state.json), and moves on only
 * when the build script has taken the screenshot and acked it (Documents/tour-ack). No fixed clock.
 */
const RAW: string = process.env.EXPO_PUBLIC_DEEPLINK_SIGNIN === '1' ? (process.env.EXPO_PUBLIC_SCREENSHOT_TOUR ?? '') : '';
const SETTLE_MS = 2500;
const MATCH_TIMEOUT_MS = 10000;

interface Step {
  name: string;
  path: string;
}

const STEPS: Step[] = RAW.split(',')
  .filter(Boolean)
  .map((s: string) => {
    const eq = s.indexOf('=');
    return eq > 0 ? { name: s.slice(0, eq), path: s.slice(eq + 1) } : { name: s, path: s };
  });

function pathOnly(p: string): string {
  const q = p.indexOf('?');
  return decodeURIComponent(q === -1 ? p : p.slice(0, q)).replace(/\/+$/, '') || '/';
}

export function ScreenshotTour() {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (STEPS.length === 0) return;
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    void (async () => {
      for (let i = 0; i < STEPS.length && alive; i++) {
        const step = STEPS[i]!;
        router.navigate(step.path as Href);
        const want = pathOnly(step.path);
        const t0 = Date.now();
        while (alive && pathOnly(pathRef.current) !== want && Date.now() - t0 < MATCH_TIMEOUT_MS) await sleep(200);
        await sleep(SETTLE_MS);
        tourReport({ step: i, name: step.name, path: step.path, matched: pathOnly(pathRef.current) === want, total: STEPS.length });
        while (alive && tourAck() < i) await sleep(300);
      }
      tourReport({ step: STEPS.length, name: 'done', path: '', matched: true, total: STEPS.length });
    })();
    return () => {
      alive = false;
    };
  }, [router]);
  return null;
}
