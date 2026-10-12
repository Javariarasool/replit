---
name: Live web research response mode
description: Provider restriction when combining live web search with JSON output
---

The current Replit OpenAI proxy rejects live web search combined with strict JSON response mode.

**Why:** A real supplier-search request returned “Web Search cannot be used with JSON mode.” Ordinary non-search drafting with JSON mode still worked.

**How to apply:** For live search, request JSON through the instructions and validate the returned structure locally. Continue grounding URLs in actual provider search/citation metadata and require human review; removing JSON mode must not weaken source validation.
