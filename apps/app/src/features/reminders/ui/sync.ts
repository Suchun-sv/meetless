import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useApp, routeToHref } from '@/state';
import { deadlineReminders, reminderKey, type Reminder } from '../model/schedule';

/*
 * iOS: keeps the pending local notifications equal to `deadlineReminders` (only when the set
 * changed), shows them while the app is open, and opens the DDL or the need on tap. Nothing
 * here asks for permission; the reminders page does.
 */

const PREFIX = 'ml-';
const OFF_KEY = 'meetless.reminders.off';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

let lastKey: string | null = null;
let chain: Promise<void> = Promise.resolve();

export async function remindersOff(): Promise<boolean> {
  return (await AsyncStorage.getItem(OFF_KEY)) === '1';
}

export async function setRemindersOff(off: boolean): Promise<void> {
  if (off) await AsyncStorage.setItem(OFF_KEY, '1');
  else await AsyncStorage.removeItem(OFF_KEY);
  lastKey = null;
}

export async function permission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

export async function askPermission(): Promise<boolean> {
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  lastKey = null;
  return p.granted;
}

async function apply(list: Reminder[]): Promise<void> {
  const off = await remindersOff();
  const wanted = off || (await permission()) !== 'granted' ? [] : list;
  const key = reminderKey(wanted);
  if (key === lastKey) return;
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((n) => n.identifier.startsWith(PREFIX)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  for (const r of wanted) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body, data: r.data },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.fireAt },
    });
  }
  lastKey = key;
}

/** Reschedules now (after a permission or on/off change). */
export function resyncReminders(list: Reminder[]): Promise<void> {
  lastKey = null;
  chain = chain.then(() => apply(list)).catch(() => undefined);
  return chain;
}

/** Mounted once inside the signed-in app (the shell). Renders nothing. */
export function ReminderSync() {
  const { live, me, t, locale } = useApp();
  const router = useRouter();
  const list = deadlineReminders(live, t, me, new Date());
  const key = `${locale}\n${reminderKey(list)}`;
  const listRef = useRef(list);
  listRef.current = list;

  useEffect(() => {
    const id = setTimeout(() => {
      chain = chain.then(() => apply(listRef.current)).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(id);
  }, [key]);

  useEffect(() => {
    const open = (data: unknown) => {
      const d = data as Reminder['data'] | undefined;
      if (!d || typeof d !== 'object' || !('kind' in d)) return;
      const href: Href = d.kind === 'round' ? routeToHref({ view: 'deliveries', projectId: d.projectId, round: d.round }) : routeToHref({ view: 'board', projectId: d.projectId, needId: d.needId });
      router.push(href);
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, [router]);

  return null;
}
