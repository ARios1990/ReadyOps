import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  FileText,
  Home,
  Menu,
  Settings,
  ShieldCheck,
  UsersRound,
  WalletCards,
  Wifi,
} from "lucide-react";
import { useAuth } from "./AuthContext";
import { ThemeToggle } from "./ThemeContext";

type IconComponent = typeof Home;
type AdminSection =
  | "overview"
  | "qc"
  | "companies"
  | "leads"
  | "appointments"
  | "staff"
  | "teams"
  | "active-users"
  | "reports"
  | "invoices"
  | "payroll"
  | "settings";
type SidebarItem = readonly [AdminSection, string, IconComponent, string];

const SIDEBAR_STORAGE_KEY = "readyops-sidebar-collapsed";
const TOPBAR_STORAGE_KEY = "readyops-topbar-collapsed";

const MAIN_ITEMS: readonly SidebarItem[] = [
  ["overview", "Overview", Home, "/"],
  ["qc", "QC Queue", ShieldCheck, "/qc"],
  ["companies", "Companies & Scheduling", Building2, "/admin/operations"],
  ["leads", "Leads", FileText, "/admin/crm"],
  ["appointments", "Appointments", CalendarDays, "/?view=appointments"],
] as const;

const MANAGER_MAIN_ITEMS: readonly SidebarItem[] = [
  ["overview", "Team Dashboard", Home, "/manager"],
  ["qc", "Team QC Queue", ShieldCheck, "/qc"],
] as const;

const MANAGEMENT_ITEMS: readonly SidebarItem[] = [
  ["staff", "Agents & Managers", UsersRound, "/#readyops-staff"],
  ["teams", "Teams", UsersRound, "/#readyops-staff"],
  ["active-users", "Active Users", Wifi, "/admin/active-users"],
  ["reports", "Reports", BarChart3, "/?view=reports"],
  ["invoices", "Invoices", WalletCards, "/?view=invoices"],
  ["payroll", "Payroll", CircleDollarSign, "/?view=payroll"],
  ["settings", "Settings", Settings, "/"],
] as const;

type Props = {
  active: AdminSection;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
};

