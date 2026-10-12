import { Pill } from '@/components/ui-kit';

export const libraryCategories = [['hardware', 'Hardware'], ['networking', 'Networking'], ['software', 'Software'], ['services', 'Services'], ['mixed', 'Mixed']] as const;
export const libraryOutcomes = [['won', 'Won'], ['lost', 'Lost'], ['rejected', 'Rejected'], ['unknown', 'Unknown']] as const;
export const outcomeLabel = (v: string) => libraryOutcomes.find(([id]) => id === v)?.[1] ?? v;
export const categoryLabel = (v: string) => libraryCategories.find(([id]) => id === v)?.[1] ?? v;
export const objectUrl = (path: string) => `/api/storage${path}`;

export function OutcomePill({ value }: { value: string }) {
  return <Pill tone={value === 'won' ? 'green' : value === 'lost' || value === 'rejected' ? 'red' : 'neutral'}>{outcomeLabel(value)}</Pill>;
}
export const SCAN_NOTE = 'OCR runs locally for scanned PDFs and document images; originals and embedded source text stay unchanged. Review OCR against the original before using it in drafts. No document images are sent to an AI provider.';
