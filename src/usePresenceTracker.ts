import { useEffect } from 'react';
import { supabase } from './supabase';

const HEARTBEAT_MS = 30_000;
const SESSION_START_KEY = 'readyops-presence-session-start';

function readSessionStart(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_START_KEY);
    if (existing) return existing;
  } catch {
    /* sessionStorage may be unavailable */
  }
  const started = new Date().toISOString();
  try {
    window.sessionStorage.setItem(SESSION_START_KEY, started);
  } catch {
    /* ignore */
  }
  return started;
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`.slice(0, 500);
}

export function usePresenceTracker(userId: string | null | undefined) {
  useEffect(() => {
    if (!userId) return;

    const sessionStartedAt = readSessionStart();
    let cancelled = false;
    let heartbeatTimer: number | null = null;

    async function upsertPresence() {
      if (cancelled) return;
      const { error } = await supabase
        .from('user_presence')
        .upsert(
          {
            user_id: userId,
            session_started_at: sessionStartedAt,
            last_seen_at: new Date().toISOString(),
            current_path: currentPath(),
          },
          { onConflict: 'user_id' },
        );
      if (error && !cancelled) {
        // Presence is best-effort; log silently for admins/devs.
        console.debug('presence upsert failed', error.message);
      }
    }

    async function touchPresence() {
      if (cancelled) return;
      const { error } = await supabase
        .from('user_presence')
        .update({
          last_seen_at: new Date().toISOString(),
          current_path: currentPath(),
        })
        .eq('user_id', userId);
      if (error && !cancelled) {
        console.debug('presence heartbeat failed', error.message);
      }
    }

    void upsertPresence();
    heartbeatTimer = window.setInterval(() => { void touchPresence(); }, HEARTBEAT_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void touchPresence();
    };
    const handleFocus = () => { void touchPresence(); };
    const handlePathChange = () => { void touchPresence(); };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('popstate', handlePathChange);
    window.addEventListener('hashchange', handlePathChange);

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    window.history.pushState = function (...args) {
      const result = originalPushState.apply(this, args as Parameters<typeof originalPushState>);
      handlePathChange();
      return result;
    };
    window.history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args as Parameters<typeof originalReplaceState>);
      handlePathChange();
      return result;
    };

    return () => {
      cancelled = true;
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('popstate', handlePathChange);
      window.removeEventListener('hashchange', handlePathChange);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, [userId]);
}
