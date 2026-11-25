import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

export const BLOB_HASH = /^sha256:[0-9a-f]{64}$/;

export function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Content-addressed, immutable blob bytes on the local filesystem:
 * `<dataDir>/blobs/sha256/<2 hex>/<62 hex>`. A write goes to a temp file and
 * is renamed into place, so a reader never sees a partial blob, and writing an
 * existing hash is a no-op (the existing file is never replaced).
 */
export class BlobFiles {
  constructor(private readonly dataDir: string) {}

  path(hash: string): string {
    if (!BLOB_HASH.test(hash)) throw new Error(`invalid blob hash ${hash}`);
    const hex = hash.slice('sha256:'.length);
    return join(this.dataDir, 'blobs', 'sha256', hex.slice(0, 2), hex.slice(2));
  }

  async exists(hash: string): Promise<boolean> {
    try {
      return (await stat(this.path(hash))).isFile();
    } catch {
      return false;
    }
  }

  /** Writes bytes whose sha256 the caller has verified equals `hash`. */
  async write(hash: string, bytes: Uint8Array): Promise<{ created: boolean }> {
    if (await this.exists(hash)) return { created: false };
    const final = this.path(hash);
    const dir = join(final, '..');
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.tmp-${randomUUID()}`);
    await writeFile(tmp, bytes, { flag: 'wx' });
    if (await this.exists(hash)) {
      await rm(tmp, { force: true });
      return { created: false };
    }
    await rename(tmp, final);
    return { created: true };
  }

  read(hash: string): Readable {
    return createReadStream(this.path(hash));
  }

  async readBytes(hash: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(hash)));
  }
}
