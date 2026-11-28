import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { clip, type ArtifactKind, type Id, type InputKind, type SourceKind } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { KIND_LABEL, SRC_LABEL_KEY, ST_TONE, type Tone as RTone } from '@renderer/ui/tone';
import { Text } from '@/components/ui';
import { useApp, useGo } from '@/state';
import { colors, radius, space, type Tone } from '@/theme';

/** Shared A4 bits (kind tag, need chip, marks, chip row). Candidates for components/ui later. */

/** The renderer's tones onto the theme's: strong and muted have no tint of their own. */
export function themeTone(t: RTone): Tone {
  return t === 'strong' || t === 'muted' ? 'neutral' : t;
}

/** A short file-kind word (MD, PDF, GIT), never a glyph. */
export function KindTag({ kind }: { kind: ArtifactKind | InputKind }) {
  return (
    <View style={s.kind}>
      <Text size="xs" weight="medium" color="textSecondary" mono tight>
        {KIND_LABEL[kind]}
      </Text>
    </View>
  );
}

export function SourceTag({ src }: { src: SourceKind }) {
  const { t } = useApp();
  return (
    <Text size="xs" weight="medium" color="textSecondary" tight>
      {t(SRC_LABEL_KEY[src])}
    </Text>
  );
}

/** A need's code and title; opens the need. Renders nothing for a need this viewer does not hold. */
export function NeedChip({ projectId, needId, max = 40, status = true }: { projectId: Id; needId: Id; max?: number; status?: boolean }) {
  const { live, t } = useApp();
  const go = useGo();
  const n = live.needs[needId];
  if (!n || n.projectId !== projectId) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${n.code} ${n.title}`}
      onPress={() => go({ view: 'board', projectId, needId })}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.chip, (pressed || hovered) && s.chipOn]}
    >
      <Text size="xs" mono color="textSecondary" tight>
        {n.code}
      </Text>
      <Text size="xs" tight numberOfLines={1} style={{ flexShrink: 1 }}>
        {clip(n.title, max)}
      </Text>
      {status ? (
        <Text size="xs" tight style={{ color: colorsFor(themeTone(ST_TONE[n.status])) }}>
          {t(`st.${n.status}` as MessageKey)}
        </Text>
      ) : null}
    </Pressable>
  );
}

function colorsFor(tone: Tone): string {
  return tone === 'neutral' ? colors.textSecondary : colors[tone];
}

/** Rule output: 「规则识别」 in violet. */
export function RulesMark() {
  const { t } = useApp();
  return (
    <Text size="xs" weight="medium" color="ai" tight>
      {t('app.rules')}
    </Text>
  );
}

export function MutedTag({ label }: { label: string }) {
  return (
    <Text size="xs" color="textTertiary" tight>
      {label}
    </Text>
  );
}

/** Wrapping (or scrolling) selectable chips: filters, scenes, kinds. */
export function ChipRow<V extends string>({ value, options, onChange, scroll }: { value: V | null; options: readonly { value: V; label: string; testID?: string }[]; onChange: (v: V) => void; scroll?: boolean }) {
  const body = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable key={o.value} testID={o.testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[s.fchip, on && s.fchipOn]}>
        <Text size="sm" weight={on ? 'medium' : 'regular'} color={on ? 'text' : 'textSecondary'} tight numberOfLines={1}>
          {o.label}
        </Text>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {body}
      </ScrollView>
    );
  }
  return <View style={[s.row, { flexWrap: 'wrap' }]}>{body}</View>;
}

export function SectionLabel({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <View style={s.label}>
      <Text size="xs" weight="medium" color="textTertiary" tight style={{ flex: 1 }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Row({ children, wrap, gap = 2, style }: { children: ReactNode; wrap?: boolean; gap?: 1 | 2 | 3; style?: object }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space[gap] }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>;
}

/** The container width (0 until the first layout), for responsive panes. */
export function useContainerWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width)), []);
  return [w, onLayout];
}

/** Pane split by container width: three panes from 1100, two from 760, else one. */
export function panesFor(width: number): 1 | 2 | 3 {
  if (width >= 1100) return 3;
  if (width >= 760) return 2;
  return 1;
}

/** Submits commands in order, stopping at the first refusal (renderer collab/answer runCmds). */
export async function runCmds(cmds: readonly { type: string; payload: unknown }[], submit: (type: never, payload: never) => Promise<{ kind: string }>): Promise<boolean> {
  for (const c of cmds) {
    const r = await submit(c.type as never, c.payload as never);
    if (r.kind === 'rejected') return false;
  }
  return true;
}

const s = StyleSheet.create({
  kind: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 4, paddingVertical: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[1], alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: 2 },
  chipOn: { backgroundColor: colors.hover },
  row: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  fchip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: space[3], minHeight: 30, justifyContent: 'center' },
  fchipOn: { borderColor: colors.borderStrong, backgroundColor: colors.selected },
  label: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
});
