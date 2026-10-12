import type { ReactNode } from 'react';
import { CircleAlert, FolderOpen, RotateCcw, X } from 'lucide-react';

export const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');
export const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set';
export const errorText = (error: unknown) => {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data;
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
};
export function Button({ children, variant = 'primary', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  const looks = { primary: 'bg-primary text-primary-foreground hover:brightness-105 shadow-sm', secondary: 'bg-card border border-border text-foreground hover:bg-secondary', quiet: 'text-muted-foreground hover:bg-secondary hover:text-foreground', danger: 'text-destructive hover:bg-destructive/10' };
  return <button {...props} className={cn('inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', looks[variant], className)}>{children}</button>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-foreground">{label}{children}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
}
export const inputClass = 'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/70';
export function PageSkeleton() {
  return <div className="space-y-5 enter" aria-label="Loading"><div className="h-8 w-56 animate-pulse rounded bg-secondary"/><div className="h-24 animate-pulse rounded-2xl bg-secondary"/><div className="h-64 animate-pulse rounded-2xl bg-secondary"/></div>;
}
export function QueryError({ retry }: { retry: () => void }) {
  return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-sm"><div className="flex items-center gap-2 font-semibold text-destructive"><CircleAlert size={17}/>Could not load this workspace</div><p className="mt-1 text-muted-foreground">Check your connection and try again.</p><Button variant="secondary" onClick={retry} className="mt-4" data-testid="button-retry"><RotateCcw size={15}/>Retry</Button></div>;
}
export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }) {
  const tones = { neutral: 'bg-secondary text-muted-foreground', green: 'bg-emerald-900/10 text-emerald-800', amber: 'bg-amber-900/10 text-amber-800', red: 'bg-rose-900/10 text-rose-800', blue: 'bg-sky-900/10 text-sky-800' };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-none', tones[tone])}>{children}</span>;
}
export function StatusPill({ value }: { value: string }) {
  const labels: Record<string, string> = { draft: 'Draft', in_progress: 'In progress', ready_for_review: 'Ready for review', submitted: 'Submitted', pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', needs_review: 'Needs review' };
  const tone = value === 'approved' || value === 'submitted' ? 'green' : value === 'rejected' ? 'red' : value === 'pending' || value === 'ready_for_review' || value === 'needs_review' ? 'amber' : 'neutral';
  return <Pill tone={tone}>{labels[value] ?? value.replaceAll('_', ' ')}</Pill>;
}
export function Dialog({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" className={cn('enter max-h-[92dvh] w-full overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl', wide ? 'max-w-2xl' : 'max-w-lg')}>
      <div className="flex items-start justify-between border-b border-border px-6 py-5"><div><h2 className="font-[Manrope] text-lg font-bold">{title}</h2>{description && <p className="mt-1 max-w-lg text-sm leading-5 text-muted-foreground">{description}</p>}</div><button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close dialog" data-testid="button-close-dialog"><X size={18}/></button></div>
      <div className="p-6">{children}</div>
    </div>
  </div>;
}
export function EmptyState({ title, body, icon = <FolderOpen size={20}/> }: { title: string; body: string; icon?: ReactNode }) {
  return <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-5 py-10 text-center"><div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">{icon}</div><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{body}</p></div>;
}
