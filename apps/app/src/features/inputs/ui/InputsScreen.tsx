import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { noDots, type Id, type Input } from '@meetless/core';
import { acceptCommands } from '@renderer/collab/confirm';
import { Button, Card, Pill, Sheet, Text, TextField } from '@/components/ui';
import { newId, useApp, useGo, useProjectId } from '@/state';
import { colors, radius, space } from '@/theme';
import { isPrivate, shareInput, shareNeedsThenInput, type Visibility } from '../../privacy/model';
import { VisibilityToggle } from '../../privacy/ui';
import {
  blockedFor,
  detectorMark,
  extractCards,
  importErrorKey,
  inputRows,
  paraRows,
  requesterFrom,
  SCENE_OPTIONS,
  selectedInput,
  sheetHeader,
  type BlockedShare,
  type ExtractCard,
  type InputRow,
} from '../model';
import { importFile, importMarkdown, type ImportDeps } from '../model/importer';
import { ChipRow, KindTag, MutedTag, NeedChip, panesFor, RulesMark, Row, runCmds, SectionLabel, themeTone, useContainerWidth } from './common';
import { pickFile, saveBytes } from './files';

const DOC_MEDIA: Record<'docx' | 'pdf', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/**
 * 输入: the list, the selected input's paragraphs, and its detected items. Three panes from 1100 px
 * of container width, list plus detail from 760, else the list and the detail are separate routes.
 */
export function InputsScreen({ inputId, paraId }: { inputId?: string; paraId?: string }) {
  const app = useApp();
  const { live, t, notify, errorText, bridge, api, today } = app;
  const projectId = useProjectId();
  const go = useGo();
  const [w, onLayout] = useContainerWidth();
  const panes = panesFor(w);
  const [hotId, setHotId] = useState<Id | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedShare | null>(null);
  const [mdOpen, setMdOpen] = useState(false);
  const [vis, setVis] = useState<Visibility>('project');

  const input = selectedInput(live, projectId, inputId ?? null);
  const blockedNeedIds = blockedFor(blocked, input?.id);

  const deps: ImportDeps = {
    importInput: (req) => api('inputs.import', req),
    uploadBlob: (b, m) => bridge.uploadBlob(b, m),
    newId,
    today,
  };

  const open = (id: Id) => go({ view: 'inputs', projectId, focusId: id });

  const onImport = async () => {
    const f = await pickFile(null);
    if (!f) return;
    setImporting(f.name);
    notify('info', t('in.importing', { name: noDots(f.name) }));
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await importFile(deps, { projectId, name: f.name, bytes, from: null, private: isPrivate(vis) });
    setImporting(null);
    if (!r.ok) {
      const k = importErrorKey(r.code);
      notify('error', k ? t(k) : errorText(r.code));
      return;
    }
    open(r.inputId);
  };

  const onShare = async () => {
    if (input) setBlocked(await shareInput(app.submit, input.id));
  };
  const onShareFirst = async () => {
    if (input && blocked && blocked.inputId === input.id) setBlocked(await shareNeedsThenInput(app.submit, blocked));
  };

  const list = <InputList projectId={projectId} selectedId={panes > 1 ? (input?.id ?? null) : null} vis={vis} onVis={setVis} onSelect={open} onImport={onImport} onWrite={() => setMdOpen(true)} busy={importing !== null} />;
  const sheetProps = { input: input!, paraId, hotId, onHot: setHotId, blockedNeedIds, onShare, onShareFirst };
  const extracts = <ExtractList input={input} parsing={importing !== null} hotId={hotId} onHot={setHotId} blockingNeedIds={blockedNeedIds ?? []} />;

  let body;
  if (w === 0) body = null;
  else if (panes === 1 && !inputId) body = <ScrollView contentContainerStyle={st.pad}>{list}</ScrollView>;
  else if (panes === 1)
    body = (
      <Detail paraId={paraId} input={input}>
        <Button label={t('web.back')} variant="link" size="sm" onPress={() => go({ view: 'inputs', projectId })} style={{ alignSelf: 'flex-start' }} />
        {input ? <InputSheet {...sheetProps} /> : <Text color="textSecondary">{t('in.empty')}</Text>}
        {input ? extracts : null}
      </Detail>
    );
  else if (panes === 2)
    body = (
      <View style={st.row}>
        <ScrollView style={st.left} contentContainerStyle={st.pad}>
          {list}
        </ScrollView>
        <Detail paraId={paraId} input={input}>
          {input ? <InputSheet {...sheetProps} /> : <Text color="textSecondary">{t('in.empty')}</Text>}
          {input ? extracts : null}
        </Detail>
      </View>
    );
  else
    body = (
      <View style={st.row}>
        <ScrollView style={st.left} contentContainerStyle={st.pad}>
          {list}
        </ScrollView>
        <Detail paraId={paraId} input={input}>
          {input ? <InputSheet {...sheetProps} /> : <Text color="textSecondary">{t('in.empty')}</Text>}
        </Detail>
        <ScrollView style={st.right} contentContainerStyle={st.pad}>
          {extracts}
        </ScrollView>
      </View>
    );

  return (
    <View style={st.root} onLayout={onLayout} testID="page-inputs">
      {body}
      <MarkdownSheet open={mdOpen} projectId={projectId} deps={deps} onClose={() => setMdOpen(false)} onDone={open} />
    </View>
  );
}

