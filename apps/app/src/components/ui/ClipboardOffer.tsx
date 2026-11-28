import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useIsFocused } from 'expo-router';
import { colors, radius, space } from '@/theme';
import { useT } from '@/i18n';
import { Icon } from './Icon';
import { Text } from './Text';

export type Pasted = { kind: 'text'; text: string } | { kind: 'image'; base64: string; width: number; height: number };

/**
 * The share-extension fallback (mobile-v2 NOTES §4): when the page comes to the foreground and the
 * clipboard holds text or an image, offer 「粘贴刚复制的内容？」. Only `hasStringAsync`/`hasImageAsync`
 * run until then (no paste prompt); the clipboard is read only when the bar is tapped (iOS shows its
 * paste permission prompt then). Native only: on the web the input takes ⌘V/Ctrl+V directly.
 * Dismissed or used, it stays hidden until the app next comes back to the foreground.
 */
export function ClipboardOffer({ onPaste }: { onPaste: (p: Pasted) => void }) {
  const t = useT();
  const focused = useIsFocused();
  const [kind, setKind] = useState<'text' | 'image' | null>(null);
  const seen = useRef(false);

  const check = useCallback(async () => {
    if (Platform.OS === 'web' || seen.current) return;
    try {
      if (await Clipboard.hasImageAsync()) setKind('image');
      else if (await Clipboard.hasStringAsync()) setKind('text');
      else setKind(null);
    } catch {
      setKind(null);
    }
  }, []);

  useEffect(() => {
    if (focused) void check();
  }, [focused, check]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        seen.current = false;
        void check();
      }
    });
    return () => sub.remove();
  }, [check]);

  if (!kind || !focused) return null;

  const take = async () => {
    seen.current = true;
    setKind(null);
    try {
      if (kind === 'image') {
        const img = await Clipboard.getImageAsync({ format: 'png' });
        if (img?.data) onPaste({ kind: 'image', base64: img.data.replace(/^data:image\/\w+;base64,/, ''), width: img.size.width, height: img.size.height });
      } else {
        const text = await Clipboard.getStringAsync();
        if (text.trim()) onPaste({ kind: 'text', text });
      }
    } catch {
      // Declined at the system prompt, or nothing there any more.
    }
  };

  return (
    <View style={styles.bar} testID="clipboard-offer">
      <Pressable accessibilityRole="button" onPress={() => void take()} style={styles.main} testID="clipboard-offer-paste">
        <Icon name="plus" size={18} color="info" />
        <Text size="sm" weight="medium" color="info" tight>
          {t('xp.pasteOffer')}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        hitSlop={8}
        onPress={() => {
          seen.current = true;
          setKind(null);
        }}
      >
        <Icon name="close" size={16} color="textTertiary" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: colors.infoBg, borderRadius: radius.lg, paddingHorizontal: space[4], minHeight: 44 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: 44 },
});
