/**
 * Owner: A2 features/needs. Route: 需求 board.
 * The owner replaces only this body, to render the feature's screen component.
 */
import { useProjectId } from '@/state';
import { BoardScreen } from '@/features/needs/BoardScreen';

export default function BoardRoute() {
  return <BoardScreen projectId={useProjectId()} />;
}
