# Placeholder documents — NOT published

The six PDFs in this folder are ~850-byte placeholder stubs generated during
the original site build. Each contains only a title line and the school's
address — no real prospectus, fee, calendar, uniform or handbook content.

They were removed from `public/downloads/` so Vite no longer copies them into
`dist/`, which means they are **not reachable by URL on the live site**. The
homepage document cards now open a request dialog instead (see
`requestDocument()` in `app.js`).

## To publish a real document

1. Replace the stub here with the genuine PDF from the school.
2. Copy it to `public/downloads/<name>.pdf`.
3. In `src/legacyMarkup.js`, change that document's `<button class="download-card">`
   back to `<a href="downloads/<name>.pdf" download>` and drop its
   `<em class="doc-state">` line.
4. Tick it off in `CONTENT-CHECKLIST.md`.
