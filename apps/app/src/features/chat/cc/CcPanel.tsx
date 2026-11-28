import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type NativeSyntheticEvent, type StyleProp, type TextInputKeyPressEventData, type ViewStyle } from 'react-native';
import type { Id } from '@meetless/core';
import { Button, Text } from '@/components/ui';
import { useApp } from '@/state';
import { colors, fontFor, hasCjk, radius, space, tones } from '@/theme';
import { Markdown } from '../md/Markdown';
import { Icon } from '../ui/icons';
import { secondsLeft, toolLine, type CcRow } from './model';
import type { CcSession } from './useCcSession';

/**
 * A tool step: one grey line, also when it failed (the agent usually recovers on its own; only a
 * failed turn gets the red style). `answer` marks a step whose permission was answered. A tap shows
 * the tool name, its full argument and the error.
 */
function ToolRow({ name, summary, ok, error, answer }: { name: string; summary: string; ok: boolean | null; error?: string; answer?: 'allow' | 'deny' }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const line = toolLine(t, name, summary);
  const text = answer ? t(answer === 'allow' ? 'cc.perm.lineAllowed' : 'cc.perm.lineDenied', { line }) : ok === false ? t('cc.toolFailed', { line }) : line;
  return (
    <Pressable onPress={() => setOpen((v) => !v)} style={styles.tool} testID="cc-tool">
      <Text size="xs" color="textTertiary" numberOfLines={open ? undefined : 1}>
        {text}
      </Text>
      {open && (
        <Text size="xs" mono color="textTertiary" selectable>
          {[`${name}  ${summary}`, error].filter(Boolean).join('\n')}
        </Text>
      )}
    </Pressable>
  );
}

/** A permission request inline in the thread: the tool, a short preview of what it runs, 同意 / 拒绝, and a quiet countdown. */
function PermissionCard({ r, canAnswer, onAnswer }: { r: Extract<CcRow, { kind: 'permission' }>; canAnswer: boolean; onAnswer: (allow: boolean) => void }) {
  const { t } = useApp();
  const [, tick] = useState(0);
  useEffect(() => {
    if (r.state !== 'pending') return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [r.state]);
  const left = secondsLeft(r.expiresAt);
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <View style={styles.perm} testID="cc-permission">
      <Text size="sm" weight="medium">
        {t('cc.perm.title', { tool: r.tool })}
      </Text>
      <Text size="sm" mono selectable style={styles.permInput} numberOfLines={4}>
        {r.input}
      </Text>
      {r.state === 'pending' ? (
        <View style={styles.permRow}>
          {canAnswer && <Button size="sm" variant="primary" label={t('cc.perm.allow')} onPress={() => onAnswer(true)} testID="cc-allow" />}
          {canAnswer && <Button size="sm" label={t('cc.perm.deny')} onPress={() => onAnswer(false)} testID="cc-deny" />}
          <View style={styles.grow} />
          <Text size="xs" color="textTertiary">
            {t('cc.perm.left', { t: mmss })}
          </Text>
        </View>
      ) : (
        <Text size="xs" color={r.state === 'allow' ? 'success' : 'textTertiary'}>
          {t(r.state === 'allow' ? 'cc.perm.allowed' : 'cc.perm.denied')}
        </Text>
      )}
    </View>
  );
}

/** The thread: the user's words in a grey bubble, the assistant's as plain text, tool steps as grey lines, permissions as cards. */
export function CcThread({ s, style }: { s: CcSession; style?: StyleProp<ViewStyle> }) {
  const { t } = useApp();
  const ref = useRef<ScrollView | null>(null);
  const toEnd = () => ref.current?.scrollToEnd({ animated: false });
  const owner = s.status?.owner === true;
  return (
    <ScrollView ref={ref} style={[styles.thread, style]} contentContainerStyle={styles.threadIn} onContentSizeChange={toEnd} onLayout={toEnd} keyboardShouldPersistTaps="handled" testID="cc-thread">
      {s.more && <Button variant="link" size="sm" label={t('cc.more')} onPress={() => void s.loadMore()} style={styles.start} />}
      {s.rows.map((r, i) => {
        const nx = s.rows[i + 1];
        const pv = i > 0 ? s.rows[i - 1] : undefined;
        switch (r.kind) {
          case 'user':
            return (
              <View key={r.id} style={styles.user}>
                <Text size="md" selectable>
                  {r.text}
                </Text>
              </View>
            );
          case 'assistant':
            return <Markdown key={r.id} text={r.text} />;
          case 'tool':
            // A step that asked for permission is shown by its permission row (card while pending, then one line).
            if ((nx?.kind === 'permission' && nx.tool === r.name) || (pv?.kind === 'permission' && pv.tool === r.name)) return null;
            return <ToolRow key={r.id} name={r.name} summary={r.summary} ok={r.ok} error={r.error} />;
          case 'permission':
            // Only a request still waiting is a card; once answered it folds back to one grey line.
            if (r.state !== 'pending') return <ToolRow key={r.id} name={r.tool} summary={r.input} ok={null} answer={r.state} />;
            return <PermissionCard key={r.id} r={r} canAnswer={owner} onAnswer={(allow) => void s.approve(r.id, allow)} />;
          case 'result':
            return null;
          case 'error':
            return (
              <Text key={r.id} size="sm" color="danger">
                {t('cc.error', { code: r.code })}
              </Text>
            );
        }
      })}
      {s.running && !s.rows.some((r) => r.kind === 'permission' && r.state === 'pending') && (
        <Text size="sm" color="ai" testID="cc-running">
          {t('cc.running')}
        </Text>
      )}
    </ScrollView>
  );
}

