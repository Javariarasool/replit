import { useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Pencil, Search, Sparkles, Trash2 } from 'lucide-react';
import { useDeleteRequirementItem, useResearchRequirementSuppliers, useSelectRequirementSupplier, useUpdateRequirementItem } from '@workspace/api-client-react';
import type { Evidence, RequirementItem, SupplierOption, Tender } from '@workspace/api-client-react';
import { Button, Dialog, Pill, errorText } from '@/components/ui-kit';
import { catLabel, isEvidenced, isStale, useRefreshRequirements } from './shared';
import { EvidenceSection } from './evidence-section';
import { OptionCard } from './option-card';
import { ManualOptionDialog, SelectDialog } from './option-dialogs';
import { RequirementFormDialog } from './requirement-form-dialog';

export function RequirementCard({ row, tender, files }: { row: RequirementItem; tender: Tender; files: Evidence[] }) {
  const update = useUpdateRequirementItem(); const del = useDeleteRequirementItem(); const research = useResearchRequirementSuppliers(); const select = useSelectRequirementSupplier();
  const refresh = useRefreshRequirements(row.tenderId);
  const [open, setOpen] = useState(false); const [edit, setEdit] = useState(false); const [confirmDel, setConfirmDel] = useState(false);
  const [consent, setConsent] = useState<'approve' | 'research' | null>(null); const [aiOk, setAiOk] = useState(false);
  const [manual, setManual] = useState(false); const [selecting, setSelecting] = useState<SupplierOption | null>(null); const [error, setError] = useState('');
  const stale = isStale(row, tender); const approved = row.reviewStatus === 'approved';
  const canResearch = approved && row.requiresVendor && !stale;
  const busy = update.isPending || research.isPending || select.isPending || del.isPending;
  const fail = (e: unknown) => { setError(errorText(e)); refresh(); };
  const approve = () => { setError(''); update.mutate({ requirementId: row.id, data: { reviewStatus: 'approved', confirmed: true } }, { onSuccess: refresh, onError: fail }); };
  const unapprove = () => { setError(''); update.mutate({ requirementId: row.id, data: { reviewStatus: 'pending' } }, { onSuccess: refresh, onError: fail }); };
  const runResearch = () => { setError(''); research.mutate({ requirementId: row.id, data: { aiConsent: true } }, { onSuccess: refresh, onError: fail }); };
  const confirmConsent = () => {
    const mode = consent; setConsent(null); setAiOk(false);
    if (mode === 'approve') { setError(''); update.mutate({ requirementId: row.id, data: { reviewStatus: 'approved', confirmed: true } }, { onSuccess: () => { refresh(); runResearch(); }, onError: fail }); } else runResearch();
  };
  const evidenced = isEvidenced(row, files);
  return <article className={`rounded-xl border bg-card ${stale ? 'border-amber-900/30' : 'border-border'}`} data-testid={`card-requirement-${row.id}`}>
    <div className="flex items-start gap-3 p-4">
      <button className="mt-1 text-muted-foreground" aria-label={open ? 'Collapse requirement' : 'Expand requirement'} aria-expanded={open} onClick={() => setOpen(!open)}><ChevronDown size={16} className={open ? '' : '-rotate-90'}/></button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5"><Pill tone="blue">{catLabel(row.category)}</Pill><Pill tone={approved && !stale ? 'green' : 'amber'}>{stale ? 'Stale: re-review' : approved ? 'Approved' : 'Pending review'}</Pill>{!evidenced && <Pill tone="red">Missing evidence</Pill>}{row.requiresVendor && <Pill>Needs supplier</Pill>}{row.requiresVendor && row.selectedOptionId && <Pill tone="green">Supplier selected</Pill>}{row.quantity !== null && <Pill>{row.quantity}{row.unit ? ` ${row.unit}` : ''}</Pill>}</div>
        <h4 className="mt-2 text-sm font-bold">{row.title}</h4>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{row.description}</p>
        {row.sourceQuote && <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">{row.sourceQuote}{row.sourceReference && <span className="not-italic font-semibold"> ({row.sourceReference})</span>}</blockquote>}
        {!row.sourceQuote && row.sourceReference && <p className="mt-2 text-xs text-muted-foreground">Source: {row.sourceReference}</p>}
        {stale && <p className="mt-2 rounded-lg bg-amber-900/5 p-2 text-xs text-amber-950">This clause came from an earlier extraction. Check it against the current documents, then re-review it before research or selection.</p>}
      </div>
      <div className="flex shrink-0 gap-1"><button className="rounded-md p-2 text-muted-foreground hover:bg-secondary" aria-label={`Edit ${row.title}`} onClick={() => setEdit(true)} data-testid={`button-edit-requirement-${row.id}`}><Pencil size={15}/></button><button className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${row.title}`} onClick={() => setConfirmDel(true)} data-testid={`button-delete-requirement-${row.id}`}><Trash2 size={15}/></button></div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
      {(!approved || stale) && <Button variant="secondary" disabled={busy} onClick={approve} data-testid={`button-approve-${row.id}`}><Check size={14}/>{stale ? 'Re-review and approve' : 'Approve clause'}</Button>}
      {approved && !stale && <Button variant="quiet" disabled={busy} onClick={unapprove}>Return to pending</Button>}
      {row.requiresVendor && !approved && !stale && <Button disabled={busy} onClick={() => setConsent('approve')} data-testid={`button-approve-research-${row.id}`}><Sparkles size={14}/>Approve & automatically research</Button>}
      {canResearch && <Button disabled={busy} onClick={() => setConsent('research')} data-testid={`button-research-${row.id}`}>{research.isPending ? <LoaderCircle size={14} className="animate-spin"/> : <Search size={14}/>}{research.isPending ? 'Researching...' : row.researchStatus === 'idle' ? 'Research suppliers' : 'Research again'}</Button>}
      {busy && !research.isPending && <LoaderCircle size={15} className="animate-spin text-muted-foreground"/>}
      {error && <p role="alert" className="w-full text-xs text-destructive">{error}</p>}
    </div>
    {open && <div className="space-y-6 border-t border-border p-4">
      <EvidenceSection row={row} files={files}/>
      {row.requiresVendor && <section className="space-y-3" data-testid={`section-suppliers-${row.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-bold">Supplier options</p><p className="text-xs text-muted-foreground">Suppliers must deliver in Pakistan. Prices are in PKR only. Candidates stay pending until you review them.</p></div><Button variant="secondary" disabled={busy || stale} onClick={() => setManual(true)} data-testid={`button-add-option-${row.id}`}>Add option or quotation</Button></div>
        {research.isPending && <div role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">Searching the live web for candidates. This can take a minute.</div>}
        {row.researchStatus === 'failed' && <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">Research failed: {row.researchError ?? 'No reason given.'}{canResearch && <Button variant="secondary" className="ml-3 text-xs" disabled={busy} onClick={() => setConsent('research')}>Retry research</Button>}</div>}
        {!approved && <p className="text-xs text-muted-foreground">Approve this clause before researching suppliers.</p>}
        {row.lastResearchedAt && <p className="text-xs text-muted-foreground">Last researched {new Date(row.lastResearchedAt).toLocaleString('en-PK')}</p>}
        {row.options.length === 0 && row.researchStatus !== 'failed' && <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">No options yet. Research suppliers or add one manually.</p>}
        {row.options.map(o => <OptionCard key={o.id} row={row} option={o} files={files} busy={busy} onSelect={() => setSelecting(o)} onDeselect={() => { setError(''); select.mutate({ requirementId: row.id, data: { optionId: null, confirmed: true } }, { onSuccess: refresh, onError: fail }); }}/>)}
      </section>}
    </div>}
    {edit && <RequirementFormDialog tenderId={row.tenderId} row={row} onClose={() => setEdit(false)}/>}
    {manual && <ManualOptionDialog row={row} files={files} onClose={() => setManual(false)}/>}
    {selecting && <SelectDialog row={row} option={selecting} onClose={() => setSelecting(null)}/>}
    {confirmDel && <Dialog title="Delete requirement" description={`"${row.title}" and its linked evidence, options and selection will be removed.`} onClose={() => setConfirmDel(false)}>
      {del.isError && <p className="mb-3 text-sm text-destructive">{errorText(del.error)}</p>}
      <div className="flex justify-end gap-2"><Button variant="quiet" onClick={() => setConfirmDel(false)}>Cancel</Button><Button className="bg-destructive text-white hover:bg-destructive/90" disabled={del.isPending} onClick={() => del.mutate({ requirementId: row.id }, { onSuccess: () => { refresh(); setConfirmDel(false); } })} data-testid="button-confirm-delete-requirement">{del.isPending ? 'Deleting...' : 'Delete requirement'}</Button></div>
    </Dialog>}
    {consent && <Dialog title={consent === 'approve' ? 'Approve and research suppliers' : 'Research suppliers'} description="Nothing is sent until you agree." onClose={() => { setConsent(null); setAiOk(false); }}>
      <p className="text-sm leading-6">The clause text, quantity and category will be sent to OpenAI through Replit AI Integrations, which searches the live web for suppliers delivering in Pakistan. Usage is billed to your Replit credits. Results are saved as candidates pending your review, and datasheets are not authenticated automatically.{consent === 'approve' && ' Approving confirms that you checked this clause against the tender.'}</p>
      <label className="mt-4 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={aiOk} onChange={e => setAiOk(e.target.checked)} data-testid="checkbox-research-consent"/>I agree to send this clause to the AI provider.</label>
      <div className="mt-5 flex justify-end gap-2"><Button variant="quiet" onClick={() => { setConsent(null); setAiOk(false); }}>Cancel</Button><Button disabled={!aiOk} onClick={confirmConsent} data-testid="button-confirm-research">{consent === 'approve' ? 'Approve and research' : 'Agree and research'}</Button></div>
    </Dialog>}
  </article>;
}