/** A scroll pane that scrolls to the focused paragraph (paragraph y is reported by `InputSheet`). */
function Detail({ children, paraId, input }: { children: ReactNode; paraId?: string; input: Input | null }) {
  const ref = useRef<ScrollView>(null);
  const ys = useRef<Record<string, number>>({});
  useEffect(() => {
    const y = paraId ? ys.current[paraId] : undefined;
    if (y !== undefined) ref.current?.scrollTo({ y: Math.max(0, y - 60), animated: true });
  }, [paraId, input?.id]);
  return (
    <ScrollView ref={ref} style={st.center} contentContainerStyle={st.pad}>
      <ParaY.Provider
        value={(id, y) => {
          ys.current[id] = y;
          if (id === paraId) ref.current?.scrollTo({ y: Math.max(0, y - 60), animated: false });
        }}
      >
        {children}
      </ParaY.Provider>
    </ScrollView>
  );
}

const ParaY = createContext<(id: string, y: number) => void>(() => undefined);

function InputList({
  projectId,
  selectedId,
  vis,
  onVis,
  onSelect,
  onImport,
  onWrite,
  busy,
}: {
  projectId: Id;
  selectedId: Id | null;
  vis: Visibility;
  onVis: (v: Visibility) => void;
  onSelect: (id: Id) => void;
  onImport: () => void;
  onWrite: () => void;
  busy: boolean;
}) {
  const { live, me, t, fmtDay } = useApp();
  const { pending, done } = inputRows(live, me, projectId, selectedId, fmtDay);
  return (
    <View style={{ gap: space[3] }}>
      <Row wrap>
        <Button testID="in-import" label={t('in.import')} variant="primary" size="sm" busy={busy} onPress={onImport} />
        <Button testID="in-write" label={t('in.write')} size="sm" onPress={onWrite} />
      </Row>
      <Text size="xs" color="textTertiary">
        {t('in.types')}
      </Text>
      <View style={{ gap: space[1] }}>
        <Text size="xs" color="textSecondary">
          {t('in.privacy')}
        </Text>
        <VisibilityToggle value={vis} onChange={onVis} />
      </View>
      {pending.length === 0 && done.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('in.empty')}
        </Text>
      ) : null}
      {pending.length > 0 ? <SectionLabel>{t('in.pending', { n: pending.length })}</SectionLabel> : null}
      {pending.map((r) => (
        <InputItem key={r.id} r={r} onPress={() => onSelect(r.id)} />
      ))}
      {done.length > 0 ? <SectionLabel>{t('in.done', { n: done.length })}</SectionLabel> : null}
      {done.map((r) => (
        <InputItem key={r.id} r={r} onPress={() => onSelect(r.id)} />
      ))}
    </View>
  );
}

function InputItem({ r, onPress }: { r: InputRow; onPress: () => void }) {
  const { t } = useApp();
  return (
    <Card dense selected={r.selected} onPress={onPress} testID="in-item">
      <Row>
        <KindTag kind={r.kind} />
        <Text size="sm" weight="medium" numberOfLines={2} style={{ flex: 1 }}>
          {r.title}
        </Text>
      </Row>
      <Row wrap>
        <Text size="xs" color="textSecondary">
          {r.fact}
        </Text>
        {r.open > 0 ? <Pill label={String(r.open)} tone="info" /> : null}
        {r.mine ? <MutedTag label={t('pv.mine')} /> : null}
      </Row>
    </Card>
  );
}

