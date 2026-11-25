import { chmodSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { http, tempDir, testSchema, withServer, type TestServer } from './helpers';

const CODE_RE = /^[0-9A-HJ-NP-TV-Z]{4}-[0-9A-HJ-NP-TV-Z]{4}-[0-9A-HJ-NP-TV-Z]{4}$/;

function printer(): { print: (line: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { print: (l: string) => lines.push(l), lines };
}

function fileMissing(path: string): boolean {
  try {
    readFileSync(path);
    return false;
  } catch {
    return true;
  }
}

describe('admin invite', () => {
  let s: TestServer | null = null;

  afterEach(async () => {
    if (s) await s.stop();
    s = null;
  });

  it('first start prints one admin invite and writes it to admin-invite.txt with mode 600', async () => {
    const p = printer();
    s = await withServer({ adminInvite: true, print: p.print });
    const file = join(s.dataDir, 'admin-invite.txt');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const code = readFileSync(file, 'utf8').trim();
    expect(code).toMatch(CODE_RE);
    expect(p.lines).toContain(`Admin invite: ${code} (saved to ${file})`);
  });

  it('a stale admin-invite.txt left with a looser mode is rewritten with mode 600 (T3)', async () => {
    const dir = tempDir('admin-invite-stale');
    try {
      const file = join(dir.path, 'admin-invite.txt');
      writeFileSync(file, 'OLD0-OLD0-OLD0\n', { mode: 0o644 });
      chmodSync(file, 0o644);
      s = await withServer({ adminInvite: true, print: printer().print, dataDir: dir.path });
      expect(statSync(file).mode & 0o777).toBe(0o600);
      const code = readFileSync(file, 'utf8').trim();
      expect(code).toMatch(CODE_RE);
      expect(code).not.toBe('OLD0-OLD0-OLD0');
    } finally {
      await s?.stop();
      s = null;
      dir.rm();
    }
  });

  it('a restart with the invite unused and the file present prints no code', async () => {
    const schema = testSchema();
    const dir = tempDir('admin-invite');
    try {
      const p1 = printer();
      const first = await withServer({ adminInvite: true, print: p1.print, pgSchema: schema.name, dataDir: dir.path });
      const file = join(dir.path, 'admin-invite.txt');
      const code1 = readFileSync(file, 'utf8').trim();
      await first.stop();

      const p2 = printer();
      s = await withServer({ adminInvite: true, print: p2.print, pgSchema: schema.name, dataDir: dir.path });
      expect(readFileSync(file, 'utf8').trim()).toBe(code1);
      expect(p2.lines.some((l) => l.includes(code1))).toBe(false);
      expect(p2.lines).toContain(`Admin invite not used yet: see ${file}`);
    } finally {
      await s?.stop();
      s = null;
      await schema.drop();
      dir.rm();
    }
  });

  it('a restart with the file deleted revokes the old admin invite and issues a new one', async () => {
    const schema = testSchema();
    const dir = tempDir('admin-invite');
    try {
      const p1 = printer();
      const first = await withServer({ adminInvite: true, print: p1.print, pgSchema: schema.name, dataDir: dir.path });
      const file = join(dir.path, 'admin-invite.txt');
      const code1 = readFileSync(file, 'utf8').trim();
      await first.stop();
      rmSync(file);

      const p2 = printer();
      s = await withServer({ adminInvite: true, print: p2.print, pgSchema: schema.name, dataDir: dir.path });
      const code2 = readFileSync(file, 'utf8').trim();
      expect(code2).not.toBe(code1);
      expect(p2.lines).toContain(`Admin invite: ${code2} (saved to ${file})`);

      const oldTry = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: code1, displayName: 'Old', locale: 'en' });
      expect(oldTry.status).toBe(404);
      expect(oldTry.json.error.code).toBe('INVITE_INVALID');

      const newTry = await http(s.base, null, 'POST', '/v1/invites/redeem', { code: code2, displayName: 'New', locale: 'en' });
      expect(newTry.status).toBe(200);
      expect(newTry.json.projectId).toBeNull();
    } finally {
      await s?.stop();
      s = null;
      await schema.drop();
      dir.rm();
    }
  });

  it('redeeming the admin invite creates an account with no project and removes the file; later starts issue none', async () => {
    const schema = testSchema();
    const dir = tempDir('admin-invite');
    try {
      const p1 = printer();
      const first = await withServer({ adminInvite: true, print: p1.print, pgSchema: schema.name, dataDir: dir.path });
      const file = join(dir.path, 'admin-invite.txt');
      const code = readFileSync(file, 'utf8').trim();

      const r = await http(first.base, null, 'POST', '/v1/invites/redeem', { code, displayName: 'Admin', locale: 'en' });
      expect(r.status).toBe(200);
      expect(r.json.projectId).toBeNull();
      expect(first.svc.current.users[r.json.user.id]).toBeDefined();
      expect(fileMissing(file)).toBe(true);

      await first.stop();

      const p2 = printer();
      s = await withServer({ adminInvite: true, print: p2.print, pgSchema: schema.name, dataDir: dir.path });
      expect(p2.lines).toEqual([]);
      expect(fileMissing(file)).toBe(true);
    } finally {
      await s?.stop();
      s = null;
      await schema.drop();
      dir.rm();
    }
  });
});
