/**
 * Owner: A2 features/confirm. Route: 待确认.
 * The owner replaces only this body, to render the feature's screen component.
 */
import { useProjectId } from '@/state';
import { ConfirmScreen } from '@/features/confirm/ConfirmScreen';

export default function ConfirmRoute() {
  return <ConfirmScreen projectId={useProjectId()} />;
}
