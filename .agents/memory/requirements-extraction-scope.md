---
name: Automatic tender requirements
description: User-requested automatic tender ingestion and human-review boundary
---

The user stated: "tender requirements should be automatically extracted from the tender".

**Why:** The user asked; entering tender clauses manually is not the intended primary workflow.

**How to apply:** Tender/RFP uploads should lead to automatic requirement extraction. Both the requirements brief and individual cards follow the assessed-only scope below; necessary non-assessment context may remain in the separate summary. Keep historical proposal guidance separate from current tender requirements. See [full-tender execution](requirements-execution.md) for the current all-at-once policy.

The user specified: "only the requirements against whom we would be marked should show not any general statement". They confirmed tender compliance checklist items requiring a response.

**Why:** The user wants the Requirements list to reflect bid assessment, not every statement in the tender.

**How to apply:** Create cards only for explicit compliance responses, pass/fail eligibility, scored evaluation criteria and mandatory bid submissions/evidence assessed for responsiveness. Do not treat every "shall" or post-award instruction as an evaluated requirement. Keep general context in the separate summary, not the requirements brief. Preserve excluded historical cards/evidence in storage, but exclude them from the current list and proposal decisions after rebuilding the assessed checklist.

Extraction must not silently overwrite a human's working brief when a new document or amendment is uploaded.

**Why:** Human corrections can contain important interpretations and decisions that an automatic rerun must not discard.

**How to apply:** Preserve the existing working brief, retain an extraction for review, and require an explicit human action before replacing the brief.

All document-driven features must use the shared OCR-capable reading pipeline, including automatic requirements extraction.

**Why:** A digitised PDF can still have no usable text layer. Native-only reading caused a real, small tender upload to fail even though OCR support was being added elsewhere.

**How to apply:** Detect sparse/image-only text and use the shared OCR fallback rather than rejecting the document or treating it as an empty tender. Verify downstream consumers when the reading pipeline changes.

For long tenders, completeness takes priority over automatic deduplication.

**Why:** Similar clauses can contain different quantities or amendments; merging them automatically risks dropping important conditions.

**How to apply:** Process every source section with boundary overlap and keep source references. Retain repetitions with an explicit human-review warning rather than silently sampling or truncating the tender.

The user wants requirements separated individually, with evidence attached to each requirement through uploads or web research. They want automatic OEM datasheet searches, vendor and product options with prices, and a human choice of vendor for proposal building.

**Why:** The user asked for requirement-by-requirement evidence and purchasing decisions rather than a single extracted text brief.

**How to apply:** Preserve clause-level source references and evidence links. Product/vendor comparisons and human selections must belong to the relevant requirement, not just the tender as a whole.

The user specified "suppliers that deliver in pakistan both national and international" and selected Pakistan supplier prices in PKR.

**Why:** The user clarified the supplier market and currency; international OEM list prices do not establish a Pakistan-deliverable supplier quotation.

**How to apply:** Include domestic and international suppliers serving Pakistan. Cite prices and delivery claims, flag missing quotations or unconfirmed delivery, and never invent PKR prices through unsupported currency conversion.

When individual requirements exist, human-reviewed cards and supplier selections govern new drafts; the full brief remains a reference rather than a competing source of quantities or product choices.

**Why:** Two editable versions of the requirements can contradict one another. Clause-level evidence and purchasing decisions must not be overridden by an older paragraph brief.

**How to apply:** Preserve human edits when re-extracting and require review against the current source documents. When importing older tenders, prefer the human-saved brief over an unreviewed extraction.

Linking evidence to a requirement is not proof that its contents establish every required fact. Supplier selection defines the offered configuration, not independently verified compliance.

**Why:** A draft cited a pricing-only quotation for port count and warranty duration it never stated, even while marking those claims unverified. Such citations can mislead reviewers.

**How to apply:** Use actual source contents to support each citation. Keep unsupported technical and warranty claims as explicit gaps; list insufficient linked documents only as received for review.
