import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetProposal, useListProposals, useUpdateProposal, getGetProposalQueryKey, getListProposalsQueryKey } from '@workspace/api-client-react';
import type { Proposal } from '@workspace/api-client-react';
import { ArrowDownToLine, ArrowLeft, Check, CheckCircle2, FileText, LoaderCircle } from 'lucide-react';
import { Button, EmptyState, PageSkeleton, Pill, QueryError, StatusPill, cn, errorText, formatDate, inputClass } from '@/components/ui-kit';
import { exportProposalDocx, exportProposalPdf } from '@/lib/proposal-export';

export default function ProposalEditor() {
  const { proposalId = '' } = useParams<{ proposalId: string }>(); const qc = useQueryClient();
  const query = useGetProposal(proposalId); const update = useUpdateProposal();
  const proposal = query.data;
  const list = useListProposals(proposal?.tenderId ?? '', { query: { enabled: !!proposal, queryKey: getListProposalsQueryKey(proposal?.tenderId ?? '') } });
  const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [saved, setSaved] = useState({ title: '', content: '' });
  const initFor = useRef<string | null>(null); const [exportError, setExportError] = useState('');
  useEffect(() => { if (proposal && initFor.current !== proposal.id) { initFor.current = proposal.id; setTitle(proposal.title); setContent(proposal.content); setSaved({ title: proposal.title, content: proposal.content }); } }, [proposal]);
  if (query.isLoading) return <PageSkeleton/>;
  if (query.isError) return <QueryError retry={() => void query.refetch()}/>;
  if (!proposal) return <EmptyState title="Draft not found" body="This proposal may have been removed." icon={<FileText size={20}/>}/>;
  const dirty = title.trim() !== saved.title || content !== saved.content;
  const onUpdated = (u: Proposal, patch?: { title: string; content: string }) => {
    qc.setQueryData(getGetProposalQueryKey(proposalId), u);
    qc.setQueryData<Proposal[]>(getListProposalsQueryKey(u.tenderId), old => old?.map(i => i.id === u.id ? u : i));
    if (patch) setSaved(patch);
  };
  const save = () => { const patch = { title: title.trim(), content }; update.mutate({ proposalId, data: patch }, { onSuccess: u => onUpdated(u, patch) }); };
  const changeStatus = (status: Proposal['status']) => update.mutate({ proposalId, data: { status } }, { onSuccess: u => onUpdated(u) });
  const older = (list.data ?? []).filter(p => p.kind === proposal.kind && p.id !== proposal.id).sort((a, b) => b.version - a.version);
  const run = async (fn: () => void | Promise<void>) => { setExportError(''); try { await fn(); } catch (err) { setExportError(errorText(err)); } };
  return <div className="enter">
    <Link href={`/tenders/${proposal.tenderId}`} className="mb-5 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary" data-testid="link-back-workspace"><ArrowLeft size={14}/>Tender workspace</Link>
    <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 md:flex-row md:items-end">
      <div><div className="flex items-center gap-2"><Pill tone={proposal.kind === 'technical' ? 'blue' : 'amber'}>{proposal.kind} proposal</Pill><StatusPill value={proposal.status}/></div><h1 className="mt-2 font-[Manrope] text-3xl font-extrabold tracking-tight">Edit proposal draft</h1><p className="mt-1 text-xs text-muted-foreground">Version {proposal.version} · Last saved {formatDate(proposal.updatedAt)}{dirty && ' · Unsaved changes'}</p></div>
      <div className="flex flex-wrap gap-2">
        <select className={cn(inputClass, 'w-auto py-2 text-xs')} aria-label="Proposal review status" value={proposal.status} onChange={e => changeStatus(e.target.value as Proposal['status'])} disabled={update.isPending} data-testid="select-proposal-status"><option value="draft">Draft</option><option value="needs_review">Needs review</option><option value="approved" disabled={dirty}>Approved{dirty ? ' (save first)' : ''}</option></select>
        <Button variant="secondary" onClick={() => void run(() => exportProposalDocx(title, content, proposal.kind))} data-testid="button-export-docx"><ArrowDownToLine size={15}/>Export DOCX</Button>
        <Button variant="secondary" onClick={() => void run(() => exportProposalPdf(title, content, proposal.kind))} data-testid="button-export-pdf"><ArrowDownToLine size={15}/>Export PDF</Button>
        <Button onClick={save} disabled={update.isPending || !dirty || !title.trim()} data-testid="button-save-proposal">{update.isPending ? <LoaderCircle size={15} className="animate-spin"/> : <Check size={15}/>}Save draft</Button>
      </div>
    </div>
    {dirty && <p className="mt-3 text-xs text-muted-foreground">Save your edits before approving this draft.</p>}
    {(update.isError || exportError) && <div className="mt-4 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">{exportError || errorText(update.error)}</div>}
    {update.isSuccess && !dirty && <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-emerald-800"><CheckCircle2 size={15}/>Saved</div>}
    <div className="mx-auto mt-7 max-w-4xl rounded-xl border border-border bg-card px-5 py-7 shadow-sm md:px-12 md:py-10"><div className="mb-6 border-b border-border pb-5"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-primary">Tender Desk · Working document</p><input className="mt-3 w-full border-0 bg-transparent p-0 font-[Manrope] text-2xl font-bold outline-none focus:ring-0" value={title} onChange={e => setTitle(e.target.value)} aria-label="Proposal title" data-testid="input-proposal-title"/><p className="mt-2 text-xs text-muted-foreground">This is a working draft. Confirm every statement against its tender evidence before submission.</p></div>
      <textarea className="min-h-[55vh] w-full resize-y border-0 bg-transparent p-0 text-sm leading-7 outline-none focus:ring-0 placeholder:text-muted-foreground/60" value={content} onChange={e => setContent(e.target.value)} aria-label="Proposal content" data-testid="textarea-proposal-content"/></div>
    {older.length > 0 && <div className="mx-auto mt-5 max-w-4xl rounded-xl border border-border bg-card p-4" data-testid="section-older-versions"><p className="text-xs font-bold">Other {proposal.kind} versions</p><div className="mt-2 flex flex-wrap gap-2">{older.map(p => <Link key={p.id} href={`/proposals/${p.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-secondary" data-testid={`link-version-${p.id}`}>Version {p.version} · {p.status.replace('_', ' ')}</Link>)}</div></div>}
    <p className="mx-auto mt-3 max-w-4xl text-[11px] text-muted-foreground">Exports include the complete draft as a real DOCX or multi-page PDF file. Technical and commercial drafts export separately.</p>
  </div>;
}
