from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
manager_path = ROOT / 'src/ManagerDashboard.tsx'
text = manager_path.read_text(encoding='utf-8')

current = '''          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Ready Ops Manager</p>
            <h1 className="text-xl font-bold">{data.manager?.name || data.team.name}</h1>
            <p className="text-xs text-slate-500">Team: {data.team.abbreviation} — {data.team.name}</p>
          </div>'''
expected_by_base_patch = '''          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Ready Ops Manager</p>
            <h1 className="text-xl font-bold">{data?.team?.name || 'Manager Dashboard'}</h1>
            {data?.team && <p className="text-xs text-slate-500">Team: {data.team.abbreviation}</p>}
          </div>'''

if current in text:
    manager_path.write_text(text.replace(current, expected_by_base_patch, 1), encoding='utf-8')
elif expected_by_base_patch not in text:
    raise RuntimeError('Manager dashboard title block did not match the expected private-link variant.')

runpy.run_path(str(ROOT / 'scripts/apply-recording-branding.py'), run_name='__main__')

text = manager_path.read_text(encoding='utf-8')
generic_branded = '''          <div className="flex items-center gap-4"><img src={READYOPS_LOGO_DATA_URI} alt="ReadyOps" className="readyops-brand-logo-sm"/><div className="border-l border-white/15 pl-4"><p className="readyops-brand-subtitle text-xs font-bold uppercase tracking-[0.18em]">Manager Dashboard</p><h1 className="text-xl font-bold text-white">{data?.team?.name || 'Manager Dashboard'}</h1>{data?.team && <p className="readyops-brand-subtitle text-xs">Team: {data.team.abbreviation}</p>}</div></div>'''
private_branded = '''          <div className="flex items-center gap-4"><img src={READYOPS_LOGO_DATA_URI} alt="ReadyOps" className="readyops-brand-logo-sm"/><div className="border-l border-white/15 pl-4"><p className="readyops-brand-subtitle text-xs font-bold uppercase tracking-[0.18em]">Manager Dashboard</p><h1 className="text-xl font-bold text-white">{data.manager?.name || data.team.name}</h1><p className="readyops-brand-subtitle text-xs">Team: {data.team.abbreviation} — {data.team.name}</p></div></div>'''
if generic_branded not in text:
    raise RuntimeError('Base patch did not create the expected branded manager block.')
manager_path.write_text(text.replace(generic_branded, private_branded, 1), encoding='utf-8')
print('Applied private manager-compatible recording and branding patch.')
