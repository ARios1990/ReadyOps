from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'Missing expected marker: {label}')
    return text.replace(old, new, 1)


# Admin dashboard: restore per-agent portal link controls directly in Agents & Managers.
admin_path = Path('src/AdminReferenceDashboard.tsx')
admin = admin_path.read_text(encoding='utf-8')
admin = replace_once(
    admin,
    "  FileText, Filter, Home, Menu, Package, Pencil, Plus, Search, Settings,\n",
    "  ClipboardCopy, ExternalLink, FileText, Filter, Home, Link2, Menu, Package, Pencil, Plus, RefreshCw, Search, Settings,\n",
    'admin icons',
)
admin = replace_once(
    admin,
    """  async function deleteAgent(agent: Agent) {
    if (!window.confirm(`Delete ${agent.name}? This removes the ReadyOps agent record and unlinks any user account.`)) return;
    await supabase.from('profiles').update({ agent_id: null }).eq('agent_id', agent.id);
    const { error } = await supabase.from('agents').delete().eq('id', agent.id);
    if (error) window.alert(error.message);
    else await store.refetch();
  }
""",
    """  async function deleteAgent(agent: Agent) {
    if (!window.confirm(`Delete ${agent.name}? This removes the ReadyOps agent record and unlinks any user account.`)) return;
    await supabase.from('profiles').update({ agent_id: null }).eq('agent_id', agent.id);
    const { error } = await supabase.from('agents').delete().eq('id', agent.id);
    if (error) window.alert(error.message);
    else await store.refetch();
  }

  function agentPortalLink(agent: Agent): string {
    if (!agent.portal_slug || !agent.access_token) return '';
    return `${window.location.origin}/agent/${agent.portal_slug}/${agent.access_token}`;
  }

  async function regenerateAgentPortalLink(agent: Agent) {
    const existing = Boolean(agent.portal_slug && agent.access_token);
    if (!window.confirm(existing
      ? `Generate a new private lead link for ${agent.name}? The old link will stop working immediately.`
      : `Generate a private lead link for ${agent.name}?`)) return;
    const { data, error } = await supabase.rpc('regenerate_agent_portal_link', { p_agent_id: agent.id });
    if (error) {
      window.alert(error.message);
      return;
    }
    await store.refetch();
    const result = data as { portal_slug?: string; access_token?: string } | null;
    if (result?.portal_slug && result?.access_token) {
      const link = `${window.location.origin}/agent/${result.portal_slug}/${result.access_token}`;
      try { await navigator.clipboard.writeText(link); } catch { /* copy is optional */ }
      window.alert(`New agent portal link created for ${agent.name}. The link was copied when browser permissions allowed it.`);
    }
  }
""",
    'admin agent link helpers',
)
old_row = """                    return <tr key={agent.id}><td>{agent.name}</td><td><TeamBadge team={team}/></td><td>{linked?.display_name || agent.email || '—'}</td><td><StatusBadge active={agent.active !== false}/></td><td><div className=\"readyops-ref-actions\"><button onClick={() => openManage('agents')}><Pencil size={14}/></button><button className=\"danger\" onClick={() => void deleteAgent(agent)}><Trash2 size={14}/></button></div></td></tr>;
"""
new_row = """                    const portalLink = agentPortalLink(agent);
                    return <tr key={agent.id}><td>{agent.name}</td><td><TeamBadge team={team}/></td><td>{linked?.display_name || agent.email || '—'}</td><td><StatusBadge active={agent.active !== false}/></td><td><div className=\"readyops-ref-actions\">{portalLink && <><button title=\"Copy Agent Portal Link\" onClick={() => void navigator.clipboard.writeText(portalLink)}><ClipboardCopy size={14}/></button><button title=\"Open Agent Lead Portal\" onClick={() => window.open(portalLink, '_blank', 'noopener,noreferrer')}><ExternalLink size={14}/></button></>}<button title={portalLink ? 'Generate New Agent Link' : 'Generate Agent Link'} onClick={() => void regenerateAgentPortalLink(agent)}>{portalLink ? <RefreshCw size={14}/> : <Link2 size={14}/>}</button><button title=\"Edit Agent\" onClick={() => openManage('agents')}><Pencil size={14}/></button><button title=\"Delete Agent\" className=\"danger\" onClick={() => void deleteAgent(agent)}><Trash2 size={14}/></button></div></td></tr>;
"""
admin = replace_once(admin, old_row, new_row, 'admin agent action row')
admin_path.write_text(admin, encoding='utf-8')


# Manager dashboard: managers can copy/open/generate links only for their returned team agents.
manager_path = Path('src/ManagerDashboard.tsx')
manager = manager_path.read_text(encoding='utf-8')
manager = replace_once(
    manager,
    """  async function exitPortal() {
    if (!privateLinkMode) await supabase.auth.signOut();
    window.location.href = '/';
  }
""",
    """  async function exitPortal() {
    if (!privateLinkMode) await supabase.auth.signOut();
    window.location.href = '/';
  }

  async function regenerateAgentPortalLink(agent: AgentSummary) {
    if (privateLinkMode) return;
    const existing = Boolean(agent.portal_slug && agent.access_token);
    if (!window.confirm(existing
      ? `Generate a new private lead link for ${agent.name}? The old link will stop working immediately.`
      : `Generate a private lead link for ${agent.name}?`)) return;
    setError('');
    const { data: result, error: rpcErr } = await supabase.rpc('regenerate_agent_portal_link', { p_agent_id: agent.id });
    if (rpcErr) {
      setError(rpcError(rpcErr));
      return;
    }
    const generated = result as { portal_slug?: string; access_token?: string } | null;
    if (generated?.portal_slug && generated?.access_token) {
      const link = `${window.location.origin}/agent/${generated.portal_slug}/${generated.access_token}`;
      try { await copyText(link); } catch { /* optional clipboard */ }
    }
    await load();
  }
""",
    'manager regenerate helper',
)
manager = replace_once(
    manager,
    "<th className=\"px-4 py-3 text-right\">Agent Leads</th>",
    "<th className=\"px-4 py-3 text-right\">Agent Portal Link</th>",
    'manager table header',
)
old_action = """                    <td className=\"px-4 py-3 text-right\">{agentLink ? <a href={agentLink} target=\"_blank\" rel=\"noreferrer\" className=\"inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white\">Agent Leads <ExternalLink size={13} /></a> : <span className=\"text-xs text-slate-400\">Link unavailable</span>}</td>
"""
new_action = """                    <td className=\"px-4 py-3\"><div className=\"flex justify-end gap-2\">{agentLink && <><button onClick={() => void copyText(agentLink)} className=\"inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700\"><ClipboardCopy size={13}/> Copy Link</button><button onClick={() => window.open(agentLink, '_blank', 'noopener,noreferrer')} className=\"inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white\">Open <ExternalLink size={13}/></button></>}{!privateLinkMode && <button onClick={() => void regenerateAgentPortalLink(agent)} className=\"inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700\"><RefreshCw size={13}/> {agentLink ? 'New Link' : 'Generate Link'}</button>}{!agentLink && privateLinkMode && <span className=\"text-xs text-slate-400\">Link unavailable</span>}</div></td>
"""
manager = replace_once(manager, old_action, new_action, 'manager agent portal actions')
manager_path.write_text(manager, encoding='utf-8')

print('Applied admin and manager agent portal link controls.')
