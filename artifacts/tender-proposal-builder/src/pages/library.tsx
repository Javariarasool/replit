import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useListProposalLibrary } from '@workspace/api-client-react';
import type { ListProposalLibraryCategory, ListProposalLibraryOutcome } from '@workspace/api-client-react';
import { Archive, ArrowRight, Info, Plus, Search } from 'lucide-react';
import { Button, EmptyState, PageSkeleton, Pill, QueryError, cn, formatDate, inputClass } from '@/components/ui-kit';
import { ImportDialog } from '@/components/library/import-dialog';
import { OutcomePill, SCAN_NOTE, categoryLabel, libraryCategories, libraryOutcomes } from '@/components/library/shared';

export default function LibraryPage() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState(''); const [category, setCategory] = useState(''); const [outcome, setOutcome] = useState(''); const [dialog, setDialog] = useState(false);
  const params = { ...(q.trim() ? { q: q.trim() } : {}), ...(category ? { category: category as ListProposalLibraryCategory } : {}), ...(outcome ? { outcome: outcome as ListProposalLibraryOutcome } : {}) };
  const query = useListProposalLibrary(params);
  const entries = query.data ?? []; const filtered = Boolean(q || category || outcome);
  return <div className="enter">
    <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Archive / Past proposals</p><h1 className="mt-2 font-[Manrope] text-3xl font-extrabold tracking-tight md:text-[38px]">Proposal library</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">A private, searchable shelf of past tenders and the proposals you submitted. Reuse their structure when drafting new work.</p></div>
      <Button onClick={() => setDialog(true)} data-testid="button-import-library"><Plus size={17}/>Import past proposal</Button>
    </div>
    <div className="mt-7 flex flex-col gap-2 md:flex-row">
      <label className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15}/><input className={cn(inputClass, 'h-10 pl-9')} value={q} onChange={e => setQ(e.target.value)} placeholder="Search text, agency, reference, notes" aria-label="Search library" data-testid="input-search-library"/></label>
      <select className={cn(inputClass, 'h-10 md:w-44')} value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter category" data-testid="select-filter-category"><option value="">All categories</option>{libraryCategories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select className={cn(inputClass, 'h-10 md:w-44')} value={outcome} onChange={e => setOutcome(e.target.value)} aria-label="Filter outcome" data-testid="select-filter-outcome"><option value="">All outcomes</option>{libraryOutcomes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
    <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-muted-foreground"><Info size={13} className="mt-0.5 shrink-0"/>{SCAN_NOTE}</p>
    <div className="mt-5">
      {query.isLoading ? <PageSkeleton/> : query.isError ? <QueryError retry={() => void query.refetch()}/>
        : !entries.length ? <EmptyState icon={<Archive size={20}/>} title={filtered ? 'No library entries match' : 'Your library is empty'} body={filtered ? 'Try different words or clear the filters.' : 'Import a past tender with its technical and commercial proposals, or archive an approved pair from a tender workspace.'}/>
        : <div className="grid gap-3 md:grid-cols-2">{entries.map(e => <Link key={e.id} href={`/library/${e.id}`} className="group rounded-xl border border-border bg-card p-5 transition hover:border-primary/40" data-testid={`link-library-${e.id}`}>
          <div className="flex flex-wrap items-center gap-2"><Pill tone="blue">{categoryLabel(e.category)}</Pill><OutcomePill value={e.outcome}/>{e.versionLabel && <Pill>{e.versionLabel}</Pill>}{e.extractionWarnings.length > 0 && <Pill tone="amber">{e.extractionWarnings.length} warning{e.extractionWarnings.length > 1 ? 's' : ''}</Pill>}</div>
          <h3 className="mt-3 font-[Manrope] text-base font-bold group-hover:text-primary">{e.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{e.agency}{e.referenceNumber ? ` · ${e.referenceNumber}` : ''}</p>
          <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground"><span>Submitted {formatDate(e.submissionDate)}</span><ArrowRight size={15} className="text-primary transition-transform group-hover:translate-x-1"/></div>
        </Link>)}</div>}
    </div>
    {dialog && <ImportDialog close={() => setDialog(false)} onCreated={id => { setDialog(false); navigate(`/library/${id}`); }}/>}
  </div>;
}
