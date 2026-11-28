/**
 * Owner: A4 features/artifacts. Route: one artifact (?version=&page=).
 * The owner replaces only this body, to render the feature's screen component.
 */
import { useLocalSearchParams } from 'expo-router';
import { ArtifactsScreen } from '@/features/artifacts/ui/ArtifactsScreen';

export default function ArtifactRoute() {
  const { artifactId, version, page } = useLocalSearchParams<{ artifactId: string; version?: string; page?: string }>();
  const n = page !== undefined && page !== '' ? Number(page) : undefined;
  return <ArtifactsScreen artifactId={String(artifactId)} versionId={version ? String(version) : undefined} page={n !== undefined && Number.isFinite(n) ? n : undefined} />;
}
