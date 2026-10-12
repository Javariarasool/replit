---
name: Post-merge stale listeners
description: Workflow reconciliation can leave older application processes listening after a merge
---

A failed managed workflow does not necessarily mean its application's port is free.

**Why:** After a merge, older API and web processes survived workflow reconciliation. Replacement workflows failed with address-in-use errors while those older processes remained running.

**How to apply:** Inspect the actual listener and process ancestry before retrying a failed workflow. Stop only the confirmed stale application processes, not all Node processes or the workspace supervisor, then restart the exact artifact-owned workflow once.
