import type { Reminder } from '../model/schedule';

/* The web has no local notifications: every call is a no-op and the page says so. */

export const remindersOff = async () => false;
export const setRemindersOff = async (_off: boolean) => undefined;
export const permission = async (): Promise<'granted' | 'denied' | 'undetermined'> => 'denied';
export const askPermission = async () => false;
export const resyncReminders = async (_list: Reminder[]) => undefined;
export function ReminderSync() {
  return null;
}