function InputSheet({
  input,
  paraId,
  hotId,
  onHot,
  blockedNeedIds,
  onShare,
  onShareFirst,
}: {
  input: Input;
  paraId?: string;
  hotId: Id | null;
  onHot: (id: Id | null) => void;
  blockedNeedIds: Id[] | null;
  onShare: () => void;
  onShareFirst: () => void;
}) {
  const { live, me, t, fmtDay, submit, bridge, notify, errorText } = useApp();
  const reportY = useContext(ParaY);
  const h = sheetHeader(live, me, input, blockedNeedIds, t, fmtDay);
  const paras = paraRows(input, paraId, hotId);

  const download = async () => {
    if (!input.blobHash) return;
    const r = await bridge.readBlob(input.blobHash);
    if (!r.ok) return notify('error', errorText(r.code));
    await saveBytes(r.bytes, noDots(input.title), DOC_MEDIA[input.kind as 'docx' | 'pdf']);
  };

  return (
    <>
      <Row wrap>
        <KindTag kind={input.kind} />
        <Text size="lg" weight="semibold" tight style={{ flexShrink: 1 }}>
          {h.title}
        </Text>
        {h.mine ? <MutedTag label={t('pv.mine')} /> : null}
        {h.canShare ? <Button testID="in-share" label={t('pv.publish')} size="sm" onPress={onShare} /> : null}
        {h.blocked ? <Button testID="in-share-needs-first" label={t('common.sharePrivateNeedFirst')} size="sm" onPress={onShareFirst} /> : null}
      </Row>
      {h.blocked ? (
        <Text size="xs" color="textSecondary">
          {t('in.decideHint')}
        </Text>
      ) : null}
      <Text size="sm" color="textSecondary">
        {h.fact}
      </Text>
      <View style={{ gap: space[1] }}>
        <Text size="xs" color="textSecondary">
          {t('in.scene')}
        </Text>
        <ChipRow scroll value={h.scene} options={SCENE_OPTIONS.map((o) => ({ value: o.scene, label: t(o.key) }))} onChange={(scene) => void submit('input.scene_set', { inputId: input.id, scene })} />
      </View>
      {h.isDocFile ? (
        <Row wrap>
          <Text size="xs" color="textSecondary">
            {t('in.preview')}
          </Text>
          {h.hasOriginal ? <Button label={t('af.original')} size="sm" variant="ghost" onPress={() => void download()} /> : null}
        </Row>
      ) : null}
      {paras.map((p) => (
        <Pressable
          key={p.id}
          testID="in-para"
          disabled={!p.extractId}
          onLayout={(e) => reportY(p.id, e.nativeEvent.layout.y)}
          style={[st.para, p.hit && st.paraHit, p.on && st.paraOn]}
          onPress={() => onHot(p.extractId === hotId ? null : p.extractId)}
        >
          <Text>{p.text}</Text>
        </Pressable>
      ))}
    </>
  );
}

function ExtractList({ input, parsing, hotId, onHot, blockingNeedIds }: { input: Input | null; parsing: boolean; hotId: Id | null; onHot: (id: Id | null) => void; blockingNeedIds: Id[] }) {
  const { t } = useApp();
  const cards = input ? extractCards(input, blockingNeedIds) : [];
  return (
    <View style={{ gap: space[3] }} testID="in-extract-panel">
      <Text weight="semibold">{t('in.extract')}</Text>
      {!input ? (
        <Text size="sm" color="textSecondary">
          {t('in.pick')}
        </Text>
      ) : parsing ? (
        <Text size="sm" color="textSecondary">
          {t('in.parsing')}
        </Text>
      ) : cards.length === 0 ? (
        <Text size="sm" color="textSecondary">
          {t('in.none')}
        </Text>
      ) : (
        cards.map((c) => <ExtractItem key={c.id} input={input} c={c} hot={c.id === hotId} onHot={() => onHot(c.id === hotId ? null : c.id)} />)
      )}
      {input ? (
        <Row wrap>
          {detectorMark(input) === 'ai' ? (
            <>
              <Text size="xs" weight="medium" color="ai">
                {t('ai.deepseek')}
              </Text>
              <Text size="xs" color="textTertiary">
                {t('in.deepseek')}
              </Text>
            </>
          ) : (
            <>
              <RulesMark />
              <Text size="xs" color="textTertiary">
                {t('in.rules')}
              </Text>
            </>
          )}
        </Row>
      ) : null}
    </View>
  );
}

