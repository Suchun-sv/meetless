import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { SearchHit } from '@meetless/core';
import { Card, Screen, Text, TextField } from '@/components/ui';
import { myProjects, useApp, useGo } from '@/state';
import { colors, space } from '@/theme';
import { ChipRow, NeedChip, Row, SectionLabel } from '../../inputs/ui/common';
import { highlight, hitFieldKey, hitTarget, runSearch, snippet } from '../model';

const ALL = '*';

/** 搜索: keyword search over everything this user can see, grouped by need, then materials and work. */
export function SearchScreen() {
  const { live, me, t, fmtDay } = useApp();
  const go = useGo();
  const [q, setQ] = useState('');
  const projects = myProjects(live, me);
  const [scope, setScope] = useState<string>(ALL);
  const res = useMemo(() => runSearch(live, q, scope === ALL ? null : scope), [live, q, scope]);
  const pname = (pid: string) => live.projects[pid]?.name ?? '';
  const multi = scope === ALL && projects.length > 1;

  const hitLine = (h: SearchHit, showProject = multi) => (
    <View key={`${h.kind}-${h.id}-${h.field}-${h.paraId ?? ''}-${h.page ?? ''}`} style={{ gap: 2 }}>
      <Text size="xs" color="textTertiary">
        {[t(hitFieldKey(h.field)), h.date ? fmtDay(h.date) : null, showProject ? pname(h.projectId) : null].filter(Boolean).join('  ')}
      </Text>
      <Marked text={snippet(h.text, res.query)} query={res.query} />
    </View>
  );

  return (
    <Screen title={t('search.title')}>
      <View style={{ gap: space[3] }} testID="page-search">
        <TextField testID="search-q" value={q} onChangeText={setQ} placeholder={t('search.ph')} autoFocus autoCapitalize="none" returnKeyType="search" />
        {projects.length > 1 ? <ChipRow scroll value={scope} onChange={setScope} options={[{ value: ALL, label: t('search.scope.all') }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} /> : null}
        {res.query && res.total === 0 ? <Text color="textSecondary">{t('search.none')}</Text> : null}
        {res.needs.length > 0 ? <SectionLabel>{t('search.needs')}</SectionLabel> : null}
        {res.needs.map((g) => (
          <Card key={g.needId} dense testID="search-need">
            <Row wrap>
              <NeedChip projectId={g.projectId} needId={g.needId} max={60} />
              {multi ? (
                <Text size="xs" color="textTertiary">
                  {pname(g.projectId)}
                </Text>
              ) : null}
            </Row>
            {g.hits.filter((h) => h.field !== 'code' && h.field !== 'title').map((h) => (
              <View key={`${h.kind}-${h.id}-${h.field}`} style={{ gap: 2 }}>
                {hitLine(h, false)}
              </View>
            ))}
          </Card>
        ))}
        {res.materials.length > 0 ? <SectionLabel>{t('search.materials')}</SectionLabel> : null}
        {res.materials.map((h) => (
          <Card key={`${h.kind}-${h.id}-${h.paraId ?? ''}-${h.versionId ?? ''}-${h.page ?? ''}`} dense onPress={() => go(hitTarget(h))} testID="search-material">
            <Text size="sm" weight="medium" numberOfLines={1}>
              {h.field === 'paragraph' || h.field === 'page' ? (h.why ?? '') : ''}
              {h.field === 'page' && h.page != null ? `  ${t('af.page', { n: h.page + 1 })}` : ''}
            </Text>
            {hitLine(h)}
          </Card>
        ))}
        {res.work.length > 0 ? <SectionLabel>{t('search.work')}</SectionLabel> : null}
        {res.work.map((h) => (
          <Card key={`w-${h.id}`} dense onPress={() => go(hitTarget(h))} testID="search-work">
            {hitLine(h)}
          </Card>
        ))}
      </View>
    </Screen>
  );
}

/** The text with the query's words marked. */
function Marked({ text, query }: { text: string; query: string }) {
  return (
    <Text size="sm">
      {highlight(text, query).map((seg, i) =>
        seg.hit ? (
          <Text key={i} size="sm" weight="semibold" style={{ backgroundColor: colors.warningBg }}>
            {seg.text}
          </Text>
        ) : (
          seg.text
        ),
      )}
    </Text>
  );
}
