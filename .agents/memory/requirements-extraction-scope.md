---
name: Automatic tender requirements
description: User-requested automatic tender ingestion and human-review boundary
---

The user stated: "tender requirements should be automatically extracted from the tender".

**Why:** The user asked; entering tender clauses manually is not the intended primary workflow.

**How to apply:** Tender/RFP uploads should lead to automatic requirement extraction, including administrative and commercial clauses as well as technical specifications. Keep historical proposal guidance separate from current tender requirements.

Extraction must not silently overwrite a human's working brief when a new document or amendment is uploaded.

**Why:** Human corrections can contain important interpretations and decisions that an automatic rerun must not discard.

**How to apply:** Preserve the existing working brief, retain an extraction for review, and require an explicit human action before replacing the brief.

All document-driven features must use the shared OCR-capable reading pipeline, including automatic requirements extraction.

**Why:** A digitised PDF can still have no usable text layer. Native-only reading caused a real, small tender upload to fail even though OCR support was being added elsewhere.

**How to apply:** Detect sparse/image-only text and use the shared OCR fallback rather than rejecting the document or treating it as an empty tender. Verify downstream consumers when the reading pipeline changes.

For long tenders, completeness takes priority over automatic deduplication.

**Why:** Similar clauses can contain different quantities or amendments; merging them automatically risks dropping important conditions.

**How to apply:** Process every source section with boundary overlap and keep source references. Retain repetitions with an explicit human-review warning rather than silently sampling or truncating the tender.
