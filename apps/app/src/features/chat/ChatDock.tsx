import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { routePath } from '@/state';
import { useCurrent } from '@/shell/useCurrent';
import { useLayout } from '@/theme';
import { setDockHeight } from './dockHeight';
import { AskBar } from './ui/AgentSheet';
import { ChatPanel } from './ui/ChatPanel';
import { InboxDoneBar } from '../inbox/ui/DoneBar';

export { useDockHeight } from './dockHeight';

/** Project pages that have their own composer or a full form, where the dock stays out of the way. */
const NO_DOCK = new Set(['chat', 'import', 'handoff']);

/**
 * The bottom composer under every page: Home's agent on 我的, the project agent on project pages.
 * Hidden on pages outside both (search, settings, ...) and on the project's own chat, import and
 * handoff pages. Reports its height through `useDockHeight()`.
 */
export function ChatDock() {
  const { projectId, section } = useCurrent();
  const { phone } = useLayout();
  const router = useRouter();
  // Phones (mobile-v1): no dock on To confirm either; the ask bar sits above the tab bar.
  const hidden = projectId ? NO_DOCK.has(section) || (phone && section === 'confirm') : section !== 'home';
  useEffect(() => {
    if (hidden) setDockHeight(0);
  }, [hidden]);
  // 「《…》分析完了」 from the 需求 inbox shows on every page, also where there is no dock.
  const bar = <InboxDoneBar />;
  if (hidden) return bar;
  const expand = projectId && phone ? () => router.push(routePath({ view: 'chat', projectId }) as Href) : undefined;
  if (phone) {
    return (
      <>
        {bar}
        <View onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}>
          <AskBar key={projectId ?? 'home'} scope={projectId ?? 'home'} onDash={projectId ? section === 'dash' : true} />
        </View>
      </>
    );
  }
  return (
    <>
      {bar}
      <View onLayout={(e) => setDockHeight(e.nativeEvent.layout.height)}>
        {projectId ? <ChatPanel key={projectId} scope={projectId} onDash={section === 'dash'} onExpand={expand} /> : <ChatPanel key="home" scope="home" onDash />}
      </View>
    </>
  );
}
