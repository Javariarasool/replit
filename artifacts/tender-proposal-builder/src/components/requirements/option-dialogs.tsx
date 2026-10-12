import { useState } from 'react';
import { useAddRequirementSupplierOption, useSelectRequirementSupplier } from '@workspace/api-client-react';
import type { Evidence, RequirementItem, SupplierOption, SupplierOptionInput } from '@workspace/api-client-react';
import { Button, Dialog, Field, cn, errorText, inputClass } from '@/components/ui-kit';
import { useEvidenceUpload, useRefreshRequirements } from './shared';

const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean);
const nul = (s: string) => s.trim() || null;

export function SelectDialog({ row, option, onClose }: { row: RequirementItem; option: SupplierOption; onClose: () => void }) {
  const select = useSelectRequirementSupplier(); const refresh = useRefreshRequirements(row.tenderId);
  const [c, setC] = useState([false, false, false, false]);
  const items = ['I opened the sources and checked them against the clause.', 'I checked the exact model and specifications against the requirement (the datasheet is not authenticated automatically).', 'I checked delivery to Pakistan and stock with a source or the supplier.', 'I checked the PKR price, tax status and quote validity.'];
  return <Dialog title="Select supplier option" description={`${option.manufacturer} ${option.product} for "${row.title}"`} onClose={onClose}>
    <div className="space-y-3 text-sm">{items.map((t, i) => <label key={i} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={c[i]} onChange={e => setC(c.map((v, j) => j === i ? e.target.checked : v))} data-testid={`checkbox-attest-${i}`}/>{t}</label>)}
      <p className="text-xs text-muted-foreground">Selecting marks this option as human reviewed and it is used when proposals are built. Nothing is selected automatically.</p>
      {select.isError && <p className="text-destructive">{errorText(select.error)}</p>}
      <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button disabled={!c.every(Boolean) || select.isPending} onClick={() => select.mutate({ requirementId: row.id, data: { optionId: option.id, confirmed: true } }, { onSuccess: () => { refresh(); onClose(); } })} data-testid="button-confirm-select">{select.isPending ? 'Saving...' : 'Confirm selection'}</Button></div></div>
  </Dialog>;
}

