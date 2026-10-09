import type { ReactNode } from 'react';

export function PortalSection({ title, children, className = '', defaultOpen = false }: { title: string; children: ReactNode; className?: string; defaultOpen?: boolean }) {
  return <details className={`readyops-portal-section ${className}`} open={defaultOpen || undefined}>
    <summary className="flex cursor-pointer items-center justify-between gap-2 border-b py-2 font-bold text-blue-950"><span>{title}</span><span className="readyops-collapse-arrow" aria-hidden="true" /></summary>
    <div className="pt-2">{children}</div>
  </details>;
}
