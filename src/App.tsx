import { lazy, Suspense } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import { LoginPage } from "./LoginPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { ThemeProvider, ThemeToggle } from "./ThemeContext";
import { Loader2 } from "lucide-react";
import { usePresenceTracker } from "./usePresenceTracker";

const Dashboard = lazy(() => import("./Dashboard").then(module => ({ default: module.Dashboard })));
const AgentBookingPortal = lazy(() => import("./AgentBookingPortal").then(module => ({ default: module.AgentBookingPortal })));
const ReadyModeCampaignRouter = lazy(() => import("./ReadyModeCampaignRouter").then(module => ({ default: module.ReadyModeCampaignRouter })));
const CompanyPortalRoute = lazy(() => import("./CompanyPortalRoute").then(module => ({ default: module.CompanyPortalRoute })));
const RepresentativePortal = lazy(() => import("./RepresentativePortal").then(module => ({ default: module.RepresentativePortal })));
const PortalAdmin = lazy(() => import("./PortalAdmin").then(module => ({ default: module.PortalAdmin })));
const AgentPortal = lazy(() => import("./AgentPortal").then(module => ({ default: module.AgentPortal })));
const ManagerDashboard = lazy(() => import("./ManagerDashboard").then(module => ({ default: module.ManagerDashboard })));
const CompanyOnboarding = lazy(() => import("./CompanyOnboarding").then(module => ({ default: module.CompanyOnboarding })));
const QCQueue = lazy(() => import("./QCQueue").then(module => ({ default: module.QCQueue })));
const ActiveUsers = lazy(() => import("./ActiveUsers").then(module => ({ default: module.ActiveUsers })));
const AdminLeadCRM = lazy(() => import("./AdminLeadCRM").then(module => ({ default: module.AdminLeadCRM })));

function pathParts(): string[] {
  return window.location.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
}
function PublicRoute() {
  const parts = pathParts();
  if (parts[0] === "readymode") return <ReadyModeCampaignRouter />;
  if (parts[0] === "book" && parts[1])
    return <AgentBookingPortal slug={parts[1]} />;
  if (parts[0] === "agent" && parts[1] && parts[2])
    return <AgentPortal slug={parts[1]} token={parts[2]} />;
  if (parts[0] === "manager" && parts[1] && parts[2])
    return <ManagerDashboard slug={parts[1]} token={parts[2]} />;
  if (parts[0] === "join" && parts[1] && parts[2])
    return <CompanyOnboarding slug={parts[1]} token={parts[2]} />;
  if (parts[0] === "rep" && parts[1])
    return <RepresentativePortal token={parts[1]} />;
  if (parts[0] === "company" && parts[1] && parts[2] === "manage" && parts[3])
    return <CompanyPortalRoute identifier={parts[1]} token={parts[3]} />;
  return null;
}

function FloatingThemeControl() {
  return (
    <div className="readyops-theme-floating">
      <ThemeToggle />
    </div>
  );
}

function AppContent() {
  const { session, profile, loading } = useAuth();
  usePresenceTracker(session && profile ? session.user.id : null);
  const parts = pathParts();
  const portalAdminRequested =
    parts[0] === "admin" && ["portals", "operations"].includes(parts[1] || "");
  const activeUsersRequested =
    parts[0] === "admin" && parts[1] === "active-users";
  const adminCrmRequested = parts[0] === "admin" && parts[1] === "crm";
  const qcRequested = parts[0] === "qc";
  const managerRequested = parts[0] === "manager";
  const isResetPasswordRoute =
    window.location.pathname.replace(/\/+$/, "") === "/reset-password";

  if (loading)
    return (
      <>
        <FloatingThemeControl />
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <Loader2 className="animate-spin text-blue-600" size={32} />
        </div>
      </>
    );
  if (isResetPasswordRoute)
    return (
      <>
        <FloatingThemeControl />
        <ResetPasswordPage />
      </>
    );
  if (!session)
    return (
      <>
        <FloatingThemeControl />
        <LoginPage />
      </>
    );

  if (activeUsersRequested) {
    if (profile?.role !== "admin") return <AccessDenied />;
    return <ActiveUsers />;
  }
  if (adminCrmRequested) {
    if (profile?.role !== "admin") return <AccessDenied />;
    return <AdminLeadCRM />;
  }
  if (portalAdminRequested) {
    if (profile?.role !== "admin") return <AccessDenied />;
    return <PortalAdmin />;
  }
  if (qcRequested || profile?.role === "qc") {
    if (!["admin", "qc", "manager"].includes(profile?.role || ""))
      return <AccessDenied />;
    return <QCQueue />;
  }
  if (managerRequested || profile?.role === "manager") {
    if (profile?.role !== "manager") return <AccessDenied />;
    return <ManagerDashboard profile={profile} />;
  }

  return <Dashboard />;
}

function AccessDenied() {
  return (
    <>
      <FloatingThemeControl />
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="font-bold text-red-700">Access required</h1>
          <button
            onClick={() => {
              window.location.href = "/";
            }}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white"
          >
            Back
          </button>
        </div>
      </div>
    </>
  );
}

function App() {
  const publicRoute = PublicRoute();
  return (
    <ThemeProvider>
      <Suspense fallback={<RouteLoading />}>
        {publicRoute ? (
          <>
            <FloatingThemeControl />
            {publicRoute}
          </>
        ) : (
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        )}
      </Suspense>
    </ThemeProvider>
  );
}

function RouteLoading() {
  return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
}

export default App;
