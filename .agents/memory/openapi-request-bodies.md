---
name: Named OpenAPI request bodies
description: A generator export collision to avoid when adding endpoints
---

Use named component schemas for endpoint request bodies instead of inline operation-specific object schemas.

**Why:** In this workspace, inline bodies can cause Orval to generate a TypeScript body type and a Zod body validator with the same exported name. Re-exporting both modules then fails compilation.

**How to apply:** Define the body under `components.schemas`, reference it from the operation, and run code generation before consuming the new hooks or validators.
