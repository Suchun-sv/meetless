import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { Id } from '@meetless/core';
import { Sheet, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, fontFor, hasCjk, radius, space } from '@/theme';
import { useComposer } from './composer';
import { Icon } from './icons';
import { Thread } from './Thread';

/** The Agent sheet's height: its top at y=196 of a 926-tall phone (NOTES 05). */
export const AGENT_SHEET_HEIGHT = 1 - 196 / 926;
/** At most this many suggestion pills, stacked. */
const MAX_SUGGESTIONS = 3;

/**
 * The phone ask bar (mobile-v1): one rounded line above the tab bar with a violet sparkle and a grey
 * send circle. No chips and no thread while idle; a tap opens the Agent sheet (05).
 */
export function AskBar({ scope, onDash }: { scope: 'home' | Id; onDash: boolean }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const ph = scope === 'home' ? t('ch.phHome') : t('dock.askPh');
  return (
    <View style={styles.barWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={ph} testID="ask-bar" onPress={() => setOpen(true)} style={styles.bar}>
        <Icon name="sparkles" size={20} color={colors.ai} />
        <Text size="md" color="textTertiary" numberOfLines={1} style={styles.grow}>
          {ph}
        </Text>
        <View style={styles.sendOff}>
          <Icon name="up" size={18} color={colors.textTertiary} />
        </View>
      </Pressable>
      <AgentSheet scope={scope} onDash={onDash} open={open} onClose={() => setOpen(false)} />
    </View>
  );
}

/**
 * 05 项目 Agent: violet title with the project name (「全部项目」 on 我的), the thread (cited needs as
 * rows, an ⓘ basis line under each answer), up to 3 suggestion pills after the last answer, and the
 * input with + at the bottom. A pill sends as a new message.
 */
export function AgentSheet({ scope, onDash, open, onClose }: { scope: 'home' | Id; onDash: boolean; open: boolean; onClose: () => void }) {
  const c = useComposer(scope, onDash);
  const { t, live } = c;
  const input = useRef<TextInput | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [open]);
  const canSend = c.text.trim().length > 0 && c.pending === null;
  const name = scope === 'home' ? t('dock.allProjects') : (live.projects[scope]?.name ?? '');
  const sugs = c.chips.slice(0, MAX_SUGGESTIONS);
  const ph = scope === 'home' ? t('ch.phHome') : c.priv ? t('ch.phPrivate') : t('ch.ph');

  const header = (
    <View>
      <Text size="lg" weight="semibold" color="ai" tight>
        {scope === 'home' ? t('ch.homeAgent') : t('ch.agent')}
      </Text>
      <Text size="sm" color="textTertiary" numberOfLines={1}>
        {name}
      </Text>
    </View>
  );

  const pills = sugs.length > 0 && (
    <View style={styles.sugs}>
      {sugs.map((s) => (
        <Pressable key={s.id} accessibilityRole="button" testID="chip" onPress={() => c.onChip(s)} style={styles.sug}>
          <Text size="sm" color="ai" numberOfLines={1}>
            {c.chipLabel(t, live, s)}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const footer = (
    <View style={[styles.inp, c.priv && styles.inpPriv]}>
      <TextInput
        ref={input}
        testID="composer-text"
        value={c.text}
        onChangeText={c.setText}
        onKeyPress={c.onKeyPress}
        placeholder={ph}
        placeholderTextColor={colors.textTertiary}
        multiline
        editable={c.pending === null}
        style={[fontFor('regular', { cjk: hasCjk(c.text || ph) }), styles.inpText]}
      />
      <View style={styles.inpBar}>
        {c.project && (
          <Pressable accessibilityRole="button" accessibilityLabel={t('cm.attach')} testID="composer-attach" onPress={() => void c.attach()} style={[styles.plus, c.attaching && styles.off]}>
            <Icon name="plus" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
        {c.project && (
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: c.priv }} testID="pv-pill" onPress={() => c.togglePriv(c.priv ? 'project' : 'only')} style={[styles.pv, c.priv && styles.pvOn]}>
            <Text size="xs" weight="medium" color={c.priv ? 'text' : 'textSecondary'} tight>
              {t(c.priv ? 'pv.only' : 'pv.project')}
            </Text>
          </Pressable>
        )}
        <View style={styles.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('cm.send')} testID="composer-send" disabled={!canSend} onPress={() => void c.send()} style={[styles.send, canSend ? styles.sendOn : styles.sendOff]}>
          <Icon name="up" size={18} color={canSend ? colors.textInverse : colors.textTertiary} />
        </Pressable>
      </View>
    </View>
  );

  const empty = c.msgs.length === 0 && c.pending === null;
  return (
    <Sheet open={open} onClose={onClose} height={AGENT_SHEET_HEIGHT} header={header} footer={footer} fixedBody>
      {empty ? (
        <ScrollView contentContainerStyle={styles.emptyBody} keyboardShouldPersistTaps="handled">
          {pills}
        </ScrollView>
      ) : (
        <Thread scope={scope} pending={c.pending} onDash={onDash} bare style={styles.thread} after={pills} />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  barWrap: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[3], backgroundColor: colors.bg },
  bar: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingLeft: space[4],
    paddingRight: space[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.textInverse,
    shadowColor: colors.text,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  grow: { flex: 1 },
  thread: { flex: 1 },
  emptyBody: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: space[3] },
  sugs: { alignItems: 'flex-start', gap: space[2], paddingTop: space[2], paddingBottom: space[3] },
  sug: { borderWidth: 1, borderColor: colors.aiBg, borderRadius: radius.full, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.textInverse },
  inp: { flex: 1, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 22, paddingTop: space[2], paddingBottom: 6, paddingLeft: space[4], paddingRight: 6, backgroundColor: colors.textInverse },
  inpPriv: { backgroundColor: colors.surface, borderStyle: 'dashed' },
  inpText: { fontSize: 16, color: colors.text, minHeight: 28, maxHeight: 120, paddingVertical: 2, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  inpBar: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[1] },
  plus: { width: 34, height: 34, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginLeft: -space[2] },
  pv: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: space[2], height: 24, justifyContent: 'center' },
  pvOn: { borderColor: colors.borderStrong, backgroundColor: colors.surface },
  off: { opacity: 0.5 },
  send: { width: 34, height: 34, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  sendOn: { backgroundColor: colors.text },
  sendOff: { width: 34, height: 34, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
