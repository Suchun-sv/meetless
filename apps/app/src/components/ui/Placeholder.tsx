import { StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme';
import { useT } from '@/i18n';
import { Screen } from './Screen';
import { Text } from './Text';

/** The stub every route renders until its owner fills it in. */
export function Placeholder({ title, owner }: { title: string; owner: string }) {
  const t = useT();
  return (
    <Screen title={title}>
      <View style={styles.box}>
        <Text color="textSecondary">{t('xp.placeholder')}</Text>
        <Text size="xs" color="textTertiary" mono>
          {owner}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: radius.lg, padding: space[6], gap: space[2], alignItems: 'flex-start' },
});
