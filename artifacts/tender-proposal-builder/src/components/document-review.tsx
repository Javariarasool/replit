import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetDocumentExtraction, useExtractUploadedDocument, useReviewDocumentExtraction, getGetDocumentExtractionQueryKey, getListProposalLibraryQueryKey, type OcrLanguage } from '@workspace/api-client-react';
import { Button, Dialog, Pill, cn, inputClass, errorText } from '@/components/ui-kit';
import { objectUrl } from '@/components/library/shared';

export const OCR_NOTE = 'Scanned PDF pages and PNG/JPEG/TIFF/BMP/WebP images are read with local English, Urdu or English + Urdu OCR (up to 30 PDF pages, 25 MB). No document images are sent to an AI provider. OCR is searchable but cannot be used in drafts until you verify it against the original.';
const LANGUAGE_LABELS: Record<OcrLanguage, string> = { eng: 'English', urd: 'Urdu', 'eng+urd': 'English + Urdu' };

export function DocumentReview({ path }: { path: string }) {
  const qc = useQueryClient();
  const query = useGetDocumentExtraction({ objectPath: path });
  const extract = useExtractUploadedDocument(); const review = useReviewDocumentExtraction();
  const [open, setOpen] = useState(false); const [text, setText] = useState(''); const [confirmed, setConfirmed] = useState(false); const [search, setSearch] = useState('');
  const data = query.data;
  const [languageChoice, setLanguageChoice] = useState<OcrLanguage | null>(null);
  const [reviewLanguage, setReviewLanguage] = useState<OcrLanguage>('eng');
  const language = languageChoice ?? data?.language ?? 'eng';
  const languageChanged = !!data && language !== (data.language ?? 'eng');
  const refresh = () => { void qc.invalidateQueries({ queryKey: getGetDocumentExtractionQueryKey({ objectPath: path }) }); void qc.invalidateQueries({ queryKey: getListProposalLibraryQueryKey() }); };
  const readDocument = () => extract.mutate({ data: { objectPath: path, retry: data?.status === 'failed', language } }, { onSuccess: refresh });
  const startReview = () => { setText(data?.reviewedText ?? data?.ocrText ?? ''); setReviewLanguage(data?.language ?? 'eng'); setConfirmed(false); review.reset(); setOpen(true); };
  const save = (status: 'verified' | 'rejected') => review.mutate({ data: { objectPath: path, status, confirmed, reviewedText: text, language: reviewLanguage } }, { onSuccess: () => { refresh(); setOpen(false); } });
  return <div className="mt-3 border-t border-border pt-3 text-xs">
    <a href={objectUrl(path)} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">View original document</a>
    {!query.isLoading && !query.isError && <div className="mt-2 space-y-2">
      <label className="block">Recognition language
        <select aria-label="Recognition language" className={cn(inputClass, 'mt-1')} value={language} disabled={extract.isPending} onChange={event => setLanguageChoice(event.target.value as OcrLanguage)}>
          {Object.entries(LANGUAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {languageChanged && <><p>Re-reading replaces the previous OCR and corrections and requires fresh human verification. The original file and embedded source text remain unchanged.</p><Button className="text-xs" disabled={extract.isPending} onClick={readDocument}>{extract.isPending ? 'Reading document…' : `Re-read in ${LANGUAGE_LABELS[language]}`}</Button></>}
    </div>}
    {query.isLoading ? <p className="mt-2">Loading extraction…</p> : query.isError ? <Button variant="quiet" onClick={() => void query.refetch()}>Retry loading extraction</Button> : !data ? <div className="mt-2"><p>Not yet extracted. {OCR_NOTE}</p><Button className="mt-2 text-xs" disabled={extract.isPending} onClick={readDocument}>{extract.isPending ? 'Reading document…' : 'Read document with local OCR'}</Button></div> :
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2"><Pill tone={data.status === 'verified' ? 'green' : data.status === 'not_needed' ? 'neutral' : 'amber'}>{({ not_needed: 'Embedded source text', needs_review: 'OCR — needs human review', verified: 'OCR — human verified', rejected: 'OCR — rejected, excluded from drafts', failed: 'Extraction failed' })[data.status]}</Pill>
          {data.confidence !== null && <span>OCR confidence: {data.confidence}% (not factual accuracy)</span>}</div>
        {data.error && <p className="text-amber-900">{data.error}</p>}
        {data.confidence !== null && data.confidence < 80 && <p className="text-amber-900">Low recognition confidence. Check this scan especially carefully; confidence never verifies facts.</p>}
        {data.reviewedAt && <p>Reviewed {new Date(data.reviewedAt).toLocaleString()}</p>}
        <p>Recognition language used: {LANGUAGE_LABELS[data.language ?? 'eng']}</p>
        {data.status === 'verified' && <p>For a Tender / RFP scan, you can now retry requirement extraction in Requirements & context using its separate AI-processing consent.</p>}
        {data.status !== 'not_needed' && <p>{data.engine}. OCR text is separate from source text and the original file.</p>}
        {['needs_review', 'verified', 'rejected'].includes(data.status) && <Button variant="secondary" className="text-xs" disabled={extract.isPending} onClick={startReview}>Review OCR against original</Button>}
        {data.status === 'failed' && <div><p>Upload a clearer or smaller document, add human evidence notes, or retry a temporary extraction failure.</p>{!languageChanged && <Button className="mt-2 text-xs" disabled={extract.isPending} onClick={readDocument}>{extract.isPending ? 'Reading document…' : 'Retry local extraction'}</Button>}</div>}
        <details><summary className="cursor-pointer font-semibold">Search / inspect extracted text</summary><input dir="auto" className={cn(inputClass, 'mt-2')} placeholder="Find in extracted text" aria-label="Find in extracted text" value={search} onChange={event => setSearch(event.target.value)}/><pre dir="auto" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap bg-background p-3 [unicode-bidi:plaintext]">{`EMBEDDED SOURCE TEXT:\n${data.sourceText}\nRAW OCR (not verified):\n${data.ocrText}\nHUMAN-REVIEWED OCR:\n${data.reviewedText ?? ''}`.split('\n').filter(line => !search || line.toLowerCase().includes(search.toLowerCase())).join('\n')}</pre></details>
      </div>}
    {extract.isError && <p className="mt-2 text-destructive">{errorText(extract.error)}</p>}
    {open && data && <Dialog wide title="Verify OCR text" description="Check every page, number, unit and table against the original. Correct errors below; the raw OCR and source text will remain unchanged." onClose={() => setOpen(false)}>
      <div className="space-y-3"><a className="font-semibold text-primary underline" href={objectUrl(path)} target="_blank" rel="noreferrer">Open original in a new tab</a>
        <p>Recognition language used: {LANGUAGE_LABELS[reviewLanguage]}</p>
        <details><summary>Raw OCR and page confidence</summary>{data.pages.map(page => <div key={page.page} className="mt-2"><p>Page {page.page} · {page.confidence ?? 'unknown'}% confidence</p><pre dir="auto" className="max-h-44 overflow-auto whitespace-pre-wrap [unicode-bidi:plaintext]">{page.text}</pre></div>)}</details>
        <textarea dir="auto" aria-label="Reviewed OCR text" maxLength={500000} className={cn(inputClass, 'min-h-64 [unicode-bidi:plaintext]')} value={text} onChange={e => { setText(e.target.value); setConfirmed(false); }}/>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>I checked all OCR pages against the original, including quantities, units and tables. Verification allows this corrected text to be used for requirements extraction or proposal drafting only with separate AI-processing consent. Original document images are not sent to the AI provider.</label>
        {review.isError && <p className="text-destructive">{errorText(review.error)}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" disabled={!confirmed || review.isPending} onClick={() => save('rejected')}>Reject OCR</Button><Button disabled={!confirmed || !text.trim() || review.isPending} onClick={() => save('verified')}>{review.isPending ? 'Saving…' : 'Verify corrected text'}</Button></div>
      </div>
    </Dialog>}
  </div>;
}
