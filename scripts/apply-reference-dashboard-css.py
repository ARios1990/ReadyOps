from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'src/index.css'
text = path.read_text(encoding='utf-8')

text = text.replace(
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');",
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=UnifrakturCook:wght@700&display=swap');",
    1,
)

marker = '/* READYOPS_REFERENCE_DASHBOARD_V1 */'
if marker not in text:
    text += r'''

/* READYOPS_REFERENCE_DASHBOARD_V1 */
.readyops-ref-shell {
  --ref-sidebar: 208px;
  --ref-topbar: 72px;
  min-height: 100vh;
  background: var(--readyops-page-bg);
  color: var(--readyops-text);
}
.readyops-ref-shell.is-sidebar-collapsed { --ref-sidebar: 72px; }
.readyops-ref-sidebar {
  position: fixed; inset: 0 auto 0 0; width: var(--ref-sidebar); z-index: 60;
  padding: 20px 10px 18px;
  border-right: 1px solid var(--readyops-border);
  background: rgba(255,255,255,.95);
  backdrop-filter: blur(18px);
  transition: width .2s ease, background .2s ease;
  overflow: hidden;
}
html[data-theme='dark'] .readyops-ref-sidebar {
  background: linear-gradient(180deg,#091a2e 0%,#071525 100%);
  border-color: #243c58;
}
.readyops-ref-wordmark {
  display:flex; align-items:center; justify-content:center; width:100%; height:46px;
  margin-bottom:24px; white-space:nowrap; overflow:hidden;
  font-family:'UnifrakturCook','Old English Text MT',Georgia,serif;
  font-size:28px; line-height:1; letter-spacing:-1.2px; color:#0b1c32;
}
.readyops-ref-wordmark span:last-child { color:#006cff; }
html[data-theme='dark'] .readyops-ref-wordmark span:first-child { color:#f0f4f9; }
.readyops-ref-nav-group { margin-top:16px; }
.readyops-ref-nav-group > p { margin:0 11px 8px; font-size:9px; font-weight:800; letter-spacing:.08em; color:#8a9bb0; }
.readyops-ref-nav-group button {
  width:100%; min-height:36px; display:flex; align-items:center; gap:11px; border-radius:7px;
  padding:0 12px; margin:2px 0; color:#31445e; font-size:12px; font-weight:650; text-align:left;
  transition:all .14s ease;
}
.readyops-ref-nav-group button:hover { background:#edf4ff; color:#0a61e8; }
.readyops-ref-nav-group button.active { background:#e8f1ff; color:#0a61e8; }
html[data-theme='dark'] .readyops-ref-nav-group button { color:#d6dfeb; }
html[data-theme='dark'] .readyops-ref-nav-group button:hover { background:#112c50; color:#66a6ff; }
html[data-theme='dark'] .readyops-ref-nav-group button.active { background:#16335b; color:#6ba8ff; }
.readyops-ref-shell.is-sidebar-collapsed .readyops-ref-wordmark { font-size:0; }
.readyops-ref-shell.is-sidebar-collapsed .readyops-ref-wordmark::after { content:'R'; font-size:28px; color:#006cff; }
.readyops-ref-shell.is-sidebar-collapsed .readyops-ref-nav-group button { justify-content:center; padding:0; }
.readyops-ref-workspace { min-height:100vh; margin-left:var(--ref-sidebar); transition:margin-left .2s ease; position:relative; overflow:hidden; }
.readyops-ref-topbar {
  position:sticky; top:0; z-index:50; height:var(--ref-topbar); padding:0 30px;
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  border-bottom:1px solid var(--readyops-border); background:rgba(255,255,255,.78); backdrop-filter:blur(18px);
}
html[data-theme='dark'] .readyops-ref-topbar { background:rgba(10,27,47,.84); border-color:#29405c; }
.readyops-ref-icon-button { width:34px; height:34px; display:grid; place-items:center; border-radius:7px; border:1px solid var(--readyops-border); background:var(--readyops-surface); }
.readyops-ref-top-actions { display:flex; align-items:center; gap:10px; }
.readyops-ref-live,.readyops-ref-admin,.readyops-ref-manage,.readyops-ref-user {
  height:34px; display:inline-flex; align-items:center; gap:7px; border-radius:10px; padding:0 13px; font-size:11px; font-weight:750; white-space:nowrap;
}
.readyops-ref-live { color:#15835b; background:rgba(20,184,116,.07); border:1px solid rgba(20,184,116,.16); }
.readyops-ref-live i,.readyops-ref-admin i { width:6px; height:6px; border-radius:50%; background:currentColor; }
.readyops-ref-admin { color:#e68522; background:rgba(245,158,11,.07); border:1px solid rgba(245,158,11,.22); }
.readyops-ref-manage { color:#fff; background:#0b63e5; box-shadow:0 6px 15px rgba(0,108,255,.18); }
.readyops-ref-user { color:var(--readyops-text); }
.readyops-ref-avatar { width:33px; height:33px; display:grid; place-items:center; border-radius:50%; background:#7da9ff; color:white; font-size:11px; font-weight:800; }
.readyops-ref-user-menu { position:absolute; right:0; top:42px; min-width:120px; padding:6px; border:1px solid var(--readyops-border); border-radius:10px; background:var(--readyops-surface); box-shadow:0 16px 38px rgba(0,0,0,.14); }
.readyops-ref-user-menu button { width:100%; padding:8px 10px; border-radius:7px; text-align:left; font-size:12px; }
.readyops-ref-user-menu button:hover { background:var(--readyops-surface-2); }
.readyops-ref-main { position:relative; z-index:5; padding:26px 30px 34px; }
.readyops-ref-scene { position:absolute; inset:var(--ref-topbar) 0 auto 0; height:260px; pointer-events:none; overflow:hidden; color:#9db6d2; opacity:.45; }
.readyops-ref-cityline { position:absolute; inset:0; }
.readyops-ref-scene svg { width:100%; height:100%; position:absolute; left:0; bottom:0; }
.readyops-ref-watermark { position:absolute; right:44px; top:-20px; font-family:'UnifrakturCook',Georgia,serif; font-size:230px; line-height:1; color:currentColor; opacity:.22; }
html[data-theme='dark'] .readyops-ref-scene { color:#32567d; opacity:.42; }
.readyops-ref-title-row { display:flex; align-items:baseline; gap:14px; margin:2px 0 22px; }
.readyops-ref-title-row h2 { font-size:23px; line-height:1; font-weight:800; letter-spacing:-.02em; }
.readyops-ref-title-row span,.readyops-ref-title-row button { color:#0b63e5; font-size:12px; font-weight:700; }
.readyops-ref-metrics { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; margin-bottom:20px; }
.readyops-ref-metric {
  min-height:104px; position:relative; overflow:hidden; display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:17px 18px; border-radius:10px; border:1px solid var(--readyops-border); background:rgba(255,255,255,.88); box-shadow:0 8px 18px rgba(33,67,108,.08);
}
html[data-theme='dark'] .readyops-ref-metric { background:rgba(17,39,64,.86); box-shadow:0 8px 18px rgba(0,0,0,.16); }
.readyops-ref-metric p { margin:0 0 5px; font-size:9px; letter-spacing:.02em; font-weight:800; opacity:.8; }
.readyops-ref-metric strong { display:block; font-size:27px; line-height:1; font-weight:800; }
.readyops-ref-metric span { display:block; margin-top:8px; font-size:10px; font-weight:650; opacity:.8; }
.readyops-ref-metric-icon { width:47px; height:47px; flex:0 0 47px; display:grid; place-items:center; border-radius:50%; }
.tone-blue .readyops-ref-metric-icon { color:#0b63e5; background:#dfeaff; }
.tone-orange .readyops-ref-metric-icon { color:#ef8b25; background:#fff0dc; }
.tone-green .readyops-ref-metric-icon { color:#17a56f; background:#dff6ed; }
.tone-purple .readyops-ref-metric-icon { color:#7c35e7; background:#ede0ff; }
.tone-red .readyops-ref-metric-icon { color:#ef3845; background:#ffe3e6; }
html[data-theme='dark'] .tone-blue .readyops-ref-metric-icon { background:#173a6b; }
html[data-theme='dark'] .tone-orange .readyops-ref-metric-icon { background:#49341f; }
html[data-theme='dark'] .tone-green .readyops-ref-metric-icon { background:#173f37; }
html[data-theme='dark'] .tone-purple .readyops-ref-metric-icon { background:#332559; }
html[data-theme='dark'] .tone-red .readyops-ref-metric-icon { background:#49272d; }
.readyops-ref-card { border:1px solid var(--readyops-border); border-radius:12px; background:rgba(255,255,255,.91); box-shadow:0 10px 24px rgba(33,67,108,.08); overflow:hidden; }
html[data-theme='dark'] .readyops-ref-card { background:rgba(13,31,52,.9); box-shadow:0 10px 24px rgba(0,0,0,.16); }
.readyops-ref-staff-card { margin-bottom:18px; }
.readyops-ref-card-heading { padding:17px 20px 5px; }
.readyops-ref-card-heading h3 { font-size:18px; font-weight:800; }
.readyops-ref-tabs { display:flex; align-items:center; gap:18px; padding:0 20px; border-bottom:1px solid var(--readyops-border); }
.readyops-ref-tabs button { position:relative; padding:10px 4px 11px; font-size:12px; font-weight:700; opacity:.78; }
.readyops-ref-tabs button.active { color:#0b63e5; opacity:1; }
.readyops-ref-tabs button.active::after { content:''; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:#0b63e5; border-radius:2px; }
.readyops-ref-toolbar { min-height:56px; display:flex; align-items:center; gap:12px; padding:10px 18px; border-bottom:1px solid var(--readyops-border); }
.readyops-ref-search { width:300px; height:34px; display:flex; align-items:center; gap:8px; padding:0 10px; border:1px solid var(--readyops-border); border-radius:7px; background:rgba(255,255,255,.6); }
html[data-theme='dark'] .readyops-ref-search { background:#0c1d31; }
.readyops-ref-search input { width:100%; border:0; outline:0; background:transparent; color:inherit; font-size:11px; }
.readyops-ref-primary,.readyops-ref-secondary,.readyops-ref-green,.readyops-ref-purple,.readyops-ref-filter { min-height:34px; display:inline-flex; align-items:center; justify-content:center; gap:6px; border-radius:7px; padding:0 13px; font-size:11px; font-weight:750; }
.readyops-ref-primary { background:#0b63e5; color:white; }
.readyops-ref-green { background:#0da36c; color:white; }
.readyops-ref-purple { background:#7a3ad5; color:white; }
.readyops-ref-secondary,.readyops-ref-filter { border:1px solid var(--readyops-border); background:var(--readyops-surface); color:var(--readyops-text); }
.readyops-ref-filter select { appearance:none; background:transparent; border:0; outline:0; color:inherit; font-size:11px; font-weight:750; padding-right:4px; }
.readyops-ref-table-wrap { max-height:330px; overflow:auto; }
.readyops-ref-table { width:100%; border-collapse:collapse; table-layout:fixed; }
.readyops-ref-table thead { position:sticky; top:0; z-index:2; background:var(--readyops-surface-2); }
.readyops-ref-table th { padding:10px 14px; font-size:9px; font-weight:800; letter-spacing:.03em; text-align:left; color:var(--readyops-muted-text); }
.readyops-ref-table td { padding:10px 14px; border-top:1px solid var(--readyops-border); font-size:11px; font-weight:600; }
.readyops-ref-table th:nth-child(1),.readyops-ref-table td:nth-child(1){width:27%}.readyops-ref-table th:nth-child(2),.readyops-ref-table td:nth-child(2){width:17%}.readyops-ref-table th:nth-child(3),.readyops-ref-table td:nth-child(3){width:23%}.readyops-ref-table th:nth-child(4),.readyops-ref-table td:nth-child(4){width:15%}.readyops-ref-table th:nth-child(5),.readyops-ref-table td:nth-child(5){width:18%}
.readyops-ref-team { display:inline-flex; min-width:30px; justify-content:center; padding:2px 6px; border-radius:4px; font-size:9px; font-weight:800; }
.team-octo { color:#ff4d50; background:#ffe7e8; }.team-brl { color:#6f3ce0; background:#eee5ff; }.team-msr { color:#2563eb; background:#e5eeff; }.team-none { color:#8a9bb0; background:#eef2f6; }
html[data-theme='dark'] .team-octo { background:#673237;color:#ff6d72 }.readyops-ref-status { display:inline-flex; padding:2px 7px; border-radius:4px; background:#ddf5e9; color:#11835b; font-size:9px; font-weight:800; }.readyops-ref-status.inactive{background:#eef1f4;color:#7b8da2}
.readyops-ref-actions { display:flex; justify-content:flex-start; gap:12px; }.readyops-ref-actions button { color:#35506d; }.readyops-ref-actions button.danger { color:#ef3a48; }
html[data-theme='dark'] .readyops-ref-actions button { color:#c5d0dd; }
.readyops-ref-quick-card { min-height:126px; }
.readyops-ref-tabs-large { gap:30px; padding-left:18px; }
.readyops-ref-tabs-large button { font-size:13px; }
.readyops-ref-quick-actions { display:flex; flex-wrap:wrap; gap:10px; padding:22px 18px; }
.readyops-ref-slots-view > .readyops-ref-title-row { justify-content:space-between; }

@media (max-width: 1200px) { .readyops-ref-metrics { grid-template-columns:repeat(3,1fr); }.readyops-ref-sidebar{width:184px}.readyops-ref-shell{--ref-sidebar:184px} }
@media (max-width: 860px) { .readyops-ref-metrics{grid-template-columns:repeat(2,1fr)} .readyops-ref-main{padding:20px 16px}.readyops-ref-topbar{padding:0 16px}.readyops-ref-top-actions{gap:6px}.readyops-ref-live,.readyops-ref-admin{display:none} .readyops-ref-sidebar{transform:translateX(-100%)} .readyops-ref-workspace{margin-left:0}.readyops-ref-shell{--ref-sidebar:0}.readyops-ref-shell.is-sidebar-collapsed .readyops-ref-sidebar{transform:translateX(0);width:72px}.readyops-ref-shell.is-sidebar-collapsed .readyops-ref-workspace{margin-left:72px} }
@media (max-width: 600px) { .readyops-ref-metrics{grid-template-columns:1fr}.readyops-ref-search{width:100%}.readyops-ref-toolbar{align-items:stretch;flex-direction:column}.readyops-ref-toolbar .ml-auto{margin-left:0;width:100%}.readyops-ref-user>span:not(.readyops-ref-avatar){display:none}.readyops-ref-watermark{display:none} }
'''

path.write_text(text, encoding='utf-8')
print('Added reference dashboard light/dark styling.')
