/**
 * Owner: A2 features/confirm. Route: the 待确认 tab (mobile-v1 04), across all projects.
 * The owner replaces only this body, to render the cross-project ConfirmScreen.
 */
import { ConfirmScreen } from '@/features/confirm/ConfirmScreen';

export default function ConfirmAllRoute() {
  return <ConfirmScreen projectId={null} />;
}
