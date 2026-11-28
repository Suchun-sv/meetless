import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { usePathname } from 'expo-router';
import type { Id } from '@meetless/core';
import { Segmented, Text } from '@/components/ui';
import { colors, fontFor, fontSize, hasCjk, radius, space, tones, useLayout } from '@/theme';
import { chipLabel } from '../model/chat';
import { replyBlocks } from '../model/reply';
import { CcDock, ModeRow } from '../cc/CcDock';
import { getMode, setMode, type ChatMode } from '../cc/model';
import { useCcAvailable } from '../cc/useCcAvailable';
import { useCcSession } from '../cc/useCcSession';
import { useComposer } from './composer';
import { Thread } from './Thread';

/**
 * The project agent: suggestion chips, the private thread, the text field, attach and the privacy
 * switch. `full` fills its parent (the phone chat page); otherwise it is the dock under a page,
 * with the thread capped in height.
 */
export function ChatPanel({ scope, onDash, full, onExpand }: { scope: 'home' | Id; onDash: boolean; full?: boolean; onExpand?: () => void }) {
  const { phone, height } = useLayout();
  /** The dock's thread: collapsed to one line until a message is sent or the line is tapped. */
  const [expanded, setExpanded] = useState(false);
  const path = usePathname();
  useEffect(() => setExpanded(false), [path]);
  /** Phone input height: one line, growing with the text up to five. */
  const [inputH, setInputH] = useState(INPUT_MIN);
  const { t, live, me, today, fmtDay, project, text, setText, priv, togglePriv, pending, attaching, msgs, chips, ph, ai, send, onKeyPress, onChip, attach } = useComposer(scope, onDash, () => setExpanded(true));

  const [mode, setModeState] = useState<ChatMode>(() => (scope === 'home' ? 'ds' : getMode(scope)));
  // Claude Code only when the server has it (no mock in production); otherwise DeepSeek, as before.
  const ccOn = useCcAvailable(scope) === true;
  const cc = scope !== 'home' && mode === 'cc' && ccOn;
  const ccs = useCcSession(scope, cc);
  const onMode = (m: ChatMode) => {
    setModeState(m);
    if (scope !== 'home') setMode(scope, m);
  };
  const showThread = msgs.length > 0 || pending !== null;
  // The dock shows one line for the thread until expanded; the chat page always shows it all.
  const bar = !full && !expanded;
  const canSend = text.trim().length > 0 && pending === null;
  const threadMax = Math.max(160, height * 0.33);
  const last = msgs[msgs.length - 1];
  const lastLine = last ? (replyBlocks(last.reply, { t, live, me, today, fmtDay, scope, messageId: last.id, onDash }).find((b) => b.kind === 'text')?.text ?? last.text) : '';
  // Tapping the line: the full chat page on phones (when there is one), else expand in place.
  const openBar = phone && onExpand ? onExpand : () => setExpanded(true);

  const pv = project ? (
    <Segmented
      size="sm"
      value={priv ? 'only' : 'project'}
      onChange={togglePriv}
      options={[
        { value: 'project', label: t('pv.project') },
        { value: 'only', label: t('pv.only') },
      ]}
    />
  ) : null;
  // Phones: the switch is one small pill next to `+` that flips on tap.
  const pvPill = project ? (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: priv }}
      accessibilityLabel={`${t('pv.project')} / ${t('pv.only')}`}
      testID="pv-pill"
      onPress={() => togglePriv(priv ? 'project' : 'only')}
      style={[styles.pill, priv && styles.pillOn]}
    >
      <Text size="xs" weight="medium" color={priv ? 'text' : 'textSecondary'} tight numberOfLines={1}>
        {t(priv ? 'pv.only' : 'pv.project')}
      </Text>
    </Pressable>
  ) : null;
  const plus = project ? (
    <Pressable accessibilityRole="button" accessibilityLabel={t('cm.attach')} testID="composer-attach" onPress={() => void attach()} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.icon, (pressed || hovered) && styles.iconHover, attaching && styles.off]}>
      <Text size="lg" color="textSecondary" tight>
        {'+'}
      </Text>
    </Pressable>
  ) : null;

  return (
    <View style={[styles.wrap, full ? styles.full : styles.dock]} testID="composer">
      <View style={[styles.column, full && styles.fullColumn]}>
        {project && ccOn && <ModeRow projectId={scope} mode={mode} onMode={onMode} s={cc ? ccs : null} />}
        {cc && <CcDock projectId={scope} s={ccs} />}
        {!cc && showThread && bar && (
          <Pressable accessibilityRole="button" testID="thread-bar" onPress={openBar} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.bar, hovered && styles.chipPressed]}>
            <Text size="sm" weight="semibold" tight>
              {t('ch.agent')}
            </Text>
            <Text size="sm" color={pending !== null ? 'ai' : 'textSecondary'} tight numberOfLines={1} style={styles.grow}>
              {pending !== null ? t('ch.pending') : lastLine.split('\n')[0]}
            </Text>
            <Text size="sm" color="textSecondary" tight>
              {'›'}
            </Text>
          </Pressable>
        )}
        {!cc && showThread && !bar && (
          <Thread
            scope={scope}
            pending={pending}
            onDash={onDash}
            style={full ? styles.threadFull : { maxHeight: threadMax }}
            onCollapse={full ? undefined : () => setExpanded(false)}
          />
        )}
        {!cc && chips.length > 0 && !(showThread && !bar) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {chips.map((c) => (
              <Pressable
                key={c.id}
                testID="chip"
                accessibilityRole="button"
                onPress={() => onChip(c)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.chip, c.hot && styles.chipHot, (pressed || hovered) && styles.chipPressed]}
              >
                <Text size="xs" tight numberOfLines={1} style={c.hot ? { color: tones.info.fg } : undefined} color={c.hot ? undefined : 'textSecondary'}>
                  {chipLabel(t, live, c)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {!cc && (
        <View style={[styles.box, priv && styles.boxPriv]}>
          <View style={styles.inputRow}>
            {plus}
            {phone && pvPill}
            <TextInput
              testID="composer-text"
              value={text}
              onChangeText={(v) => {
                setText(v);
                if (v === '') setInputH(INPUT_MIN);
              }}
              onContentSizeChange={(e) => phone && setInputH(Math.max(INPUT_MIN, Math.min(INPUT_MAX, Math.ceil(e.nativeEvent.contentSize.height))))}
              onKeyPress={onKeyPress}
              placeholder={ph}
              accessibilityLabel={ph}
              placeholderTextColor={colors.textTertiary}
              multiline
              editable={pending === null}
              numberOfLines={phone ? 1 : undefined}
              style={[fontFor('regular', { cjk: hasCjk(text || ph) }), styles.input, phone && { height: text ? inputH : INPUT_MIN, minHeight: INPUT_MIN, paddingVertical: space[1] }]}
            />
            {!phone && pv}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('cm.send')}
              testID="composer-send"
              disabled={!canSend}
              onPress={() => void send()}
              style={[styles.send, canSend ? styles.sendOn : styles.sendOff]}
            >
              <Text size="md" weight="semibold" color={canSend ? 'textInverse' : 'textTertiary'} tight>
                {'↑'}
              </Text>
            </Pressable>
          </View>
        </View>
        )}
        {!cc && ai && (!phone || full) && (
          <Text size="xs" color="ai" testID="ai-note">
            {t('ch.aiNote')}
          </Text>
        )}
      </View>
    </View>
  );
}

const INPUT_MIN = 32;
const INPUT_MAX = 120;

const styles = StyleSheet.create({
  pill: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: space[2], height: 26, justifyContent: 'center', marginBottom: 5 },
  pillOn: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  wrap: { backgroundColor: colors.bg },
  dock: { borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: space[2] },
  full: { flex: 1, padding: space[3] },
  column: { width: '100%', maxWidth: 820, alignSelf: 'center', gap: space[2] },
  fullColumn: { flex: 1 },
  threadFull: { flex: 1 },
  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: space[2], paddingVertical: 2, alignItems: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2] },
  chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, borderRadius: radius.full, paddingHorizontal: space[3], paddingVertical: space[1] },
  chipHot: { borderColor: tones.info.bg, backgroundColor: tones.info.bg },
  chipPressed: { backgroundColor: colors.hover },
  box: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.xl, backgroundColor: colors.bg, paddingHorizontal: space[2], paddingVertical: space[1], gap: space[1] },
  boxPriv: { backgroundColor: colors.surface, borderStyle: 'dashed' },
  grow: { flex: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  input: { flex: 1, fontSize: fontSize.base, color: colors.text, minHeight: 36, maxHeight: 160, paddingVertical: space[2], paddingHorizontal: space[1], ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  icon: { width: 32, height: 32, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  iconHover: { backgroundColor: colors.hover },
  off: { opacity: 0.5 },
  send: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  sendOn: { backgroundColor: colors.text },
  sendOff: { backgroundColor: colors.surface },
});
