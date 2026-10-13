import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams, useSearch } from 'wouter';
import { notifySessionExpired, useAuth } from '@workspace/replit-auth-web';
import {
  useGetDashboardSummary, useListTenders, useCreateTender, useGetTender, useUpdateTender, useDeleteTender,
  useListTenderEvidence, useAddTenderEvidence, useDeleteEvidence, useListVendorSources, useAddVendorSource,
  useReviewVendorSource, useListProposals, useGenerateProposalPair, useUpdateProposal, useRequestUploadUrl,
  useResearchVendorSource, useExtractTenderRequirements, useProcessTenderRequirements, useGetDocumentExtraction, getGetDocumentExtractionQueryKey,
  useListRequirementItems, getListRequirementItemsQueryKey,
  useListCompanyEvidence, useLinkCompanyEvidence, useReviewEvidenceApplicability,
  getGetDashboardSummaryQueryKey, getListTendersQueryKey, getGetTenderQueryKey, getListTenderEvidenceQueryKey,
  getListVendorSourcesQueryKey, getListProposalsQueryKey,
} from '@workspace/api-client-react';
import type { Evidence, EvidenceInput, Proposal, Tender, TenderInputCategory, VendorResearchResult, VendorSource } from '@workspace/api-client-react';
import {
  Archive, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, Clock3, FilePlus2,
  FileText, FolderOpen, Info, LoaderCircle, LogOut, Menu, Plus, Search, ShieldCheck, Sparkles, Trash2,
  Upload, X, ExternalLink, ClipboardList, Building2, Layers3, RotateCcw,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Button, Dialog, EmptyState, Field, PageSkeleton, Pill, QueryError, StatusPill, cn, errorText, formatDate, inputClass } from '@/components/ui-kit';
import { GenerateDialog } from '@/components/proposals/generate-dialog';
import { ArchivePairButton } from '@/components/library/archive-button';
import LibraryPage from '@/pages/library';
import LibraryEntryPage from '@/pages/library-entry';
import ProposalEditor from '@/pages/proposal-editor';
import { RequirementsPanel } from '@/components/requirements-panel';
import { DocumentReview, OCR_NOTE } from '@/components/document-review';
import CompanyEvidencePage, { useCompanyEvidenceRefresh } from '@/pages/company-evidence';
import { ReadingActivity, ReadingReviewPage } from '@/components/reading-activity';

function isUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if ('status' in error && error.status === 401) return true;
  return 'response' in error && !!error.response && typeof error.response === 'object' &&
    'status' in error.response && error.response.status === 401;
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: error => { if (isUnauthorized(error)) notifySessionExpired(); } }),
  mutationCache: new MutationCache({ onError: error => { if (isUnauthorized(error)) notifySessionExpired(); } }),
  defaultOptions: { queries: { retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 3 } },
});
const categories = [
  ['tender_rfp', 'Tender / RFP'], ['previous_proposal', 'Previous proposal'], ['company_profile', 'Company profile'],
  ['certification', 'Certifications'], ['cv_reference', 'CV / project references'], ['technical_bom', 'Bill of materials'],
  ['vendor_quote', 'Vendor quote'], ['oem_datasheet', 'OEM datasheet'], ['other', 'Other'], ['staff_cv', 'Staff CV'], ['oem_authorization', 'OEM authorization'], ['project_reference', 'Project reference'],
] as const;
type DialogName = 'tender' | 'source' | 'research' | 'generate' | null;

const categoryName = (value: string) => categories.find(([id]) => id === value)?.[1] ?? value;

