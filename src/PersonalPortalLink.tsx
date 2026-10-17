import { useState } from 'react';

export function PersonalPortalLink({ name }: { name: string }) {
  const [notice, setNotice] = useState('');
  const link = `${window.location.origin}${window.location.pathname}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Link copied.');
    } catch {
      setNotice('Select the link above to copy it manually.');
    }
  }
  return <details className="aw-panel">
    <summary className="cursor-pointer font-semibold">My Personal Portal Link</summary>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input aria-label={`${name}'s personal portal link`} readOnly value={link}
        onFocus={event => event.currentTarget.select()}
        className="min-w-0 flex-1 basis-64 rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
      <button type="button" className="aw-primary" style={{ backgroundColor: '#315eee', color: '#ffffff' }} onClick={() => void copy()}>Copy My Link</button>
    </div>
    <p className="mt-2 text-xs">This private link opens your leads. Share it only with authorized people.</p>
    {notice && <p className="mt-2 text-sm" role="status">{notice}</p>}
  </details>;
}
