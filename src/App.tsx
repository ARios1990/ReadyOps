import { AuthProvider, useAuth } from './AuthContext';
import { LoginPage } from './LoginPage';
import { Dashboard } from './Dashboard';
import { AgentBookingPortal } from './AgentBookingPortal';
import { ReadyModeCampaignRouter } from './ReadyModeCampaignRouter';
import { CompanyPortalRoute } from './CompanyPortalRoute';
import { RepresentativePortal } from './RepresentativePortal';
import { PortalAdmin } from './PortalAdmin';
import { AgentPortal } from './AgentPortal';
import { ManagerDashboard } from './ManagerDashboard';
import { CompanyOnboarding } from './CompanyOnboarding';
import { QCQueue } from './QCQueue';
import { ResetPasswordPage } from './ResetPasswordPage';
import { ThemeProvider, ThemeToggle } from './ThemeContext';
import { Loader2 } from 'lucide-react';
import { usePresenceTracker } from './usePresenceTracker';
import { ActiveUsers } from './ActiveUsers';

function pathParts(): string[] { return window.location.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
function PublicRoute() {
  const parts = pathParts();
  if (parts[0] === 'readymode') return <ReadyModeCampaignRouter />;
  if (parts[0] === 'book' && parts[1]) return <AgentBookingPortal slug={parts[1]} />;
  if (parts[0] === 'agent' && parts[1] && parts[2]) return <AgentPortal slug={parts[1]} token={parts[2]} />;
  if (parts[0] === 'manager' && parts[1] && parts[2]) return <ManagerDashboard slug={parts[1]} token={parts[2]} />;
  if (parts[0] === 'join' && parts[1] && parts[2]) return <CompanyOnboarding slug={parts[1]} token={parts[2]} />;
  if (parts[0] === 'rep' && parts[1]) return <RepresentativePortal token={parts[1]} />;
  if (parts[0] === 'company' && parts[1] && parts[2] === 'manage' && parts[3]) return <CompanyPortalRoute identifier={parts[1]} token={parts[3]} />;
  return null;
}

function FloatingThemeControl() {
  return <div className="readyops-theme-floating"><ThemeToggle /></div>;
}

function AppContent() {
  const { session, profile, loading } = useAuth();
  usePresenceTracker(session && profile ? session.user.id : null);
  const parts = pathParts();
  const portalAdminRequested = parts[0] === 'admin' && parts[1] === 'portals';
  const activeUsersRequested = parts[0] === 'admin' && parts[1] === 'active-users';
  const qcRequested = parts[0] === 'qc';
  const managerRequested = parts[0] === 'manager';
  const isResetPasswordRoute = window.location.pathname.replace(/\/+$/, '') === '/reset-password';

  if (loading) return <><FloatingThemeControl /><div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={32} /></div></>;
  if (isResetPasswordRoute) return <><FloatingThemeControl /><ResetPasswordPage /></>;
  if (!session) return <><FloatingThemeControl /><LoginPage /></>;

  if (activeUsersRequested) {
    if (profile?.role !== 'admin') return <AccessDenied />;
    return <><FloatingThemeControl /><ActiveUsers /></>;
  }
  if (portalAdminRequested) {
    if (profile?.role !== 'admin') return <AccessDenied />;
    return <><FloatingThemeControl /><PortalAdmin /></>;
  }
  if (qcRequested || profile?.role === 'qc') {
    if (!['admin','qc'].includes(profile?.role || '')) return <AccessDenied />;
    return <><FloatingThemeControl /><QCQueue /></>;
  }
  if (managerRequested || profile?.role === 'manager') {
    if (profile?.role !== 'manager') return <AccessDenied />;
    return <><FloatingThemeControl /><ManagerDashboard profile={profile} /></>;
  }

  return <Dashboard />;
}

function AccessDenied(){return <><FloatingThemeControl /><div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm"><h1 className="font-bold text-red-700">Access required</h1><button onClick={()=>{window.location.href='/'}} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Back</button></div></div></>}

function App(){
  const publicRoute = PublicRoute();
  return (
    <ThemeProvider>
      {publicRoute
        ? <><FloatingThemeControl />{publicRoute}</>
        : <AuthProvider><AppContent /></AuthProvider>}
    </ThemeProvider>
  );
}

export default App;
