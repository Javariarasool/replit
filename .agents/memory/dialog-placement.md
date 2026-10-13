---
name: Viewport-level consent dialogs
description: Animated long pages must not become containing blocks for consent overlays
---

Render viewport-level dialogs through a portal outside animated page containers.

**Why:** The entrance animation retains a transform even after finishing. A fixed consent overlay rendered inside the long tender page was positioned relative to that page, placing its contents outside the viewport. Approval and research consequently never reached the server.

**How to apply:** Keep overlays attached to the document body rather than inline under animated pages. Check consent on a long, scrolled requirements list, not just a short page. Keep explicit AI consent and make the resulting progress, candidates, and errors visible.