type Src = { url: string; title: string; quote: string };
export function ManualOptionDialog({ row, files, onClose }: { row: RequirementItem; files: Evidence[]; onClose: () => void }) {
  const add = useAddRequirementSupplierOption(); const refresh = useRefreshRequirements(row.tenderId); const upload = useEvidenceUpload(row.tenderId);
  const [f, setF] = useState({ manufacturer: '', product: '', model: '', supplier: '', supplierUrl: '', datasheetUrl: '', matchSummary: '', specs: '', gaps: '', deliveryStatus: 'unconfirmed' as SupplierOptionInput['deliveryStatus'], deliverySourceUrl: '', deliveryNotes: '', price: '', priceSourceUrl: '', quoteEvidenceId: '', priceType: 'not_published' as SupplierOptionInput['priceType'], taxStatus: 'unknown' as SupplierOptionInput['taxStatus'], priceNotes: '' });
  const [sources, setSources] = useState<Src[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [extra, setExtra] = useState<Evidence[]>([]);
  const set = (k: keyof typeof f, v: string) => setF(o => ({ ...o, [k]: v }));
  const quotes = [...files, ...extra.filter(e => !files.some(x => x.id === e.id))].filter(x => x.category === 'vendor_quote');
  const submit = () => {
    const price = f.price.trim() === '' ? null : Number(f.price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) return setError('Enter a valid PKR price or leave it empty if a quote is required.');
    if (price !== null && !f.priceSourceUrl.trim() && !f.quoteEvidenceId) return setError('A price needs a cited price URL or a linked quotation.');
    if (!f.product.trim() || !f.supplier.trim()) return setError('Product and supplier are required.');
    setError('');
    const data: SupplierOptionInput = { manufacturer: f.manufacturer.trim(), product: f.product.trim(), model: f.model.trim(), supplier: f.supplier.trim(), supplierUrl: nul(f.supplierUrl), datasheetUrl: nul(f.datasheetUrl), specifications: lines(f.specs), matchSummary: f.matchSummary.trim(), gaps: lines(f.gaps), deliveryStatus: f.deliveryStatus, deliverySourceUrl: nul(f.deliverySourceUrl), deliveryNotes: f.deliveryNotes.trim(), pricePkr: price, priceSourceUrl: nul(f.priceSourceUrl), quoteEvidenceId: f.quoteEvidenceId || null, priceType: f.priceType, taxStatus: f.taxStatus, priceNotes: f.priceNotes.trim(), sources: sources.filter(s => s.url.trim()).map(s => ({ url: s.url.trim(), title: s.title.trim(), quote: s.quote.trim() })) };
    add.mutate({ requirementId: row.id, data }, { onSuccess: () => { refresh(); onClose(); } });
  };
  const uploadQuote = async (file?: File) => { if (!file) return; setBusy(true); setError(''); try { const ev = await upload(file, 'vendor_quote', `Quotation for requirement: ${row.title}`); setExtra(x => [...x, ev]); set('quoteEvidenceId', ev.id); refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const t = (label: string, k: keyof typeof f, hint?: string) => <Field label={label} hint={hint}><input className={inputClass} value={f[k]} onChange={e => set(k, e.target.value)}/></Field>;
  return <Dialog wide title="Add supplier option or quotation" description="Enter a supplier that delivers in Pakistan. Prices are PKR only; leave the price empty when a quote is required." onClose={onClose}>
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">{t('Manufacturer', 'manufacturer')}{t('Product *', 'product')}{t('Model', 'model')}</div>
      <div className="grid gap-4 sm:grid-cols-2">{t('Supplier *', 'supplier')}{t('Supplier URL', 'supplierUrl')}{t('Datasheet URL', 'datasheetUrl', 'Candidate OEM source only.')}</div>
      <Field label="Match summary"><textarea className={cn(inputClass, 'min-h-16')} value={f.matchSummary} onChange={e => set('matchSummary', e.target.value)}/></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Specifications" hint="One per line."><textarea className={cn(inputClass, 'min-h-20')} value={f.specs} onChange={e => set('specs', e.target.value)}/></Field><Field label="Gaps" hint="One per line."><textarea className={cn(inputClass, 'min-h-20')} value={f.gaps} onChange={e => set('gaps', e.target.value)}/></Field></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Delivery to Pakistan"><select className={inputClass} value={f.deliveryStatus} onChange={e => set('deliveryStatus', e.target.value)}><option value="unconfirmed">Unconfirmed</option><option value="source_states_pakistan">A source states Pakistan delivery</option></select></Field>{t('Delivery source URL', 'deliverySourceUrl')}</div>
      <Field label="Delivery notes"><input className={inputClass} value={f.deliveryNotes} onChange={e => set('deliveryNotes', e.target.value)}/></Field>
      <div className="grid gap-4 sm:grid-cols-3"><Field label="Unit price (PKR)" hint="Empty = quote required."><input type="number" min="0" step="any" className={inputClass} value={f.price} onChange={e => set('price', e.target.value)} data-testid="input-option-price"/></Field><Field label="Price type"><select className={inputClass} value={f.priceType} onChange={e => set('priceType', e.target.value)}><option value="not_published">Not published</option><option value="published">Published</option><option value="quotation">Quotation</option></select></Field><Field label="Tax"><select className={inputClass} value={f.taxStatus} onChange={e => set('taxStatus', e.target.value)}><option value="unknown">Unknown</option><option value="included">Included</option><option value="excluded">Excluded</option></select></Field></div>
      <div className="grid gap-4 sm:grid-cols-2">{t('Price source URL', 'priceSourceUrl')}<Field label="Linked quotation" hint="Choose or upload a vendor quote."><select className={inputClass} value={f.quoteEvidenceId} onChange={e => set('quoteEvidenceId', e.target.value)}><option value="">None</option>{quotes.map(q => <option key={q.id} value={q.id}>{q.name}</option>)}</select></Field></div>
      <Field label="Upload a quotation file"><input type="file" disabled={busy} className={inputClass} onChange={e => void uploadQuote(e.target.files?.[0])}/></Field>
      <Field label="Price notes (validity, terms)"><input className={inputClass} value={f.priceNotes} onChange={e => set('priceNotes', e.target.value)}/></Field>
      <div><p className="text-sm font-semibold">Sources</p>{sources.map((s, i) => <div key={i} className="mt-2 grid gap-2 sm:grid-cols-3"><input aria-label="Source URL" placeholder="URL" className={inputClass} value={s.url} onChange={e => setSources(sources.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}/><input aria-label="Source title" placeholder="Title" className={inputClass} value={s.title} onChange={e => setSources(sources.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}/><input aria-label="Source quote" placeholder="Quote" className={inputClass} value={s.quote} onChange={e => setSources(sources.map((x, j) => j === i ? { ...x, quote: e.target.value } : x))}/></div>)}<Button variant="quiet" className="mt-2 text-xs" onClick={() => setSources([...sources, { url: '', title: '', quote: '' }])}>Add source</Button></div>
      {(error || add.isError) && <p className="text-sm text-destructive" role="alert">{error || errorText(add.error)}</p>}
      <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button disabled={add.isPending || busy} onClick={submit} data-testid="button-save-option">{add.isPending ? 'Saving...' : 'Save option'}</Button></div>
    </div>
  </Dialog>;
}
