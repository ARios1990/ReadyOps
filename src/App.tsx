import { AuthProvider, useAuth } from './AuthContext';
import { LoginPage } from './LoginPage';
import { Dashboard } from './Dashboard';
import { AgentBookingPortal } from './AgentBookingPortal';
import { CompanyPortal } from './CompanyPortal';
import { RepresentativePortal } from './RepresentativePortal';
import { PortalAdmin } from './PortalAdmin';
import { ResetPasswordPage } from './ResetPasswordPage';
import { Loader2, ShieldCheck } from 'lucide-react';

function pathParts(): string[] {
  return window.location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

function PublicRoute() {
  const parts = pathParts();
  if (parts[0] === 'book' && parts[1]) return <AgentBookingPortal slug={parts[1]} />;
  if (parts[0] === 'rep' && parts[1]) return <RepresentativePortal token={parts[1]} />;
  if (parts[0] === 'company' && parts[1] && parts[2] === 'manage' && parts[3]) {
    return <CompanyPortal companyId={parts[1]} token={parts[3]} />;
  }
  return null;
}

function AppContent() {
  const { session, profile, loading } = useAuth();
  const parts = pathParts();
  const portalAdminRequested = parts[0] === 'admin' && parts[1] === 'portals';
  const isResetPasswordRoute = window.location.pathname.replace(/\/+$/, '') === '/reset-password';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (isResetPasswordRoute) {
    return <ResetPasswordPage />;
  }

  if (!session) return <LoginPage />;

  if (portalAdminRequested) {
    if (profile?.role !== 'admin') {
      return <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6"><div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm"><h1 className="font-bold text-red-700">Admin access required</h1><button onClick={() => { window.location.href = '/'; }} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Back to Scheduler</button></div></div>;
    }
    return <PortalAdmin />;
  }

  return (
    <>
      <Dashboard />
      {profile?.role === 'admin' && (
        <button
          onClick={() => { window.location.href = '/admin/portals'; }}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-xl hover:bg-slate-800"
        >
          <ShieldCheck size={16} /> Portal Links
        </button>
      )}
    </>
  );
}

function App() {
  const publicRoute = PublicRoute();
  if (publicRoute) return publicRoute;
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
