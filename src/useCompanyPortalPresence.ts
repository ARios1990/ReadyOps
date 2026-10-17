import { useEffect } from 'react';
import { supabase } from './supabase';

const HEARTBEAT_MS = 30_000;
const SESSION_START_KEY = 'readyops-company-portal-session-start';

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
    /* Presence is best-effort. */
  }
  return started;
}
export function useCompanyPortalPresence(companyId: string, token: string, section: string) {
  useEffect(() => {
    if (!companyId || !token) return;

    const sessionStartedAt = readSessionStart();
    let cancelled = false;

    async function heartbeat() {
      if (cancelled || document.visibilityState === 'hidden') return;
      const { error } = await supabase.rpc('record_company_portal_presence', {
        p_company_id: companyId,
        p_access_token: token,
        p_session_started_at: sessionStartedAt,
        p_current_section: section,
      });
      if (error && !cancelled) console.debug('company portal presence heartbeat failed', error.message);
    }

    void heartbeat();
    const timer = window.setInterval(() => { void heartbeat(); }, HEARTBEAT_MS);
    const handleVisible = () => { if (document.visibilityState === 'visible') void heartbeat(); };
    const handleFocus = () => { void heartbeat(); };

    document.addEventListener('visibilitychange', handleVisible);
    window.addEventListener('focus', handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('focus', handleFocus);
    };
  }, [companyId, section, token]);
}