function AppShell({ children, auth }: { children: ReactNode; auth: ReturnType<typeof useAuth> }) {
  const [location] = useLocation();
  const [mobileMenu, setMobileMenu] = useState(false);
  useEffect(() => {
    if (auth.isSessionExpired) queryClient.clear();
  }, [auth.isSessionExpired]);
  if (auth.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-background"><div className="w-64 space-y-3"><div className="h-5 w-40 animate-pulse rounded bg-secondary"/><div className="h-3 w-full animate-pulse rounded bg-secondary"/></div></div>;
  if (auth.isSessionExpired) return <main className="app-grain grid min-h-[100dvh] place-items-center bg-background p-6">
    <section className="enter w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
      <div className="bg-primary px-8 pb-9 pt-8 text-primary-foreground">
        <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-primary-foreground/10"><ClipboardList size={23}/></div><div><p className="text-sm font-bold tracking-wide">Tender Desk</p><p className="text-xs opacity-65">Session ended</p></div></div>
        <h1 className="mt-10 max-w-sm font-[Manrope] text-3xl font-bold leading-tight">Sign in to continue your tender work.</h1>
      </div>
      <div className="p-8"><p className="text-sm leading-6 text-muted-foreground">Your tender page will reopen after sign-in. Unsaved brief edits are kept in this browser when possible. Interrupted uploads or extraction are not repeated automatically; review the page and choose what to retry.</p>
        <Button onClick={auth.login} className="mt-6 w-full" data-testid="button-session-login">Sign in and return to this tender <ArrowRight size={16}/></Button>
      </div>
    </section>
  </main>;
  if (!auth.isAuthenticated) return <main className="app-grain grid min-h-[100dvh] place-items-center bg-background p-6">
    <section className="enter w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
      <div className="bg-primary px-8 pb-10 pt-8 text-primary-foreground">
        <div className="flex items-center gap-3"><div className="grid size-11 place-items-center rounded-xl bg-primary-foreground/10"><ClipboardList size={23}/></div><div><p className="text-sm font-bold tracking-wide">Tender Desk</p><p className="text-xs opacity-65">Proposal workspace</p></div></div>
        <p className="mt-12 font-mono text-[10px] uppercase tracking-[.2em] text-primary-foreground/65">Procurement, with a paper trail</p>
        <h1 className="mt-3 max-w-sm font-[Manrope] text-3xl font-bold leading-tight">Every claim has a source. Every draft stays yours.</h1>
      </div>
      <div className="p-8"><p className="text-sm leading-6 text-muted-foreground">A careful workspace for Pakistani IT procurement teams. Sign in to continue to your tenders and proposal evidence.</p>
        <Button onClick={auth.login} className="mt-6 w-full" data-testid="button-login">Log in to Tender Desk <ArrowRight size={16}/></Button>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Sign in with Replit to access your private workspace.</p>
      </div>
    </section>
  </main>;
  return <div className="app-grain min-h-[100dvh] bg-background">
    <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-sidebar text-sidebar-foreground transition-transform md:translate-x-0', mobileMenu ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex items-center gap-3 px-6 pb-7 pt-7"><div className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground"><ClipboardList size={21}/></div><div><p className="font-[Manrope] text-sm font-extrabold tracking-tight">Tender Desk</p><p className="mt-0.5 text-[10px] uppercase tracking-[.16em] text-sidebar-foreground/50">Pakistan · Procurement</p></div></div>
      <div className="px-4"><p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/40">Workspace</p>
        <Link href="/" onClick={() => setMobileMenu(false)} className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition', location === '/' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70')} data-testid="link-dashboard"><Layers3 size={17}/>Tenders</Link>
        <Link href="/library" onClick={() => setMobileMenu(false)} className={cn('mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition', location.startsWith('/library') ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70')} data-testid="link-library"><Archive size={17}/>Proposal library</Link>
        <Link href="/company-evidence" onClick={() => setMobileMenu(false)} className={cn('mt-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition', location.startsWith('/company-evidence') ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70')} data-testid="link-company-evidence"><ShieldCheck size={17}/>Company evidence</Link>
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
        <div className="flex items-center gap-3"><button onClick={() => setMobileMenu(v => !v)} className="rounded-md p-2 hover:bg-secondary md:hidden" aria-label="Open navigation" data-testid="button-menu"><Menu size={19}/></button><span className="hidden font-mono text-[10px] uppercase tracking-[.16em] text-muted-foreground lg:inline">TENDER OPERATIONS</span></div>
        <ReadingActivity key={auth.user!.id} userId={auth.user!.id}/>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 pb-16 pt-8 md:px-9 md:pt-10">
        {auth.recoveredFromSessionExpiry && <div role="status" className="mb-5 rounded-xl border border-amber-900/20 bg-amber-900/[.06] p-4 text-sm text-amber-950">You’re signed in again. Interrupted uploads or extraction were not retried; review your tender and explicitly start anything you still need.</div>}
        {children}
      </main>
    </div>
  </div>;
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
      <Field label="Requirements (optional)" hint="Upload the Tender / RFP in its workspace to extract these automatically."><textarea className={cn(inputClass, 'min-h-[90px] resize-y')} value={form.requirements} onChange={e => update('requirements', e.target.value)} placeholder="Optional initial notes; no need to type the tender clauses" data-testid="input-tender-requirements"/></Field>
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
function TenderWorkspace({ userId, sessionExpired }: { userId: string; sessionExpired: boolean }) {
  const params = useParams<{ tenderId: string }>(); const id = params.tenderId ?? '';
  const [, navigate] = useLocation();
  const detail = useGetTender(id); const evidenceQuery = useListTenderEvidence(id); const sourceQuery = useListVendorSources(id); const proposalsQuery = useListProposals(id);
  const qc = useQueryClient(); const updateTender = useUpdateTender(); const deleteTender = useDeleteTender(); const gen = useGenerateProposalPair();
  const extract = useExtractTenderRequirements(); const [requirementError, setRequirementError] = useState(''); const [tenderUploadOpen, setTenderUploadOpen] = useState(false);
  const [pendingRead, setPendingRead] = useState<{ tenderId: string; path: string } | null>(null);
  const pendingReadPath = pendingRead?.tenderId === id ? pendingRead.path : null;
  const localReading = useGetDocumentExtraction({ objectPath: pendingReadPath ?? '' }, { query: {
    queryKey: getGetDocumentExtractionQueryKey({ objectPath: pendingReadPath ?? '' }),
    enabled: !!pendingReadPath, refetchInterval: pendingReadPath ? 2000 : false,
  } });
  const addSource = useAddVendorSource(); const reviewSource = useReviewVendorSource();
  const search = useSearch();
  const requestedTab = new URLSearchParams(search).get('tab');
  const tab = requestedTab === 'evidence' || requestedTab === 'sources' || requestedTab === 'proposals' ? requestedTab : 'requirements';
  const setTab = (next: 'requirements' | 'evidence' | 'sources' | 'proposals') => navigate(`/tenders/${id}?tab=${next}`, { replace: true });
  const [dialog, setDialog] = useState<DialogName>(null); const [deleteConfirm, setDeleteConfirm] = useState(false); const [error, setError] = useState('');
  const tender = detail.data;
  const processRequirements = useProcessTenderRequirements();
  const requirementsJob = tender?.requirementsExtraction?.job;
  const extractingRequirements = extract.isPending || requirementsJob?.status === 'processing';
  useEffect(() => {
    if (sessionExpired || requirementError || requirementsJob?.status !== 'processing' || processRequirements.isPending || extract.isPending) return;
    const timer = window.setTimeout(() => processRequirements.mutate({ tenderId: id }, {
      onSuccess: updated => {
        qc.setQueryData(getGetTenderQueryKey(id), updated);
        if (updated.requirementsExtraction?.job?.status !== 'processing') {
          void qc.invalidateQueries({ queryKey: getListRequirementItemsQueryKey(id) });
          void qc.invalidateQueries({ queryKey: getListTendersQueryKey() });
        }
      },
      onError: e => setRequirementError(`Extraction paused; completed sections are saved. Reload to resume. ${errorText(e)}`),
    }), 1000);
    return () => window.clearTimeout(timer);
  }, [id, requirementsJob, processRequirements.isPending, extract.isPending, sessionExpired, requirementError, qc]);
  const requirementItems = useListRequirementItems(id);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: getGetTenderQueryKey(id) }); void qc.invalidateQueries({ queryKey: getListTendersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getListVendorSourcesQueryKey(id) }); void qc.invalidateQueries({ queryKey: getListProposalsQueryKey(id) });
    void qc.invalidateQueries({ queryKey: getListRequirementItemsQueryKey(id) });
  };
  const runExtraction = () => { if (sessionExpired) return; setTab('requirements'); setRequirementError(''); extract.mutate({ tenderId: id, data: { aiConsent: true } }, { onSuccess: updated => { qc.setQueryData(getGetTenderQueryKey(id), updated); refresh(); }, onError: e => { refresh(); setRequirementError(`Your uploaded documents and saved brief are unchanged. ${errorText(e)}`); } }); };
  useEffect(() => {
    if (!pendingReadPath || sessionExpired) return;
    const result = localReading.data;
    if (!localReading.isError && (!result || ['queued', 'running'].includes(result.status))) return;
    setPendingRead(null);
    if (result?.status === 'not_needed' || result?.status === 'verified') {
      runExtraction();
    } else {
      setRequirementError(result?.status === 'failed' ? `Document reading failed: ${result.error}. Your original is saved; retry local reading below.` :
        localReading.isError ? 'Could not load document reading status. Your original is saved; check its status below and retry requirement extraction when ready.' :
          'Local OCR has finished. Verify it against the original below, then extract requirements using the separate AI-processing consent.');
    }
  }, [pendingReadPath, localReading.data, localReading.isError, sessionExpired]);
  const afterTenderUpload = (path: string) => { setTab('requirements'); setRequirementError(''); setPendingRead({ tenderId: id, path }); };
  if (detail.isLoading) return <PageSkeleton/>;
  if (detail.isError || !tender) return <QueryError retry={() => void detail.refetch()}/>;
  const pending = (sourceQuery.data ?? []).filter(source => source.reviewStatus === 'pending').length;
  const performDelete = () => deleteTender.mutate({ tenderId: id }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListTendersQueryKey() }); void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); navigate('/'); }, onError: e => setError(errorText(e)) });
  const runGenerate = (ids: string[]) => { setError(''); gen.mutate({ tenderId: id, data: { aiConsent: true, ...(ids.length ? { libraryEntryIds: ids } : {}) } }, { onSuccess: refresh, onError: e => setError(errorText(e)) }); setDialog(null); };
  const requirementsBlocked = extractingRequirements ? 'Tender requirements are being extracted. Review them before generating.' :
    tender.requirementsExtraction && tender.requirementsExtraction.cardScope !== 'evaluated_only' ? 'Extract again to build the bid-evaluation and compliance checklist, then review it before generating.' :
    requirementItems.isLoading || requirementItems.isError ? 'Individual requirements must be loaded before proposal generation.' :
    requirementItems.data?.some(r => r.reviewStatus !== 'approved' || r.extractionId !== (tender.requirementsExtraction?.id ?? null)) ? 'Review each individual requirement against the current tender before generating.' :
    requirementItems.data?.some(r => r.requiresVendor && !r.options.some(o => o.id === r.selectedOptionId && o.reviewed)) ? 'Choose and confirm a supplier/product for every requirement that needs a vendor.' :
    !requirementItems.data?.length && tender.requirementsExtraction && !tender.requirementsExtraction.reviewedAt ? 'Review the automatically extracted requirements, load them into the editor, and save to confirm review before generating.' :
    tender.requirementsExtraction && evidenceQuery.data && JSON.stringify(evidenceQuery.data.filter(f => f.category === 'tender_rfp').map(f => f.id).sort()) !== JSON.stringify(tender.requirementsExtraction.sourceFiles.map(f => f.id).sort()) ? 'Tender documents changed. Extract and review the requirements again before generating.' : '';
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
      <div hidden={tab !== 'requirements'}><RequirementsPanel key={`${userId}:${id}`} tender={tender} userId={userId} files={evidenceQuery.data ?? []} onSave={(requirements, summary, reviewedExtractionId) => { setRequirementError(''); updateTender.mutate({ tenderId: id, data: { requirements, summary, ...(reviewedExtractionId ? { reviewedExtractionId } : {}) } }, { onSuccess: () => { try { window.sessionStorage.removeItem(`tender-draft:${userId}:${id}`); } catch { /* Storage may be blocked. */ } refresh(); }, onError: e => setRequirementError(errorText(e)) }); }} saving={updateTender.isPending} extracting={extractingRequirements} error={requirementError} onExtract={runExtraction} onUpload={() => setTenderUploadOpen(true)}/></div>
      {tab === 'evidence' && <EvidencePanel tenderId={id} userId={userId} evidence={evidenceQuery.data ?? []} loading={evidenceQuery.isLoading} failed={evidenceQuery.isError} onRetry={() => void evidenceQuery.refetch()} onChanged={refresh} onTenderUploaded={afterTenderUpload}/>}
      {tab === 'sources' && <SourcesPanel sources={sourceQuery.data ?? []} loading={sourceQuery.isLoading} failed={sourceQuery.isError} onRetry={() => void sourceQuery.refetch()} onAdd={() => setDialog('source')} onResearch={() => setDialog('research')} onReview={(source, status) => reviewSource.mutate({ sourceId: source.id, data: { reviewStatus: status } }, { onSuccess: refresh })} busy={reviewSource.isPending}/>}
      {tab === 'proposals' && <ProposalPanel tender={tender} proposals={proposalsQuery.data ?? []} loading={proposalsQuery.isLoading} failed={proposalsQuery.isError} onRetry={() => void proposalsQuery.refetch()} onGenerate={() => setDialog('generate')} generating={gen.isPending} error={error} requirementsBlocked={requirementsBlocked}/>}
    </div>
    {dialog === 'source' && <SourceDialog tenderId={id} close={() => setDialog(null)} onDone={refresh}/>}
    {pendingReadPath && <p role="status" className="mt-4 text-sm text-muted-foreground">Reading tender locally before automatic requirements extraction. Local reading continues if you leave; on your return, review any OCR and use Extract requirements to continue.</p>}
    {tenderUploadOpen && <EvidenceDialog tenderId={id} userId={userId} close={() => setTenderUploadOpen(false)} onDone={refresh} onTenderUploaded={afterTenderUpload}/>}
    {dialog === 'research' && <ResearchDialog tenderId={id} close={() => setDialog(null)} onDone={refresh}/>}
    {dialog === 'generate' && <GenerateDialog close={() => setDialog(null)} onConfirm={runGenerate} loading={gen.isPending}/>}
    {deleteConfirm && <Dialog title="Delete this tender?" description="This removes the tender workspace and its metadata. This action cannot be undone." onClose={() => setDeleteConfirm(false)}><div className="flex justify-end gap-2"><Button variant="quiet" onClick={() => setDeleteConfirm(false)}>Cancel</Button><Button variant="danger" onClick={performDelete} disabled={deleteTender.isPending} data-testid="button-confirm-delete">{deleteTender.isPending ? 'Deleting…' : 'Delete tender'}</Button></div>{error && <p className="mt-3 text-sm text-destructive">{error}</p>}</Dialog>}
  </div>;
}
function EvidencePanel({ tenderId, userId, evidence, loading, failed, onRetry, onChanged, onTenderUploaded }: { tenderId: string; userId: string; evidence: Evidence[]; loading: boolean; failed: boolean; onRetry: () => void; onChanged: () => void; onTenderUploaded: (path: string) => void }) {
  const [uploadOpen, setUploadOpen] = useState(false); const remove = useDeleteEvidence(); const qc = useQueryClient(); const [pickOpen, setPickOpen] = useState(false); const review = useReviewEvidenceApplicability(); const [reviewError, setReviewError] = useState(''); const refreshCompany = useCompanyEvidenceRefresh();
  if (loading) return <PageSkeleton/>; if (failed) return <QueryError retry={onRetry}/>;
  return <section><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Source documents</p><h2 className="mt-1 font-[Manrope] text-xl font-bold">Evidence library</h2><p className="mt-1 text-xs text-muted-foreground">Files and notes remain connected to this tender record.</p></div><Button onClick={() => setUploadOpen(true)} data-testid="button-upload-evidence"><Upload size={16}/>Add evidence</Button><Button variant="secondary" onClick={() => setPickOpen(true)} data-testid="button-reuse-evidence"><FolderOpen size={16}/>Reuse from library</Button></div>{reviewError && <p className="mt-3 text-sm text-destructive">{reviewError}</p>}
    {!evidence.length ? <div className="mt-5"><EmptyState title="No evidence attached yet" body="Upload the RFP, company credentials, project references, quotes or OEM datasheets that support this response." icon={<Upload size={20}/>}/></div>
      : <div className="mt-5 grid gap-3 md:grid-cols-2">{evidence.map(item => <div key={item.id} className="rounded-xl border border-border bg-card p-4" data-testid={`card-evidence-${item.id}`}>
        <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><FileText size={18}/></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.name}</p><div className="mt-1.5 flex flex-wrap items-center gap-2"><Pill>{categoryName(item.category)}</Pill><span className="mono text-[10px] text-muted-foreground">{(item.size / 1024 / 1024).toFixed(1)} MB</span></div></div><button disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove evidence “${item.name}” from this tender?`)) remove.mutate({ evidenceId: item.id }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(tenderId) }); onChanged(); }, onError: e => setReviewError(errorText(e)) }); }} aria-label={`Remove ${item.name}`} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`button-delete-evidence-${item.id}`}><Trash2 size={15}/></button></div>
        {item.notes && <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{item.notes}</p>}
        {(item.companyEvidenceId || (item.warnings?.length ?? 0) > 0 || item.issueDate || item.expiryDate) && (() => { const blocked = (item.warnings ?? []).some(w => /expired|expires before|not yet issued|^not applicable:/i.test(w)); const app = item.applicability ?? 'pending'; return <div className="mt-3 border-t border-border pt-3 text-xs">
          <p className="mono text-[11px] text-muted-foreground">Issued {formatDate(item.issueDate)} · Expires {formatDate(item.expiryDate)}</p>
          {(item.warnings ?? []).map(w => <p key={w} className="mt-2 text-amber-800">{w}</p>)}
          <label className="mt-2 grid gap-1 font-semibold">Applicability to this tender<select className={inputClass} value={app} disabled={review.isPending} onChange={e => { setReviewError(''); review.mutate({ evidenceId: item.id, data: { applicability: e.target.value as 'pending' | 'applicable' | 'not_applicable' } }, { onSuccess: () => { refreshCompany([tenderId]); onChanged(); }, onError: err => setReviewError(errorText(err)) }); }} data-testid={`select-applicability-${item.id}`}><option value="pending">Pending review</option><option value="applicable" disabled={blocked}>Applicable</option><option value="not_applicable">Not applicable</option></select></label>
          {blocked && <p className="mt-1 text-muted-foreground">Expired or mismatched evidence cannot be marked applicable.</p>}
          {app === 'pending' && <p className="mt-1 text-amber-800">Pending reused evidence cannot support current claims.</p>}
        </div>; })()}
        <DocumentReview path={item.objectPath}/>
        <p className="mt-3 text-[10px] text-muted-foreground">Added {formatDate(item.uploadedAt)}</p>
      </div>)}</div>}
    {uploadOpen && <EvidenceDialog tenderId={tenderId} userId={userId} close={() => setUploadOpen(false)} onDone={onChanged} onTenderUploaded={onTenderUploaded}/>}
    {pickOpen && <ReusePicker tenderId={tenderId} linked={evidence.map(e => e.companyEvidenceId).filter(Boolean) as string[]} close={() => setPickOpen(false)} onDone={onChanged}/>}
  </section>;
}

function ReusePicker({ tenderId, linked, close, onDone }: { tenderId: string; linked: string[]; close: () => void; onDone: () => void }) {
  const list = useListCompanyEvidence(); const link = useLinkCompanyEvidence(); const refresh = useCompanyEvidenceRefresh(); const [error, setError] = useState(''); const [search, setSearch] = useState('');
  const items = (list.data ?? []).filter(i => `${i.title} ${i.agency}`.toLowerCase().includes(search.toLowerCase()));
  return <Dialog wide title="Reuse company evidence" description="Linked evidence starts as pending review for this tender." onClose={close}>
    <input className={inputClass} placeholder="Search library" aria-label="Search library" value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search-picker"/>
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    <div className="mt-4 grid gap-2">{list.isLoading ? <PageSkeleton/> : list.isError ? <QueryError retry={() => void list.refetch()}/> : !items.length ? <EmptyState title="Nothing to reuse" body="Add evidence on the Company evidence page first."/> : items.map(i => <div key={i.id} className="flex items-center gap-3 rounded-lg border border-border p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{i.title}</p><p className="mono text-[11px] text-muted-foreground">Expires {formatDate(i.expiryDate)}</p>{i.warnings.map(w => <p key={w} className="text-xs text-amber-800">{w}</p>)}</div>
      <Button variant="secondary" disabled={link.isPending || linked.includes(i.id)} onClick={() => { setError(''); link.mutate({ tenderId, data: { companyEvidenceId: i.id } }, { onSuccess: () => { refresh([tenderId]); onDone(); }, onError: e => setError(errorText(e)) }); }} data-testid={`button-link-${i.id}`}>{linked.includes(i.id) ? 'Linked' : link.isPending ? 'Linking…' : 'Link'}</Button></div>)}</div>
  </Dialog>;
}
function EvidenceDialog({ tenderId, userId, close, onDone, onTenderUploaded }: { tenderId: string; userId: string; close: () => void; onDone: () => void; onTenderUploaded: (path: string) => void }) {
  const uploadUrl = useRequestUploadUrl(); const add = useAddTenderEvidence(); const qc = useQueryClient();
  const draftKey = `tender-upload-draft:${userId}:${tenderId}`;
  const savedDraft = (() => {
    try {
      const raw = window.sessionStorage.getItem(draftKey);
      return raw ? JSON.parse(raw) as { category?: string; notes?: string; fileName?: string } : null;
    } catch {
      return null;
    }
  })();
  const savedCategory = categories.some(([id]) => id === savedDraft?.category) ? savedDraft?.category ?? 'tender_rfp' : 'tender_rfp';
  const [file, setFile] = useState<File | null>(null); const [fileName, setFileName] = useState(savedDraft?.fileName ?? ''); const [category, setCategory] = useState(savedCategory); const [notes, setNotes] = useState(savedDraft?.notes ?? ''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  useEffect(() => {
    try {
      if (fileName || notes) window.sessionStorage.setItem(draftKey, JSON.stringify({ category, notes, fileName }));
      else window.sessionStorage.removeItem(draftKey);
    } catch {
      // The dialog remains usable if session storage is unavailable.
    }
  }, [draftKey, fileName, category, notes]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); if (!file) { setError('Choose a file before continuing.'); return; }
    if (category === 'tender_rfp' && !aiConsent) { setError('Please consent to AI processing to automatically extract this tender.'); return; }
    setBusy(true); setError('');
    try {
      const url = await new Promise<{ uploadURL: string; objectPath: string }>((resolve, reject) => uploadUrl.mutate({ data: { name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' } }, { onSuccess: resolve, onError: reject }));
      const result = await fetch(url.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!result.ok) throw new Error(`File upload failed (${result.status}).`);
      const payload: EvidenceInput = { name: file.name, category: category as EvidenceInput['category'], objectPath: url.objectPath, contentType: file.type || 'application/octet-stream', size: file.size, notes };
      await new Promise<void>((resolve, reject) => add.mutate({ tenderId, data: payload }, { onSuccess: () => resolve(), onError: reject }));
      try { window.sessionStorage.removeItem(draftKey); } catch { /* Storage may be blocked. */ }
      void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(tenderId) }); onDone(); close(); if (category === 'tender_rfp') onTenderUploaded(url.objectPath);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return <Dialog title="Attach evidence" description="Upload one source file and record why it matters to this tender." onClose={close}>
    <form onSubmit={submit} className="grid gap-4"><Field label="File"><input type="file" className={cn(inputClass, 'file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs')} onChange={e => { const selected = e.target.files?.[0] ?? null; setFile(selected); setFileName(selected?.name ?? ''); }} data-testid="input-evidence-file"/>{file && <span className="text-xs text-muted-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</span>}</Field>
      {!file && fileName && <p role="status" className="rounded-lg border border-amber-900/20 bg-amber-900/[.06] p-3 text-xs text-amber-950">Your previous selection, {fileName}, was not uploaded again. Select the file once more to continue.</p>}
      <Field label="Evidence category"><select className={inputClass} value={category} onChange={e => setCategory(e.target.value)} data-testid="select-evidence-category">{categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
      <Field label="Notes / summary" hint="A short note helps reviewers understand the context."><textarea className={cn(inputClass, 'min-h-24 resize-y')} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Relevant sections, dates, or context" data-testid="textarea-evidence-notes"/></Field>
      <p className="text-xs text-muted-foreground">{OCR_NOTE}</p>
      {category === 'tender_rfp' && <label className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs leading-5"><input type="checkbox" checked={aiConsent} onChange={e => setAiConsent(e.target.checked)} className="mt-1 shrink-0" data-testid="checkbox-tender-extraction-consent"/><span>Automatically extract requirements after upload. I agree to send readable Tender / RFP text and notes to OpenAI through Replit AI Integrations, billed to my Replit credits. Results require human review and do not overwrite my saved brief.</span></label>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="quiet" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || (category === 'tender_rfp' && !aiConsent)} data-testid="button-attach-evidence">{busy ? <LoaderCircle className="animate-spin" size={15}/> : <Upload size={15}/>}Upload{category === 'tender_rfp' ? ' & extract requirements' : ' and attach'}</Button></div>
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
import { useGetProposalReadiness, getGetProposalReadinessQueryKey } from '@workspace/api-client-react';
import { CompanyBrandingPanel } from '@/components/company-branding';
function ProposalPanel({ tender, proposals, loading, failed, onRetry, onGenerate, generating, error, requirementsBlocked }: { tender: Tender; proposals: Proposal[]; loading: boolean; failed: boolean; onRetry: () => void; onGenerate: () => void; generating: boolean; error: string; requirementsBlocked: string }) {
  const readiness = useGetProposalReadiness(tender.id, { query: { queryKey: getGetProposalReadinessQueryKey(tender.id), staleTime: 0, refetchOnMount: 'always', refetchInterval: 15000 } });
  if (loading) return <PageSkeleton/>; if (failed) return <QueryError retry={onRetry}/>;
  const rd = readiness.data; const canGenerate = !!rd?.ready && !requirementsBlocked && !readiness.isError && !readiness.isLoading;
  const latest = (kind: string) => [...proposals].filter(p => p.kind === kind).sort((a, b) => b.version - a.version)[0]; const technical = latest('technical'); const commercial = latest('commercial'); const older = proposals.filter(p => p !== technical && p !== commercial).sort((a, b) => b.version - a.version);
  return <section><CompanyBrandingPanel/><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Separate drafts</p><h2 className="mt-1 font-[Manrope] text-xl font-bold">Technical & commercial proposals</h2><p className="mt-1 text-xs text-muted-foreground">Each draft is independently editable and exportable.</p></div><div className="flex flex-wrap gap-2"><ArchivePairButton tender={tender} technical={technical} commercial={commercial}/><Button onClick={onGenerate} disabled={generating || !canGenerate} data-testid="button-generate-proposals">{generating ? <LoaderCircle size={15} className="animate-spin"/> : <Sparkles size={15}/>}Generate proposal pair</Button></div></div>
    {readiness.isLoading && <div className="mt-4 h-12 animate-pulse rounded-lg bg-secondary" aria-label="Checking readiness"/>}
    {readiness.isError && <p role="alert" className="mt-4 rounded-lg bg-destructive/5 p-3 text-xs text-destructive">Proposal readiness could not be checked. Generation stays disabled. <button className="underline" onClick={() => void readiness.refetch()} data-testid="button-retry-readiness">Retry</button></p>}
    {rd && <div className={`mt-4 rounded-lg border p-3 text-xs ${rd.ready ? 'border-emerald-900/20 bg-emerald-900/5 text-emerald-900' : 'border-amber-900/20 bg-amber-900/5 text-amber-950'}`} data-testid="panel-readiness"><p className="font-bold">{rd.ready ? 'Ready to generate' : 'Not ready to generate'} · {rd.readyCount} of {rd.requirementCount} requirements ready</p>{rd.blockers.length > 0 && <ul className="mt-2 space-y-1.5">{rd.blockers.map((bl, i) => <li key={bl.requirementId ?? i} data-testid={`blocker-${bl.requirementId ?? i}`}><span className="font-semibold">{bl.title}</span>: {bl.reasons.join('; ')}</li>)}</ul>}</div>}
    {requirementsBlocked && <p role="status" className="mt-4 rounded-lg border border-amber-900/20 bg-amber-900/5 p-3 text-xs text-amber-950">{requirementsBlocked}</p>}
    {error && <p className="mt-3 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {!proposals.length ? <div className="mt-5"><EmptyState title="No proposal drafts yet" body="Generate a technical and a commercial draft separately after reviewing the content you want processed." icon={<FileText size={20}/>}/></div>
      : <div className="mt-5 grid gap-4 lg:grid-cols-2">{(['technical', 'commercial'] as const).map(kind => {
        const proposal = kind === 'technical' ? technical : commercial;
        return <div key={kind} className="rounded-xl border border-border bg-card p-5" data-testid={`card-proposal-${kind}`}><div className="flex items-start justify-between gap-3"><div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><FileText size={18}/></div>{proposal ? <StatusPill value={proposal.status}/> : <Pill>Not generated</Pill>}</div><h3 className="mt-4 font-[Manrope] text-lg font-bold">{kind === 'technical' ? 'Technical proposal' : 'Commercial proposal'}</h3><p className="mt-1 text-xs text-muted-foreground">{proposal ? `Version ${proposal.version} · Updated ${formatDate(proposal.updatedAt)}` : 'A distinct draft will be created for this proposal type.'}</p>
          {proposal ? <><p className="mt-4 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{proposal.content || 'This draft is ready for your edits.'}</p><Link href={`/proposals/${proposal.id}`} className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline" data-testid={`link-edit-proposal-${proposal.id}`}>Open and edit <ArrowRight size={14}/></Link></> : <p className="mt-4 rounded-lg bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground">Use Generate proposal pair to create both drafts after explicit AI processing consent.</p>}
        </div>;
      })}</div>}
    {older.length > 0 && <div className="mt-4 rounded-xl border border-border bg-card p-4" data-testid="section-older-drafts"><p className="text-xs font-bold">Earlier generated versions</p><div className="mt-2 flex flex-wrap gap-2">{older.map(p => <Link key={p.id} href={`/proposals/${p.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-secondary" data-testid={`link-older-${p.id}`}>{p.kind} v{p.version} · {p.status.replace('_', ' ')}</Link>)}</div></div>}
    {proposals.length > 0 && <p className="mt-4 text-[11px] text-muted-foreground">Drafts remain separate. Review and approve each proposal independently before submission.</p>}
  </section>;
}
function Router() {
  const [location] = useLocation();
  const auth = useAuth();
  return <AppShell auth={auth}><ErrorBoundary resetKey={location}><Switch><Route path="/" component={Dashboard}/><Route path="/tenders/:tenderId" component={() => <TenderWorkspace userId={auth.user?.id ?? ''} sessionExpired={auth.isSessionExpired}/ >}/><Route path="/company-evidence" component={CompanyEvidencePage}/><Route path="/library" component={LibraryPage}/><Route path="/library/:entryId" component={LibraryEntryPage}/><Route path="/readings/review" component={ReadingReviewPage}/><Route path="/proposals/:proposalId" component={ProposalEditor}/><Route component={NotFound}/></Switch></ErrorBoundary></AppShell>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router/></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
