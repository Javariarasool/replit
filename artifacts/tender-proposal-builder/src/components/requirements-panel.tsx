import { useEffect, useRef, useState } from 'react';
import type { Evidence, Tender } from '@workspace/api-client-react';
import { Check, ClipboardList, LoaderCircle, Sparkles } from 'lucide-react';
import { Button, Dialog, Field, Pill, cn, inputClass } from './ui-kit';
import { DocumentReview } from './document-review';
import { RequirementWorkspace } from './requirements/requirement-workspace';

interface Props {
  tender: Tender;
  userId: string;
  files: Evidence[];
  saving: boolean;
  extracting: boolean;
  error: string;
  onSave: (requirements: string, summary: string, reviewedExtractionId?: string) => void;
  onExtract: (provider: 'openai' | 'anthropic', operation?: 'extract' | 'filter_saved') => void;
  onUpload: () => void;
}

export function RequirementsPanel({ tender, userId, files, saving, extracting, error, onSave, onExtract, onUpload }: Props) {
  const draftKey = `tender-draft:${userId}:${tender.id}`;
  const savedDraft = (() => {
    if (!userId) return null;
    try {
      const raw = window.sessionStorage.getItem(draftKey);
      return raw ? JSON.parse(raw) as { requirements?: string; summary?: string; reviewId?: string } : null;
    } catch {
      return null;
    }
  })();
  const [requirements, setRequirements] = useState(savedDraft?.requirements ?? tender.requirements ?? '');
  const [summary, setSummary] = useState(savedDraft?.summary ?? tender.summary ?? '');
  const [reviewId, setReviewId] = useState<string | undefined>(savedDraft?.reviewId);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentOperation, setConsentOperation] = useState<'extract' | 'filter_saved'>('extract');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const previous = useRef({ requirements: tender.requirements ?? '', summary: tender.summary ?? '' });
  useEffect(() => {
    const old = previous.current;
    setRequirements(value => value === old.requirements ? tender.requirements ?? '' : value);
    setSummary(value => value === old.summary ? tender.summary ?? '' : value);
    previous.current = { requirements: tender.requirements ?? '', summary: tender.summary ?? '' };
  }, [tender.requirements, tender.summary]);
  useEffect(() => {
    if (!userId) return;
    try {
      if (requirements !== (tender.requirements ?? '') || summary !== (tender.summary ?? '') || reviewId) {
        window.sessionStorage.setItem(draftKey, JSON.stringify({ requirements, summary, reviewId }));
      } else {
        window.sessionStorage.removeItem(draftKey);
      }
    } catch {
      // Keep editing available when browser storage is restricted.
    }
  }, [draftKey, userId, requirements, summary, reviewId, tender.requirements, tender.summary]);
  const extraction = tender.requirementsExtraction;
  const job = extraction?.job;
  const consentProvider = consentOperation === 'filter_saved' ? 'anthropic' : job?.status === 'processing' ? job.provider ?? 'openai' : provider;
  const rfpFiles = files.filter(f => f.category === 'tender_rfp');
  const changed = !!extraction && JSON.stringify(rfpFiles.map(f => f.id).sort()) !== JSON.stringify(extraction.sourceFiles.map(f => f.id).sort());
  const canFilterSaved = !!extraction?.items?.length && extraction.cardScope !== 'evaluated_only' && !changed;
  const openExtractConsent = () => { setConsentOperation('extract'); setConsentOpen(true); };
  const openFilterConsent = () => { setConsentOperation('filter_saved'); setConsentOpen(true); };
  const pending = !!extraction && !extraction.reviewedAt;
  const waitingForOcr = /Verify the OCR/i.test(error);
  const useExtraction = () => {
    if (!extraction) return;
    if ((requirements.trim() || summary.trim()) && !window.confirm('Load the extracted brief into the editor? This replaces the text currently in these fields. Your saved brief stays unchanged until you save.')) return;
    setRequirements(extraction.requirements); setSummary(extraction.summary); setReviewId(extraction.id);
  };
  const save = () => {
    onSave(requirements, summary, pending && reviewId === extraction?.id && !changed ? reviewId : undefined);
  };
  return <section className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-[Manrope] text-xl font-bold">Assessed requirements</h2><p className="mt-1 text-xs text-muted-foreground">Extract the complete tender in one pass. Only requirements assessed for compliance, eligibility, scoring or mandatory submission belong in the checklist—not general statements.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={onUpload} disabled={extracting} data-testid="button-upload-tender">Upload tender</Button>
        {canFilterSaved && <Button variant="secondary" onClick={openFilterConsent} disabled={extracting || saving} data-testid="button-filter-saved-requirements">Filter saved list ({extraction!.items!.length})</Button>}
        <Button onClick={openExtractConsent} disabled={extracting || saving || !rfpFiles.length} data-testid="button-extract-requirements"><Sparkles size={15}/>{extraction ? 'Extract again' : 'Extract from tender'}</Button></div>
    </div>
    {job?.provider && <p className="text-xs text-muted-foreground" data-testid="text-extraction-provider">{job.status === 'completed' ? 'Last extraction' : 'Current extraction attempt'}: {job.provider === 'anthropic' ? 'Claude Sonnet 5.5' : 'OpenAI'}.</p>}
    <RequirementWorkspace tender={tender} files={files}/>
    {extracting && <div role="status" data-testid="requirements-extraction-progress" className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"><LoaderCircle size={18} className="animate-spin"/><div>{job?.strategy === 'filter_saved' ? `Filtering ${job.filterCandidateCount ?? 'saved'} previously extracted items…` : job?.status === 'processing' ? 'Reviewing the complete tender for assessed requirements…' : 'Preparing the complete tender for requirement extraction.'}<p className="mt-1 text-xs text-muted-foreground">{job?.strategy === 'filter_saved' ? 'The saved list is classified without reading the document again. Nothing changes until every saved item is classified; evidence and vendor choices are preserved.' : 'All tender sources are reviewed together in one AI request, without processing chunks. The checklist appears only when the full result is ready. Keep this tender open while processing. Your saved brief and evidence stay unchanged.'}</p>{job?.error && <p className="mt-2">{job.error}</p>}</div></div>}
    {job?.status === 'failed' && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"><p>{job.error}</p><p className="mt-2">No partial brief or requirement list has replaced your previous work.</p><Button className="mt-3" onClick={job.strategy === 'filter_saved' ? openFilterConsent : openExtractConsent} disabled={saving} data-testid="button-retry-extraction">{job.strategy === 'filter_saved' ? 'Retry filtering saved list' : 'Retry full-tender extraction'}</Button></div>}
    {job?.status === 'completed' && <p role="status" className="text-sm text-primary">{job.strategy === 'filter_saved' ? `Retained ${job.filterKeptCount ?? 'assessed'} of ${job.filterCandidateCount ?? 'saved'} extracted items for review. Excluded items and evidence remain stored.` : 'The assessed requirements and requirements-only brief are ready for human review.'}</p>}
    {error && <div role={waitingForOcr ? 'status' : 'alert'} className={cn('rounded-xl border p-4 text-sm', waitingForOcr ? 'border-amber-900/20 bg-amber-900/5 text-amber-950' : 'border-destructive/20 bg-destructive/5 text-destructive')}>
      {waitingForOcr && <p className="mb-2 font-bold">OCR verification required—not a failed upload</p>}
      <p>{error}</p>
      {job?.status === 'processing' && <Button className="mt-3" onClick={job.strategy === 'filter_saved' ? openFilterConsent : openExtractConsent} disabled={saving} data-testid="button-resume-extraction">Resume saved {job.strategy === 'filter_saved' ? 'filter' : 'extraction'}</Button>}
      {waitingForOcr && <p className="mt-2">Review and verify the OCR for each scanned source below, then choose Extract from tender. Unverified OCR is not sent to the requirements AI.</p>}
    </div>}
    {!rfpFiles.length && <p className="text-sm text-muted-foreground">Upload a Tender / RFP document to begin. Manual entry remains available below.</p>}
    {!!rfpFiles.length && <details open={!!error} className="rounded-xl border border-border bg-card p-4" data-testid="panel-tender-source-reading">
      <summary className="cursor-pointer text-sm font-bold">Source documents & OCR review ({rfpFiles.length})</summary>
      <p className="mt-3 text-xs text-muted-foreground">Readable documents are extracted automatically. Scanned documents require checking the recognised text against the original before requirements can be extracted.</p>
      <div className="mt-3 space-y-4">{rfpFiles.map(file => <div key={file.id} className="rounded-lg border border-border p-3"><p className="break-words text-sm font-semibold">{file.name}</p><DocumentReview path={file.objectPath}/></div>)}</div>
    </details>}
    {extraction?.requirements && <div className="rounded-xl border border-primary/20 bg-card p-5" data-testid="panel-extracted-requirements">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Automatically extracted brief</h3><Pill tone={pending || changed ? 'amber' : 'blue'}>{changed ? 'Documents changed · extract again' : pending ? 'Human review required' : 'Reviewed'}</Pill></div>
      <p className="mt-2 text-xs text-muted-foreground">Sources: {extraction.sourceFiles.map(f => f.name).join(', ')}. Check quantities, mandatory clauses, dates, forms and source references against the originals.</p>
      {extraction.warnings.length > 0 && <div className="mt-3 rounded-lg bg-amber-900/5 p-3 text-xs text-amber-950"><p className="font-bold">Extraction warnings</p><ul className="mt-1 list-disc space-y-1 pl-4">{extraction.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
      <p className="mt-4 text-sm leading-6">{extraction.summary}</p>
      <pre className="mt-3 max-h-[440px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/40 p-4 font-sans text-sm leading-6" data-testid="text-extracted-requirements">{extraction.requirements}</pre>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="secondary" onClick={useExtraction} disabled={changed || extracting || saving} data-testid="button-use-extracted-requirements">Load into editor for review</Button><p className="text-xs text-muted-foreground">Existing edits are never replaced automatically. Saving the loaded brief records your review.</p></div>
    </div>}
    <div className="rounded-xl border border-border bg-card p-5 md:p-7"><div className="flex items-center gap-2"><ClipboardList size={18} className="text-primary"/><h3 className="text-sm font-bold">Working brief</h3></div>
      {reviewId && pending && <p className="mt-3 text-xs text-primary">{reviewId === extraction?.id ? 'Extracted brief loaded. Correct any gaps below, then save to confirm your review.' : 'A newer extraction is available. Load and review it before saving approval.'}</p>}
      <div className="mt-5 grid gap-5"><Field label="Requirements"><textarea className={cn(inputClass, 'min-h-[240px] resize-y leading-6')} value={requirements} onChange={e => setRequirements(e.target.value)} data-testid="textarea-requirements"/></Field>
        <Field label="Summary"><textarea className={cn(inputClass, 'min-h-[88px] resize-y')} value={summary} onChange={e => setSummary(e.target.value)} data-testid="textarea-summary"/></Field></div>
      <div className="mt-4 flex justify-end"><Button onClick={save} disabled={saving || extracting || (pending && !!reviewId && (reviewId !== extraction?.id || changed))} data-testid="button-save-requirements">{saving ? <LoaderCircle size={15} className="animate-spin"/> : <Check size={15}/>}Save brief{pending && reviewId === extraction?.id ? ' & confirm review' : ''}</Button></div>
    </div>
    {consentOpen && <Dialog title={consentOperation === 'filter_saved' ? 'Filter saved requirements' : 'Extract tender requirements'} description={consentOperation === 'filter_saved' ? 'Classify the saved list without reading the tender documents again.' : 'Read all documents attached in the Tender / RFP category.'} onClose={() => setConsentOpen(false)}>
      {consentOperation === 'extract' && <Field label="AI provider">
        <select className={inputClass} value={consentProvider} disabled={job?.status === 'processing'} data-testid="select-extraction-provider" onChange={event => setProvider(event.target.value as 'openai' | 'anthropic')}>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Claude Sonnet 5.5</option>
        </select>
      </Field>}
      <p className="mt-3 text-sm leading-6">{consentOperation === 'filter_saved' ? 'Saved requirement titles, original source quotes and references—not the tender document or its images—will be sent to Claude through Replit AI Integrations. Every saved item must receive a keep or exclude decision before the reviewed shortlist appears. Original evidence and vendor choices stay stored.' : `Readable tender text and its notes will be sent to ${consentProvider === 'anthropic' ? 'Claude through Anthropic' : 'OpenAI'} using Replit AI Integrations. Original document images are not sent. Results are saved for review; your working brief is not replaced automatically.`} Usage is billed to your Replit credits.</p>
      <div className="mt-5 flex justify-end gap-2"><Button variant="quiet" onClick={() => setConsentOpen(false)}>Cancel</Button><Button data-testid="button-confirm-extraction" onClick={() => { setConsentOpen(false); onExtract(consentProvider, consentOperation); }}>Agree and {consentOperation === 'filter_saved' ? 'filter' : 'extract'}</Button></div>
    </Dialog>}
  </section>;
}
