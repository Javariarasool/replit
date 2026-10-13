---
name: Production document reading
description: Native dependencies and repeated graphics can block otherwise readable tenders
---

Do not assume utilities available in the workspace are included in a published app. Declare PDF command-line utilities explicitly and validate native OCR dependencies during production builds.

**Why:** Published imports failed because the Poppler library dependency did not supply the PDF utility commands, although local reading worked. Cached infrastructure failures then kept readable PDFs blocked.

**How to apply:** Preserve the explicit poppler-utils and Tesseract dependencies, build-time tool validation, and production binary-path resolution. Allow old missing-tool failures to be reprocessed without replacing uploads; never automatically reset human-verified OCR.

Raster pixel dimensions or physical coverage alone do not identify a scanned page. Repeated image objects across genuinely readable pages can be logos or watermarks.

**Why:** A 257-page digitized tender had a large reused watermark on nearly every page. Both pixel-size and area-only heuristics misclassified it as hundreds of scans.

**How to apply:** Keep repeated-graphic detection alongside sparse-text and substantial-image checks. Apply the OCR page limit to pages requiring recognition, not the document's total page count. Genuine scans must still require human verification.
