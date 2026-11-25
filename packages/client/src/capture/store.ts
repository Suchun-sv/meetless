/**
 * U3-owned. Local-only capture metadata: which repo an artifact is bound to,
 * the Overleaf git binding and its last sync failure (T2), the last run per
 * artifact, and secrets (currently just the Overleaf token). Never synced to
 * the server. The Notion OAuth file (T3, capture/notion.ts) reuses the same
 * reader and atomic writer. Writes are atomic (write to a temp file, then rename);
 * `secrets.json` is created at mode 0600 - the temp file is born with that
 * mode (passed to `writeFileSync`'s own `mode` option), never chmod'd after
 * the fact, so there is no window where it is readable by anyone else.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Id, IsoTime } from '@meetless/core';
import type { CaptureCode } from './types';

interface CaptureData {
  bindings: Record<Id, { repoId: string }>;
  overleaf: Record<Id, { repoId: string; url: string; syncedAt: IsoTime }>;
  /** Code of the last failed `syncOverleaf`, cleared on the next success. Kept even once `overleaf[id]` exists, so a later failure still shows. */
  overleafErrors: Record<Id, CaptureCode>;
  lastRun: Record<Id, IsoTime>;
}

interface SecretsData {
  overleafToken?: string | null;
}

function emptyData(): CaptureData {
  return { bindings: {}, overleaf: {}, overleafErrors: {}, lastRun: {} };
}

/** Shared with the Notion OAuth file (T3), so every capture file goes through the same reader and atomic writer. */
export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file: string, value: unknown, mode?: number): void {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const data = JSON.stringify(value, null, 2);
  if (mode !== undefined) writeFileSync(tmp, data, { mode });
  else writeFileSync(tmp, data);
  renameSync(tmp, file);
}

export class CaptureStore {
  private readonly dataFile: string;
  private readonly secretsFile: string;
  private data: CaptureData;
  private secrets: SecretsData;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.dataFile = join(dir, 'capture.json');
    this.secretsFile = join(dir, 'secrets.json');
    this.data = readJson(this.dataFile, emptyData());
    this.data.overleafErrors ??= {}; // tolerate a capture.json written before this field existed
    this.secrets = readJson(this.secretsFile, {});
  }

  bindings(): Record<Id, { repoId: string }> {
    return this.data.bindings;
  }

  bind(artifactId: Id, repoId: string | null): void {
    if (repoId === null) delete this.data.bindings[artifactId];
    else this.data.bindings[artifactId] = { repoId };
    this.save();
  }

  overleaf(artifactId: Id): { repoId: string; url: string; syncedAt: IsoTime } | null {
    return this.data.overleaf[artifactId] ?? null;
  }

  setOverleaf(artifactId: Id, info: { repoId: string; url: string; syncedAt: IsoTime } | null): void {
    if (info === null) delete this.data.overleaf[artifactId];
    else this.data.overleaf[artifactId] = info;
    this.save();
  }

  overleafError(artifactId: Id): CaptureCode | null {
    return this.data.overleafErrors[artifactId] ?? null;
  }

  setOverleafError(artifactId: Id, code: CaptureCode | null): void {
    if (code === null) delete this.data.overleafErrors[artifactId];
    else this.data.overleafErrors[artifactId] = code;
    this.save();
  }

  lastRun(artifactId: Id): IsoTime | null {
    return this.data.lastRun[artifactId] ?? null;
  }

  setLastRun(artifactId: Id, at: IsoTime): void {
    this.data.lastRun[artifactId] = at;
    this.save();
  }

  secret(name: 'overleafToken'): string | null {
    return this.secrets[name] ?? null;
  }

  setSecret(name: 'overleafToken', value: string | null): void {
    if (value === null) delete this.secrets[name];
    else this.secrets[name] = value;
    writeJsonAtomic(this.secretsFile, this.secrets, 0o600);
  }

  private save(): void {
    writeJsonAtomic(this.dataFile, this.data);
  }
}
