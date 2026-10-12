import { ExternalLink, TriangleAlert } from 'lucide-react';
import type { Evidence, RequirementItem, SupplierOption } from '@workspace/api-client-react';
import { Button, Pill } from '@/components/ui-kit';
import { objectUrl } from '@/components/library/shared';
import { pkr, safeUrl } from './shared';

const Link = ({ href, children }: { href: string | null; children: string }) => href && safeUrl(href) ? <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-primary underline">{children}<ExternalLink size={11}/></a> : null;

export function OptionCard({ row, option, files, busy, onSelect, onDeselect }: { row: RequirementItem; option: SupplierOption; files: Evidence[]; busy: boolean; onSelect: () => void; onDeselect: () => void }) {
  const selected = row.selectedOptionId === option.id;
  const quote = files.find(f => f.id === option.quoteEvidenceId);
  const subtotal = option.pricePkr !== null && row.quantity ? option.pricePkr * row.quantity : null;
  const unconfirmed = option.deliveryStatus !== 'source_states_pakistan';
  return <article className={`rounded-xl border p-4 text-xs ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`} data-testid={`card-option-${option.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="text-sm font-bold">{option.manufacturer} {option.product}{option.model && ` · ${option.model}`}</p><p className="mt-0.5 text-muted-foreground">Supplier: {option.supplier} {option.supplierUrl && <Link href={option.supplierUrl}>Supplier page</Link>}</p></div>
      <div className="flex flex-wrap gap-1.5"><Pill tone={option.origin === 'web' ? 'blue' : 'neutral'}>{option.origin === 'web' ? 'Web candidate' : 'Manual entry'}</Pill><Pill tone={option.reviewed ? 'green' : 'amber'}>{option.reviewed ? 'Human reviewed' : 'Pending human review'}</Pill>{selected && <Pill tone="green">Selected for proposal</Pill>}</div>
    </div>
    {option.matchSummary && <p className="mt-3 text-sm leading-6">{option.matchSummary}</p>}
    {option.specifications.length > 0 && <div className="mt-3"><p className="font-bold">Stated specifications</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{option.specifications.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
    {option.gaps.length > 0 && <div className="mt-3 rounded-lg bg-amber-900/5 p-3 text-amber-950"><p className="font-bold">Gaps against the clause</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{option.gaps.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <div className={`rounded-lg p-3 ${unconfirmed ? 'bg-rose-900/5 text-rose-950' : 'bg-secondary/50'}`}>
        <p className="flex items-center gap-1.5 font-bold">{unconfirmed && <TriangleAlert size={13}/>}Delivery to Pakistan</p>
        <p className="mt-1">{unconfirmed ? 'Unconfirmed. No source states delivery to Pakistan; check stock and delivery with the supplier.' : 'A source states delivery to Pakistan. Confirm stock and lead time.'}</p>
        {option.deliveryNotes && <p className="mt-1">{option.deliveryNotes}</p>}<p className="mt-1"><Link href={option.deliverySourceUrl}>Delivery source</Link></p>
      </div>
      <div className="rounded-lg bg-secondary/50 p-3" data-testid={`text-price-${option.id}`}>
        <p className="font-bold">Price (PKR only)</p>
        {option.pricePkr === null ? <p className="mt-1 text-sm font-bold">Quote required</p> : <p className="mt-1 text-sm font-bold">{pkr(option.pricePkr, 8)} unit price</p>}
        <p className="mt-1">{option.priceType === 'published' ? 'Published price' : option.priceType === 'quotation' ? 'Supplier quotation' : 'Price not published'} · Tax {option.taxStatus === 'included' ? 'included' : option.taxStatus === 'excluded' ? 'excluded' : 'unknown'} · as of {new Date(option.checkedAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        <p className="mt-1">{subtotal !== null ? `Subtotal for ${row.quantity}${row.unit ? ` ${row.unit}` : ''}: ${pkr(subtotal)}` : 'Subtotal not calculated: price or quantity is unknown.'}</p>
        {option.priceNotes && <p className="mt-1">{option.priceNotes}</p>}
        <p className="mt-1 flex flex-wrap gap-3"><Link href={option.priceSourceUrl}>Price source</Link>{quote && <a className="font-semibold text-primary underline" href={objectUrl(quote.objectPath)} target="_blank" rel="noreferrer">Linked quotation: {quote.name}</a>}</p>
      </div>
    </div>
    {option.sources.length > 0 && <div className="mt-3"><p className="font-bold">Sources</p><ul className="mt-1 space-y-2">{option.sources.map((s, i) => <li key={i}><Link href={s.url}>{s.title || s.url}</Link>{s.quote && <blockquote className="mt-0.5 border-l-2 border-border pl-2 italic text-muted-foreground">{s.quote}</blockquote>}</li>)}</ul></div>}
    {option.datasheetUrl && <p className="mt-3 rounded-lg bg-secondary/50 p-3">Candidate OEM datasheet: <Link href={option.datasheetUrl}>Open datasheet</Link>. Not automatically authenticated; check the exact model, specs, delivery/stock and price, tax and validity yourself.</p>}
    <div className="mt-3 flex justify-end">{selected ? <Button variant="secondary" disabled={busy} onClick={onDeselect} data-testid={`button-deselect-${option.id}`}>Deselect option</Button> : <Button disabled={busy} onClick={onSelect} data-testid={`button-select-${option.id}`}>Review and select</Button>}</div>
  </article>;
}
