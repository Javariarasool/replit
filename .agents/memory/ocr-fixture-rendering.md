---
name: Multilingual OCR fixture rendering
description: Avoid missing-glyph test images when rendering Urdu and English without system font fallback
---

Register both an Arabic-script font and a Latin font explicitly when generating bilingual OCR fixtures. Inspect the rendered image before treating recognition failures as OCR-engine defects.

**Why:** The workspace's PDF-parser canvas renderer did not provide a reliable Latin fallback for an Arabic-only font. English words rendered as empty glyph boxes, which Tesseract sometimes read as zeros rather than reporting an error. Correct Arabic shaping alone did not make the bilingual fixture valid.

**How to apply:** Use a font with the required glyph coverage for each script, preserve fixture source wording, and visually inspect at least one image. Recognition assertions should check meaningful recovered text and the human-review gate, not assume perfect recovery of every heading or currency label.
