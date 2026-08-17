from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'src/AdminPanel.tsx'
s = p.read_text(encoding='utf-8')

anchor = "  useEffect(() => {\n    if (initialTab) setTab(initialTab as Tab);\n  }, [initialTab]);\n"
extra = anchor + "\n  useEffect(() => {\n    const previousOverflow = document.body.style.overflow;\n    document.body.style.overflow = 'hidden';\n    const handleKey = (event: KeyboardEvent) => {\n      if (event.key === 'Escape') onClose();\n    };\n    window.addEventListener('keydown', handleKey);\n    return () => {\n      document.body.style.overflow = previousOverflow;\n      window.removeEventListener('keydown', handleKey);\n    };\n  }, [onClose]);\n"
if "document.body.style.overflow = 'hidden'" not in s:
    if anchor not in s:
        raise SystemExit('initial tab effect anchor not found')
    s = s.replace(anchor, extra, 1)

old_open = '''  return (\n    <div className="border-b border-gray-200 bg-gray-50">\n      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-4">'''
new_open = '''  return (\n    <div\n      className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-[2px]"\n      onMouseDown={onClose}\n      role="presentation"\n    >\n      <aside\n        className="absolute right-0 top-0 h-full w-full max-w-[1180px] overflow-y-auto border-l border-gray-200 bg-gray-50 shadow-2xl"\n        onMouseDown={event => event.stopPropagation()}\n        role="dialog"\n        aria-modal="true"\n        aria-label="ReadyOps management"\n      >\n        <div className="px-4 py-4 sm:px-6">'''
if old_open not in s:
    raise SystemExit('AdminPanel opening wrapper not found')
s = s.replace(old_open, new_open, 1)

# Make the drawer purpose clear and reduce confusion with the dedicated Companies & Packages page.
s = s.replace('<h2 className="text-base font-bold text-gray-800">Admin Panel</h2>', '<div><h2 className="text-base font-bold text-gray-800">Manage ReadyOps</h2><p className="text-[11px] text-gray-500">Company setup, staff, users, and account configuration</p></div>', 1)
s = s.replace("{ key: 'companies', icon: Building2, label: 'Companies' }", "{ key: 'companies', icon: Building2, label: 'Company Setup' }", 1)

# Use the available vertical space instead of forcing a short inline table.
s = s.replace('max-h-[360px]', 'max-h-[calc(100vh-220px)]')

old_close = '''      </div>\n    </div>\n  );\n}\n\nfunction getTeamColor'''
new_close = '''        </div>\n      </aside>\n    </div>\n  );\n}\n\nfunction getTeamColor'''
if old_close not in s:
    raise SystemExit('AdminPanel closing wrapper not found')
s = s.replace(old_close, new_close, 1)

p.write_text(s, encoding='utf-8')
print('Converted AdminPanel from inline section to right-side management drawer.')
