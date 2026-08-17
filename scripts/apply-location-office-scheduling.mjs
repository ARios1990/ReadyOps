import fs from 'node:fs';

const file = 'src/AdminReferenceDashboard.tsx';
let text = fs.readFileSync(file, 'utf8');

function replaceOnce(needle, replacement, label) {
  if (!text.includes(needle)) throw new Error(`Unable to patch ${label}: source text not found`);
  text = text.replace(needle, replacement);
}

replaceOnce(
  "import { AdminPayroll } from './AdminPayroll';\n",
  "import { AdminPayroll } from './AdminPayroll';\nimport { AdminSchedulingManager } from './AdminSchedulingManager';\n",
  'scheduling manager import',
);

replaceOnce(
  "  const [userMenu, setUserMenu] = useState(false);\n",
  "  const [userMenu, setUserMenu] = useState(false);\n  const [showSchedulingManager, setShowSchedulingManager] = useState(false);\n  const [schedulingManagerMode, setSchedulingManagerMode] = useState<'company' | 'locations'>('locations');\n",
  'scheduling manager state',
);

replaceOnce(
  "  function openManage(tab?: string) {\n    setManageTab(tab);\n    setShowManage(true);\n  }\n",
  "  function openManage(tab?: string) {\n    setManageTab(tab);\n    setShowManage(true);\n  }\n\n  function openSchedulingManager(mode: 'company' | 'locations') {\n    setSchedulingManagerMode(mode);\n    setShowSchedulingManager(true);\n  }\n",
  'scheduling manager opener',
);

replaceOnce(
  "                  <button className=\"readyops-ref-purple\" onClick={() => setView('slots')}><Plus size={14}/> Add Location</button>",
  "                  <button className=\"readyops-ref-purple\" onClick={() => openSchedulingManager('locations')}><Plus size={14}/> Add Location</button>",
  'overview add location button',
);

replaceOnce(
  "                  <>\n                    <button className=\"readyops-ref-primary\" onClick={() => setView('overview')}>Overview</button>\n                    <button className=\"readyops-ref-secondary\" onClick={() => openManage('companies')}><Settings size={14}/> Edit Status</button>\n                  </>",
  "                  <>\n                    <button className=\"readyops-ref-primary\" onClick={() => openSchedulingManager('locations')}><Plus size={14}/> Add Location</button>\n                    <button className=\"readyops-ref-secondary\" onClick={() => openSchedulingManager('company')}><Pencil size={14}/> Edit Company</button>\n                    <button className=\"readyops-ref-secondary\" onClick={() => { window.location.href = '/admin/portals'; }}><Package size={14}/> Packages</button>\n                    <button className=\"readyops-ref-secondary\" onClick={() => openManage('companies')}><Settings size={14}/> Full Setup</button>\n                  </>",
  'time slot quick actions',
);

replaceOnce(
  "      {showManage && <AdminPanel store={store} onClose={() => setShowManage(false)} initialTab={manageTab}/>} \n",
  "      {showSchedulingManager && (\n        <AdminSchedulingManager\n          store={store}\n          initialMode={schedulingManagerMode}\n          onClose={() => setShowSchedulingManager(false)}\n        />\n      )}\n      {showManage && <AdminPanel store={store} onClose={() => setShowManage(false)} initialTab={manageTab}/>} \n",
  'scheduling manager render',
);

fs.writeFileSync(file, text);
console.log('Applied ReadyOps location/office scheduling UI patch.');
