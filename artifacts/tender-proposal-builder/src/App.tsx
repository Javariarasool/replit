import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import {
  useGetDashboardSummary, useListTenders, useCreateTender, useGetTender, useUpdateTender, useDeleteTender,
  useListTenderEvidence, useAddTenderEvidence, useDeleteEvidence, useListVendorSources, useAddVendorSource,
  useReviewVendorSource, useListProposals, useGenerateProposalPair, useUpdateProposal, useRequestUploadUrl,
  useResearchVendorSource,
  getGetDashboardSummaryQueryKey, getListTendersQueryKey, getGetTenderQueryKey, getListTenderEvidenceQueryKey,
  getListVendorSourcesQueryKey, getListProposalsQueryKey,
} from '@workspace/api-client-react';
import type { Evidence, EvidenceInput, Proposal, Tender, TenderInputCategory, VendorResearchResult, VendorSource } from '@workspace/api-client-react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, Clock3, FilePlus2,
  FileText, FolderOpen, Info, LoaderCircle, LogOut, Menu, Plus, Search, ShieldCheck, Sparkles, Trash2,
  Upload, X, ExternalLink, ClipboardList, PackageCheck, Building2, Layers3, RotateCcw,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const categories = [
  ['tender_rfp', 'Tender / RFP'], ['previous_proposal', 'Previous proposal'], ['company_profile', 'Company profile'],
  ['certification', 'Certifications'], ['cv_reference', 'CV / project references'], ['technical_bom', 'Bill of materials'],
  ['vendor_quote', 'Vendor quote'], ['oem_datasheet', 'OEM datasheet'], ['other', 'Other'],
] as const;
type DialogName = 'tender' | 'source' | 'research' | 'generate' | null;

