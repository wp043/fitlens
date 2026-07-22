# Real-site compatibility fixtures

These are curated, offline snapshots of public fields from official product
pages and metadata APIs. Each fixture records its source URL, capture time, and
fixture schema version. Large descriptions, media, user reviews, maintainer
emails, signatures, and unrelated registry fields are deliberately omitted.

The test suite never refreshes these files or calls the network. A fixture
should be updated only after inspecting the current official source and the
resulting diff. Keep older field shapes represented when they exercise a
compatibility branch; add a new fixture instead of silently rewriting history.

Current sources cover:

- npm registry metadata for Next.js;
- PyPI metadata for Requests;
- Apple lookup metadata for Bear;
- a Chrome Web Store listing excerpt for uBlock Origin;
- official documentation links from cmux and Otty.

The excerpts exist to test parser compatibility, not to archive or republish
third-party pages. The source URL remains the authority for current product
information.
