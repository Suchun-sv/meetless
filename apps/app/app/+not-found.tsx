/** Owner: P0. Unknown path. */
import { Link } from 'expo-router';
import { Screen, Text } from '@/components/ui';
import { useT } from '@/i18n';

export default function NotFound() {
  const t = useT();
  return (
    <Screen title={t('xp.notFound')}>
      <Link href="/">
        <Text color="textSecondary">{t('nav.home')}</Text>
      </Link>
    </Screen>
  );
}