const cn = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(' ');
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set';
const categoryName = (value: string) => categories.find(([id]) => id === value)?.[1] ?? value;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function Button({ children, variant = 'primary', className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  const looks = { primary: 'bg-primary text-primary-foreground hover:brightness-105 shadow-sm', secondary: 'bg-card border border-border text-foreground hover:bg-secondary', quiet: 'text-muted-foreground hover:bg-secondary hover:text-foreground', danger: 'text-destructive hover:bg-destructive/10' };
  return <button {...props} className={cn('inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', looks[variant], className)} />;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-foreground">{label}{children}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
}
const inputClass = 'w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm font-normal outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground/70';
function PageSkeleton() {
  return <div className="space-y-5 enter" aria-label="Loading"><div className="h-8 w-56 animate-pulse rounded bg-secondary"/><div className="h-24 animate-pulse rounded-2xl bg-secondary"/><div className="h-64 animate-pulse rounded-2xl bg-secondary"/></div>;
}
function QueryError({ retry }: { retry: () => void }) {
  return <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-sm"><div className="flex items-center gap-2 font-semibold text-destructive"><CircleAlert size={17}/>Could not load this workspace</div><p className="mt-1 text-muted-foreground">Check your connection and try again.</p><Button variant="secondary" onClick={retry} className="mt-4" data-testid="button-retry"><RotateCcw size={15}/>Retry</Button></div>;
}
function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red' | 'blue' }) {
  const tones = { neutral: 'bg-secondary text-muted-foreground', green: 'bg-emerald-900/10 text-emerald-800', amber: 'bg-amber-900/10 text-amber-800', red: 'bg-rose-900/10 text-rose-800', blue: 'bg-sky-900/10 text-sky-800' };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-none', tones[tone])}>{children}</span>;
}
function StatusPill({ value }: { value: string }) {
  const labels: Record<string, string> = { draft: 'Draft', in_progress: 'In progress', ready_for_review: 'Ready for review', submitted: 'Submitted', pending: 'Pending review', approved: 'Approved', rejected: 'Rejected', needs_review: 'Needs review' };
  const tone = value === 'approved' || value === 'submitted' ? 'green' : value === 'rejected' ? 'red' : value === 'pending' || value === 'ready_for_review' || value === 'needs_review' ? 'amber' : 'neutral';
  return <Pill tone={tone}>{labels[value] ?? value.replaceAll('_', ' ')}</Pill>;
}
function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [location] = useLocation();
  const [mobileMenu, setMobileMenu] = useState(false);
  if (auth.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background"><div className="w-64 space-y-3"><div className="h-5 w-40 animate-pulse rounded bg-secondary"/><div className="h-3 w-full animate-pulse rounded bg-secondary"/></div></div>;
  if (!auth.isAuthenticated) return <main className="app-grain grid min-h-[100dvh] place-items-center bg-background p-6">
    <section className="enter w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
      <div className="bg-primary px-8 pb-10 pt-8 text-primary-foreground">
        <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-primary-foreground/10"><ClipboardList size={23}/></div><div><p className="text-sm font-bold tracking-wide">Tender Desk</p><p className="text-xs opacity-65">Proposal workspace</p></div></div>
        <p className="mt-12 font-mono text-[10px] uppercase tracking-[.2em] text-primary-foreground/65">Procurement, with a paper trail</p>
        <h1 className="mt-3 max-w-sm font-[Manrope] text-3xl font-bold leading-tight">Every claim has a source. Every draft stays yours.</h1>
      </div>
      <div className="p-8"><p className="text-sm leading-6 text-muted-foreground">A careful workspace for Pakistani IT procurement teams. Sign in to continue to your tenders and proposal evidence.</p>
        <Button onClick={auth.login} className="mt-6 w-full" data-testid="button-login">Log in to Tender Desk <ArrowRight size={16}/></Button>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Access is managed by your organization.</p>
      </div>
    </section>
  </main>;
  return <div className="app-grain min-h-[100dvh] bg-background">
    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar text-sidebar-foreground transition-transform md:translate-x-0', mobileMenu ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center gap-3 px-6 pb-7 pt-7"><div className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><ClipboardList size={21}/></div><div><p className="font-[Manrope] text-sm font-extrabold tracking-tight">Tender Desk</p><p className="mt-0.5 text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/50">Pakistan · Procurement</p></div></div>
      <div className="px-4"><p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">Workspace</p>
        <Link href="/" onClick={() => setMobileMenu(false)} className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition', location === '/' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70')} data-testid="link-dashboard"><Layers3 size={17}/>Tenders</Link>
      </div>
      <div className="mx-6 mt-8 border-t border-sidebar-border"/>
      <div className="mx-5 mt-5 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={14} className="text-sidebar-primary"/>Human-reviewed by design</div>
        <p className="mt-2 text-[11px] leading-5 text-sidebar-foreground/55">OEM claims stay pending until a person reviews the source.</p>
      </div>
      <div className="mt-auto border-t border-sidebar-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent font-mono text-xs font-medium">{(auth.user?.firstName?.[0] ?? auth.user?.email?.[0] ?? 'U').toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{[auth.user?.firstName, auth.user?.lastName].filter(Boolean).join(' ') || 'Workspace member'}</p><p className="truncate text-[10px] text-sidebar-foreground/50">{auth.user?.email}</p></div><button onClick={auth.logout} className="rounded-md p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground" aria-label="Log out" data-testid="button-logout"><LogOut size={16}/></button></div>
      </div>
    </aside>
    {mobileMenu && <button className="fixed inset-0 z-30 bg-black/30 md:hidden" aria-label="Close navigation" onClick={() => setMobileMenu(false)}/>}
    <div className="md:pl-[248px]">
      <header className="sticky top-0 z-20 flex h-[64px] items-center justify-between border-b border-border/80 bg-background/90 px-5 backdrop-blur-md md:px-9">
        <div className="flex items-center gap-3"><button onClick={() => setMobileMenu(v => !v)} className="rounded-md p-2 hover:bg-secondary md:hidden" aria-label="Open navigation" data-testid="button-menu"><Menu size={19}/></button><span className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">TENDER OPERATIONS</span></div>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-700"/>Private workspace</div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 pb-16 pt-8 md:px-9 md:pt-10">{children}</main>
    </div>
  </div>;
}
function Dialog({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/35 p-4 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" className={cn('enter max-h-[92dvh] w-full overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl', wide ? 'max-w-2xl' : 'max-w-lg')}>
      <div className="flex items-start justify-between border-b border-border px-6 py-5"><div><h2 className="font-[Manrope] text-lg font-bold">{title}</h2>{description && <p className="mt-1 max-w-lg text-sm leading-5 text-muted-foreground">{description}</p>}</div><button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary" aria-label="Close dialog" data-testid="button-close-dialog"><X size={18}/></button></div>
      <div className="p-6">{children}</div>
    </div>
  </div>;
}
function EmptyState({ title, body, icon = <FolderOpen size={20}/> }: { title: string; body: string; icon?: ReactNode }) {
  return <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-5 py-10 text-center"><div className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">{icon}</div><p className="mt-3 text-sm font-semibold">{title}</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{body}</p></div>;
}
function CreateTenderDialog({ close }: { close: () => void }) {
  const create = useCreateTender(); const qc = useQueryClient(); const [, navigate] = useLocation();
  const [form, setForm] = useState({ title: '', agency: '', referenceNumber: '', category: 'mixed' as TenderInputCategory, closingDate: '', summary: '', requirements: '' });
  const [error, setError] = useState('');
  const update = (key: keyof typeof form, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); create.mutate({ data: { ...form, referenceNumber: form.referenceNumber || null, closingDate: form.closingDate || null } }, { onSuccess: tender => { void qc.invalidateQueries({ queryKey: getListTendersQueryKey() }); void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); close(); navigate(`/tenders/${tender.id}`); }, onError: err => setError(errorText(err)) }); };
  return <Dialog title="Start a tender workspace" description="Create a traceable home for tender documents, claims and proposal drafts." onClose={close}>
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Tender title"><input required className={inputClass} value={form.title} onChange={e => update('title', e.target.value)} placeholder="e.g. Enterprise network refresh" data-testid="input-tender-title"/></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Procuring agency"><input required className={inputClass} value={form.agency} onChange={e => update('agency', e.target.value)} placeholder="Agency / department" data-testid="input-tender-agency"/></Field><Field label="Reference number"><input className={inputClass} value={form.referenceNumber} onChange={e => update('referenceNumber', e.target.value)} placeholder="Optional" data-testid="input-tender-reference"/></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><select className={inputClass} value={form.category} onChange={e => update('category', e.target.value)} data-testid="select-tender-category"><option value="mixed">Mixed</option><option value="hardware">Hardware</option><option value="networking">Networking</option><option value="software">Software</option><option value="services">Services</option></select></Field><Field label="Closing date"><input type="date" className={inputClass} value={form.closingDate} onChange={e => update('closingDate', e.target.value)} data-testid="input-closing-date"/></Field></div>
      <Field label="Tender summary"><textarea className={cn(inputClass, 'min-h-[76px] resize-y')} value={form.summary} onChange={e => update('summary', e.target.value)} placeholder="Brief context for your team" data-testid="input-tender-summary"/></Field>
      <Field label="Requirements"><textarea className={cn(inputClass, 'min-h-[90px] resize-y')} value={form.requirements} onChange={e => update('requirements', e.target.value)} placeholder="Paste or outline the key requirements" data-testid="input-tender-requirements"/></Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={create.isPending} data-testid="button-create-tender">{create.isPending ? <LoaderCircle className="animate-spin" size={16}/> : <Plus size={16}/>}Create workspace</Button></div>
    </form>
  </Dialog>;
}
function Dashboard() {
  const summary = useGetDashboardSummary(); const tendersQuery = useListTenders(); const [dialog, setDialog] = useState(false); const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all');
  const tenders = tendersQuery.data ?? [];
  const filtered = useMemo(() => tenders.filter(t => (filter === 'all' || t.status === filter) && `${t.title} ${t.agency} ${t.referenceNumber ?? ''}`.toLowerCase().includes(search.toLowerCase())), [tenders, filter, search]);
  if (summary.isLoading || tendersQuery.isLoading) return <PageSkeleton/>;
  if (summary.isError || tendersQuery.isError) return <QueryError retry={() => { void summary.refetch(); void tendersQuery.refetch(); }}/>;
  const metrics = [
    { label: 'Active tenders', value: summary.data?.activeTenders ?? 0, icon: <ClipboardList size={17}/>, tone: 'text-primary bg-primary/10' },
    { label: 'Awaiting review', value: summary.data?.awaitingReview ?? 0, icon: <Clock3 size={17}/>, tone: 'text-amber-800 bg-amber-800/10' },
    { label: 'Completed proposals', value: summary.data?.completedProposals ?? 0, icon: <CheckCircle2 size={17}/>, tone: 'text-emerald-800 bg-emerald-800/10' },
  ];
  return <div className="enter">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Tender operations / Overview</p><h1 className="mt-2 font-[Manrope] text-3xl font-extrabold tracking-tight md:text-[38px]">Good work starts with a record.</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Keep requirements, OEM evidence and proposal drafts connected to the tender they belong to.</p></div>
      <Button onClick={() => setDialog(true)} data-testid="button-new-tender"><Plus size={17}/>New tender</Button>
    </div>
    <div className="mt-8 grid gap-3 sm:grid-cols-3">{metrics.map(item => <div key={item.label} className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4"><div className={cn('grid size-10 place-items-center rounded-xl', item.tone)}>{item.icon}</div><div><p className="font-[Manrope] text-[25px] font-extrabold leading-none">{item.value}</p><p className="mt-1.5 text-xs text-muted-foreground">{item.label}</p></div></div>)}</div>
    <section className="mt-9">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-muted-foreground">Your records</p><h2 className="mt-1.5 font-[Manrope] text-xl font-bold">Tender workspaces <span className="ml-1 font-mono text-sm font-normal text-muted-foreground">{tenders.length.toString().padStart(2, '0')}</span></h2></div>
        <div className="flex flex-col gap-2 sm:flex-row"><label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15}/><input className={cn(inputClass, 'h-10 pl-9 sm:w-64')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tenders" aria-label="Search tenders" data-testid="input-search-tenders"/></label><select className={cn(inputClass, 'h-10 sm:w-44')} value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter by status" data-testid="select-tender-filter"><option value="all">All statuses</option><option value="draft">Draft</option><option value="in_progress">In progress</option><option value="ready_for_review">Ready for review</option><option value="submitted">Submitted</option></select></div>
      </div>
      {!tenders.length ? <div className="mt-5 rounded-2xl border border-border bg-card p-10 text-center"><div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary"><FilePlus2 size={22}/></div><h3 className="mt-4 font-[Manrope] text-lg font-bold">No tenders in your workspace</h3><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Start with a tender record, then bring its evidence and proposal work into one traceable place.</p><Button onClick={() => setDialog(true)} className="mt-5" data-testid="button-create-first"><Plus size={16}/>Create first tender</Button></div>
        : !filtered.length ? <div className="mt-5"><EmptyState title="No matching tenders" body="Try another search term or status filter."/></div>
        : <div className="mt-5 overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[minmax(260px,2.2fr)_1.15fr_.9fr_1fr_110px] gap-4 border-b border-border bg-secondary/55 px-5 py-3 text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground md:grid"><span>Tender / agency</span><span>Reference</span><span>Closing</span><span>Stage</span><span>Evidence · drafts</span></div>
          {filtered.map((tender, index) => <TenderRow tender={tender} key={tender.id} index={index}/>)}
        </div>}
    </section>
    <section className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
      <div className="rounded-xl border border-border bg-card p-5 md:p-6"><div className="flex items-center gap-2 text-primary"><ShieldCheck size={17}/><h2 className="font-[Manrope] text-sm font-bold text-foreground">A dependable paper trail</h2></div><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Proposal inputs stay attached to their source materials. OEM statements are clearly labeled as claims until a reviewer checks the linked manufacturer source.</p></div>
      <div className="flex items-start gap-3 rounded-xl border border-amber-900/10 bg-amber-900/[.04] p-5"><Info className="mt-0.5 shrink-0 text-amber-800" size={17}/><div><p className="text-sm font-bold">AI drafting is opt-in</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Draft generation asks for explicit consent before selected workspace content is sent for processing.</p></div></div>
    </section>
    {dialog && <CreateTenderDialog close={() => setDialog(false)}/>}
  </div>;
}
function TenderRow({ tender, index }: { tender: Tender; index: number }) {
  return <Link href={`/tenders/${tender.id}`} className="group grid grid-cols-1 gap-2 border-b border-border px-5 py-4 transition-colors last:border-0 hover:bg-secondary/40 md:grid-cols-[minmax(260px,2.2fr)_1.15fr_.9fr_1fr_110px] md:items-center md:gap-4" data-testid={`link-tender-${tender.id}`}>
    <div className="flex items-start gap-3"><div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Building2 size={16}/></div><div className="min-w-0"><p className="truncate text-sm font-bold group-hover:text-primary">{tender.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{tender.agency} <span className="mx-1">·</span><span className="capitalize">{tender.category}</span></p></div></div>
    <p className="mono truncate text-xs text-muted-foreground"><span className="md:hidden">Ref. </span>{tender.referenceNumber || '—'}</p>
    <p className="text-xs text-muted-foreground"><span className="md:hidden">Closes </span>{formatDate(tender.closingDate)}</p>
    <div><StatusPill value={tender.status}/></div><div className="flex gap-3 text-[11px] text-muted-foreground"><span>{tender.evidenceCount} evidence</span><span>{tender.proposalCount} drafts</span><ArrowRight className="ml-auto hidden text-primary transition-transform group-hover:translate-x-1 md:block" size={15}/></div>
  </Link>;
}
function TenderWorkspace() {
  const params = useParams<{ tenderId: string }>(); const id = params.tenderId ?? '';
  const [, navigate] = useLocation();
  const detail = useGetTender(id); const evidenceQuery = useListTenderEvidence(id); const sourceQuery = useListVendorSources(id); const proposalsQuery = useListProposals(id);
  const qc = useQueryClient(); const updateTender = useUpdateTender(); const deleteTender = useDeleteTender(); const gen = useGenerateProposalPair();
  const addSource = useAddVendorSource(); const reviewSource = useReviewVendorSource(); const [tab, setTab] = useState<'requirements' | 'evidence' | 'sources' | 'proposals'>('requirements');
  const [dialog, setDialog] = useState<DialogName>(null); const [deleteConfirm, setDeleteConfirm] = useState(false); const [error, setError] = useState('');
  const tender = detail.data;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetTenderQueryKey(id) }); void qc.invalidateQueries({ queryKey: getListTendersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getListVendorSourcesQueryKey(id) }); void qc.invalidateQueries({ queryKey: getListProposalsQueryKey(id) });
  };
  if (detail.isLoading) return <PageSkeleton/>;
  if (detail.isError || !tender) return <QueryError retry={() => void detail.refetch()}/>;
  const pending = (sourceQuery.data ?? []).filter(source => source.reviewStatus === 'pending').length;
  const performDelete = () => deleteTender.mutate({ tenderId: id }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListTendersQueryKey() }); void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); navigate('/'); }, onError: e => setError(errorText(e)) });
  const runGenerate = () => { setError(''); gen.mutate({ tenderId: id, data: { aiConsent: true } }, { onSuccess: refresh, onError: e => setError(errorText(e)) }); setDialog(null); };
  const nav = [
    { key: 'requirements', label: 'Requirements', icon: <ClipboardList size={15}/> },
    { key: 'evidence', label: 'Evidence', count: evidenceQuery.data?.length ?? tender.evidenceCount, icon: <FolderOpen size={15}/> },
    { key: 'sources', label: 'OEM sources', count: sourceQuery.data?.length ?? tender.sourceCount, icon: <ShieldCheck size={15}/> },
    { key: 'proposals', label: 'Proposal pair', count: proposalsQuery.data?.length ?? tender.proposalCount, icon: <FileText size={15}/> },
  ] as const;
  return <div className="enter">
    <Link href="/" className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-dashboard"><ArrowLeft size={14}/>All tenders</Link>
    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
      <div className="max-w-3xl"><div className="flex flex-wrap items-center gap-2"><Pill tone="blue">{tender.category}</Pill><StatusPill value={tender.status}/>{tender.referenceNumber && <span className="mono text-[11px] text-muted-foreground">{tender.referenceNumber}</span>}</div>
        <h1 className="mt-3 font-[Manrope] text-3xl font-extrabold tracking-tight md:text-[36px]">{tender.title}</h1><p className="mt-1.5 text-sm font-semibold text-primary">{tender.agency}</p>{tender.summary && <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{tender.summary}</p>}</div>
      <div className="flex shrink-0 flex-wrap items-center gap-2"><div className="mr-2 border-r border-border pr-4 text-right"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Closing date</p><p className="mt-1 text-sm font-bold">{formatDate(tender.closingDate)}</p></div><select className={cn(inputClass, 'w-auto py-2')} value={tender.status} onChange={e => updateTender.mutate({ tenderId: id, data: { status: e.target.value as 'draft' | 'in_progress' | 'ready_for_review' | 'submitted' } }, { onSuccess: refresh })} aria-label="Tender status" data-testid="select-tender-status"><option value="draft">Draft</option><option value="in_progress">In progress</option><option value="ready_for_review">Ready for review</option><option value="submitted">Submitted</option></select><Button variant="quiet" onClick={() => setDeleteConfirm(true)} aria-label="Delete tender" data-testid="button-delete-tender"><Trash2 size={16}/></Button></div>
    </div>
    <div className="mt-7 flex gap-1 overflow-x-auto border-b border-border pb-px">{nav.map(item => { const count = 'count' in item ? item.count : undefined; return <button key={item.key} onClick={() => setTab(item.key)} className={cn('relative flex shrink-0 items-center gap-2 px-3 py-3 text-xs font-bold transition-colors', tab === item.key ? 'text-primary' : 'text-muted-foreground hover:text-foreground')} data-testid={`tab-${item.key}`}>{item.icon}{item.label}{count !== undefined && <span className="mono rounded bg-secondary px-1.5 py-0.5 text-[10px]">{count}</span>}{tab === item.key && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded bg-primary"/>}</button>; })}</div>
    <div className="pt-6">
      {tab === 'requirements' && <Requirements tender={tender} onSave={(requirements, summary) => updateTender.mutate({ tenderId: id, data: { requirements, summary } }, { onSuccess: refresh })} saving={updateTender.isPending}/>}
      {tab === 'evidence' && <EvidencePanel tenderId={id} evidence={evidenceQuery.data ?? []} loading={evidenceQuery.isLoading} failed={evidenceQuery.isError} onRetry={() => void evidenceQuery.refetch()} onChanged={refresh}/>}
      {tab === 'sources' && <SourcesPanel sources={sourceQuery.data ?? []} loading={sourceQuery.isLoading} failed={sourceQuery.isError} onRetry={() => void sourceQuery.refetch()} onAdd={() => setDialog('source')} onResearch={() => setDialog('research')} onReview={(source, status) => reviewSource.mutate({ sourceId: source.id, data: { reviewStatus: status } }, { onSuccess: refresh })} busy={reviewSource.isPending}/>}
      {tab === 'proposals' && <ProposalPanel tenderId={id} proposals={proposalsQuery.data ?? []} loading={proposalsQuery.isLoading} failed={proposalsQuery.isError} onRetry={() => void proposalsQuery.refetch()} onGenerate={() => setDialog('generate')} generating={gen.isPending} error={error}/>}
    </div>
    {dialog === 'source' && <SourceDialog tenderId={id} close={() => setDialog(null)} onDone={refresh}/>}
    {dialog === 'research' && <ResearchDialog tenderId={id} close={() => setDialog(null)} onDone={refresh}/>}
    {dialog === 'generate' && <GenerateDialog close={() => setDialog(null)} onConfirm={runGenerate} loading={gen.isPending}/>}
    {deleteConfirm && <Dialog title="Delete this tender?" description="This removes the tender workspace and its metadata. This action cannot be undone." onClose={() => setDeleteConfirm(false)}><div className="flex justify-end gap-2"><Button variant="quiet" onClick={() => setDeleteConfirm(false)}>Cancel</Button><Button variant="danger" onClick={performDelete} disabled={deleteTender.isPending} data-testid="button-confirm-delete">{deleteTender.isPending ? 'Deleting…' : 'Delete tender'}</Button></div>{error && <p className="mt-3 text-sm text-destructive">{error}</p>}</Dialog>}
  </div>;
}
function Requirements({ tender, onSave, saving }: { tender: Tender; onSave: (requirements: string, summary: string) => void; saving: boolean }) {
  const [requirements, setRequirements] = useState(tender.requirements ?? ''); const [summary, setSummary] = useState(tender.summary ?? '');
  return <div className="grid gap-5 lg:grid-cols-[1.5fr_.75fr]">
    <div className="rounded-xl border border-border bg-card p-5 md:p-7"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Tender brief</p><h2 className="mt-1 font-[Manrope] text-xl font-bold">Requirements & context</h2><p className="mt-1 text-xs text-muted-foreground">Keep the working brief grounded in the tender record.</p></div><ClipboardList className="text-primary/70" size={21}/></div>
      <div className="mt-6 grid gap-5"><Field label="Requirements"><textarea className={cn(inputClass, 'min-h-[210px] resize-y leading-6')} value={requirements} onChange={e => setRequirements(e.target.value)} placeholder="Add the tender's technical and compliance requirements…" data-testid="textarea-requirements"/></Field><Field label="Summary"><textarea className={cn(inputClass, 'min-h-[88px] resize-y leading-6')} value={summary} onChange={e => setSummary(e.target.value)} placeholder="Short context for the proposal team" data-testid="textarea-summary"/></Field></div>
      <div className="mt-4 flex justify-end"><Button onClick={() => onSave(requirements, summary)} disabled={saving} data-testid="button-save-requirements">{saving ? <LoaderCircle className="animate-spin" size={15}/> : <Check size={15}/>}Save brief</Button></div>
    </div>
    <div className="space-y-4"><div className="rounded-xl border border-border bg-card p-5"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground">Record details</p><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Category</dt><dd className="font-semibold capitalize">{tender.category}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Reference</dt><dd className="mono text-xs">{tender.referenceNumber || '—'}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Created</dt><dd className="font-semibold">{formatDate(tender.createdAt)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Last updated</dt><dd className="font-semibold">{formatDate(tender.updatedAt)}</dd></div></dl></div>
      <div className="rounded-xl border border-primary/15 bg-primary/[.04] p-5"><div className="flex items-center gap-2 text-primary"><PackageCheck size={17}/><p className="text-sm font-bold text-foreground">Evidence-led drafting</p></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Add source documents and manufacturer links before preparing separate technical and commercial drafts.</p></div></div>
  </div>;
}
function EvidencePanel({ tenderId, evidence, loading, failed, onRetry, onChanged }: { tenderId: string; evidence: Evidence[]; loading: boolean; failed: boolean; onRetry: () => void; onChanged: () => void }) {
  const [uploadOpen, setUploadOpen] = useState(false); const remove = useDeleteEvidence(); const qc = useQueryClient();
  if (loading) return <PageSkeleton/>; if (failed) return <QueryError retry={onRetry}/>;
  return <section><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Source documents</p><h2 className="mt-1 font-[Manrope] text-xl font-bold">Evidence library</h2><p className="mt-1 text-xs text-muted-foreground">Files and notes remain connected to this tender record.</p></div><Button onClick={() => setUploadOpen(true)} data-testid="button-upload-evidence"><Upload size={16}/>Add evidence</Button></div>
    {!evidence.length ? <div className="mt-5"><EmptyState title="No evidence attached yet" body="Upload the RFP, company credentials, project references, quotes or OEM datasheets that support this response." icon={<Upload size={20}/>}/></div>
      : <div className="mt-5 grid gap-3 md:grid-cols-2">{evidence.map(item => <div key={item.id} className="rounded-xl border border-border bg-card p-4" data-testid={`card-evidence-${item.id}`}><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><FileText size={18}/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.name}</p><div className="mt-1.5 flex flex-wrap items-center gap-2"><Pill>{categoryName(item.category)}</Pill><span className="mono text-[10px] text-muted-foreground">{(item.size / 1024 / 1024).toFixed(1)} MB</span></div></div><button onClick={() => { if (window.confirm(`Remove evidence “${item.name}” from this tender?`)) remove.mutate({ evidenceId: item.id }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(tenderId) }); onChanged(); } }); }} aria-label={`Remove ${item.name}`} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`button-delete-evidence-${item.id}`}><Trash2 size={15}/></button></div>{item.notes && <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{item.notes}</p>}<p className="mt-3 text-[10px] text-muted-foreground">Added {formatDate(item.uploadedAt)}</p></div>)}</div>}
    {uploadOpen && <EvidenceDialog tenderId={tenderId} close={() => setUploadOpen(false)} onDone={onChanged}/>}
  </section>;
}
function EvidenceDialog({ tenderId, close, onDone }: { tenderId: string; close: () => void; onDone: () => void }) {
  const uploadUrl = useRequestUploadUrl(); const add = useAddTenderEvidence(); const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null); const [category, setCategory] = useState('tender_rfp'); const [notes, setNotes] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!file) { setError('Choose a file before continuing.'); return; }
    setBusy(true); setError('');
    try {
      const url = await new Promise<{ uploadURL: string; objectPath: string }>((resolve, reject) => uploadUrl.mutate({ data: { name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' } }, { onSuccess: resolve, onError: reject }));
      const result = await fetch(url.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!result.ok) throw new Error(`File upload failed (${result.status}).`);
      const payload: EvidenceInput = { name: file.name, category: category as EvidenceInput['category'], objectPath: url.objectPath, contentType: file.type || 'application/octet-stream', size: file.size, notes };
      await new Promise<void>((resolve, reject) => add.mutate({ tenderId, data: payload }, { onSuccess: () => resolve(), onError: reject }));
      void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(tenderId) }); onDone(); close();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return <Dialog title="Attach evidence" description="Upload one source file and record why it matters to this tender." onClose={close}>
    <form onSubmit={submit} className="grid gap-4"><Field label="File"><input type="file" className={cn(inputClass, 'file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs')} onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-evidence-file"/>{file && <span className="text-xs text-muted-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span>}</Field>
      <Field label="Evidence category"><select className={inputClass} value={category} onChange={e => setCategory(e.target.value)} data-testid="select-evidence-category">{categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Notes / summary" hint="A short note helps reviewers understand the context."><textarea className={cn(inputClass, 'min-h-24 resize-y')} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Relevant sections, dates, or context" data-testid="textarea-evidence-notes"/></Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={busy} data-testid="button-attach-evidence">{busy ? <LoaderCircle className="animate-spin" size={15}/> : <Upload size={15}/>}Upload and attach</Button></div>
    </form>
  </Dialog>;
}
function SourcesPanel({ sources, loading, failed, onRetry, onAdd, onResearch, onReview, busy }: { sources: VendorSource[]; loading: boolean; failed: boolean; onRetry: () => void; onAdd: () => void; onResearch: () => void; onReview: (source: VendorSource, status: 'approved' | 'rejected') => void; busy: boolean }) {
  if (loading) return <PageSkeleton/>; if (failed) return <QueryError retry={onRetry}/>;
  return <section><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Manufacturer statements</p><h2 className="mt-1 font-[Manrope] text-xl font-bold">OEM source claims</h2><p className="mt-1 text-xs text-muted-foreground">Claims are not automatically verified. A person must review the linked source.</p></div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onResearch} data-testid="button-research-oem-source"><Search size={15}/>Research a source</Button><Button onClick={onAdd} data-testid="button-add-oem-claim"><Plus size={16}/>Add source claim</Button></div></div>
    <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-900/15 bg-amber-900/[.04] p-3.5 text-xs leading-5 text-muted-foreground"><Info size={15} className="mt-0.5 shrink-0 text-amber-800"/><span>Keep evidence traceable: every claim below includes its source URL and stays pending until explicitly approved or rejected by a reviewer.</span></div>
    {!sources.length ? <div className="mt-5"><EmptyState title="No OEM claims recorded" body="Add the manufacturer, product, claim and an official source URL before using the statement in your response." icon={<ShieldCheck size={20}/>}/></div>
      : <div className="mt-5 space-y-3">{sources.map(source => <div key={source.id} className="rounded-xl border border-border bg-card p-4 md:p-5" data-testid={`card-source-${source.id}`}><div className="flex flex-col justify-between gap-3 md:flex-row md:items-start"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold">{source.manufacturer}</span><span className="text-muted-foreground">/</span><span className="text-sm font-semibold">{source.product}</span><StatusPill value={source.reviewStatus}/></div><p className="mt-3 max-w-3xl text-sm leading-6">{source.claim}</p><a href={source.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex max-w-full items-center gap-1.5 break-all text-xs font-semibold text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary" data-testid={`link-source-${source.id}`}><ExternalLink size={13} className="shrink-0"/>{source.sourceTitle || source.sourceUrl}</a>{source.reviewedAt && <p className="mt-2 text-[10px] text-muted-foreground">Reviewed {formatDate(source.reviewedAt)}</p>}</div>
          {source.reviewStatus === 'pending' && <div className="flex shrink-0 gap-2"><Button variant="secondary" className="px-3 py-2 text-xs" onClick={() => onReview(source, 'rejected')} disabled={busy} data-testid={`button-reject-source-${source.id}`}>Reject</Button><Button className="px-3 py-2 text-xs" onClick={() => onReview(source, 'approved')} disabled={busy} data-testid={`button-approve-source-${source.id}`}><Check size={14}/>Approve</Button></div>}
        </div></div>)}</div>}
  </section>;
}
function SourceDialog({ tenderId, close, onDone }: { tenderId: string; close: () => void; onDone: () => void }) {
  const add = useAddVendorSource(); const qc = useQueryClient(); const [error, setError] = useState('');
  const [values, setValues] = useState({ manufacturer: '', product: '', claim: '', sourceUrl: '', sourceTitle: '' });
  const set = (key: keyof typeof values, value: string) => setValues(prev => ({ ...prev, [key]: value }));
  const submit = (e: FormEvent) => { e.preventDefault(); setError(''); add.mutate({ tenderId, data: values }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListVendorSourcesQueryKey(tenderId) }); onDone(); close(); }, onError: err => setError(errorText(err)) }); };
  return <Dialog title="Add an OEM source claim" description="Record the exact statement and where a human reviewer can check it. New claims start pending." onClose={close}>
    <form onSubmit={submit} className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Manufacturer"><input required className={inputClass} value={values.manufacturer} onChange={e => set('manufacturer', e.target.value)} placeholder="Manufacturer name" data-testid="input-source-manufacturer"/></Field><Field label="Product"><input required className={inputClass} value={values.product} onChange={e => set('product', e.target.value)} placeholder="Product / model" data-testid="input-source-product"/></Field></div>
      <Field label="Claim"><textarea required className={cn(inputClass, 'min-h-24 resize-y')} value={values.claim} onChange={e => set('claim', e.target.value)} placeholder="What does the manufacturer state?" data-testid="textarea-source-claim"/></Field>
      <Field label="Source URL"><input required type="url" className={inputClass} value={values.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://manufacturer.example/…" data-testid="input-source-url"/></Field>
      <Field label="Source title" hint="Optional page or document title."><input className={inputClass} value={values.sourceTitle} onChange={e => set('sourceTitle', e.target.value)} placeholder="Datasheet, product page…" data-testid="input-source-title"/></Field>
      <div className="rounded-lg bg-secondary/70 p-3 text-xs leading-5 text-muted-foreground"><Clock3 size={14} className="mr-1 inline text-amber-800"/>Status will be <strong className="text-foreground">Pending review</strong>. This claim is not verified until a person approves it.</div>
      {error && <p className="text-sm text-destructive">{error}</p>}<div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={add.isPending} data-testid="button-save-oem-claim">{add.isPending ? <LoaderCircle className="animate-spin" size={15}/> : <Plus size={15}/>}Record claim</Button></div>
    </form>
  </Dialog>;
}
function ResearchDialog({ tenderId, close, onDone }: { tenderId: string; close: () => void; onDone: () => void }) {
  const research = useResearchVendorSource(); const add = useAddVendorSource(); const qc = useQueryClient();
  const [form, setForm] = useState({ manufacturer: '', product: '', sourceUrl: '' });
  const [result, setResult] = useState<VendorResearchResult | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [saved, setSaved] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const submitResearch = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    let parsed: URL;
    try { parsed = new URL(form.sourceUrl); } catch { setError('Enter a valid HTTPS source URL.'); return; }
    if (parsed.protocol !== 'https:') { setError('The source URL must use HTTPS.'); return; }
    setResult(null); setSelected([]); setSaved([]);
    try {
      const data = await research.mutateAsync({ tenderId, data: form });
      setResult(data);
    } catch (err) { setError(errorText(err)); }
  };
  const saveSelected = async () => {
    if (!result || selected.length === 0) return;
    let source: URL;
    try { source = new URL(result.sourceUrl); } catch { setError('The returned source URL is invalid. Review the source manually and add a claim with a valid HTTPS URL.'); return; }
    if (source.protocol !== 'https:') { setError('The returned source URL is not HTTPS. Claims cannot be added from this result.'); return; }
    setSaving(true); setError('');
    try {
      for (const index of selected) {
        if (saved.includes(index)) continue;
        await add.mutateAsync({ tenderId, data: { manufacturer: form.manufacturer, product: form.product, claim: result.claims[index], sourceUrl: result.sourceUrl, sourceTitle: result.sourceTitle || result.sourceUrl } });
        setSaved(previous => previous.includes(index) ? previous : [...previous, index]);
      }
      void qc.invalidateQueries({ queryKey: getListVendorSourcesQueryKey(tenderId) });
      onDone();
    } catch (err) { setError(`Some claims could not be saved. ${errorText(err)}`); }
    finally { setSaving(false); }
  };
  const toggleClaim = (index: number) => setSelected(previous => previous.includes(index) ? previous.filter(item => item !== index) : [...previous, index]);
  return <Dialog title="Research an OEM source" description="Extract candidate claims from a manufacturer source, then choose what to record for human review." onClose={close} wide>
    <form onSubmit={submitResearch} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Manufacturer"><input required className={inputClass} value={form.manufacturer} onChange={event => set('manufacturer', event.target.value)} placeholder="Manufacturer name" data-testid="input-research-manufacturer"/></Field><Field label="Product"><input required className={inputClass} value={form.product} onChange={event => set('product', event.target.value)} placeholder="Product / model" data-testid="input-research-product"/></Field></div>
      <Field label="Official HTTPS source URL" hint="Use a manufacturer-owned page or official datasheet. The domain is not independently authenticated."><input required type="url" pattern="https://.+" className={inputClass} value={form.sourceUrl} onChange={event => set('sourceUrl', event.target.value)} placeholder="https://manufacturer.example/product/datasheet" data-testid="input-research-source-url"/></Field>
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-900/20 bg-amber-900/[.06] p-3.5 text-xs leading-5 text-amber-950"><Info size={15} className="mt-0.5 shrink-0"/><span><strong>Unverified source and claims.</strong> This domain/source is not independently authenticated. Extracted statements are candidate claims only; check the manufacturer source yourself. Nothing is approved automatically.</span></div>
      <div className="flex items-center justify-between gap-3"><p className="text-[11px] text-muted-foreground">Research uses only the details and URL entered above.</p><Button type="submit" disabled={research.isPending} data-testid="button-run-oem-research">{research.isPending ? <LoaderCircle size={15} className="animate-spin"/> : <Search size={15}/>}Find candidate claims</Button></div>
    </form>
    {error && <p role="alert" className="mt-3 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {result && <div className="mt-5 border-t border-border pt-5">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start"><div><p className="font-mono text-[10px] uppercase tracking-[.15em] text-primary">Candidate extraction</p><h3 className="mt-1 text-sm font-bold">{result.sourceTitle || 'Source page'}</h3><a href={result.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs font-semibold text-primary underline underline-offset-2" data-testid="link-researched-oem-source"><ExternalLink size={12}/>{result.sourceUrl}</a></div><Pill tone="amber">Unverified · human review required</Pill></div>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-900/20 bg-amber-900/[.06] p-3 text-xs leading-5 text-amber-950"><CircleAlert size={14} className="mt-0.5 shrink-0"/><span>The domain/source is not independently authenticated, and every extracted claim is unverified. Compare each statement against the source before saving it.</span></div>
      {!result.claims.length ? <div className="mt-4"><EmptyState title="No candidate claims extracted" body="Review the source directly, then use Add source claim to record any statement you can support."/></div> :
        <div className="mt-4 space-y-2">{result.claims.map((claim, index) => <label key={`${index}-${claim}`} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors', selected.includes(index) ? 'border-primary/35 bg-primary/[.035]' : 'border-border bg-card')} data-testid={`candidate-oem-claim-${index}`}><input type="checkbox" checked={selected.includes(index)} disabled={saved.includes(index)} onChange={() => toggleClaim(index)} className="mt-0.5 size-4 accent-primary" data-testid={`checkbox-oem-claim-${index}`}/><span className="flex-1 text-sm leading-6">{claim}</span>{saved.includes(index) && <Pill tone="green">Saved · pending review</Pill>}</label>)}</div>}
      <div className="mt-4 flex flex-col justify-between gap-3 border-t border-border pt-4 sm:flex-row sm:items-center"><p className="text-xs text-muted-foreground">{selected.length - saved.filter(index => selected.includes(index)).length} selected to add. Added claims remain pending until a person reviews them.</p><Button onClick={saveSelected} disabled={!selected.length || saving || selected.every(index => saved.includes(index))} data-testid="button-save-selected-oem-claims">{saving ? <LoaderCircle size={15} className="animate-spin"/> : <Check size={15}/>}Save selected as pending</Button></div>
    </div>}
    <div className="mt-5 flex justify-end border-t border-border pt-4"><Button variant="quiet" onClick={close}>Close</Button></div>
  </Dialog>;
}
function ProposalPanel({ proposals, loading, failed, onRetry, onGenerate, generating, error }: { tenderId: string; proposals: Proposal[]; loading: boolean; failed: boolean; onRetry: () => void; onGenerate: () => void; generating: boolean; error: string }) {
  if (loading) return <PageSkeleton/>; if (failed) return <QueryError retry={onRetry}/>;
  const technical = proposals.find(p => p.kind === 'technical'); const commercial = proposals.find(p => p.kind === 'commercial');
  return <section><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Separate drafts</p><h2 className="mt-1 font-[Manrope] text-xl font-bold">Technical & commercial proposals</h2><p className="mt-1 text-xs text-muted-foreground">Each draft is independently editable and exportable.</p></div><Button onClick={onGenerate} disabled={generating} data-testid="button-generate-proposals">{generating ? <LoaderCircle size={15} className="animate-spin"/> : <Sparkles size={15}/>}Generate proposal pair</Button></div>
    {error && <p className="mt-3 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {!proposals.length ? <div className="mt-5"><EmptyState title="No proposal drafts yet" body="Generate a technical and a commercial draft separately after reviewing the content you want processed." icon={<FileText size={20}/>}/></div>
      : <div className="mt-5 grid gap-4 lg:grid-cols-2">{(['technical', 'commercial'] as const).map(kind => {
        const proposal = kind === 'technical' ? technical : commercial;
        return <div key={kind} className="rounded-xl border border-border bg-card p-5" data-testid={`card-proposal-${kind}`}><div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><FileText size={18}/></div>{proposal ? <StatusPill value={proposal.status}/> : <Pill>Not generated</Pill>}</div><h3 className="mt-4 font-[Manrope] text-lg font-bold">{kind === 'technical' ? 'Technical proposal' : 'Commercial proposal'}</h3><p className="mt-1 text-xs text-muted-foreground">{proposal ? `Version ${proposal.version} · Updated ${formatDate(proposal.updatedAt)}` : 'A distinct draft will be created for this proposal type.'}</p>
          {proposal ? <><p className="mt-4 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{proposal.content || 'This draft is ready for your edits.'}</p><Link href={`/proposals/${proposal.id}`} className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline" data-testid={`link-edit-proposal-${proposal.id}`}>Open and edit <ArrowRight size={14}/></Link></> : <p className="mt-4 rounded-lg bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground">Use Generate proposal pair to create both drafts after explicit AI processing consent.</p>}
        </div>;
      })}</div>}
    {proposals.length > 0 && <p className="mt-4 text-[11px] text-muted-foreground">Drafts remain separate. Review and approve each proposal independently before submission.</p>}
  </section>;
}
function GenerateDialog({ close, onConfirm, loading }: { close: () => void; onConfirm: () => void; loading: boolean }) {
  const [checked, setChecked] = useState(false);
  return <Dialog title="Confirm AI draft generation" description="Review this before creating the technical and commercial proposal drafts." onClose={close}>
    <div className="rounded-xl border border-amber-900/15 bg-amber-900/[.045] p-4"><div className="flex items-start gap-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-900/10 text-amber-900"><Info size={17}/></div><div><p className="text-sm font-bold">Your selected tender content will be processed</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Generating drafts sends selected tender details, requirements, evidence notes and approved source claims to OpenAI via Replit AI Integrations. Usage is billed to Replit credits. Review and edit all generated text before use.</p></div></div></div>
    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3.5 text-xs leading-5"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5 size-4 accent-primary" data-testid="checkbox-ai-consent"/><span>I understand what content will be sent and consent to processing for this proposal generation.</span></label>
    <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4"><Button variant="quiet" onClick={close}>Cancel</Button><Button onClick={onConfirm} disabled={!checked || loading} data-testid="button-confirm-generate">{loading ? <LoaderCircle size={15} className="animate-spin"/> : <Sparkles size={15}/>}Generate both drafts</Button></div>
  </Dialog>;
}
function ProposalEditor() {
  const params = useParams<{ proposalId: string }>(); const proposalId = params.proposalId ?? ''; const qc = useQueryClient();
  const update = useUpdateProposal(); const [location, navigate] = useLocation(); void location;
  const proposal = useMemo(() => {
    const matches = qc.getQueryCache().findAll({ predicate: query => Array.isArray(query.queryKey) && typeof query.queryKey[0] === 'string' && query.queryKey[0].includes('/proposals') });
    for (const query of matches) { const list = query.state.data as Proposal[] | undefined; const found = list?.find(item => item.id === proposalId); if (found) return found; }
    return undefined;
  }, [qc, proposalId, update.isSuccess]);
  const [title, setTitle] = useState(proposal?.title ?? ''); const [content, setContent] = useState(proposal?.content ?? '');
  useEffect(() => { if (proposal) { setTitle(proposal.title); setContent(proposal.content); } }, [proposal?.id]);
  const onUpdated = (updated: Proposal) => {
    const key = getListProposalsQueryKey(updated.tenderId);
    qc.setQueryData<Proposal[]>(key, old => old?.map(item => item.id === updated.id ? updated : item));
    void qc.invalidateQueries({ queryKey: key });
  };
  const save = () => update.mutate({ proposalId, data: { title: title.trim(), content } }, { onSuccess: onUpdated });
  const changeStatus = (status: Proposal['status']) => update.mutate({ proposalId, data: { status } }, { onSuccess: onUpdated });
  const exportDocx = () => { const bytes = createDocx(title, content); const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }); const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = `${proposal?.kind ?? 'proposal'}-proposal.docx`; anchor.click(); URL.revokeObjectURL(anchor.href); };
  const exportPdf = () => window.print();
  if (!proposal) return <div className="mx-auto max-w-xl py-14"><EmptyState title="Draft not in this session" body="Open the proposal from its tender workspace so the draft can be loaded from the current workspace record." icon={<FileText size={20}/>}/><div className="mt-4 flex justify-center"><Link href="/" className="text-sm font-bold text-primary hover:underline" data-testid="link-back-tenders">Back to tenders</Link></div></div>;
  return <div className="enter">
    <Link href={`/tenders/${proposal.tenderId}`} className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-workspace"><ArrowLeft size={14}/>Tender workspace</Link>
    <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-end">
      <div><div className="flex items-center gap-2"><Pill tone={proposal.kind === 'technical' ? 'blue' : 'amber'}>{proposal.kind} proposal</Pill><StatusPill value={proposal.status}/></div><h1 className="mt-2 font-[Manrope] text-3xl font-extrabold tracking-tight">Edit proposal draft</h1><p className="mt-1 text-xs text-muted-foreground">Version {proposal.version} · Last saved {formatDate(proposal.updatedAt)}</p></div>
      <div className="flex flex-wrap gap-2"><select className={cn(inputClass, 'w-auto py-2 text-xs')} aria-label="Proposal review status" value={proposal.status} onChange={e => changeStatus(e.target.value as Proposal['status'])} disabled={update.isPending} data-testid="select-proposal-status"><option value="draft">Draft</option><option value="needs_review">Needs review</option><option value="approved">Approved</option></select><Button variant="secondary" onClick={exportDocx} data-testid="button-export-docx"><ArrowDownToLine size={15}/>Export DOCX</Button><Button variant="secondary" onClick={exportPdf} data-testid="button-export-pdf"><ArrowDownToLine size={15}/>Export PDF</Button><Button onClick={save} disabled={update.isPending} data-testid="button-save-proposal">{update.isPending ? <LoaderCircle size={15} className="animate-spin"/> : <Check size={15}/>}Save draft</Button></div>
    </div>
    {update.isError && <div className="mt-4 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{errorText(update.error)}</div>}{update.isSuccess && <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-800"><CheckCircle2 size={15}/>Saved just now</div>}
    <div className="mx-auto mt-7 max-w-4xl rounded-xl border border-border bg-card px-5 py-7 shadow-sm md:px-12 md:py-10"><div className="mb-6 border-b border-border pb-5"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Tender Desk · Working document</p><input className="mt-3 w-full border-0 bg-transparent p-0 font-[Manrope] text-2xl font-bold outline-none focus:ring-0" value={title} onChange={e => setTitle(e.target.value)} aria-label="Proposal title" data-testid="input-proposal-title"/><p className="mt-2 text-xs text-muted-foreground">This is a working draft. Confirm every statement against its tender evidence before submission.</p></div>
      <textarea className="min-h-[55vh] w-full resize-y border-0 bg-transparent p-0 text-sm leading-7 outline-none focus:ring-0 placeholder:text-muted-foreground/60" value={content} onChange={e => setContent(e.target.value)} placeholder="Write and refine this proposal draft…" aria-label="Proposal content" data-testid="textarea-proposal-content"/>
    </div>
    <p className="mx-auto mt-3 max-w-4xl text-[11px] text-muted-foreground">DOCX export downloads an editable document. PDF export opens your browser's print dialog; choose “Save as PDF”.</p>
  </div>;
}
function escapeHTML(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)); }
function createDocx(title: string, content: string) {
  const encoder = new TextEncoder();
  const entries: Array<[string, string]> = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${escapeHTML(title)}</w:t></w:r></w:p>${content.split(/\r?\n/).map(line => `<w:p><w:r><w:t xml:space="preserve">${escapeHTML(line)}</w:t></w:r></w:p>`).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`],
  ];
  const crc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  const local: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value >>> 0, true);
  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name); const data = encoder.encode(text); const crc = crc32(data);
    const localPart = new Uint8Array(30 + nameBytes.length + data.length); const lv = new DataView(localPart.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0); u16(lv, 8, 0); u16(lv, 10, 0); u16(lv, 12, 0); u32(lv, 14, crc); u32(lv, 18, data.length); u32(lv, 22, data.length); u16(lv, 26, nameBytes.length); u16(lv, 28, 0); localPart.set(nameBytes, 30); localPart.set(data, 30 + nameBytes.length); local.push(localPart);
    const centralPart = new Uint8Array(46 + nameBytes.length); const cv = new DataView(centralPart.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, 0); u16(cv, 10, 0); u16(cv, 12, 0); u16(cv, 14, 0); u32(cv, 16, crc); u32(cv, 20, data.length); u32(cv, 24, data.length); u16(cv, 28, nameBytes.length); u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset); centralPart.set(nameBytes, 46); central.push(centralPart); offset += localPart.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0); const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, entries.length); u16(ev, 10, entries.length); u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);
  const all = [...local, ...central, end]; const output = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0)); let cursor = 0; for (const part of all) { output.set(part, cursor); cursor += part.length; } return output;
}
function Router() {
  const [location] = useLocation();
  return <AppShell><ErrorBoundary resetKey={location}><Switch><Route path="/" component={Dashboard}/><Route path="/tenders/:tenderId" component={TenderWorkspace}/><Route path="/proposals/:proposalId" component={ProposalEditor}/><Route component={NotFound}/></Switch></ErrorBoundary></AppShell>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
