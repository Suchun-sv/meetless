import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { noDots, progressCard, type Id } from '@meetless/core';
import type { MessageKey } from '@meetless/i18n';
import { colors, space, type ColorName } from '@/theme';
import { Icon, MenuSheet, Text, type MenuItem } from '@/components/ui';
import { routeToHref, useApp } from '@/state';
import { useHeaderActionList, type HeaderAction } from './chrome';
import { ProjectSheet } from './ProjectSheet';
import { useCurrent } from './useCurrent';
import { useCcAvailable } from '@/features/chat/cc/useCcAvailable';

/** Page titles for the compact header (‹ back + large title). */
const TITLE: Record<string, MessageKey> = {
  need: 'xp.need',
  inputs: 'nav.inputs',
  stream: 'nav.stream',
  members: 'nav.members',
  rounds: 'nav.rounds',
  confirm: 'w.confirm',
  chat: 'xp.chat',
  import: 'xp.import',
  handoff: 'cp.handoff',
  lineage: 'lin.title',
  artifacts: 'nav.artifacts',
  search: 'xp.search',
  settings: 'xp.settings',
  agents: 'nav.agents',
  reminders: 'xp.reminders',
  projects: 'nav.newProject',
};

/** The project's four segments (mobile-v1 decision 2: no timeline segment, inputs live in 脉络). */
const SEGMENTS = [
  { key: 'board', label: 'nav.board', href: (pid: Id) => routeToHref({ view: 'board', projectId: pid }) },
  { key: 'trail', label: 'view.lineage', href: (pid: Id) => `/p/${encodeURIComponent(pid)}/lineage` as Href },
  { key: 'artifacts', label: 'nav.artifacts', href: (pid: Id) => routeToHref({ view: 'artifacts', projectId: pid }) },
  { key: 'deliveries', label: 'nav.deliveries', href: (pid: Id) => routeToHref({ view: 'deliveries', projectId: pid }) },
] as const satisfies readonly { key: string; label: MessageKey; href: (pid: Id) => Href }[];

/** Which phone header a path gets. */
export function phoneHeaderKind(path: string): 'mine' | 'list' | 'project' | 'compact' {
  if (path === '/') return 'mine';
  if (path === '/projects' || path === '/confirm') return 'list';
  const m = /^\/p\/[^/]+(\/[^/]+)?\/?$/.exec(path);
  if (m && (!m[1] || ['/board', '/lineage', '/artifacts', '/deliveries'].includes(m[1]))) return 'project';
  // A need's sheet (03) and its trail (07) open over the project page.
  if (/^\/p\/[^/]+\/(need|lineage)\/[^/]+\/?$/.test(path)) return 'project';
  return 'compact';
}

function segmentOf(path: string): string {
  const m = /^\/p\/[^/]+\/([^/]+)/.exec(path);
  const s = m?.[1] ?? 'board';
  return s === 'lineage' ? 'trail' : s === 'need' ? 'board' : s;
}

/** Days left in colour (NOTES: ≤3 red, ≤7 amber, else grey). */
export function daysColor(days: number): ColorName {
  return days <= 3 ? 'danger' : days <= 7 ? 'warning' : 'textSecondary';
}

function NavButton({ a }: { a: HeaderAction }) {
  return (
    <Pressable testID={a.testID} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.onPress} hitSlop={4} style={styles.nb}>
      {a.text ? (
        <Text size="lg" weight="semibold" tight>
          {a.text}
        </Text>
      ) : a.icon ? (
        <Icon name={a.icon} size={24} />
      ) : null}
    </Pressable>
  );
}

function NavRow({ back, right }: { back?: { label: string; onPress: () => void }; right?: React.ReactNode }) {
  return (
    <View style={styles.nav}>
      {back ? (
        <Pressable testID="nav-back" accessibilityRole="button" onPress={back.onPress} hitSlop={6} style={styles.back}>
          <Icon name="back" size={24} />
          <Text size="lg" tight numberOfLines={1} style={{ maxWidth: 220 }}>
            {back.label}
          </Text>
        </Pressable>
      ) : (
        <View />
      )}
      <View style={styles.right}>{right}</View>
    </View>
  );
}

function LargeTitle({ text, small }: { text: string; small?: boolean }) {
  return (
    <Text weight="semibold" tight style={[styles.lt, small && styles.ltSm]} numberOfLines={2} testID="large-title">
      {text}
    </Text>
  );
}

