import { Link, useSearch } from 'wouter';
import { useState } from 'react';
import { useListDocumentReadingActivity, getListDocumentReadingActivityQueryKey } from '@workspace/api-client-react';
import { CheckCircle2, CircleAlert, Clock3, FileText, LoaderCircle } from 'lucide-react';
import { Dialog, Button, Pill } from '@/components/ui-kit';
import { DocumentReview } from '@/components/document-review';

const labels = {
  queued: 'Queued', running: 'Reading', not_needed: 'Finished · source text ready',
  needs_review: 'Finished · OCR needs review', verified: 'Finished · OCR verified',
  rejected: 'Finished · OCR rejected', failed: 'Reading failed',
} as const;

export function ReadingActivity({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const activity = useListDocumentReadingActivity({ query: {
    // Never reuse another account's cached activity.
    queryKey: [...getListDocumentReadingActivityQueryKey(), userId],
    staleTime: 0, refetchInterval: 5000, refetchOnMount: 'always',
  } });
  const items = activity.data ?? [];
  const active = items.filter(item => item.status === 'queued' || item.status === 'running').length;
  const review = items.filter(item => item.status === 'needs_review' || item.status === 'rejected').length;
  const failed = items.filter(item => item.status === 'failed').length;
  const finished = items.length - active - failed;
  return <>
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold hover:bg-secondary" data-testid="button-reading-activity" aria-label={`Document readings: ${active} active, ${finished} finished, ${failed} failed`}>
      {active ? <LoaderCircle size={14} className="animate-spin"/> : failed || activity.isError ? <CircleAlert size={14} className="text-destructive"/> : <FileText size={14}/>}
      <span className="hidden sm:inline">Document readings</span><span className="sm:hidden">Readings</span>
      <span role="status" className="tabular-nums">{activity.isLoading ? '…' : activity.isError ? 'Unavailable' : `${active} active · ${finished} done${failed ? ` · ${failed} failed` : ''}`}</span>
    </button>
    {open && <Dialog title="Document readings" description="Saved reading activity across your workspace. Opening this list does not start reading or authorize AI processing." onClose={() => setOpen(false)} wide>
      <div className="mb-4 flex flex-wrap gap-2" role="status"><Pill>{active} queued / reading</Pill><Pill tone="green">{finished} finished</Pill><Pill tone="amber">{review} need human review</Pill><Pill tone={failed ? 'amber' : 'green'}>{failed} failed</Pill></div>
      {activity.isError ? <div role="alert"><p className="text-sm text-destructive">Reading activity could not be refreshed. Any saved statuses below may be out of date.</p><Button onClick={() => void activity.refetch()} className="mt-2" variant="quiet">Try again</Button></div>
        : activity.isLoading ? <p className="text-sm text-muted-foreground">Loading saved readings…</p>
        : !items.length && <p className="text-sm text-muted-foreground">No document readings yet. Uploaded documents will appear here when reading starts.</p>}
      <ul className="mt-3 max-h-[55dvh] space-y-3 overflow-y-auto" data-testid="reading-activity-list">
        {items.map(item => <li key={item.id} className="rounded-xl border border-border p-4" data-testid={`reading-activity-${item.id}`}>
          <div className="flex items-start gap-3">
            {item.status === 'running' ? <LoaderCircle size={17} className="mt-0.5 shrink-0 animate-spin text-primary"/> : item.status === 'queued' ? <Clock3 size={17} className="mt-0.5 shrink-0"/> : item.status === 'failed' || item.status === 'rejected' ? <CircleAlert size={17} className="mt-0.5 shrink-0 text-destructive"/> : <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-800"/>}
            <div className="min-w-0 flex-1"><p className="break-words text-sm font-bold">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{labels[item.status]}</p>
              {item.totalPages !== null && <p className="mt-1 text-xs text-muted-foreground">{item.completedPages} / {item.totalPages} pages read</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">{item.finishedAt ? 'Finished' : 'Started'} {new Date(item.finishedAt ?? item.queuedAt).toLocaleString()}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{item.reviewLinks.map(link => <Link key={`${link.href}-${link.label}`} href={link.href} onClick={() => setOpen(false)} className="text-xs font-bold text-primary underline underline-offset-2">{link.label}</Link>)}</div>
            </div>
          </div>
        </li>)}
      </ul>
      <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">No document text is shown in this activity summary. Finished readings are not approval of OCR or consent to AI drafting. Review failures and retry only from the document review screen.</p>
    </Dialog>}
  </>;
}

// Uploads not yet attached to a record still have an owner-protected review path.
export function ReadingReviewPage() {
  const search = useSearch();
  const path = new URLSearchParams(search).get('objectPath');
  return <section><h1 className="font-[Manrope] text-2xl font-bold">Review document reading</h1><p className="mt-2 text-sm text-muted-foreground">Check the reading against your original document before verifying OCR.</p>
    {path ? <DocumentReview key={path} path={path}/> : <p role="alert" className="mt-4 text-sm text-destructive">No document was selected. Open a review link from Document readings.</p>}
  </section>;
}
