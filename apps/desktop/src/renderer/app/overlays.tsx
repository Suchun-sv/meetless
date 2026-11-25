import type { ComponentType } from 'react';
import type { Id } from '@meetless/core';
import { ConfirmPanel } from '../collab/ConfirmPanel';
import { HandoffModal } from '../collab/HandoffModal';
import { LinkModal } from '../collab/LinkModal';

export type Overlay =
  | { kind: 'confirm'; projectId: Id }
  | { kind: 'handoff'; projectId: Id; needId: Id; toId?: Id | null; ask?: string }
  | { kind: 'link'; projectId: Id; needId: Id };

/** The component for each overlay kind (contract §8). The shell renders `OVERLAYS[overlay.kind]`. */
export const OVERLAYS: { [K in Overlay['kind']]: ComponentType<{ overlay: Extract<Overlay, { kind: K }> }> } = {
  confirm: ConfirmPanel,
  handoff: HandoffModal,
  link: LinkModal,
};
