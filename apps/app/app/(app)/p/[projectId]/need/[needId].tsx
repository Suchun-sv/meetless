/**
 * Owner: A2 features/needs. Route: need detail and edit.
 * The owner replaces only this body, to render the feature's screen component.
 */
import { useLocalSearchParams } from 'expo-router';
import { useProjectId } from '@/state';
import { NeedScreen } from '@/features/needs/NeedScreen';

export default function NeedRoute() {
  const { needId } = useLocalSearchParams<{ needId: string }>();
  return <NeedScreen projectId={useProjectId()} needId={String(needId ?? '')} />;
}