/** The project header: ‹ 项目, actions and ⋯, the name, the current deadline line, the four segments. */
function ProjectHeader({ projectId }: { projectId: Id }) {
  const { live, t, today, fmtDay, submit, me } = useApp();
  const router = useRouter();
  const cur = useCurrent();
  const actions = useHeaderActionList();
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const ccOn = useCcAvailable(projectId) === true;
  const project = live.projects[projectId];
  if (!project) return null;
  const pc = progressCard(live, projectId, today);
  const seg = segmentOf(cur.path);
  const items: MenuItem[] = [
    { label: t('nav.stream'), onPress: () => router.push(routeToHref({ view: 'stream', projectId })), testID: 'menu-stream' },
    { label: t('nav.members'), onPress: () => router.push(routeToHref({ view: 'members', projectId })), testID: 'menu-members' },
    { label: t('nav.rounds'), onPress: () => router.push(routeToHref({ view: 'rounds', projectId })), testID: 'menu-rounds' },
    { label: t('pj.setup'), onPress: () => setSettings(true), testID: 'menu-settings' },
    // Claude Code session (A3): continue elsewhere, owner only (the page explains to others).
    ...(ccOn && project.createdBy === me ? [{ label: t('cc.handoff.title'), onPress: () => router.push(`/p/${encodeURIComponent(projectId)}/handoff?cc=1` as Href), testID: 'menu-cc-handoff' }] : []),
    project.archived
      ? { label: t('pj.restore'), onPress: () => void submit('project.unarchived', { projectId }), testID: 'menu-restore' }
      : {
          label: t('pj.archive'),
          tone: 'danger',
          testID: 'menu-archive',
          onPress: () =>
            void submit('project.archived', { projectId }).then((r) => {
              if (r.kind !== 'rejected') router.navigate('/projects');
            }),
        },
  ];
  return (
    <View testID="project-header">
      <NavRow
        back={{ label: t('nav.projects'), onPress: () => router.navigate('/projects') }}
        right={
          <>
            {actions.map((a) => (
              <NavButton key={`${a.icon ?? a.text}-${a.label}`} a={a} />
            ))}
            <NavButton a={{ icon: 'more', label: t('pj.setup'), onPress: () => setMenu(true), testID: 'project-more' }} />
          </>
        }
      />
      <LargeTitle text={noDots(project.name)} small />
      <View style={styles.meta} testID="project-meta">
        {pc.round ? (
          <>
            <Text size="md" weight="semibold" tight numberOfLines={1} style={{ flexShrink: 1 }}>
              {noDots(pc.round.title) || t('round', { n: pc.round.n })}
            </Text>
            {pc.daysLeft !== null ? (
              <Text size="md" tight color={daysColor(pc.daysLeft)}>
                {pc.daysLeft >= 0 ? t('round.left', { n: pc.daysLeft }) : t('round.over', { n: -pc.daysLeft })}
              </Text>
            ) : null}
            <Text size="md" tight>
              {t('xp.ext', { a: pc.done, b: pc.ext })}
            </Text>
            <Text size="sm" tight color="textTertiary">
              {t('xp.dueOn', { d: fmtDay(pc.round.due) })}
            </Text>
          </>
        ) : (
          <Text size="md" tight color="textTertiary">
            {t('xp.noRound')}
          </Text>
        )}
      </View>
      <View style={styles.seg} accessibilityRole="tablist" testID="project-segments">
        {SEGMENTS.map((s) => {
          const on = s.key === seg;
          return (
            <Pressable key={s.key} testID={`seg-${s.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => !on && router.replace(s.href(projectId))} style={[styles.segItem, on && styles.segOn]}>
              <Text size="sm" weight="medium" color={on ? 'text' : 'textSecondary'} tight>
                {t(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <MenuSheet open={menu} onClose={() => setMenu(false)} title={noDots(project.name)} items={items} />
      <ProjectSheet projectId={settings ? projectId : null} onClose={() => setSettings(false)} />
    </View>
  );
}

/** 我的: its page (A1, features/home) draws the avatar menu, the date and the count; nothing here. */
function MineHeader() {
  return null;
}

/**
 * The phone header (mobile-v1): no 「菜单」, a back arrow with the parent's name and a large title.
 * 我的 shows only the avatar (its page draws the date and the count); 项目 and 待确认 a large title
 * with the page's actions; project pages the project header; everything else ‹ back plus its title.
 */
export function PhoneHeader() {
  const { live, t } = useApp();
  const router = useRouter();
  const cur = useCurrent();
  const actions = useHeaderActionList();
  const kind = phoneHeaderKind(cur.path);
  if (kind === 'mine') return <MineHeader />;
  if (kind === 'project' && cur.projectId) return <ProjectHeader projectId={cur.projectId} />;
  if (kind === 'list') {
    const projects = cur.path === '/projects';
    const right = (
      <>
        {projects ? <NavButton a={{ icon: 'plus', label: t('nav.newProject'), onPress: () => router.push('/projects/new'), testID: 'projects-new' }} /> : null}
        {actions.map((a) => (
          <NavButton key={`${a.icon ?? a.text}-${a.label}`} a={a} />
        ))}
      </>
    );
    return (
      <View>
        <NavRow right={right} />
        <LargeTitle text={projects ? t('nav.projects') : t('w.confirm')} />
      </View>
    );
  }
  // Compact: ‹ parent and the page's title.
  const pid = cur.projectId;
  const parent = pid ? noDots(live.projects[pid]?.name ?? '') : t('nav.home');
  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate(pid ? routeToHref({ view: 'board', projectId: pid }) : '/');
  };
  const key = TITLE[cur.section];
  return (
    <View>
      <NavRow
        back={{ label: parent, onPress: goBack }}
        right={actions.map((a) => (
          <NavButton key={`${a.icon ?? a.text}-${a.label}`} a={a} />
        ))}
      />
      {key ? <LargeTitle text={t(key)} small /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: space[2], paddingRight: 10 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44 },
  right: { flexDirection: 'row', alignItems: 'center' },
  nb: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  lt: { fontSize: 32, lineHeight: 37, letterSpacing: -0.64, paddingHorizontal: space[5], paddingTop: 2 },
  ltSm: { fontSize: 28, lineHeight: 33, letterSpacing: -0.56 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 2, paddingHorizontal: space[5], paddingTop: space[2], paddingBottom: space[4] },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 9, padding: 2, marginHorizontal: space[5], marginBottom: space[3], height: 34 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segOn: { backgroundColor: colors.sheet, shadowColor: colors.text, shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
});

