import { useQueryClient } from '@tanstack/react-query';
import type { RequirementItem, Tender } from '@workspace/api-client-react';
import { getGetTenderQueryKey, getListRequirementItemsQueryKey, getListTenderEvidenceQueryKey, useAddTenderEvidence, useRequestUploadUrl } from '@workspace/api-client-react';
import type { EvidenceInput } from '@workspace/api-client-react';

export const reqCategories = [['technical', 'Technical'], ['eligibility', 'Eligibility'], ['commercial', 'Commercial'], ['submission', 'Submission'], ['delivery', 'Delivery'], ['services', 'Services'], ['other', 'Other']] as const;
export type ReqCategory = typeof reqCategories[number][0];
export const catLabel = (v: string) => reqCategories.find(([id]) => id === v)?.[1] ?? v;
export const pkr = (n: number, precision = 2) => `PKR ${n.toLocaleString('en-PK', { maximumFractionDigits: precision })}`;
export const isStale = (row: RequirementItem, tender: Tender) => row.extractionId !== (tender.requirementsExtraction?.id ?? null);
export const isEvidenced = (row: RequirementItem, files?: { id: string }[]) => row.evidenceIds.some(id => !files || files.some(f => f.id === id)) || row.webEvidence.some(w => w.verified) || row.options.some(o => o.id === row.selectedOptionId && o.reviewed && !!o.datasheetUrl);
export const safeUrl = (u: string) => /^https:\/\//i.test(u);

export function useRefreshRequirements(tenderId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: getListRequirementItemsQueryKey(tenderId) });
    void qc.invalidateQueries({ queryKey: getGetTenderQueryKey(tenderId) });
    void qc.invalidateQueries({ queryKey: getListTenderEvidenceQueryKey(tenderId) });
  };
}

export function useEvidenceUpload(tenderId: string) {
  const uploadUrl = useRequestUploadUrl(); const add = useAddTenderEvidence();
  return async (file: File, category: EvidenceInput['category'], notes: string) => {
    const type = file.type || 'application/octet-stream';
    const url = await uploadUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: type } });
    const put = await fetch(url.uploadURL, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
    if (!put.ok) throw new Error(`File upload failed (${put.status}).`);
    return add.mutateAsync({ tenderId, data: { name: file.name, category, objectPath: url.objectPath, contentType: type, size: file.size, notes } });
  };
}
