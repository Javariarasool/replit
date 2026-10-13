---
name: Extraction cancellation
description: Cancellation must remain explicit across language changes and native process cleanup
---

Cancelled readings require an explicit retry, even when the caller selects a different recognition language.

**Why:** Merely loading a document or changing a language must not undo the user's decision to stop processing their saved original.

**How to apply:** Keep cancellation terminal until a retry action creates a new attempt. Target cancellation at the attempt rather than the document so delayed requests cannot cancel a later retry.

Native cancellation must wait for process exit before deleting temporary inputs or freeing a worker slot.

**Why:** Node's built-in child-process abort can reject before the process closes; cleanup at that point races the still-running native reader.

**How to apply:** Terminate the direct OCR process and wait for completion. Keep database publication fenced independently of the stop signal, including across API processes.
