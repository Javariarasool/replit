import { Link } from 'wouter';
import { History, LoaderCircle, RefreshCw } from 'lucide-react';
import { getGetRequirementPriceHistoryQueryKey, useGetRequirementPriceHistory, type RequirementItem } from '@workspace/api-client-react';
import { Button, Pill, errorText } from '@/components/ui-kit';
import { objectUrl } from '@/components/library/shared';

export function PriceHistorySection({ row }: { row: RequirementItem }) {
  const history = useGetRequirementPriceHistory(row.id, { query: { queryKey: getGetRequirementPriceHistoryQueryKey(row.id), staleTime: 30000, refetchOnMount: 'always' } });
  return <section className="space-y-3 rounded-xl border border-primary/15 bg-primary/[.03] p-4" data-testid={`price-history-${row.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h4 className="flex items-center gap-2 text-sm font-bold"><History size={15}/>Past proposal & quotation prices</h4><p className="mt-1 max-w-2xl text-xs text-muted-foreground">Historical references for matching items—not current offers. Confirm the exact model, licence term, tax, delivery and quote validity before quoting. Nothing here changes your selected supplier or price.</p></div>
      <Button variant="quiet" className="text-xs" disabled={history.isFetching} onClick={() => void history.refetch()} data-testid={`button-refresh-price-history-${row.id}`}><RefreshCw size={13}/>Recheck history</Button>
    </div>
    {history.isLoading ? <p role="status" className="flex items-center gap-2 text-xs"><LoaderCircle size={14} className="animate-spin"/>Checking your private proposal library and past quotations…</p>
      : history.isError ? <p role="alert" className="text-xs text-destructive">{errorText(history.error)} Use Recheck history to retry. Your current price is unchanged.</p>
      : <>
        <p className="text-xs text-muted-foreground">{history.data?.sourcesChecked ?? 0} readable historical sources checked · No AI calls or web searches are used for this comparison.</p>
        {!history.data?.matches.length && <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No matching historical prices found. Add past commercial proposals to the library or complete reading/OCR review for earlier quotations. Prices in unrecognised layouts are not guessed.</p>}
        {history.data?.matches.map(price => <article key={price.id} className="rounded-lg border border-border bg-card p-4" data-testid={`historical-price-${price.id}`}>
          <div className="flex flex-wrap justify-between gap-3">
            <div><p className="text-sm font-bold">{price.item}</p><p className="mt-1 text-xs text-muted-foreground">{price.supplier ? `Supplier: ${price.supplier}` : 'Supplier not stated'}</p></div>
            <div className="text-right"><p className="font-mono text-lg font-bold text-primary">{price.currency ?? 'Currency unknown'} {price.amount.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</p><p className="text-xs text-muted-foreground">{price.priceBasis === 'unit' ? `Historical unit price${price.unit ? ` / ${price.unit}` : ' · unit not stated'}` : 'Historical line total—not a unit price'}</p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2"><Pill tone="amber">Historical · confirm current quote</Pill><Pill tone={price.matchType === 'same_item' ? 'blue' : 'amber'}>{price.matchType === 'same_item' ? 'Matching item/model' : 'Possible match only'}</Pill></div>
          <p className="mt-2 text-xs text-muted-foreground">{price.matchNotes}</p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div><dt className="font-semibold">Source</dt><dd className="mt-0.5">{price.sourceTitle}</dd></div>
            <div><dt className="font-semibold">{price.dateLabel}</dt><dd className="mt-0.5">{price.sourceDate ? new Date(price.sourceDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded—check original'}</dd></div>
            <div><dt className="font-semibold">Historical quantity</dt><dd className="mt-0.5">{price.quantity === null ? 'Not stated' : `${price.quantity} ${price.unit ?? '(unit not stated)'}`}</dd></div>
            <div><dt className="font-semibold">Historical tax basis</dt><dd className="mt-0.5">{price.taxStatus}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-4 text-xs font-semibold text-primary">
            {price.libraryEntryId && <Link href={`/library/${price.libraryEntryId}`} className="underline">Open past proposal</Link>}
            {price.sourceTenderId && <Link href={`/tenders/${price.sourceTenderId}?tab=${price.sourceType === 'past_proposal' ? 'proposals' : 'evidence'}`} className="underline">Open source tender</Link>}
            {price.objectPath && <a href={objectUrl(price.objectPath)} target="_blank" rel="noreferrer" className="underline">Open original document</a>}
          </div>
          <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold">Source pricing text</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/50 p-3 font-sans text-xs">{price.sourceQuote}</pre></details>
        </article>)}
        {!!history.data?.warnings.length && <details className="text-xs text-amber-950"><summary className="cursor-pointer font-semibold">History search notes ({history.data.warnings.length})</summary><ul className="mt-2 list-disc space-y-1 pl-4">{history.data.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>}
      </>}
  </section>;
}
