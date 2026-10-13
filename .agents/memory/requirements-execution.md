---
name: Large tender extraction execution
description: Bound AI work to a single section per request and retain durable checkpoints for larger tenders
---

Requirement extraction must not process an entire large tender in one HTTP request. Each processing request makes at most one bounded provider call; malformed output is divided and saved for later requests, not recursively retried within the same request.

**Why:** Live large-tender extraction was aborted at the five-minute request boundary. Smaller input chunks alone did not solve the problem while every chunk and recovery attempt still ran inside that request.

**How to apply:** Persist completed sections, pending sections and consented job state. Resume through authenticated requests while the tender is open; do not assume background timers keep autoscaled deployments alive. Fence expired attempts, keep source text and internal leases out of public responses, and atomically publish the whole brief and individual requirements only after all sections succeed. Preserve saved human work during failure and retry.