function ExtractItem({ input, c, hot, onHot }: { input: Input; c: ExtractCard; hot: boolean; onHot: () => void }) {
  const { live, t, submit, today } = useApp();
  const go = useGo();
  const [busy, setBusy] = useState(false);
  const x = input.extracts.find((e) => e.id === c.id)!;
  const accept = async () => {
    setBusy(true);
    await runCmds(acceptCommands(live, input, x, newId('n'), today), submit as never);
    setBusy(false);
  };
  return (
    <Card dense selected={hot} onPress={onHot} testID="in-x" style={c.action === 'ignored' || c.action === 'accepted' ? { opacity: 0.75 } : undefined}>
      <Row wrap>
        {c.needId ? <NeedChip projectId={input.projectId} needId={c.needId} /> : null}
        <Pill label={t(c.typeKey)} tone={themeTone(c.tone)} />
      </Row>
      <Text size="sm">{c.text}</Text>
      {c.action === 'open' ? (
        <Row>
          <Button testID="in-x-accept" label={t('in.accept')} variant="primary" size="sm" busy={busy} onPress={() => void accept()} />
          <Button testID="in-x-ignore" label={t('in.ignore')} size="sm" onPress={() => void submit('extract.ignored', { inputId: input.id, extractId: c.id })} />
        </Row>
      ) : null}
      {c.action === 'decide' ? (
        <Row wrap>
          <Text size="xs" color="warning">
            {t('in.conflict')}
          </Text>
          <Button testID="in-x-decide" label={t('in.decide')} size="sm" onPress={() => go({ view: 'confirm', projectId: input.projectId })} />
        </Row>
      ) : null}
      {c.action === 'accepted' ? (
        <Row wrap>
          <Text size="xs" color="success">
            {t('in.accepted')}
          </Text>
          {c.resultNeedId ? <NeedChip projectId={input.projectId} needId={c.resultNeedId} /> : null}
        </Row>
      ) : null}
      {c.action === 'ignored' ? (
        <Text size="xs" color="textTertiary">
          {t('in.ignored')}
        </Text>
      ) : null}
      {c.blocking ? (
        <Text size="xs" color="textSecondary">
          {t('in.decideHint')}
        </Text>
      ) : null}
    </Card>
  );
}

function MarkdownSheet({ open, projectId, deps, onClose, onDone }: { open: boolean; projectId: Id; deps: ImportDeps; onClose: () => void; onDone: (id: Id) => void }) {
  const { live, t, notify, errorText } = useApp();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const [vis, setVis] = useState<Visibility>('project');
  const [busy, setBusy] = useState(false);
  const canGo = text.trim().length > 0 && !busy;
  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    const r = await importMarkdown(deps, { projectId, title, text, from: requesterFrom(live, projectId, from), private: isPrivate(vis) });
    setBusy(false);
    if (!r.ok) {
      const k = importErrorKey(r.code);
      notify('error', k ? t(k) : errorText(r.code));
      return;
    }
    setTitle('');
    setText('');
    setFrom('');
    onClose();
    onDone(r.inputId);
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('in.mdTitle')}
      footer={
        <>
          <Button label={t('common.cancel')} onPress={onClose} />
          <Button testID="md-go" label={t('in.mdGo')} variant="primary" busy={busy} disabled={!canGo} onPress={() => void go()} />
        </>
      }
    >
      <TextField testID="md-title" label={t('in.mdName')} value={title} onChangeText={setTitle} />
      <TextField testID="md-text" label={t('in.mdPh')} placeholder={t('in.mdPh')} value={text} onChangeText={setText} multiline style={{ minHeight: 160 }} />
      <TextField testID="md-from" label={t('in.fromPh')} value={from} onChangeText={setFrom} />
      <VisibilityToggle value={vis} onChange={setVis} />
    </Sheet>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  row: { flex: 1, flexDirection: 'row' },
  left: { width: 300, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border },
  center: { flex: 1 },
  right: { width: 340, flexGrow: 0, borderLeftWidth: 1, borderLeftColor: colors.border },
  pad: { padding: space[4], gap: space[3] },
  para: { paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.md, borderLeftWidth: 2, borderLeftColor: 'transparent' },
  paraHit: { borderLeftColor: colors.borderStrong },
  paraOn: { backgroundColor: colors.warningBg, borderLeftColor: colors.warning },
});