/** 「为这个项目开启 Claude Code」: shown once to the owner before the first message starts the session. */
export function CcOpening({ onOpen }: { onOpen: () => void }) {
  const { t } = useApp();
  return (
    <View style={styles.opening} testID="cc-opening">
      <Text size="lg" weight="semibold" tight>
        {t('cc.open.title')}
      </Text>
      <Text size="sm" color="textSecondary">
        {t('cc.open.body')}
      </Text>
      <Button variant="primary" label={t('cc.open.go')} onPress={onOpen} style={styles.start} testID="cc-open" />
    </View>
  );
}

/**
 * The bottom of the Claude Code chat: the input with send or stop for the owner; 「正在别处使用」 with
 * 刷新 when the session is open elsewhere; one line for anyone who is not the owner.
 */
export function CcInput({ projectId, s, autoFocus }: { projectId: Id; s: CcSession; autoFocus?: boolean }) {
  const { t } = useApp();
  const [text, setText] = useState('');
  const input = useRef<TextInput | null>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const id = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [autoFocus, projectId]);
  if (!s.status) return null;
  if (!s.status.owner) {
    return (
      <Text size="sm" color="textTertiary" style={styles.note} testID="cc-viewer">
        {t('cc.viewer')}
      </Text>
    );
  }
  if (s.status.state === 'in_use_elsewhere') {
    return (
      <View style={styles.elsewhere} testID="cc-elsewhere">
        <Text size="sm" color="textSecondary" style={styles.grow}>
          {s.status.detail ? `${t('cc.elsewhere')}  ${s.status.detail}` : t('cc.elsewhere')}
        </Text>
        <Button size="sm" label={t('cc.refresh')} onPress={() => void s.refresh()} />
      </View>
    );
  }
  const go = () => {
    const v = text;
    if (!v.trim() || s.running) return;
    setText('');
    void s.send(v);
  };
  const onKey = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') return;
    const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (ne.key !== 'Enter' || ne.shiftKey || ne.isComposing) return;
    e.preventDefault();
    go();
  };
  const ph = t('cc.ph');
  const can = text.trim().length > 0 && !s.running;
  return (
    <View style={styles.inp}>
      <TextInput
        ref={input}
        testID="cc-text"
        value={text}
        onChangeText={setText}
        onKeyPress={onKey}
        placeholder={ph}
        placeholderTextColor={colors.textTertiary}
        multiline
        style={[fontFor('regular', { cjk: hasCjk(text || ph) }), styles.inpText]}
      />
      {s.running ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('cc.stop')} testID="cc-stop" onPress={() => void s.stop()} style={[styles.send, styles.stop]}>
          <View style={styles.stopSquare} />
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={t('cm.send')} testID="cc-send" disabled={!can} onPress={go} style={[styles.send, can ? styles.sendOn : styles.sendOff]}>
          <Icon name="up" size={18} color={can ? colors.textInverse : colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  start: { alignSelf: 'flex-start' },
  thread: { flex: 1 },
  threadIn: { gap: space[3], paddingVertical: space[2] },
  user: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.surface, borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: space[2] + 2 },
  tool: { gap: 2 },
  perm: { gap: space[2], borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.xl, padding: space[3], backgroundColor: colors.textInverse },
  permInput: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: space[2], paddingVertical: space[1] + 2 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  opening: { gap: space[3], paddingVertical: space[4] },
  note: { paddingVertical: space[3] },
  elsewhere: { flexDirection: 'row', alignItems: 'center', gap: space[2], backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2] },
  inp: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2], borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 22, paddingVertical: 6, paddingLeft: space[4], paddingRight: 6, backgroundColor: colors.textInverse },
  inpText: { flex: 1, fontSize: 16, color: colors.text, minHeight: 34, maxHeight: 140, paddingVertical: 6, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
  send: { width: 34, height: 34, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  sendOn: { backgroundColor: colors.text },
  sendOff: { backgroundColor: colors.surface },
  stop: { backgroundColor: colors.text },
  stopSquare: { width: 11, height: 11, borderRadius: 2, backgroundColor: tones.neutral.bg },
});
