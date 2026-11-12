import * as SecureStore from 'expo-secure-store';

/**
 * Session tokens and the active language, held outside React.
 *
 * The API client is not a component and cannot read a hook, but it has to
 * attach the current token to every request and know which language to ask
 * errors to be spoken in. This module is that shared state. It imports
 * nothing from the rest of the app, which is what keeps `apiClient`, the
 * store and the speech layer from forming an import cycle.
 *
 * Tokens live in the platform keystore (Keychain / Android Keystore) via
 * SecureStore, not in the JSON profile file: a refresh token is a long-lived
 * credential and should not sit in app storage a backup or a rooted device
 * could read.
 */

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

const STORE_KEY = 'kalasetu.session.v1';

let current: Session | null = null;
let language = 'hi-IN';
let onExpired: (() => void) | null = null;

export function getSession(): Session | null {
  return current;
}

export function getLanguage(): string {
  return language;
}

export function setLanguage(next: string): void {
  language = next;
}

/** Registered by the store: called when a refresh fails and the user must log in again. */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onExpired = handler;
}

export function expireSession(): void {
  current = null;
  void SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined);
  onExpired?.();
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== 'number') {
      return null;
    }
    current = parsed as Session;
    return current;
  } catch {
    // An unreadable keystore entry means "not signed in", never a crash.
    return null;
  }
}

export async function saveSession(next: Session | null): Promise<void> {
  current = next;
  try {
    if (next) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    // Keep the in-memory session so this launch still works; the next cold
    // start will simply ask for a login.
  }
}

/** Refresh a minute early so a request never leaves with a token about to expire. */
const REFRESH_MARGIN_SECONDS = 60;

export function isExpiringSoon(session: Session): boolean {
  return session.expiresAt - Math.floor(Date.now() / 1000) < REFRESH_MARGIN_SECONDS;
}
