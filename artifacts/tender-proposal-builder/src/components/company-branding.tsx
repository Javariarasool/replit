import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { getGetCompanyBrandingQueryKey, useGetCompanyBranding, useRequestUploadUrl, useUpdateCompanyBranding } from '@workspace/api-client-react';
import { Button, Field, PageSkeleton, QueryError, errorText, inputClass } from '@/components/ui-kit';
import { objectUrl } from '@/components/library/shared';

export function CompanyBrandingPanel() {
  const qc = useQueryClient(); const q = useGetCompanyBranding({ query: { queryKey: getGetCompanyBrandingQueryKey() } });
  const save = useUpdateCompanyBranding(); const uploadUrl = useRequestUploadUrl();
  const [name, setName] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  const init = useRef(false); const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (q.data && !init.current) { init.current = true; setName(q.data.companyName); } }, [q.data]);
  if (q.isLoading) return <PageSkeleton/>;
  if (q.isError || !q.data) return <QueryError retry={() => void q.refetch()}/>;
  const b = q.data;
  const commit = async (logoObjectPath: string | null) => { const r = await save.mutateAsync({ data: { companyName: name.trim(), logoObjectPath } }); qc.setQueryData(getGetCompanyBrandingQueryKey(), r); setOk(true); };
  const run = async (fn: () => Promise<void>) => { setErr(''); setOk(false); setBusy(true); try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); } };
  const pick = (file: File) => run(async () => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Logo must be a PNG or JPEG image.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be 2 MB or smaller.');
    let bmp: ImageBitmap; try { bmp = await createImageBitmap(file); } catch { throw new Error('This image could not be read.'); }
    const { width, height } = bmp; bmp.close();
    if (width > 4000 || height > 4000) throw new Error('Logo must be at most 4000 x 4000 pixels.');
    const u = await uploadUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type } });
    const put = await fetch(u.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!put.ok) throw new Error(`Logo upload failed (${put.status}). Your previous logo is unchanged.`);
    await commit(u.objectPath);
  });
  return <section className="mb-6 rounded-xl border border-border bg-card p-5" data-testid="panel-company-branding">
    <p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Export cover</p>
    <h3 className="mt-1 font-[Manrope] text-lg font-bold">Company name & logo</h3>
    <p className="mt-1 text-xs text-muted-foreground">Saved name and logo appear on DOCX and PDF covers. The logo is a private image: it is not evidence and is never sent to AI.</p>
    <div className="mt-4 grid gap-5 md:grid-cols-[200px_1fr]">
      <div className="grid h-28 place-items-center rounded-lg border border-dashed border-border bg-secondary/40 p-2">{b.logoObjectPath ? <img src={objectUrl(b.logoObjectPath)} alt="Company logo preview" className="max-h-full max-w-full object-contain" data-testid="img-logo-preview"/> : <span className="text-xs text-muted-foreground">No logo saved</span>}</div>
      <div className="space-y-3">
        <Field label="Company name"><input className={inputClass} maxLength={200} value={name} onChange={e => { setName(e.target.value); setOk(false); }} data-testid="input-company-name"/></Field>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || name.trim() === b.companyName} onClick={() => void run(() => commit(b.logoObjectPath))} data-testid="button-save-branding">{busy && <LoaderCircle size={14} className="animate-spin"/>}Save name</Button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} data-testid="input-logo-file"/>
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()} data-testid="button-upload-logo"><ImagePlus size={14}/>{b.logoObjectPath ? 'Replace logo' : 'Upload logo'}</Button>
          {b.logoObjectPath && <Button variant="quiet" disabled={busy} onClick={() => void run(() => commit(null))} data-testid="button-remove-logo"><Trash2 size={14}/>Remove logo</Button>}
        </div>
        <p className="text-[11px] text-muted-foreground">PNG or JPEG, up to 2 MB and 4000 x 4000 pixels.</p>
        {err && <p role="alert" className="text-sm text-destructive" data-testid="text-branding-error">{err} <button className="underline" onClick={() => setErr('')}>Dismiss</button></p>}
        {ok && <p role="status" className="text-xs text-emerald-900">Saved.</p>}
      </div>
    </div>
  </section>;
}
