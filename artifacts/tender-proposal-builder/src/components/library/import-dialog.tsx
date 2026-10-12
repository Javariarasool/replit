import { type FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCreateLibraryEntry, useRequestUploadUrl, getListProposalLibraryQueryKey } from '@workspace/api-client-react';
import type { LibraryEntryInput, LibraryEntryInputCategory, LibraryEntryInputOutcome } from '@workspace/api-client-react';
import { LoaderCircle, Upload, Info } from 'lucide-react';
import { Button, Dialog, Field, inputClass, cn, errorText } from '@/components/ui-kit';
import { libraryCategories, libraryOutcomes, SCAN_NOTE } from './shared';

type Slot = 'tender' | 'technical' | 'commercial';
const slots: Array<[Slot, string]> = [['tender', 'Tender document (required)'], ['technical', 'Technical proposal'], ['commercial', 'Commercial proposal']];

export function ImportDialog({ close, onCreated }: { close: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient(); const create = useCreateLibraryEntry(); const upload = useRequestUploadUrl();
  const [form, setForm] = useState({ title: '', tenderTitle: '', agency: '', category: 'mixed' as LibraryEntryInputCategory, referenceNumber: '', submissionDate: '', outcome: 'unknown' as LibraryEntryInputOutcome, versionLabel: '', notes: '' });
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));
  const putFile = async (file: File) => {
    const url = await upload.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type || 'application/octet-stream' } });
    const res = await fetch(url.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!res.ok) throw new Error(`Upload of ${file.name} failed.`);
    return url.objectPath;
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!files.tender) return setError('Add the tender document.');
    if (!files.technical && !files.commercial) return setError('Add a technical proposal, a commercial proposal, or both.');
    setBusy(true);
    try {
      const data: LibraryEntryInput = { ...form, referenceNumber: form.referenceNumber || null, submissionDate: form.submissionDate || null };
      data.tenderObjectPath = await putFile(files.tender);
      if (files.technical) data.technicalObjectPath = await putFile(files.technical);
      if (files.commercial) data.commercialObjectPath = await putFile(files.commercial);
      create.mutate({ data }, { onSuccess: entry => { void qc.invalidateQueries({ queryKey: getListProposalLibraryQueryKey() }); onCreated(entry.id); }, onError: err => { setError(errorText(err)); setBusy(false); } });
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return <Dialog wide title="Import a past proposal" description="Private to your workspace. Files are stored privately and their text is extracted for search." onClose={close}>
    <form onSubmit={e => void submit(e)} className="grid gap-4">
      <Field label="Library title"><input required maxLength={300} className={inputClass} value={form.title} onChange={e => set('title', e.target.value)} data-testid="input-library-title"/></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tender title"><input maxLength={500} className={inputClass} value={form.tenderTitle} onChange={e => set('tenderTitle', e.target.value)} data-testid="input-library-tender-title"/></Field>
        <Field label="Agency"><input required maxLength={300} className={inputClass} value={form.agency} onChange={e => set('agency', e.target.value)} data-testid="input-library-agency"/></Field>
        <Field label="Category"><select className={inputClass} value={form.category} onChange={e => set('category', e.target.value)} data-testid="select-library-category">{libraryCategories.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Outcome"><select className={inputClass} value={form.outcome} onChange={e => set('outcome', e.target.value)} data-testid="select-library-outcome">{libraryOutcomes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Reference number"><input className={inputClass} value={form.referenceNumber} onChange={e => set('referenceNumber', e.target.value)} data-testid="input-library-reference"/></Field>
        <Field label="Submission date"><input type="date" className={inputClass} value={form.submissionDate} onChange={e => set('submissionDate', e.target.value)} data-testid="input-library-date"/></Field>
        <Field label="Version label"><input maxLength={100} className={inputClass} value={form.versionLabel} onChange={e => set('versionLabel', e.target.value)} placeholder="e.g. Final, v2" data-testid="input-library-version"/></Field>
      </div>
      <Field label="Notes" hint="Notes are searchable and may be sent to OpenAI when you select this entry for drafting."><textarea maxLength={20000} className={cn(inputClass, 'min-h-[70px] resize-y')} value={form.notes} onChange={e => set('notes', e.target.value)} data-testid="input-library-notes"/></Field>
      <div className="grid gap-2">{slots.map(([slot, label]) => <label key={slot} className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border bg-background px-3.5 py-3 text-sm hover:border-primary">
        <Upload size={16} className="text-primary"/><span className="flex-1"><span className="block font-semibold">{label}</span><span className="block truncate text-xs text-muted-foreground">{files[slot]?.name ?? 'Choose a file'}</span></span>
        <input type="file" className="sr-only" onChange={e => { const f = e.target.files?.[0]; setFiles(p => ({ ...p, [slot]: f })); }} data-testid={`input-library-file-${slot}`}/></label>)}</div>
      <p className="flex items-start gap-2 rounded-lg bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground"><Info size={14} className="mt-0.5 shrink-0"/>{SCAN_NOTE}</p>
      {error && <p className="text-sm text-destructive" data-testid="text-import-error">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="quiet" onClick={close}>Cancel</Button><Button type="submit" disabled={busy} data-testid="button-submit-import">{busy ? <LoaderCircle size={15} className="animate-spin"/> : <Upload size={15}/>}Import to library</Button></div>
    </form>
  </Dialog>;
}
