import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { useCreateLibraryEntry, getListProposalLibraryQueryKey } from '@workspace/api-client-react';
import type { Proposal, Tender } from '@workspace/api-client-react';
import { Archive, LoaderCircle } from 'lucide-react';
import { Button, Dialog, Field, errorText, inputClass } from '@/components/ui-kit';

export function ArchivePairButton({ tender, technical, commercial }: { tender: Tender; technical?: Proposal; commercial?: Proposal }) {
  const ready = technical?.status === 'approved' && commercial?.status === 'approved';
  const qc = useQueryClient(); const create = useCreateLibraryEntry();
  const [open, setOpen] = useState(false); const [label, setLabel] = useState(''); const [doneId, setDoneId] = useState('');
  const submit = () => create.mutate({ data: { title: tender.title, tenderTitle: tender.title, agency: tender.agency, category: tender.category ?? 'mixed', referenceNumber: tender.referenceNumber ?? null, versionLabel: label, sourceTenderId: tender.id } }, { onSuccess: e => { void qc.invalidateQueries({ queryKey: getListProposalLibraryQueryKey() }); setDoneId(e.id); } });
  return <div className="flex items-center gap-2">
    <Button variant="secondary" disabled={!ready} title={ready ? undefined : 'Approve both the latest technical and commercial drafts first'} onClick={() => { setDoneId(''); setOpen(true); }} data-testid="button-archive-pair"><Archive size={15}/>Archive approved pair</Button>
    {open && <Dialog title="Archive approved pair" description="Saves the latest approved technical and commercial drafts, with a snapshot of this tender's requirements, to your private library." onClose={() => setOpen(false)}>
      {doneId ? <div><p className="text-sm">Archived to your library.</p><div className="mt-4 flex justify-end gap-2"><Button variant="quiet" onClick={() => setOpen(false)}>Close</Button><Link href={`/library/${doneId}`} className="inline-flex items-center rounded-lg bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground" data-testid="link-view-archived">View entry</Link></div></div>
        : <div className="grid gap-4"><Field label="Version label"><input className={inputClass} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Submitted" data-testid="input-archive-version"/></Field>
          {create.isError && <p className="text-sm text-destructive">{errorText(create.error)}</p>}
          <div className="flex justify-end gap-2"><Button variant="quiet" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={create.isPending} data-testid="button-confirm-archive">{create.isPending && <LoaderCircle size={15} className="animate-spin"/>}Archive</Button></div></div>}
    </Dialog>}
  </div>;
}
