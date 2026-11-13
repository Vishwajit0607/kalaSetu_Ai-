import type { AuthEvent, AuthEventType } from './apiClient';
import type { StringKey } from '@/i18n';
import type { UiLanguage } from '@/i18n/strings';

/**
 * How the activity trail is worded and summarised. Pure, so the parts that are easy
 * to get subtly wrong - which day an event belongs to, what counts as "recent" -
 * are unit-tested. Days are Indian calendar days (UTC+5:30).
 */

export interface EventStyle {
  label: StringKey;
  icon: 'person-add' | 'log-in' | 'alert-circle' | 'log-out' | 'key';
  /** 'warn' for the one event that might mean someone else is trying the account. */
  tone: 'normal' | 'warn';
}

const EVENTS: Record<AuthEventType, EventStyle> = {
  signup: { label: 'activity.event.signup', icon: 'person-add', tone: 'normal' },
  login: { label: 'activity.event.login', icon: 'log-in', tone: 'normal' },
  login_failed: { label: 'activity.event.login_failed', icon: 'alert-circle', tone: 'warn' },
  logout: { label: 'activity.event.logout', icon: 'log-out', tone: 'normal' },
  password_changed: { label: 'activity.event.password_changed', icon: 'key', tone: 'normal' },
};

/** How to show an event; an unknown type (a newer server) falls back to a neutral sign-in. */
export function describeEvent(type: string): EventStyle {
  return EVENTS[type as AuthEventType] ?? EVENTS.login;
}

/** A rough "which device" from the user-agent text the server stored. */
export function deviceKey(userAgent: string | null): StringKey {
  if (!userAgent) return 'activity.device.unknown';
  if (/iPhone|iPad|CFNetwork|Darwin/i.test(userAgent)) return 'activity.device.ios';
  if (/okhttp|Dalvik|Android/i.test(userAgent)) return 'activity.device.android';
  if (/Mozilla|Chrome|Safari|Firefox/i.test(userAgent)) return 'activity.device.web';
  return 'activity.device.unknown';
}

/** Wrong-password attempts within the last `hours`: what the warning banner counts. */
export function recentFailures(events: Pick<AuthEvent, 'event_type' | 'created_at'>[], now: Date, hours = 24): number {
  const since = now.getTime() - hours * 60 * 60 * 1000;
  return events.filter((e) => e.event_type === 'login_failed' && new Date(e.created_at).getTime() >= since).length;
}

/** Show the warning from this many wrong-password attempts in a day. One typo is not an attack. */
export const WARN_AFTER_FAILURES = 3;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS: Record<UiLanguage, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  hi: ['जन॰', 'फ़र॰', 'मार्च', 'अप्रै॰', 'मई', 'जून', 'जुला॰', 'अग॰', 'सित॰', 'अक्तू॰', 'नव॰', 'दिस॰'],
};
const two = (n: number) => String(n).padStart(2, '0');

export interface EventTime {
  /** Set for today and yesterday, so the screen can say the word in the artisan's language. */
  relative: 'today' | 'yesterday' | null;
  /** "12 Nov" */
  date: string;
  /** 24-hour "15:30", unambiguous in both languages. */
  time: string;
}

export function formatEventTime(iso: string, now: Date, lang: UiLanguage): EventTime {
  const then = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const today = new Date(now.getTime() + IST_OFFSET_MS);
  const gap = Math.floor(today.getTime() / DAY_MS) - Math.floor(then.getTime() / DAY_MS);
  return {
    relative: gap === 0 ? 'today' : gap === 1 ? 'yesterday' : null,
    date: `${then.getUTCDate()} ${MONTHS[lang][then.getUTCMonth()]}`,
    time: `${two(then.getUTCHours())}:${two(then.getUTCMinutes())}`,
  };
}
