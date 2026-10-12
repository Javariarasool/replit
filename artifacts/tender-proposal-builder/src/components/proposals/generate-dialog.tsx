import { useState } from 'react';
import { useListProposalLibrary } from '@workspace/api-client-react';
import { Info, LoaderCircle, Sparkles } from 'lucide-react';
import { Button, Dialog, cn } from '@/components/ui-kit';
import { OutcomePill, categoryLabel } from '@/components/library/shared';

export function GenerateDialog({ close, onConfirm, loading }: { close: () => void; onConfirm: (libraryEntryIds: string[]) => void; loading: boolean }) {
  const [checked, setChecked] = useState(false); const [picked, setPicked] = useState<string[]>([]);
  const lib = useListProposalLibrary();
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.length < 5 ? [...p, id] : p);
  return <Dialog title="Confirm AI draft generation" description="Review this before creating the technical and commercial proposal drafts." onClose={close}>
    <div className="rounded-xl border border-amber-900/15 bg-amber-900/[.045] p-4"><div className="flex items-start gap-3"><div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-900/10 text-amber-900"><Info size={17}/></div><div><p className="text-sm font-bold">Your tender content will be processed</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Generating drafts sends tender details and requirements, the full readable text of uploaded evidence, evidence notes, approved source claims, and the selected historical library excerpts to OpenAI via Replit AI Integrations. Usage is billed to Replit credits. Review and edit all generated text before use.</p></div></div></div>
    <div className="mt-4"><div className="flex items-center justify-between"><p className="text-sm font-bold">Reuse past proposals <span className="font-normal text-muted-foreground">(optional)</span></p><span className="mono text-[11px] text-muted-foreground" data-testid="text-library-count">{picked.length}/5</span></div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">Selected archived excerpts guide structure and wording style only. They are never used for current prices, credentials or compliance claims.</p>
      <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
        {lib.isLoading ? <div className="h-12 animate-pulse rounded-lg bg-secondary"/> : lib.isError ? <p className="text-xs text-destructive">Could not load the library. <button className="font-bold underline" onClick={() => void lib.refetch()} data-testid="button-retry-library">Retry</button></p>
          : !(lib.data ?? []).length ? <p className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">No library entries yet.</p>
          : (lib.data ?? []).map(e => { const on = picked.includes(e.id); const locked = !on && picked.length >= 5; return <label key={e.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 text-xs', on ? 'border-primary bg-primary/5' : 'border-border', locked && 'opacity-50')}>
            <input type="checkbox" checked={on} disabled={locked} onChange={() => toggle(e.id)} className="mt-0.5 size-4 accent-primary" data-testid={`checkbox-library-${e.id}`}/>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{e.title}</span><span className="block truncate text-muted-foreground">{e.agency} · {categoryLabel(e.category)}</span></span><OutcomePill value={e.outcome}/></label>; })}
      </div></div>
    <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3.5 text-xs leading-5"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5 size-4 accent-primary" data-testid="checkbox-ai-consent"/><span>I understand that this content, including full readable uploaded evidence text, notes and the selected historical excerpts, will be sent to OpenAI, and I consent.</span></label>
    <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4"><Button variant="quiet" onClick={close}>Cancel</Button><Button onClick={() => onConfirm(picked)} disabled={!checked || loading} data-testid="button-confirm-generate">{loading ? <LoaderCircle size={15} className="animate-spin"/> : <Sparkles size={15}/>}Generate both drafts</Button></div>
  </Dialog>;
}
