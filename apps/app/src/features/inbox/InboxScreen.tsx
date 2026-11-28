import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ClipboardOffer, Text } from '@/components/ui';
import { AvatarMenu } from '@/features/home/ui/mine/AvatarMenu';
import { routePath, useApp } from '@/state';
import { colors, fontFor, hasCjk, radius, space, useLayout } from '@/theme';
import { Icon, type IconName } from '../chat/ui/icons';
import { useInboxInput } from './input/useInboxInput';
import { retryMaterial, undoMaterial, type ApiFn, type InboxCard } from './model/api';
import { clearDoneToast, useDoneToast } from './model/toast';
import { useInbox } from './model/useInbox';
import { InboxDoneBar } from './ui/DoneBar';
import { MaterialCard } from './ui/MaterialCard';

function Pill({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }: { pressed: boolean }) => [styles.pill, pressed && styles.pillOn]} testID={testID}>
      <Icon name={icon} size={18} color={colors.text} />
      <Text size="md" weight="medium" tight>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * B5: the black bar after a commit. 「3 条放进 课程助教，改了 1 个截止」 with 撤销 (rolls the whole
 * material back to 待你确认) and 去看看 (the project's 需求, or the first of several). About 6 s.
 */
function DoneToast({ onUndone }: { onUndone: () => void }) {
  const { t, api, notify, errorText } = useApp();
  const router = useRouter();
  const toast = useDoneToast();
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(clearDoneToast, 6000);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  const undo = async () => {
    clearDoneToast();
    try {
      await undoMaterial(api as unknown as ApiFn, toast.materialId);
      notify('info', t('inb.undone'));
    } catch (e) {
      notify('error', errorText((e as { code?: string }).code ?? 'ERROR'));
    }
    onUndone();
  };
  const look = () => {
    clearDoneToast();
    const pid = toast.projectIds[0];
    if (pid) router.push(routePath({ view: 'board', projectId: pid }) as Href);
  };
  return (
    <View style={styles.toast} testID="inbox-toast">
      <Icon name="checkCircle" size={20} color={colors.successBg} />
      <Text size="md" color="textInverse" style={styles.grow} numberOfLines={2}>
        {toast.text}
      </Text>
      <Pressable onPress={() => void undo()} hitSlop={8} testID="toast-undo">
        <Text size="md" style={styles.toastUndo}>
          {t('inb.undo')}
        </Text>
      </Pressable>
      <Pressable onPress={look} hitSlop={8} testID="toast-look">
        <Text size="md" weight="semibold" color="textInverse">
          {t('inb.look')}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * B1 「需求」: one place to drop material (paste or type, 文件, 拍照, 相册, a copied text or image, or
 * files dragged onto the page on web and desktop), then two lists of materials: 待你确认, and
 * 最近收进来的 (analysing, put away, nothing found, couldn't read). No Agent ask bar here.
 */
export function InboxScreen() {
  const { t, api } = useApp();
  const router = useRouter();
  const { phone } = useLayout();
  const { list, local, refresh } = useInbox();
  const input = useInboxInput();
  const [text, setText] = useState('');
  const [drag, setDrag] = useState(false);
  const field = useRef<TextInput | null>(null);
  const page = useRef<View | null>(null);
  const toast = useDoneToast();

  // Web and desktop: the whole page takes dropped files, one material each.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = page.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    let depth = 0;
    const has = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth++;
      setDrag(true);
    };
    const over = (e: DragEvent) => has(e) && e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0;
      setDrag(false);
      void input.dropFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    el.addEventListener('dragenter', enter);
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', leave);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('dragenter', enter);
      el.removeEventListener('dragover', over);
      el.removeEventListener('dragleave', leave);
      el.removeEventListener('drop', drop);
    };
  }, [input]);

  const send = () => {
    const v = text;
    if (!v.trim()) return;
    setText('');
    void input.sendText(v);
  };
  const open = (c: InboxCard) => {
    // Before the server has an inbox the cards are the projects' own pending items: open its 待确认.
    if (local) {
      const pid = c.projectIds[0];
      if (pid) router.push(routePath({ view: 'confirm', projectId: pid }) as Href);
      return;
    }
    router.push(`/inbox/${encodeURIComponent(c.id)}` as Href);
  };
  const retry = async (c: InboxCard) => {
    await retryMaterial(api as unknown as ApiFn, c.id).catch(() => undefined);
    void refresh();
  };

  const pending = list?.pending ?? [];
  const recent = list?.recent ?? [];
  const empty = list !== null && pending.length === 0 && recent.length === 0;
  const can = text.trim().length > 0 && !input.busy;
  const ph = t('inb.ph');
  const fresh = toast && Date.now() - toast.at < 3000 ? toast.materialId : null;

  return (
    <View ref={page} style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingHorizontal: phone ? space[4] : space[8] }]} keyboardShouldPersistTaps="handled" testID="inbox">
        <View style={styles.column}>
          <View style={styles.top}>
            <AvatarMenu />
          </View>
          <Text weight="semibold" style={styles.title}>
            {t('inb.title')}
          </Text>
          <View style={[styles.box, drag && styles.boxDrag]}>
            {drag ? (
              <Text size="md" color="info" style={styles.dropText}>
                {t('inb.drop')}
              </Text>
            ) : (
              <TextInput
                ref={field}
                testID="inbox-text"
                value={text}
                onChangeText={setText}
                placeholder={ph}
                placeholderTextColor={colors.textTertiary}
                multiline
                style={[fontFor('regular', { cjk: hasCjk(text || ph) }), styles.input]}
              />
            )}
            <View style={styles.pills}>
              <Pill icon="clip" label={t('inb.file')} onPress={() => void input.pickFile()} testID="inbox-file" />
              <Pill icon="camera" label={t('inb.camera')} onPress={() => void input.takePhoto()} testID="inbox-camera" />
              <Pill icon="image" label={t('inb.album')} onPress={() => void input.pickImage()} testID="inbox-album" />
              <View style={styles.grow} />
              <Pressable accessibilityRole="button" accessibilityLabel={t('cm.send')} disabled={!can} onPress={send} style={[styles.send, can && styles.sendOn]} testID="inbox-send">
                <Icon name="up" size={20} color={can ? colors.textInverse : colors.textTertiary} />
              </Pressable>
            </View>
          </View>
          <ClipboardOffer onPaste={(p) => (p.kind === 'text' ? setText((cur) => (cur ? `${cur}\n${p.text}` : p.text)) : void input.pasteImage(p.base64))} />

          {empty && (
            <View style={styles.empty}>
              <Text size="sm" color="textTertiary">
                {t('inb.emptyHint')}
              </Text>
              <View style={styles.examples}>
                <Pill icon="mail" label={t('inb.ex.mail')} onPress={() => field.current?.focus()} />
                <Pill icon="camera" label={t('inb.ex.photo')} onPress={() => void input.takePhoto()} />
                <Pill icon="file" label={t('inb.ex.pdf')} onPress={() => void input.pickFile()} />
              </View>
            </View>
          )}

          {pending.length > 0 && (
            <View style={styles.group}>
              <Text size="md" weight="medium" color="textSecondary">
                {t('inb.pending', { n: pending.length })}
              </Text>
              {pending.map((c) => (
                <MaterialCard key={c.id} c={c} onPress={() => open(c)} />
              ))}
            </View>
          )}

          {recent.length > 0 && (
            <View style={styles.group}>
              <Text size="md" weight="medium" color="textSecondary">
                {t('inb.recent')}
              </Text>
              {recent.map((c) => (
                <MaterialCard key={c.id} c={c} highlight={c.id === fresh} onPress={() => open(c)} onRetry={() => void retry(c)} />
              ))}
              {(list?.older ?? 0) > 0 && (
                <Text size="sm" color="textTertiary" style={styles.older}>
                  {t('inb.older', { n: list!.older })}
                </Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>
      <View style={styles.bottom} pointerEvents="box-none">
        <InboxDoneBar />
      </View>
      <DoneToast onUndone={() => void refresh()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 120 },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: space[4] },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: space[3] },
  title: { fontSize: 32, lineHeight: 40, letterSpacing: -0.64, marginTop: -space[2] },
  box: { backgroundColor: colors.textInverse, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 16, padding: space[3] + 2, gap: space[3] },
  boxDrag: { borderStyle: 'dashed', borderColor: colors.info, backgroundColor: colors.infoBg },
  input: { fontSize: 16, color: colors.text, minHeight: 56, maxHeight: 220, paddingHorizontal: space[1], ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  dropText: { minHeight: 56, textAlignVertical: 'center', paddingHorizontal: space[1], paddingTop: space[3] },
  pills: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.full, paddingHorizontal: space[3] + 2, height: 38 },
  pillOn: { backgroundColor: colors.hover },
  grow: { flex: 1 },
  send: { width: 38, height: 38, borderRadius: radius.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sendOn: { backgroundColor: colors.text },
  empty: { gap: space[3] },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  group: { gap: space[3], marginTop: space[2] },
  older: { textAlign: 'center', paddingVertical: space[2] },
  toast: { position: 'absolute', left: space[3], right: space[3], bottom: space[3], flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: colors.text, borderRadius: 14, paddingHorizontal: space[4], paddingVertical: space[3] + 2 },
  toastUndo: { color: colors.borderStrong },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: space[1] },
});
