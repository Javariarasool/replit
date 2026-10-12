import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetLibraryEntry, useUpdateLibraryEntry, useDeleteLibraryEntry, getGetLibraryEntryQueryKey, getListProposalLibraryQueryKey } from '@workspace/api-client-react';
import type { LibraryEntryDetail, LibraryEntryUpdateCategory, LibraryEntryUpdateOutcome } from '@workspace/api-client-react';
import { ArrowLeft, Check, CircleAlert, ExternalLink, FileText, LoaderCircle, Trash2 } from 'lucide-react';
import { Button, Dialog, Field, PageSkeleton, Pill, QueryError, cn, errorText, formatDate, inputClass } from '@/components/ui-kit';
import { OutcomePill, SCAN_NOTE, categoryLabel, libraryCategories, libraryOutcomes, objectUrl } from '@/components/library/shared';
import { DocumentReview } from '@/components/document-review';

function TextBlock({ label, text, path }: { label: string; text: string; path: string | null }) {
  return <section className="rounded-xl border border-border bg-card p-5" data-testid={`section-text-${label.toLowerCase()}`}>
    <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-[Manrope] text-sm font-bold"><FileText size={15} className="text-primary"/>{label} text</h3>
      {path ? <a href={objectUrl(path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline" data-testid={`link-original-${label.toLowerCase()}`}>View original <ExternalLink size={12}/></a> : <Pill>No file</Pill>}</div>
    {!path ? <p className="mt-3 text-xs text-muted-foreground">No {label.toLowerCase()} file was stored for this entry.</p>
      : text.trim() ? <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-background p-4 font-sans text-xs leading-6">{text}</pre>
      : <p className="mt-3 rounded-lg bg-amber-900/[.06] p-3 text-xs leading-5 text-amber-900">No readable text was extracted. {SCAN_NOTE}</p>}
    {path && <DocumentReview path={path}/>}
  </section>;
}

function Editor({ entry }: { entry: LibraryEntryDetail }) {
  const qc = useQueryClient(); const update = useUpdateLibraryEntry();
  const [f, setF] = useState({ title: entry.title, tenderTitle: entry.tenderTitle, agency: entry.agency, category: entry.category as LibraryEntryUpdateCategory, referenceNumber: entry.referenceNumber ?? '', submissionDate: entry.submissionDate?.slice(0, 10) ?? '', outcome: entry.outcome as LibraryEntryUpdateOutcome, versionLabel: entry.versionLabel, notes: entry.notes });
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setSaved(false); setF(p => ({ ...p, [k]: v })); };
  const save = () => update.mutate({ entryId: entry.id, data: { ...f, referenceNumber: f.referenceNumber || null, submissionDate: f.submissionDate || null } }, { onSuccess: u => {
    qc.setQueryData<LibraryEntryDetail>(getGetLibraryEntryQueryKey(entry.id), old => old ? { ...old, ...u } : old);
    void qc.invalidateQueries({ queryKey: getListProposalLibraryQueryKey() }); setSaved(true); } });
  return <section className="rounded-xl border border-border bg-card p-5">
    <h2 className="font-[Manrope] text-base font-bold">Metadata</h2>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Title"><input className={inputClass} value={f.title} onChange={e => set('title', e.target.value)} data-testid="input-edit-title"/></Field>
      <Field label="Tender title"><input className={inputClass} value={f.tenderTitle} onChange={e => set('tenderTitle', e.target.value)} data-testid="input-edit-tender-title"/></Field>
      <Field label="Agency"><input className={inputClass} value={f.agency} onChange={e => set('agency', e.target.value)} data-testid="input-edit-agency"/></Field>
      <Field label="Reference number"><input className={inputClass} value={f.referenceNumber} onChange={e => set('referenceNumber', e.target.value)} data-testid="input-edit-reference"/></Field>
      <Field label="Category"><select className={inputClass} value={f.category} onChange={e => set('category', e.target.value)} data-testid="select-edit-category">{libraryCategories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Outcome"><select className={inputClass} value={f.outcome} onChange={e => set('outcome', e.target.value)} data-testid="select-edit-outcome">{libraryOutcomes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Submission date"><input type="date" className={inputClass} value={f.submissionDate} onChange={e => set('submissionDate', e.target.value)} data-testid="input-edit-date"/></Field>
      <Field label="Version label"><input className={inputClass} value={f.versionLabel} onChange={e => set('versionLabel', e.target.value)} data-testid="input-edit-version"/></Field>
    </div>
    <div className="mt-4"><Field label="Notes"><textarea className={cn(inputClass, 'min-h-[90px] resize-y')} value={f.notes} onChange={e => set('notes', e.target.value)} data-testid="input-edit-notes"/></Field></div>
    {update.isError && <p className="mt-3 text-sm text-destructive">{errorText(update.error)}</p>}
    <div className="mt-4 flex items-center justify-end gap-3">{saved && <span className="text-xs font-semibold text-emerald-800">Saved</span>}<Button onClick={save} disabled={update.isPending || !f.title.trim() || !f.agency.trim()} data-testid="button-save-library">{update.isPending ? <LoaderCircle size={15} className="animate-spin"/> : <Check size={15}/>}Save metadata</Button></div>
  </section>;
}

export default function LibraryEntryPage() {
  const { entryId = '' } = useParams<{ entryId: string }>(); const [, navigate] = useLocation(); const qc = useQueryClient();
  const query = useGetLibraryEntry(entryId); const del = useDeleteLibraryEntry(); const [confirm, setConfirm] = useState(false);
  const mounted = useRef(true); useEffect(() => () => { mounted.current = false; }, []);
  if (query.isLoading) return <PageSkeleton/>;
  const e = query.data;
  if (query.isError || !e) return <QueryError retry={() => void query.refetch()}/>;
  const remove = () => del.mutate({ entryId }, { onSuccess: () => { qc.removeQueries({ queryKey: getGetLibraryEntryQueryKey(entryId) }); void qc.invalidateQueries({ queryKey: getListProposalLibraryQueryKey() }); navigate('/library'); } });
  return <div className="enter">
    <Link href="/library" className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-library"><ArrowLeft size={14}/>Library</Link>
    <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
      <div><div className="flex flex-wrap items-center gap-2"><Pill tone="blue">{categoryLabel(e.category)}</Pill><OutcomePill value={e.outcome}/>{e.versionLabel && <Pill>{e.versionLabel}</Pill>}{e.sourceTenderId && <Pill tone="green">Archived from a tender workspace</Pill>}</div>
        <h1 className="mt-3 font-[Manrope] text-3xl font-extrabold tracking-tight">{e.title}</h1><p className="mt-1 text-sm font-semibold text-primary">{e.agency}</p>
        <p className="mono mt-1 text-[11px] text-muted-foreground">{e.referenceNumber ?? 'No reference'} · Submitted {formatDate(e.submissionDate)} · Added {formatDate(e.createdAt)}</p></div>
      <Button variant="danger" onClick={() => setConfirm(true)} data-testid="button-delete-library"><Trash2 size={15}/>Delete entry</Button>
    </div>
    {e.extractionWarnings.length > 0 && <div className="mt-5 rounded-xl border border-amber-900/15 bg-amber-900/[.05] p-4" data-testid="section-warnings"><p className="flex items-center gap-2 text-sm font-bold text-amber-900"><CircleAlert size={16}/>Extraction warnings</p><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">{e.extractionWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">{SCAN_NOTE}</p></div>}
    <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      <Editor key={e.updatedAt} entry={e}/>
      <div className="grid content-start gap-4"><TextBlock label="Tender" text={e.tenderText} path={e.tenderObjectPath}/><TextBlock label="Technical" text={e.technicalText} path={e.technicalObjectPath}/><TextBlock label="Commercial" text={e.commercialText} path={e.commercialObjectPath}/></div>
    </div>
    {confirm && <Dialog title="Delete this library entry?" description="The entry, its extracted text and its stored original files will be permanently removed from your library. It will no longer be available when drafting. Tender workspaces and proposals are not affected. This cannot be undone." onClose={() => setConfirm(false)}>
      {del.isError && <p className="mb-3 text-sm text-destructive">{errorText(del.error)}</p>}
      <div className="flex justify-end gap-2"><Button variant="quiet" onClick={() => setConfirm(false)}>Keep entry</Button><Button variant="danger" onClick={remove} disabled={del.isPending} data-testid="button-confirm-delete-library">{del.isPending ? 'Deleting…' : 'Delete permanently'}</Button></div></Dialog>}
  </div>;
}
