import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from './supabase';
import { AgentBookingPortal } from './AgentBookingPortal';
import { rpcError } from './portalUtils';

interface CampaignResolution {
  public_slug?: string;
  company_name?: string;
  state?: string | null;
}

/** Resolves a ReadyMode campaign name to the matching Ready Ops booking portal. */
export function ReadyModeCampaignRouter() {
  const query = new URLSearchParams(window.location.search);
  const campaignName = (query.get('campaign') || '').trim();
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function resolveCampaign() {
      if (!campaignName) {
        setError('ReadyMode did not provide a campaign name.');
        return;
      }

      const { data, error: rpcErr } = await supabase.rpc('resolve_readymode_campaign', {
        p_campaign_name: campaignName,
      });

      if (cancelled) return;
      if (rpcErr) {
        setError(rpcError(rpcErr));
        return;
      }

      const result = (data || {}) as CampaignResolution;
      if (!result.public_slug) {
        setError(`No Ready Ops company matches the ReadyMode campaign: ${campaignName}`);
        return;
      }

      setSlug(result.public_slug);
    }

    void resolveCampaign();
    return () => { cancelled = true; };
  }, [campaignName]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="font-bold text-red-700">Ready Ops campaign not matched</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!slug) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-600">
          <Loader2 className="animate-spin text-blue-600" size={20} />
          Matching ReadyMode campaign...
        </div>
      </div>
    );
  }

  return <AgentBookingPortal slug={slug} />;
}
