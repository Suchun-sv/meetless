import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Server-side OCR, for images sent without device text (web, desktop) and PDF pages with no text
 * layer: the infra/ocr image (PaddleOCR models via RapidOCR), run without network. Off unless
 * MEETLESS_OCR_IMAGE names the image.
 */
export interface OcrConfig {
  image: string;
  docker: string;
  env: NodeJS.ProcessEnv;
}

export function ocrConfigFrom(env: Record<string, string | undefined>): OcrConfig | null {
  if (!env.MEETLESS_OCR_IMAGE) return null;
  const home = homedir();
  return {
    image: env.MEETLESS_OCR_IMAGE,
    docker: env.MEETLESS_OCR_DOCKER ?? 'docker',
    env: {
      PATH: [join(home, 'bin'), join(home, '.local/bin'), env.PATH ?? '/usr/local/bin:/usr/bin:/bin'].join(':'),
      HOME: home,
      DOCKER_HOST: env.DOCKER_HOST ?? `unix:///run/user/${process.getuid?.() ?? 1000}/docker.sock`,
    },
  };
}

/** The text of an image (one page) or a scanned PDF (one entry per page, at most `maxPages`). */
export async function ocr(cfg: OcrConfig, bytes: Uint8Array, ext: string, maxPages = 30): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'meetless-ocr-'));
  try {
    writeFileSync(join(dir, `in.${ext}`), bytes);
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        cfg.docker,
        ['run', '--rm', '--network', 'none', '--memory', '2g', '-v', `${dir}:/d:ro`, cfg.image, `/d/in.${ext}`, String(maxPages)],
        { env: cfg.env, timeout: 5 * 60_000, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout)),
      );
    });
    const pages = (JSON.parse(out) as { pages?: unknown }).pages;
    return Array.isArray(pages) ? pages.map((p) => (typeof p === 'string' ? p.trim() : '')) : [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
