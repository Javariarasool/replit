---
name: OCR execution budget
description: Native thread contention under the workspace CPU quota can slow recognition and cause avoidable timeouts
---

Bound native OCR parallelism as well as the application's concurrent job count.

**Why:** A small scanned-PDF browser upload hit the recognition deadline although manual OCR worked. Recognizing the same rendered page with a single native thread was more than twice as fast as the engine default under this workspace's CPU quota.

**How to apply:** Keep a controlled per-job thread budget rather than combining multiple application jobs with unbounded engine parallelism. Measure under application load. A recognition timeout must remain an explicit, retryable failure and must never permit unverified partial text into drafting.
