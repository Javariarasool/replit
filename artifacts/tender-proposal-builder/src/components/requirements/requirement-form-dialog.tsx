import { useState } from 'react';
import { useCreateRequirementItem, useUpdateRequirementItem } from '@workspace/api-client-react';
import type { RequirementDraft, RequirementItem } from '@workspace/api-client-react';
import { Button, Dialog, Field, cn, errorText, inputClass } from '@/components/ui-kit';
import { reqCategories, useRefreshRequirements } from './shared';

export function RequirementFormDialog({ tenderId, row, onClose }: { tenderId: string; row?: RequirementItem; onClose: () => void }) {
  const create = useCreateRequirementItem(); const update = useUpdateRequirementItem(); const refresh = useRefreshRequirements(tenderId);
  const [f, setF] = useState({ title: row?.title ?? '', description: row?.description ?? '', category: row?.category ?? 'technical', sourceReference: row?.sourceReference ?? '', sourceQuote: row?.sourceQuote ?? '', quantity: row?.quantity?.toString() ?? '', unit: row?.unit ?? '', requiresVendor: row?.requiresVendor ?? false });
  const [error, setError] = useState('');
  const pending = create.isPending || update.isPending;
  const submit = () => {
    const q = f.quantity.trim() === '' ? null : Number(f.quantity);
    if (!f.title.trim() || !f.description.trim()) return setError('Title and clause text are required.');
    if (q !== null && !(q > 0)) return setError('Quantity must be greater than zero, or empty.');
    const data: RequirementDraft = { title: f.title.trim(), description: f.description.trim(), category: f.category, sourceReference: f.sourceReference.trim(), sourceQuote: f.sourceQuote.trim(), quantity: q, unit: f.unit.trim() || null, requiresVendor: f.requiresVendor };
    const opts = { onSuccess: () => { refresh(); onClose(); }, onError: (e: unknown) => setError(errorText(e)) };
    if (row) update.mutate({ requirementId: row.id, data }, opts); else create.mutate({ tenderId, data }, opts);
  };
  return <Dialog wide title={row ? 'Edit requirement' : 'Add requirement'} description={row ? 'Changing clause details removes approval and any supplier selection until you review it again.' : 'Record one clause exactly as the tender states it.'} onClose={onClose}>
    <div className="grid gap-4">
      <Field label="Title"><input className={inputClass} value={f.title} maxLength={300} onChange={e => setF({ ...f, title: e.target.value })} data-testid="input-req-title"/></Field>
      <Field label="Clause text"><textarea className={cn(inputClass, 'min-h-28')} value={f.description} maxLength={8000} onChange={e => setF({ ...f, description: e.target.value })} data-testid="textarea-req-description"/></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><select className={inputClass} value={f.category} onChange={e => setF({ ...f, category: e.target.value as RequirementDraft['category'] })}>{reqCategories.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field><Field label="Source reference" hint="Page, section or clause number."><input className={inputClass} value={f.sourceReference} onChange={e => setF({ ...f, sourceReference: e.target.value })}/></Field></div>
      <Field label="Source quote" hint="The exact words from the tender."><textarea className={cn(inputClass, 'min-h-16')} value={f.sourceQuote} maxLength={4000} onChange={e => setF({ ...f, sourceQuote: e.target.value })}/></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Quantity"><input type="number" min="0" step="any" className={inputClass} value={f.quantity} onChange={e => setF({ ...f, quantity: e.target.value })}/></Field><Field label="Unit"><input className={inputClass} value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })}/></Field></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresVendor} onChange={e => setF({ ...f, requiresVendor: e.target.checked })}/>This clause needs a supplied product (vendor research applies)</label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button disabled={pending} onClick={submit} data-testid="button-save-requirement">{pending ? 'Saving...' : row ? 'Save changes' : 'Add requirement'}</Button></div>
    </div>
  </Dialog>;
}
