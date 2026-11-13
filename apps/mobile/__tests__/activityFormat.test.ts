import { deviceKey, describeEvent, formatEventTime, recentFailures, WARN_AFTER_FAILURES } from '../services/activityFormat';

describe('describeEvent', () => {
  it('gives every event a label and icon, and flags only a failed login as a warning', () => {
    expect(describeEvent('login_failed')).toMatchObject({ tone: 'warn', icon: 'alert-circle', label: 'activity.event.login_failed' });
    for (const type of ['signup', 'login', 'logout', 'password_changed']) {
      expect(describeEvent(type).tone).toBe('normal');
    }
  });

  it('does not crash on an event type a newer server invents', () => {
    expect(describeEvent('something_new')).toMatchObject({ tone: 'normal' });
  });
});

describe('deviceKey', () => {
  it.each([
    ['okhttp/4.12.0', 'activity.device.android'],
    ['Dalvik/2.1.0 (Linux; U; Android 14)', 'activity.device.android'],
    ['KalaSetu/1 CFNetwork/1490 Darwin/23', 'activity.device.ios'],
    ['Mozilla/5.0 (Windows NT 10.0) Chrome/120', 'activity.device.web'],
    ['curl/8.1', 'activity.device.unknown'],
    [null, 'activity.device.unknown'],
    ['', 'activity.device.unknown'],
  ])('reads %j as %s', (agent, key) => {
    expect(deviceKey(agent)).toBe(key);
  });
});

describe('recentFailures', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  const at = (hoursAgo: number, type = 'login_failed') => ({
    event_type: type as 'login_failed',
    created_at: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
  });

  it('counts wrong-password attempts in the last 24 hours only', () => {
    expect(recentFailures([at(1), at(23), at(25), at(100)], now)).toBe(2);
  });

  it('ignores every other kind of event', () => {
    expect(recentFailures([at(1, 'login'), at(2, 'logout'), at(3, 'password_changed')], now)).toBe(0);
  });

  it('includes an attempt exactly 24 hours ago, and is zero for an empty trail', () => {
    expect(recentFailures([at(24)], now)).toBe(1);
    expect(recentFailures([], now)).toBe(0);
  });

  it('can use a different window', () => {
    expect(recentFailures([at(1), at(5)], now, 2)).toBe(1);
  });

  it('warns from three attempts, not from a single typo', () => {
    expect(WARN_AFTER_FAILURES).toBe(3);
  });
});

describe('formatEventTime (Indian calendar days)', () => {
  const now = new Date('2026-11-13T06:00:00Z'); // 11:30 on the 13th in India

  it('says today, with a 24-hour time', () => {
    expect(formatEventTime('2026-11-13T04:00:00Z', now, 'en')).toEqual({ relative: 'today', date: '13 Nov', time: '09:30' });
  });

  it('puts 19:00 UTC on the 12th into today (00:30 on the 13th in India)', () => {
    expect(formatEventTime('2026-11-12T19:00:00Z', now, 'en')).toMatchObject({ relative: 'today', time: '00:30' });
  });

  it('puts 18:29 UTC on the 12th into yesterday (23:59 on the 12th in India)', () => {
    expect(formatEventTime('2026-11-12T18:29:00Z', now, 'en')).toMatchObject({ relative: 'yesterday', time: '23:59' });
  });

  it('has no relative word for older days, and counts yesterday across a month end', () => {
    expect(formatEventTime('2026-11-01T10:00:00Z', now, 'en')).toMatchObject({ relative: null, date: '1 Nov' });
    expect(formatEventTime('2026-11-30T10:00:00Z', new Date('2026-12-01T06:00:00Z'), 'en').relative).toBe('yesterday');
  });

  it('names the month in Hindi', () => {
    expect(formatEventTime('2026-11-01T10:00:00Z', now, 'hi').date).toBe('1 नव॰');
  });
});
