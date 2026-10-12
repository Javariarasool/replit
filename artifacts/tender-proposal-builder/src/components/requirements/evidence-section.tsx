import { useState } from 'react';
import { useUpdateRequirementItem } from '@workspace/api-client-react';
import type { Evidence, EvidenceInput, RequirementItem } from '@workspace/api-client-react';
import { Button, Field, cn, errorText, inputClass } from '@/components/ui-kit';
import { objectUrl } from '@/components/library/shared';
import { safeUrl, useEvidenceUpload, useRefreshRequirements } from './shared';
import { DocumentReview } from '../document-review';

const cats = [['tender_rfp', 'Tender / RFP'], ['previous_proposal', 'Previous proposal'], ['company_profile', 'Company profile'], ['certification', 'Certifications'], ['cv_reference', 'CV / project references'], ['technical_bom', 'Bill of materials'], ['vendor_quote', 'Vendor quote'], ['oem_datasheet', 'OEM datasheet'], ['other', 'Other']] as const;

export function EvidenceSection({ row, files }: { row: RequirementItem; files: Evidence[] }) {
  const update = useUpdateRequirementItem(); const refresh = useRefreshRequirements(row.tenderId); const upload = useEvidenceUpload(row.tenderId);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(''); const [cat, setCat] = useState<EvidenceInput['category']>('other'); const [file, setFile] = useState<File | null>(null);
  const [web, setWeb] = useState({ url: '', title: '', claim: '', verified: false });
  const linked = row.evidenceIds.map(id => files.find(f => f.id === id)).filter((f): f is Evidence => !!f);
  const patch = (data: Parameters<typeof update.mutate>[0]['data'], done?: () => void) => { setError(''); update.mutate({ requirementId: row.id, data }, { onSuccess: () => { refresh(); done?.(); }, onError: e => setError(errorText(e)) }); };
  const doUpload = async () => {
    if (!file) return; setBusy(true); setError('');
    try { const ev = await upload(file, cat, `Evidence for requirement: ${row.title}`); await update.mutateAsync({ requirementId: row.id, data: { evidenceIds: [...row.evidenceIds, ev.id] } }); setFile(null); refresh(); } catch (e) { setError(errorText(e)); refresh(); } finally { setBusy(false); }
  };
  const addWeb = () => {
    if (!safeUrl(web.url.trim()) || !web.title.trim() || !web.claim.trim()) return setError('Web evidence needs an http(s) URL, a title and the claim it supports.');
    patch({ webEvidence: [...row.webEvidence, { id: crypto.randomUUID(), url: web.url.trim(), title: web.title.trim(), claim: web.claim.trim(), verified: web.verified }] }, () => setWeb({ url: '', title: '', claim: '', verified: false }));
  };
  const disabled = update.isPending || busy;
  return <div className="space-y-4 text-xs" data-testid={`section-evidence-${row.id}`}>
    <div><p className="text-sm font-bold">Tender evidence</p>
      {linked.length === 0 && row.webEvidence.length === 0 && <p className="mt-1 text-amber-900">Missing evidence: nothing is linked to this requirement yet.</p>}
      <ul className="mt-2 space-y-1.5">{linked.map(f => <li key={f.id} className="rounded-lg bg-secondary/50 px-3 py-2"><div className="flex items-center justify-between gap-2"><a href={objectUrl(f.objectPath)} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold text-primary underline">{f.name}</a><Button variant="danger" className="px-2 py-1 text-xs" disabled={disabled} onClick={() => patch({ evidenceIds: row.evidenceIds.filter(i => i !== f.id) })}>Unlink</Button></div><DocumentReview path={f.objectPath}/></li>)}</ul>
      <div className="mt-2 flex flex-wrap gap-2"><select aria-label="Link existing evidence" className={cn(inputClass, 'max-w-xs')} value={pick} onChange={e => setPick(e.target.value)}><option value="">Link existing evidence</option>{files.filter(f => !row.evidenceIds.includes(f.id)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select><Button variant="secondary" disabled={!pick || disabled} onClick={() => patch({ evidenceIds: [...row.evidenceIds, pick] }, () => setPick(''))}>Link</Button></div>
      <div className="mt-2 flex flex-wrap items-end gap-2"><Field label="Upload new file"><input type="file" className={inputClass} onChange={e => setFile(e.target.files?.[0] ?? null)}/></Field><Field label="Category"><select className={inputClass} value={cat} onChange={e => setCat(e.target.value as EvidenceInput['category'])}>{cats.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field><Button disabled={!file || disabled} onClick={() => void doUpload()}>{busy ? 'Uploading...' : 'Upload and link'}</Button></div>
    </div>
    <div><p className="text-sm font-bold">Web evidence</p>
      <ul className="mt-2 space-y-1.5">{row.webEvidence.map(w => <li key={w.id} className="rounded-lg bg-secondary/50 px-3 py-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><a href={w.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-primary underline">{w.title}</a><p className="mt-0.5">{w.claim}</p><p className={w.verified ? 'text-emerald-800' : 'text-amber-900'}>{w.verified ? 'Verified by a person' : 'Not verified; does not count as evidence'}</p></div><div className="flex shrink-0 gap-1"><Button variant="quiet" className="px-2 py-1 text-xs" disabled={disabled} onClick={() => patch({ webEvidence: row.webEvidence.map(x => x.id === w.id ? { ...x, verified: !x.verified } : x) })}>{w.verified ? 'Unverify' : 'Mark verified'}</Button><Button variant="danger" className="px-2 py-1 text-xs" disabled={disabled} onClick={() => patch({ webEvidence: row.webEvidence.filter(x => x.id !== w.id) })}>Remove</Button></div></div></li>)}</ul>
      <div className="mt-2 grid gap-2 sm:grid-cols-2"><input aria-label="Web evidence URL" placeholder="https://..." className={inputClass} value={web.url} onChange={e => setWeb({ ...web, url: e.target.value })}/><input aria-label="Web evidence title" placeholder="Title" className={inputClass} value={web.title} onChange={e => setWeb({ ...web, title: e.target.value })}/></div>
      <textarea aria-label="Claim supported" placeholder="Claim this page supports" className={cn(inputClass, 'mt-2 min-h-16')} value={web.claim} onChange={e => setWeb({ ...web, claim: e.target.value })}/>
      <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={web.verified} onChange={e => setWeb({ ...web, verified: e.target.checked })}/>I opened this page and verified it supports the claim.</label>
      <Button variant="secondary" className="mt-2" disabled={disabled} onClick={addWeb} data-testid={`button-add-web-${row.id}`}>Add web evidence</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
