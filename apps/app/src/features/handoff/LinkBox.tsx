import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Id, IsoTime } from '@meetless/core';
import { Button, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, radius, space } from '@/theme';
import { COPIED_MS, linkBox } from './model/link';

/**
 * The prompt to paste into an agent, with Copy, and a foldable live preview of the shareable
 * context it resolves to (desktop `PromptBox`). A private or invisible need shows only
 * 「先公开到项目」.
 */
export function LinkBox({ projectId, needId }: { projectId: Id; needId: Id }) {
  const { t, live, locale, fmtClock, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [gen, setGen] = useState<IsoTime | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const box = linkBox(t, live, projectId, needId, locale);
  if (!box) {
    return (
      <View style={styles.box}>
        <Text size="sm" color="textSecondary">
          {t('lk.privateFirst')}
        </Text>
      </View>
    );
  }

  const onCopy = async () => {
    const ok = await Clipboard.setStringAsync(box.prompt).catch(() => false);
    if (!ok) return notify('error', t('lk.copyFailed'));
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Text size="sm" color="textSecondary" style={styles.grow}>
          {t('lk.prompt')}
        </Text>
        <Button variant="primary" size="sm" label={copied ? `✓ ${t('cp.copied')}` : t('lk.copy')} onPress={() => void onCopy()} testID="lk-copy" />
      </View>
      <Text size="sm" mono selectable style={styles.prompt} testID="lk-prompt">
        {box.prompt}
      </Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" testID="lk-preview" onPress={() => setOpen((o) => !o)}>
          <Text size="sm" color="textSecondary">
            {(open ? '▾ ' : '▸ ') + t('lk.preview')}
          </Text>
        </Pressable>
        <View style={styles.grow} />
        {open && (
          <>
            <Text size="xs" color="textTertiary">
              {t('lk.gen', { t: gen ? fmtClock(gen) : t('lk.now'), v: box.version })}
            </Text>
            <Button variant="link" size="sm" label={t('lk.refresh')} onPress={() => setGen(new Date().toISOString())} testID="lk-refresh" />
          </>
        )}
      </View>
      {open && (
        <Text size="xs" mono selectable style={styles.context} testID="lk-context">
          {box.markdown}
        </Text>
      )}
      <Text size="xs" color="textTertiary">
        {t('lk.note')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: space[3], backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  grow: { flex: 1 },
  prompt: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space[3] },
  context: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space[3], maxHeight: 320, overflow: 'hidden' },
});
