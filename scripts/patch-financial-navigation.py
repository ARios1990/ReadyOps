from pathlib import Path

root = Path(__file__).resolve().parents[1]
p = root / 'src/AdminReferenceDashboard.tsx'
s = p.read_text(encoding='utf-8')

s = s.replace(
    "  Building2, CalendarDays, CheckCircle2, ChevronDown, CircleDollarSign,",
    "  Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign,",
    1,
)

marker = "import { useScheduleStore } from './useScheduleStore';"
if "./AdminReports" not in s:
    s = s.replace(marker, marker + "\nimport { AdminReports } from './AdminReports';\nimport { AdminInvoices } from './AdminInvoices';\nimport { AdminPayroll } from './AdminPayroll';", 1)

s = s.replace("type View = 'overview' | 'slots';", "type View = 'overview' | 'slots' | 'reports' | 'invoices' | 'payroll';", 1)

old_nav = "    else if (key === 'teams') { setView('overview'); setStaffTab('team'); scrollStaff(); }\n    else if (key === 'settings') openManage('companies');"
new_nav = "    else if (key === 'teams') { setView('overview'); setStaffTab('team'); scrollStaff(); }\n    else if (key === 'reports') setView('reports');\n    else if (key === 'invoices') setView('invoices');\n    else if (key === 'payroll') setView('payroll');\n    else if (key === 'settings') openManage('companies');"
s = s.replace(old_nav, new_nav, 1)

s = s.replace("  const currentSection = view === 'slots' ? 'slots' : 'overview';", "  const currentSection = view;", 1)

wordmark = '<button className="readyops-ref-wordmark" onClick={() => navigate(\'overview\')} aria-label="Ready Ops home">\n          <span>Ready</span><span>Ops</span>\n        </button>'
if 'readyops-sidebar-edge-toggle' not in s:
    s = s.replace(
        wordmark,
        wordmark + '\n        <button type="button" className="readyops-sidebar-edge-toggle" onClick={() => setSidebarCollapsed(v => !v)} title={sidebarCollapsed ? \'Expand sidebar\' : \'Collapse sidebar\'} aria-label={sidebarCollapsed ? \'Expand sidebar\' : \'Collapse sidebar\'}>{sidebarCollapsed ? <ChevronRight size={15}/> : <ChevronLeft size={15}/>}</button>',
        1,
    )

s = s.replace("<SidebarGroup title=\"MANAGEMENT\" collapsed={sidebarCollapsed && !isMobile} items={SIDEBAR_MANAGEMENT} active=\"\" onSelect={navigate} />", "<SidebarGroup title=\"MANAGEMENT\" collapsed={sidebarCollapsed && !isMobile} items={SIDEBAR_MANAGEMENT} active={currentSection} onSelect={navigate} />", 1)

needle = "          </> : (\n            <section className=\"readyops-ref-slots-view\">"
replacement = "          </> : view === 'reports' ? (\n            <AdminReports />\n          ) : view === 'invoices' ? (\n            <AdminInvoices />\n          ) : view === 'payroll' ? (\n            <AdminPayroll />\n          ) : (\n            <section className=\"readyops-ref-slots-view\">"
if needle in s:
    s = s.replace(needle, replacement, 1)

p.write_text(s, encoding='utf-8')

invoice = root / 'src/AdminInvoices.tsx'
if invoice.exists():
    t = invoice.read_text(encoding='utf-8')
    t = t.replace("import { useEffect, useMemo, useState } from 'react';", "import { useEffect, useMemo, useState, type ReactNode } from 'react';", 1)
    t = t.replace('children:React.ReactNode', 'children:ReactNode')
    invoice.write_text(t, encoding='utf-8')

reports = root / 'src/AdminReports.tsx'
if reports.exists():
    t = reports.read_text(encoding='utf-8')
    old = "  const joined = useMemo(() => {\n    const leadMap = new Map(leads.map(l => [l.id, l]));\n    return appointments.map(ap => ({ ...ap, lead: leadMap.get(ap.lead_id) || null })).filter(row => row.lead);\n  }, [appointments, leads]);"
    new = "  const joined = useMemo<Obj[]>(() => {\n    const leadMap = new Map(leads.map(l => [l.id, l]));\n    return appointments.map(ap => ({ ...ap, lead: leadMap.get(ap.lead_id) || null } as Obj)).filter(row => Boolean(row.lead));\n  }, [appointments, leads]);"
    t = t.replace(old, new, 1)
    reports.write_text(t, encoding='utf-8')

print('Patched ReadyOps sidebar and financial modules.')
