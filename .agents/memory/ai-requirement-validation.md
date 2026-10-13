---
name: AI requirement validation
description: Optional purchase counts must not discard a complete tender extraction
---

Treat invalid or non-positive AI purchase quantities as unknown, preserve the clause and its source quote, and add a human-review warning. Keep manually entered purchase counts strictly positive.

**Why:** A model returned a non-positive quantity in one administrative/contract section. Strict validation rejected the entire brief and every individual requirement, although the PDF had been read successfully.

**How to apply:** Normalize only the AI output boundary; never guess a replacement quantity, remove the clause, or interpret unknown quantities as zero-priced totals. Mandatory clause fields still require validation. Invalid or incomplete model sections may be retried with smaller overlapping sections, not silently omitted.
