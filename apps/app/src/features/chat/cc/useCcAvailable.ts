import { useEffect, useState } from 'react';
import type { Id } from '@meetless/core';
import { useApp } from '@/state';
import { ccAvailable, ccStatus, onCcAvailability, type ApiFn } from './api';

/**
 * Whether Claude Code can be offered: the server answers `cc.status` (or a dev mock is allowed).
 * Null while the first probe runs. Unavailable means DeepSeek only, with no Claude Code toggle.
 */
export function useCcAvailable(projectId: Id | 'home'): boolean | null {
  const { api } = useApp();
  const [v, setV] = useState(ccAvailable);
  useEffect(() => onCcAvailability(() => setV(ccAvailable())), []);
  useEffect(() => {
    if (projectId === 'home' || ccAvailable() !== null) return;
    void ccStatus(api as unknown as ApiFn, projectId)
      .catch(() => null)
      .then(() => setV(ccAvailable()));
  }, [api, projectId]);
  return v;
}
