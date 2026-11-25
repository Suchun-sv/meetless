import { describe, expect, it } from 'vitest';
import { isWebUrl } from '../src/index';
import { atlas, P, U } from './log';

describe('artifact and version URLs (links are handed to the OS)', () => {
  it('isWebUrl takes only absolute http(s) URLs', () => {
    for (const u of ['https://github.com/a/b', 'http://example.com/x?y=1']) expect(isWebUrl(u)).toBe(true);
    for (const u of ['file:///System/Applications/Calculator.app', 'smb://attacker.example/share', 'javascript:alert(1)', 'ms-msdt:/id PCWDiagnostic', 'x-apple.systempreferences:', '//evil.com', '/tmp/x', '', 'not a url']) {
      expect(isWebUrl(u)).toBe(false);
    }
  });

  it('the reducer refuses a non-web artifact URL and keeps an http(s) one', () => {
    const log = atlas();
    for (const [i, url] of ['file:///System/Applications/Calculator.app', 'smb://attacker.example/share', 'javascript:alert(1)', 'ms-msdt:/id PCWDiagnostic'].entries()) {
      expect(() => log.emit('artifact.created', U.me, { artifactId: `bad-${i}`, projectId: P, kind: 'code', title: 'x', where: 'GitHub', needIds: [], url })).toThrow(/http\(s\) URL/);
    }
    log.emit('artifact.created', U.me, { artifactId: 'ok', projectId: P, kind: 'code', title: 'Repo', where: 'GitHub', needIds: [], url: 'https://github.com/a/b' });
    expect(log.state.artifacts.ok?.url).toBe('https://github.com/a/b');
    log.emit('artifact.created', U.me, { artifactId: 'empty', projectId: P, kind: 'code', title: 'Repo', where: 'GitHub', needIds: [], url: '' });
    expect(log.state.artifacts.empty?.url).toBe('');
  });

  it('the reducer refuses a non-web version URL', () => {
    const log = atlas();
    log.emit('artifact.created', U.me, { artifactId: 'a', projectId: P, kind: 'code', title: 'Repo', where: 'GitHub', needIds: [] });
    expect(() => log.emit('artifact.version_added', U.me, { artifactId: 'a', versionId: 'v1', label: 'v1', date: '2026-11-24', note: '', url: 'file:///Volumes/share/X.app' })).toThrow(/http\(s\) URL/);
    log.emit('artifact.version_added', U.me, { artifactId: 'a', versionId: 'v2', label: 'v2', date: '2026-11-24', note: '', url: 'https://github.com/a/b/commit/1' });
    expect(log.state.artifacts.a?.versions[0]?.url).toBe('https://github.com/a/b/commit/1');
  });

  it('an Overleaf artifact may name a local clone path (dev-bridge tests only)', () => {
    const log = atlas();
    log.emit('artifact.created', U.me, { artifactId: 'ol', projectId: P, kind: 'overleaf', title: 'Paper', where: 'Overleaf', needIds: [], url: '/tmp/clone' });
    expect(log.state.artifacts.ol?.url).toBe('/tmp/clone');
    expect(() => log.emit('artifact.created', U.me, { artifactId: 'ol2', projectId: P, kind: 'overleaf', title: 'Paper', where: 'Overleaf', needIds: [], url: 'smb://x/y' })).toThrow(/http\(s\) URL/);
  });
});
