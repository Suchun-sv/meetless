import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, space, useLayout } from '@/theme';
import { useT } from '@/i18n';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** A custom header in place of the title (e.g. 「H4 假设」 over the need title). */
  header?: ReactNode;
  children: ReactNode;
  /** Fixed at the bottom, outside the scroll (buttons, an input). */
  footer?: ReactNode;
  /** Phones: a step back inside the sheet (07's 「‹ 详情」), shown top-left. */
  onBack?: () => void;
  backLabel?: string;
  /** Phones: the sheet's height as a fraction of the window (0.45 for the Agent), or 'auto' (up to 92%). */
  height?: number | 'auto';
  /** Wide screens: max width of the centred dialog. */
  width?: number;
  /** Phones: the body does not scroll (the content scrolls itself, e.g. a chat thread). */
  fixedBody?: boolean;
}

/**
 * A modal: on phones a bottom sheet (grabber, round ✕, dimmed page behind, mobile-v1); on wide
 * screens a centred dialog. Tapping the scrim or ✕ calls `onClose`.
 */
export function Sheet({ open, onClose, title, header, children, footer, onBack, backLabel, height = 'auto', width = 520, fixedBody }: SheetProps) {
  const { phone } = useLayout();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const t = useT();
  const sized = phone && typeof height === 'number' ? { height: Math.round(winH * height) } : null;
  const body = fixedBody ? (
    <View style={[styles.bodyFixed, phone ? styles.bodyPhone : styles.body]}>{children}</View>
  ) : (
    <ScrollView style={[phone ? styles.bodyPhone : styles.body, styles.scroll]} contentContainerStyle={{ gap: space[3], paddingBottom: space[4] }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
  return (
    <Modal visible={open} transparent animationType={phone ? 'slide' : 'fade'} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, phone ? styles.rootPhone : styles.rootWide]}>
        <Pressable accessibilityLabel={t('close')} style={StyleSheet.absoluteFill} onPress={onClose}>
          <View style={styles.scrim} />
        </Pressable>
        <View style={[styles.panel, phone ? [styles.panelPhone, { paddingBottom: Math.max(insets.bottom, space[3]) }, sized] : [styles.panelWide, { width }]]}>
          {phone ? <View style={styles.grabber} /> : null}
          {phone ? (
            <View style={styles.headPhone}>
              <View style={{ flex: 1, gap: space[1] }}>
                {onBack ? (
                  <Pressable accessibilityRole="button" onPress={onBack} hitSlop={8} style={styles.back} testID="sheet-back">
                    <Icon name="back" size={20} />
                    <Text size="md" tight>
                      {backLabel ?? t('web.back')}
                    </Text>
                  </Pressable>
                ) : null}
                {header ?? (title ? (
                  <Text size="lg" weight="semibold" tight numberOfLines={2}>
                    {title}
                  </Text>
                ) : null)}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose} hitSlop={8} style={styles.x} testID="sheet-close">
                <Icon name="close" size={18} color="textSecondary" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                {header ?? (
                  <Text size="lg" weight="semibold" tight numberOfLines={2}>
                    {title ?? ''}
                  </Text>
                )}
              </View>
              <Button label={t('close')} variant="ghost" size="sm" onPress={onClose} />
            </View>
          )}
          {body}
          {footer ? <View style={phone ? styles.footerPhone : styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootPhone: { justifyContent: 'flex-end' },
  rootWide: { justifyContent: 'center', alignItems: 'center', padding: space[6] },
  scrim: { flex: 1, backgroundColor: colors.scrim },
  panel: { backgroundColor: colors.bg, ...shadow.lg },
  panelPhone: { maxHeight: '92%', borderTopLeftRadius: radius.xl + 8, borderTopRightRadius: radius.xl + 8 },
  panelWide: { maxWidth: '100%', maxHeight: '90%', borderRadius: radius.xl },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: radius.full, backgroundColor: colors.borderStrong, marginTop: space[2] },
  headPhone: { flexDirection: 'row', alignItems: 'flex-start', gap: space[3], paddingHorizontal: space[5], paddingTop: space[3], paddingBottom: space[2] },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -space[1], marginBottom: space[2] },
  x: { width: 30, height: 30, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingVertical: space[3] },
  body: { paddingHorizontal: space[5] },
  bodyPhone: { paddingHorizontal: space[5] },
  scroll: { flexGrow: 0 },
  bodyFixed: { flex: 1, minHeight: 0 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2], paddingHorizontal: space[5], paddingTop: space[4], paddingBottom: space[4] },
  footerPhone: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[5], paddingTop: space[3], borderTopWidth: 1, borderTopColor: colors.border },
});
