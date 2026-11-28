import { useProjectId } from '@/state';
import { ChatPanel } from './ui/ChatPanel';

/** The project agent full screen (phones): the thread fills the page, the composer at the bottom. */
export function ChatScreen() {
  const projectId = useProjectId();
  return <ChatPanel key={projectId} scope={projectId} onDash={false} full />;
}
