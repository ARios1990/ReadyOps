import fs from 'node:fs';

function replace(path, from, to) {
  const content = fs.readFileSync(path, 'utf8');
  if (!content.includes(from)) throw new Error(`Target not found in ${path}: ${from.slice(0, 100)}`);
  fs.writeFileSync(path, content.replace(from, to));
}

replace(
  'src/Dashboard.tsx',
  "import { AdminPanel } from './AdminPanel';\n",
  "import { AdminPanel } from './AdminPanel';\nimport { AdminOperationsHome } from './AdminOperationsHome';\n",
);

replace(
  'src/Dashboard.tsx',
  "  const [adminTab, setAdminTab] = useState<string | undefined>(undefined);\n",
  "  const [adminTab, setAdminTab] = useState<string | undefined>(undefined);\n  const [adminView, setAdminView] = useState<'overview' | 'slots'>('overview');\n",
);

replace(
  'src/Dashboard.tsx',
  "        {/* Action Buttons (Admin) */}\n",
  `        {isAdmin && (\n          <nav className=\"mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm\">\n            <button onClick={() => setAdminView('overview')} className={\`rounded-xl px-4 py-2.5 text-sm font-bold transition \${adminView === 'overview' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}\`}>Overview</button>\n            <button onClick={() => { window.location.href = '/qc'; }} className=\"rounded-xl px-4 py-2.5 text-sm font-bold text-blue-700 hover:bg-blue-50\">QC Queue</button>\n            <button onClick={() => { window.location.href = '/admin/portals'; }} className=\"rounded-xl px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50\">Companies & Packages</button>\n            <button onClick={() => setAdminView('slots')} className={\`rounded-xl px-4 py-2.5 text-sm font-bold transition \${adminView === 'slots' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}\`}>Time Slots</button>\n          </nav>\n        )}\n\n        {isAdmin && adminView === 'overview' && (\n          <AdminOperationsHome onOpenTimeSlots={() => setAdminView('slots')} />\n        )}\n\n        {(!isAdmin || adminView === 'slots') && (<>\n        {/* Action Buttons (Admin) */}\n`,
);

replace(
  'src/Dashboard.tsx',
  "        <div className=\"mt-4 text-center text-xs text-gray-400\">\n          {isAdmin\n            ? 'Admin -- full control. Click status badges to edit. Use toolbar to add companies/agents/locations.'\n            : 'Agent -- book open slots for your team\\'s companies. Changes sync live.'}\n        </div>\n      </main>",
  "        <div className=\"mt-4 text-center text-xs text-gray-400\">\n          {isAdmin\n            ? 'Time Slots -- manage weekly blocks and current-week appointment capacity.'\n            : 'Agent -- book open slots for your team\\'s companies. Changes sync live.'}\n        </div>\n        </>)}\n      </main>",
);

replace(
  'src/App.tsx',
  "import { Loader2, ShieldCheck, Building2 } from 'lucide-react';",
  "import { Loader2 } from 'lucide-react';",
);

replace(
  'src/App.tsx',
  "  return <><Dashboard />{profile?.role === 'admin' && <div className=\"fixed bottom-5 right-5 z-40 flex flex-col gap-2\"><button onClick={()=>{window.location.href='/qc'}} className=\"inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-xl\"><ShieldCheck size={16}/> QC Queue</button><button onClick={()=>{window.location.href='/admin/portals'}} className=\"inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-xl\"><Building2 size={16}/> Operations</button></div>}</>;",
  "  return <Dashboard />;",
);

console.log('Admin operations homepage integrated.');
