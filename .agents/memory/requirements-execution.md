---
name: Large tender extraction execution
description: Bound AI work to a single section per request and retain durable checkpoints for larger tenders
---

Requirement extraction must not process an entire large tender in one HTTP request. Each processing request makes at most one bounded provider call; malformed output is divided and saved for later requests, not recursively retried within the same request.

**Why:** Live large-tender extraction was aborted at the five-minute request boundary. Smaller input chunks alone did not solve the problem while every chunk and recovery attempt still ran inside that request.

**How to apply:** Persist completed sections, pending sections and consented job state. Resume through authenticated requests while the tender is open; do not assume background timers keep autoscaled deployments alive. Fence expired attempts, keep source text and internal leases out of public responses, and atomically publish the whole brief and individual requirements only after all sections succeed. Preserve saved human work during failure and retry.

Recovery splits must always advance, with overlap bounded relative to the current chunk size.

**Why:** A fixed large overlap combined with newline alignment can make a small recovery split repeat or move backwards indefinitely. Live extraction then errors without checkpointing progress, even though the server health check passes.

**How to apply:** Include regression cases with newline-aligned recovery-sized inputs, verify full source coverage, and retain completed checkpoints. Bounded batching of small untouched chunks may reduce provider calls, but malformed batches must fall back to the original individual inputs; never relax source grounding or publish partial cards for speed.

User-facing progress counts must say “processing chunks,” not imply a count of the tender’s numbered sections.

**Why:** The user explicitly requested this distinction after comparing the progress count with the tender’s actual section count.

**How to apply:** Treat chunk numbers as processing metadata, not original clause/page references, in both progress messages and model prompts. Keep original tender references available for human review.