export function AdminWorkspaceShell({
  active,
  title,
  subtitle,
  actions,
  children,
}: Props) {
  const { profile, signOut } = useAuth();
  const managerMode = profile?.role === "manager";
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1",
  );
  const [topbarCollapsed, setTopbarCollapsed] = useState(
    () => window.localStorage.getItem(TOPBAR_STORAGE_KEY) === "1",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 900);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    window.localStorage.setItem(
      TOPBAR_STORAGE_KEY,
      topbarCollapsed ? "1" : "0",
    );
  }, [topbarCollapsed]);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < 900;
      setIsMobile(mobile);
      if (!mobile) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function navigate(path: string) {
    setMobileOpen(false);
    window.location.href = path;
  }

  function toggleSidebar() {
    if (isMobile) setMobileOpen((open) => !open);
    else setCollapsed((value) => !value);
  }

  const shellClass = [
    "readyops-ref-shell",
    collapsed ? "is-sidebar-collapsed" : "",
    topbarCollapsed ? "is-topbar-collapsed" : "",
    mobileOpen ? "is-mobile-sidebar-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass} data-admin-section={active}>
      <button
        type="button"
        className="readyops-ref-sidebar-backdrop"
        aria-label="Close navigation"
        onClick={() => setMobileOpen(false)}
      />
      <aside className="readyops-ref-sidebar">
        <button
          className="readyops-ref-wordmark"
          onClick={() => navigate("/")}
          aria-label="Ready Ops home"
        >
          <span>Ready</span>
          <span>Ops</span>
        </button>
        <button
          type="button"
          className="readyops-sidebar-edge-toggle"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
        <AdminNavGroup
          title="MAIN"
          items={managerMode ? MANAGER_MAIN_ITEMS : MAIN_ITEMS}
          active={active}
          collapsed={collapsed && !isMobile}
          onSelect={navigate}
        />
        {!managerMode && (
          <AdminNavGroup
            title="MANAGEMENT"
            items={MANAGEMENT_ITEMS}
            active={active}
            collapsed={collapsed && !isMobile}
            onSelect={navigate}
          />
        )}
      </aside>

      <div className="readyops-ref-workspace">
        <div className="readyops-ref-scene" aria-hidden="true">
          <AdminSkyline />
          <div className="readyops-ref-watermark">R</div>
        </div>
        <header className="readyops-ref-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="readyops-ref-icon-button"
              onClick={toggleSidebar}
              title="Open or collapse navigation"
            >
              <Menu size={17} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-extrabold">Ready Ops</h1>
              <p className="truncate text-[11px] opacity-70">
                {managerMode
                  ? "Manager Dashboard — Team Access"
                  : "Admin Dashboard — Full Access"}
              </p>
            </div>
          </div>
          <div className="readyops-ref-top-actions">
            <span className="readyops-ref-live">
              <i /> Live
            </span>
            <span className="readyops-ref-admin">
              <i /> {managerMode ? "Manager" : "Admin"}
            </span>
            <button
              className="readyops-ref-manage"
              onClick={() => navigate(managerMode ? "/manager" : "/")}
            >
              <Settings size={14} /> {managerMode ? "Team" : "Manage"}
            </button>
            <ThemeToggle />
            <div className="relative">
              <button
                className="readyops-ref-user"
                onClick={() => setUserMenu((value) => !value)}
              >
                <span className="readyops-ref-avatar">
                  {initials(profile?.display_name || "Admin")}
                </span>
                <span className="hidden sm:inline">
                  {profile?.display_name || "Admin"}
                </span>
                <ChevronDown size={13} />
              </button>
              {userMenu && (
                <div className="readyops-ref-user-menu">
                  <button onClick={() => void signOut()}>Sign Out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <button
          type="button"
          className="readyops-topbar-edge-toggle"
          onClick={() => setTopbarCollapsed((value) => !value)}
          title={topbarCollapsed ? "Show top header" : "Hide top header"}
          aria-label={topbarCollapsed ? "Show top header" : "Hide top header"}
          aria-expanded={!topbarCollapsed}
        >
          {topbarCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>

        <main className="readyops-ref-main">
          <div className="readyops-ref-page-header">
            <div className="readyops-ref-title-row">
              <div>
                <h2>{title}</h2>
                <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
              </div>
            </div>
            {actions && (
              <div className="readyops-ref-page-actions">{actions}</div>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function AdminNavGroup({
  title,
  items,
  active,
  collapsed,
  onSelect,
}: {
  title: string;
  items: readonly SidebarItem[];
  active: AdminSection;
  collapsed: boolean;
  onSelect: (path: string) => void;
}) {
  return (
    <div className="readyops-ref-nav-group">
      <p>{collapsed ? "•" : title}</p>
      {items.map(([key, label, Icon, path]) => (
        <button
          key={key}
          className={active === key ? "active" : ""}
          onClick={() => onSelect(path)}
          title={collapsed ? label : undefined}
          data-tooltip={collapsed ? label : undefined}
        >
          <Icon size={16} />
          {!collapsed && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}

function initials(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AD"
  );
}

function AdminSkyline() {
  return (
    <svg viewBox="0 0 1400 260" preserveAspectRatio="none" aria-hidden="true">
      <g fill="currentColor" opacity=".35">
        <path d="M0 230h40v-52h18v52h33v-88h28v88h18v-36h28v36h44v-112h31v112h20v-70h32v70h30v-150h15v-38h14v38h18v150h28v-94h27v94h42v-124h36v124h18v-58h30v58h54v-175h17v-34h12v34h16v175h30v-92h36v92h29v-55h31v55h47v-148h12v-29h10v29h13v148h23v-84h33v84h43v-116h28v116h26v-48h30v48h42v-133h31v133h39v-72h25v72h56v-102h30v102h22v-60h31v60h40v30H0z" />
      </g>
    </svg>
  );
}
