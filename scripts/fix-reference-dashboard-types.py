from pathlib import Path
p = Path(__file__).resolve().parents[1] / 'src/AdminReferenceDashboard.tsx'
s = p.read_text(encoding='utf-8')

s = s.replace("import { useEffect, useMemo, useState } from 'react';", "import { useEffect, useMemo, useState, type ReactNode } from 'react';", 1)
s = s.replace("import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';", "import { useEffect, useMemo, useState, type ReactNode } from 'react';", 1)
s = s.replace("  Clock3, FileText, Filter, Home, LayoutDashboard, Menu, Package, Pencil,\n  Plus, Search, Settings, ShieldCheck, Trash2, UserRound, UsersRound,", "  FileText, Filter, Home, Menu, Package, Pencil,\n  Plus, Search, Settings, ShieldCheck, Trash2, UsersRound,", 1)
s = s.replace("WalletCards, ChartNoAxesCombined", "WalletCards, BarChart3")
s = s.replace("ChartNoAxesCombined", "BarChart3")
s = s.replace("import type { useScheduleStore } from './useScheduleStore';", "import { useScheduleStore } from './useScheduleStore';", 1)
s = s.replace("renderSlots: () => React.ReactNode;", "renderSlots: () => ReactNode;", 1)
s = s.replace("ReadonlyArray<readonly [string, string, React.ComponentType<{size?: number}>]>", "ReadonlyArray<readonly [string, string, any]>")
s = s.replace("ReadonlyArray<readonly [string, string, ComponentType<{size?: number}>]>", "ReadonlyArray<readonly [string, string, any]>")
s = s.replace("icon: React.ComponentType<{size?: number}>", "icon: any")
s = s.replace("icon: ComponentType<{size?: number}>", "icon: any")
p.write_text(s, encoding='utf-8')
print('Fixed reference dashboard TypeScript imports and icon types.')
