/**
 * Owner: A4 features/deliveries. Route: 交付 (?round=).
 * The owner replaces only this body, to render the feature's screen component.
 */
import { useLocalSearchParams } from 'expo-router';
import { DeliveriesScreen } from '@/features/deliveries/ui/DeliveriesScreen';

export default function DeliveriesRoute() {
  const { round } = useLocalSearchParams<{ round?: string }>();
  const n = round ? Number(round) : NaN;
  return <DeliveriesScreen round={Number.isFinite(n) ? n : undefined} />;
}
