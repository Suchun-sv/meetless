import { useEffect, useState } from 'react';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';
import { Platform } from 'react-native';
import { chatMessages, type Id, type Suggestion } from '@meetless/core';
import { newId, useApp } from '@/state';
import { useFileImport } from '../../import/ui/useFileImport';
import { aiEnabled } from '../model/ai';
import {
  askCommands,
  chipLabel,
  chipOutcome,
  chipsFor,
  getPriv,
  goesToServer,
  placeholderKey,
  recordSentPriv,
  recordSentPrivFor,
  runCommands,
  sendCommands,
  setPriv,
  shouldSend,
  type ChatCommand,
} from '../model/chat';
import { useOpenTarget } from './nav';

/** Whether the server sends free questions to DeepSeek for this user (asked once per session). */
export function useAi(): boolean {
  const { api, me } = useApp();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void aiEnabled(me, () => api('me', {}) as never).then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, [api, me]);
  return on;
}

/**
 * The composer's state and actions for a scope: text, privacy switch, the question waiting on
 * `agent.ask`, send, chips and attach. Shared by the dock panel and the phone Agent sheet.
 * `onSent` runs when a message (or a chip's question) goes out.
 */
export function useComposer(scope: 'home' | Id, onDash: boolean, onSent?: () => void) {
  const { t, live, me, today, fmtDay, submit, api } = useApp();
  const open = useOpenTarget();
  const pickFile = useFileImport();
  const ai = useAi();
  const project = scope !== 'home';
  const [text, setText] = useState('');
  const [priv, setPrivState] = useState(() => (project ? getPriv(scope) : false));
  /** The question waiting on `agent.ask`; no new question meanwhile. */
  const [pending, setPending] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);

  useEffect(() => setPrivState(project ? getPriv(scope) : false), [scope, project]);

  const msgs = chatMessages(live, me, scope);
  const chips = chipsFor(live, me, scope, onDash, today);
  const ph = t(placeholderKey(scope, priv));
  const sendPriv = project && priv;

  const togglePriv = (v: 'project' | 'only') => {
    const on = v === 'only';
    setPrivState(on);
    if (project) setPriv(scope, on);
  };

  async function run(cmds: ChatCommand[]): Promise<boolean> {
    recordSentPrivFor(cmds, sendPriv);
    return runCommands(cmds, submit);
  }

  async function send() {
    if (pending !== null || !shouldSend(text, false)) return;
    const value = text;
    setText('');
    onSent?.();
    const messageId = newId('msg');
    const now = new Date().toISOString();
    let cmds: ChatCommand[];
    if (goesToServer(live, me, scope, value, today, ai)) {
      setPending(value);
      // The switch the message is sent under; the server imports content under it (ruling R21).
      recordSentPriv(messageId, sendPriv);
      try {
        cmds = await askCommands(live, me, scope, value, today, now, messageId, (req) => api('agent.ask', req), { ai, priv: sendPriv });
      } finally {
        setPending(null);
      }
    } else {
      cmds = sendCommands(live, me, scope, value, today, now, messageId);
    }
    const sent = await run(cmds);
    // A rejected question gives the text back, unless the user has typed again.
    if (!sent) setText((cur) => (cur === '' ? value : cur));
  }

  function onKeyPress(e: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (Platform.OS !== 'web') return;
    const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (ne.key !== 'Enter' || ne.shiftKey) return;
    e.preventDefault();
    if (shouldSend(text, ne.isComposing === true)) void send();
  }

  function onChip(chip: Suggestion) {
    const label = chipLabel(t, live, chip);
    const out = chipOutcome(live, me, scope, chip, label, today, new Date().toISOString(), newId('msg'));
    if (out.commands.some((c) => c.type === 'chat.asked') && !out.open) onSent?.();
    void run(out.commands).then(() => {
      if (out.open) open(out.open);
    });
  }

  async function attach() {
    if (!project || attaching) return;
    setAttaching(true);
    try {
      const out = await pickFile({ projectId: scope, priv });
      if (out) open(out.open);
    } finally {
      setAttaching(false);
    }
  }

  return { t, live, me, today, fmtDay, project, text, setText, priv, togglePriv, pending, attaching, msgs, chips, ph, ai, send, onKeyPress, onChip, attach, chipLabel };
}
