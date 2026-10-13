import { useState } from 'react';
import { ListChecks, LoaderCircle, Plus, Sparkles } from 'lucide-react';
import { useImportRequirementItems, useListRequirementItems } from '@workspace/api-client-react';
import type { Evidence, Tender } from '@workspace/api-client-react';
import { exportRequirementsXlsx } from '@/lib/requirements-export';
import { Download } from 'lucide-react';
import { Button, Dialog, EmptyState, QueryError, errorText } from '@/components/ui-kit';
import { isEvidenced, isStale, reqCategories, useRefreshRequirements } from './shared';
import { RequirementCard } from './requirement-card';
import { RequirementFormDialog } from './requirement-form-dialog';

export function RequirementWorkspace({ tender, files }: { tender: Tender; files: Evidence[] }) {
  const query = useListRequirementItems(tender.id); const imp = useImportRequirementItems(); const refresh = useRefreshRequirements(tender.id);
  const [filter, setFilter] = useState<string>('all'); const [adding, setAdding] = useState(false); const [importing, setImporting] = useState(false); const [aiOk, setAiOk] = useState(false);
  const [page, setPage] = useState(1); const [xl, setXl] = useState<'' | 'filtered' | 'all'>(''); const [xlErr, setXlErr] = useState('');
  const rows = query.data ?? [];
  const approved = rows.filter(r => r.reviewStatus === 'approved' && !isStale(r, tender)).length;
  const stale = rows.filter(r => isStale(r, tender)).length;
  const missing = rows.filter(r => !isEvidenced(r, files)).length;
  const shown = filter === 'all' ? rows : rows.filter(r => r.category === filter);
  const pageCount = Math.max(1, Math.ceil(shown.length / 50));
  const currentPage = Math.min(page, pageCount);
  const pageRows = shown.slice((currentPage - 1) * 50, currentPage * 50);
  const doXlsx = async (mode: 'filtered' | 'all') => { setXl(mode); setXlErr(''); try { await exportRequirementsXlsx({ mode, filter, rows: shown, allRows: rows, files, tenderTitle: tender.title }); } catch (e) { setXlErr(errorText(e)); } finally { setXl(''); } };
  const pct = rows.length ? Math.round(approved / rows.length * 100) : 0;
  return <section className="rounded-2xl border border-primary/20 bg-card p-5 md:p-6" data-testid="panel-requirement-workspace">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><ListChecks size={18} className="text-primary"/><h3 className="font-[Manrope] text-lg font-bold">Bid evaluation & compliance requirements</h3></div><p className="mt-1 max-w-xl text-xs text-muted-foreground">Only requirements against which your bid is assessed: compliance responses, pass/fail eligibility, scored criteria and mandatory bid evidence. General statements stay in the brief, not this checklist.</p></div>
      <div className="flex gap-2"><Button variant="secondary" onClick={() => { setAiOk(false); imp.reset(); setImporting(true); }} disabled={imp.isPending || (!!tender.requirementsExtraction && tender.requirementsExtraction.cardScope !== 'evaluated_only')} data-testid="button-import-requirements"><Sparkles size={14}/>Import from brief</Button><Button onClick={() => setAdding(true)} data-testid="button-add-requirement"><Plus size={15}/>Add requirement</Button></div>
    </div>
    {tender.requirementsExtraction && tender.requirementsExtraction.cardScope !== 'evaluated_only' && <p role="status" className="mt-4 rounded-lg bg-amber-900/5 p-3 text-xs text-amber-950">Checklist rules updated. Choose “Extract again” to separate assessed requirements from general statements. Earlier automatically extracted cards and their evidence are preserved but hidden until the new checklist is ready; manually added requirements remain visible.</p>}
    {query.isLoading ? <div className="mt-5 space-y-3" aria-label="Loading requirements">{[0, 1, 2].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary"/>)}</div>
      : query.isError ? <div className="mt-5"><QueryError retry={() => void query.refetch()}/></div>
      : <>
        <div className="mt-5 grid gap-3 sm:grid-cols-3" data-testid="summary-requirements">
          <div className="rounded-xl bg-secondary/50 p-3"><p className="text-xs text-muted-foreground">Reviewed</p><p className="text-lg font-bold">{approved} of {rows.length}</p><div className="mt-2 h-1.5 overflow-hidden rounded bg-border"><div className="h-full origin-left bg-primary" style={{ width: `${pct}%` }}/></div></div>
          <div className="rounded-xl bg-secondary/50 p-3"><p className="text-xs text-muted-foreground">Missing evidence</p><p className={`text-lg font-bold ${missing ? 'text-amber-900' : ''}`}>{missing}</p></div>
          <div className="rounded-xl bg-secondary/50 p-3"><p className="text-xs text-muted-foreground">Stale after new extraction</p><p className={`text-lg font-bold ${stale ? 'text-amber-900' : ''}`}>{stale}</p></div>
        </div>
        {stale > 0 && <p className="mt-3 rounded-lg bg-amber-900/5 p-3 text-xs text-amber-950">{stale} requirement{stale === 1 ? '' : 's'} came from an earlier extraction. Re-review them against the current documents, or import new rows. Your existing work is preserved.</p>}
        {imp.isSuccess && <p role="status" className="mt-3 rounded-lg bg-emerald-900/5 p-3 text-xs text-emerald-900">Import finished. New rows were added; existing human work was not replaced.</p>}
        <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-3" data-testid="panel-requirements-excel"><div className="flex flex-wrap items-center gap-2"><Button variant="secondary" disabled={!!xl || shown.length === 0} onClick={() => void doXlsx('filtered')} data-testid="button-export-filtered-xlsx">{xl === 'filtered' ? <LoaderCircle size={14} className="animate-spin"/> : <Download size={14}/>}Export filtered ({shown.length}) to Excel</Button><Button variant="secondary" disabled={!!xl || rows.length === 0} onClick={() => void doXlsx('all')} data-testid="button-export-all-xlsx">{xl === 'all' ? <LoaderCircle size={14} className="animate-spin"/> : <Download size={14}/>}Export all groups with pricing</Button></div><p className="mt-2 text-[11px] text-muted-foreground">Filtered export includes every matching row, not just this page. Technical and compliance sheets carry no prices. The all-groups workbook contains commercial pricing on a separate Pricing sheet and must not be attached to the technical envelope.</p>{xlErr && <p role="alert" className="mt-2 text-xs text-destructive">{xlErr}</p>}</div>
        <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by category">{[['all', 'All'], ...reqCategories].map(([id, label]) => { const n = id === 'all' ? rows.length : rows.filter(r => r.category === id).length; return <button key={id} role="tab" aria-selected={filter === id} onClick={() => { setFilter(id); setPage(1); }} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`} data-testid={`filter-${id}`}>{label} {n}</button>; })}</div>
        <div className="mt-4 space-y-3">{rows.length === 0 ? <EmptyState title="No assessed requirements to show" body="Extract from tender identifies bid-evaluation and compliance-response items. General statements do not become cards. Check the original compliance tables if an assessed requirement is missing." icon={<ListChecks size={20}/>}/> : shown.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No requirements in this category.</p> : pageRows.map(r => <RequirementCard key={r.id} row={r} tender={tender} files={files}/>)}</div>
        {pageCount > 1 && <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Requirement pages">
          <p className="text-xs text-muted-foreground">Showing {(currentPage - 1) * 50 + 1}–{Math.min(currentPage * 50, shown.length)} of {shown.length} · Page {currentPage} of {pageCount}</p>
          <div className="flex gap-2"><Button variant="secondary" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} data-testid="button-requirements-previous">Previous</Button><Button variant="secondary" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} data-testid="button-requirements-next">Next</Button></div>
        </nav>}
      </>}
    <p className="mt-3 text-xs text-muted-foreground">Reviewed cards and human-selected suppliers govern new proposal drafts. The full brief below is retained for reference; editing it does not update existing cards.</p>
    {adding && <RequirementFormDialog tenderId={tender.id} onClose={() => setAdding(false)}/>}
    {importing && <Dialog title="Import requirements from brief" description="Adds only assessed compliance and evaluation requirements, not general statements. Existing evidence is kept." onClose={() => setImporting(false)}>
      <p className="text-sm leading-6">The saved requirements brief and its notes will be sent to OpenAI through Replit AI Integrations, billed to your Replit credits. New rows start as pending review.</p>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={aiOk} onChange={e => setAiOk(e.target.checked)} data-testid="checkbox-import-consent"/>I agree to send the brief to the AI provider.</label>
      {imp.isError && <p role="alert" className="mt-3 text-sm text-destructive">{errorText(imp.error)}</p>}
      <div className="mt-5 flex justify-end gap-2"><Button variant="quiet" onClick={() => setImporting(false)}>Cancel</Button><Button disabled={!aiOk || imp.isPending} onClick={() => imp.mutate({ tenderId: tender.id, data: { aiConsent: true } }, { onSuccess: () => { refresh(); setImporting(false); } })} data-testid="button-confirm-import">{imp.isPending && <LoaderCircle size={14} className="animate-spin"/>}{imp.isPending ? 'Importing...' : 'Agree and import'}</Button></div>
    </Dialog>}
  </section>;
}
