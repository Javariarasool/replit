---
name: Large tender extraction execution
description: Full-tender single-request extraction, assessed-only briefs and safe migration of earlier jobs
---

Use one bounded AI request for the complete supplied tender. Do not silently divide it into processing chunks or recursively retry smaller fragments.

**Why:** The user explicitly requested a return to all-at-once extraction after repeated failures and slow progress with chunking. This supersedes the earlier chunk-based execution decision.

**How to apply:** Include every verified source and its human notes once. Keep the call bounded below the proxy lifetime, fence expired attempts and publish the brief and cards atomically only after complete valid output. On input-capacity, output-truncation or service failure, preserve previous work and require explicit retry rather than silently splitting or dropping text. Do not assume background timers keep autoscaled deployments alive.

Only assessed requirements belong in either the checklist or the requirements brief; general narrative may remain separate in the summary.

**Why:** The user reiterated “just the actual requirements not statements.” A free-form AI brief could still include general statements even when checklist cards were filtered.

**How to apply:** Build the requirements brief from validated assessed items, not free-form model narrative. Preserve exact constraints and source references; keep human review mandatory. Do not drop remaining requirements to fit an arbitrary per-chunk item limit.

Earlier unfinished jobs may switch strategies only against the same already-consented sources. Retain their checkpoints privately until the full replacement succeeds.

**Why:** Changing execution must not erase human work or silently authorize newly uploaded documents.

**How to apply:** Preserve uploads, evidence and the saved human brief; exclude archived source text and internal leases from public responses. Changed sources require a fresh explicit extraction. UI progress must describe the complete-tender attempt, never imply that internal counters are original numbered tender sections.

Treat a complete AI response with a few unsupported assessment quotations differently from an entirely unusable response.

**Why:** An actual full-tender model response was complete, but all-or-nothing quote validation discarded every otherwise grounded requirement when some candidates could not be matched exactly.

**How to apply:** Exclude individual ungrounded candidates with an explicit warning and preserve the supported assessed items. If no assessed candidate can be grounded, fail without replacing the earlier checklist.

Keep full-tender extraction and saved-list filtering as separate, explicitly consented operations.

**Why:** The user confirmed that a previously extracted broad list should be filterable without losing the earlier ability to extract the whole tender. A concise keep/exclude decision over saved items avoids regenerating a very large response.

**How to apply:** Keep OpenAI as the default for full-tender extraction and Claude optional. For filtering, require a decision on every saved candidate and reuse retained card identities, evidence, approvals and vendor choices; preserve excluded cards in storage for human review.
