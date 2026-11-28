/**
 * Owner: A4 features/inputs. Route: one input (?para= scrolls to a paragraph).
 * The owner replaces only this body, to render the feature's screen component.
 */
import { useLocalSearchParams } from 'expo-router';
import { InputsScreen } from '@/features/inputs/ui/InputsScreen';

export default function InputRoute() {
  const { inputId, para } = useLocalSearchParams<{ inputId: string; para?: string }>();
  return <InputsScreen inputId={String(inputId)} paraId={para ? String(para) : undefined} />;
}
