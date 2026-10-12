import { type FormEvent, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListCompanyEvidence, useCreateCompanyEvidence, useUpdateCompanyEvidence, useDeleteCompanyEvidence, useRequestUploadUrl,
  getListCompanyEvidenceQueryKey, getListTendersQueryKey, getGetTenderQueryKey, getListTenderEvidenceQueryKey, getGetDashboardSummaryQueryKey,
} from '@workspace/api-client-react';
import type { CompanyEvidence, CompanyEvidenceMetadata } from '@workspace/api-client-react';
import { Download, FileText, LoaderCircle, Pencil, Plus, Search, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { Button, Dialog, EmptyState, Field, PageSkeleton, Pill, QueryError, cn, errorText, formatDate, inputClass } from '@/components/ui-kit';
import { DocumentReview } from '@/components/document-review';
import { objectUrl } from '@/components/library/shared';

export const companyCategories = [['company_profile', 'Company profile'], ['certification', 'Certification'], ['oem_authorization', 'OEM authorization'], ['staff_cv', 'Staff CV'], ['project_reference', 'Project reference']] as const;
export const tenderCategories = ['hardware', 'networking', 'software', 'services', 'mixed'] as const;
const label = (v: string) => companyCategories.find(([id]) => id === v)?.[1] ?? v;

export function useCompanyEvidenceRefresh() {
  const qc = useQueryClient();
  return (tenderIds: string[] = []) => {
    void qc.invalidateQueries({ queryKey: getListCompanyEvidenceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListTendersQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    tenderIds.forEach(id => { void qc.invalidateQueries({ queryKey: getGetTenderQueryKey(id) }); void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(id) }); });
    // Metadata changes and deletions can affect any linked tender.
    void qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/tenders') });
  };
}

type Form = Omit<CompanyEvidenceMetadata, 'tenderCategory'> & { tenderCategory: string };
const blank: Form = { title: '', category: 'company_profile', notes: '', issueDate: null, expiryDate: null, tenderCategory: '', agency: '', tenderReference: '' };

function EvidenceDialog({ item, close }: { item: CompanyEvidence | null; close: () => void }) {
  const refresh = useCompanyEvidenceRefresh();
  const upload = useRequestUploadUrl(); const create = useCreateCompanyEvidence(); const update = useUpdateCompanyEvidence();
  const [form, setForm] = useState<Form>(item ? { title: item.title, category: item.category, notes: item.notes, issueDate: item.issueDate?.slice(0, 10) ?? null, expiryDate: item.expiryDate?.slice(0, 10) ?? null, tenderCategory: item.tenderCategory ?? '', agency: item.agency, tenderReference: item.tenderReference } : blank);
  const [file, setFile] = useState<File | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(p => ({ ...p, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!item && !file) { setError('Choose a file to add to the library.'); return; }
    setBusy(true);
    const meta: CompanyEvidenceMetadata = { ...form, tenderCategory: (form.tenderCategory || null) as CompanyEvidenceMetadata['tenderCategory'], issueDate: form.issueDate || null, expiryDate: form.expiryDate || null };
    try {
      if (item) await update.mutateAsync({ companyEvidenceId: item.id, data: meta });
      else if (file) {
        const type = file.type || 'application/octet-stream';
        const url = await upload.mutateAsync({ data: { name: file.name, size: file.size, contentType: type } });
        const put = await fetch(url.uploadURL, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
        if (!put.ok) throw new Error(`File upload failed (${put.status}).`);
        await create.mutateAsync({ data: { ...meta, objectPath: url.objectPath } });
      }
      refresh(); close();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return <Dialog wide title={item ? 'Edit library evidence' : 'Add to company library'} description={item ? 'Changes apply to every tender this evidence is linked to.' : 'Upload once, then reuse across tenders.'} onClose={close}>
    <form onSubmit={submit} className="grid gap-4">
      {!item && <Field label="File"><input type="file" className={inputClass} onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="input-company-file"/></Field>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title"><input required maxLength={200} className={inputClass} value={form.title} onChange={e => set('title', e.target.value)} data-testid="input-company-title"/></Field>
        <Field label="Category"><select className={inputClass} value={form.category} onChange={e => set('category', e.target.value as Form['category'])} data-testid="select-company-category">{companyCategories.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>
        <Field label="Issue date"><input type="date" className={inputClass} value={form.issueDate ?? ''} onChange={e => set('issueDate', e.target.value || null)} data-testid="input-company-issue"/></Field>
        <Field label="Expiry date"><input type="date" className={inputClass} value={form.expiryDate ?? ''} onChange={e => set('expiryDate', e.target.value || null)} data-testid="input-company-expiry"/></Field>
        <Field label="Tender category scope" hint="Leave open to allow any category."><select className={inputClass} value={form.tenderCategory} onChange={e => set('tenderCategory', e.target.value)} data-testid="select-company-tender-category"><option value="">Any category</option>{tenderCategories.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}</select></Field>
        <Field label="Agency scope" hint="Optional."><input maxLength={200} className={inputClass} value={form.agency} onChange={e => set('agency', e.target.value)} data-testid="input-company-agency"/></Field>
      </div>
      <Field label="Tender reference scope" hint="Optional."><input maxLength={200} className={inputClass} value={form.tenderReference} onChange={e => set('tenderReference', e.target.value)} data-testid="input-company-reference"/></Field>
      <Field label="Notes"><textarea maxLength={10000} className={cn(inputClass, 'min-h-20 resize-y')} value={form.notes} onChange={e => set('notes', e.target.value)} data-testid="textarea-company-notes"/></Field>
      {error && <p className="text-sm text-destructive" data-testid="text-company-error">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="quiet" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy} data-testid="button-save-company">{busy ? <LoaderCircle className="animate-spin" size={15}/> : item ? <Pencil size={15}/> : <Upload size={15}/>}{busy ? 'Saving…' : item ? 'Save changes' : 'Upload and save'}</Button></div>
    </form>
  </Dialog>;
}

export default function CompanyEvidencePage() {
  const query = useListCompanyEvidence(); const remove = useDeleteCompanyEvidence(); const refresh = useCompanyEvidenceRefresh();
  const [search, setSearch] = useState(''); const [cat, setCat] = useState('all');
  const [editing, setEditing] = useState<CompanyEvidence | null>(null); const [open, setOpen] = useState(false);
  const [del, setDel] = useState<CompanyEvidence | null>(null); const [delError, setDelError] = useState('');
  const items = query.data ?? [];
  const filtered = useMemo(() => items.filter(i => (cat === 'all' || i.category === cat) && `${i.title} ${i.name} ${i.agency} ${i.tenderReference} ${i.notes}`.toLowerCase().includes(search.toLowerCase())), [items, cat, search]);
  if (query.isLoading) return <PageSkeleton/>;
  if (query.isError) return <QueryError retry={() => void query.refetch()}/>;
  return <div className="enter">
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-primary">Private library</p><h1 className="mt-2 font-[Manrope] text-3xl font-extrabold tracking-tight">Company evidence</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Certificates, authorizations, CVs and references you can reuse across tenders. Each tender keeps its own review of applicability.</p></div>
      <Button onClick={() => { setEditing(null); setOpen(true); }} data-testid="button-add-company-evidence"><Plus size={16}/>Add evidence</Button></div>
    <div className="mt-6 flex flex-col gap-2 sm:flex-row"><label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15}/><input className={cn(inputClass, 'h-10 pl-9 sm:w-72')} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search library" aria-label="Search library" data-testid="input-search-company"/></label>
      <select className={cn(inputClass, 'h-10 sm:w-52')} value={cat} onChange={e => setCat(e.target.value)} aria-label="Filter category" data-testid="select-company-filter"><option value="all">All categories</option>{companyCategories.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></div>
    {!items.length ? <div className="mt-5"><EmptyState title="Your library is empty" body="Add a certificate, OEM authorization, CV or project reference to reuse it in any tender." icon={<Upload size={20}/>}/></div>
      : !filtered.length ? <div className="mt-5"><EmptyState title="No matching evidence" body="Try another search or category."/></div>
      : <div className="mt-5 grid gap-3 lg:grid-cols-2">{filtered.map(i => <div key={i.id} className="rounded-xl border border-border bg-card p-4" data-testid={`card-company-${i.id}`}>
        <div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><FileText size={18}/></div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{i.title}</p><p className="truncate text-xs text-muted-foreground">{i.name}</p><div className="mt-1.5 flex flex-wrap gap-2"><Pill>{label(i.category)}</Pill>{i.tenderCategory && <Pill tone="blue">{i.tenderCategory}</Pill>}{i.agency && <Pill>{i.agency}</Pill>}{i.tenderReference && <Pill>{i.tenderReference}</Pill>}</div></div>
          <div className="flex shrink-0"><a href={objectUrl(i.objectPath)} target="_blank" rel="noreferrer" download className="rounded-md p-2 text-muted-foreground hover:bg-secondary" aria-label={`Download ${i.title}`} data-testid={`link-download-company-${i.id}`}><Download size={15}/></a>
            <button onClick={() => { setEditing(i); setOpen(true); }} className="rounded-md p-2 text-muted-foreground hover:bg-secondary" aria-label={`Edit ${i.title}`} data-testid={`button-edit-company-${i.id}`}><Pencil size={15}/></button>
            <button onClick={() => { setDelError(''); setDel(i); }} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${i.title}`} data-testid={`button-delete-company-${i.id}`}><Trash2 size={15}/></button></div></div>
        <p className="mono mt-3 text-[11px] text-muted-foreground">Issued {formatDate(i.issueDate)} · Expires {formatDate(i.expiryDate)}</p>
        {i.warnings.map(w => <p key={w} className="mt-2 flex items-start gap-1.5 text-xs text-amber-800"><TriangleAlert size={13} className="mt-0.5 shrink-0"/>{w}</p>)}
        {i.notes && <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{i.notes}</p>}
        <DocumentReview path={i.objectPath}/>
      </div>)}</div>}
    {open && <EvidenceDialog item={editing} close={() => setOpen(false)}/>}
    {del && <Dialog title="Delete from company library?" description="The library file is removed. Copies already linked to tenders remain in those tenders as dated snapshots; they will no longer receive metadata updates." onClose={() => setDel(null)}>
      {delError && <p className="mb-3 text-sm text-destructive">{delError}</p>}
      <div className="flex justify-end gap-2"><Button variant="quiet" onClick={() => setDel(null)} disabled={remove.isPending}>Cancel</Button><Button variant="danger" disabled={remove.isPending} data-testid="button-confirm-delete-company" onClick={() => remove.mutate({ companyEvidenceId: del.id }, { onSuccess: () => { refresh(); setDel(null); }, onError: e => setDelError(errorText(e)) })}>{remove.isPending ? 'Deleting…' : 'Delete from library'}</Button></div></Dialog>}
  </div>;
}
