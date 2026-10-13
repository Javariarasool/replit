# Local OCR tender fixtures

These are **synthetic government-style tender notices**, not official tenders.
They contain no real bidder data. The Urdu notice covers the Government of
Punjab, education department, tender notice, computer supply, bid deadline and
PKR pricing. The mixed notice pairs Urdu headings with an English reference,
quantity, bid security and deadline.

The PNGs and image-only PDFs deliberately have no embedded text. Both formats
are tested through the same local OCR pipeline used by uploads. They are small
regression inputs, not generated application assets.

To regenerate, download NotoNaskhArabic-Regular.ttf and NotoSans-Regular.ttf from
https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf/NotoNaskhArabic
and the neighboring NotoSans directory (SIL Open Font License), then run:

```sh
node artifacts/api-server/src/lib/fixtures/generate-tender-scans.mjs /path/to/NotoNaskhArabic-Regular.ttf /path/to/NotoSans-Regular.ttf
```

Rendering uses the canvas dependency provided by the installed PDF parser.
The generator records all source wording directly in its fixture definitions.
