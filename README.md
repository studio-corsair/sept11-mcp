# sept11-mcp

An MCP server over the [NYC 9/11 Document Portal](https://sept11documents.cityofnewyork.us/).

On 2026-09-08 the City of New York published roughly 170,000 pages of its own internal
records on the response to September 11th — with an emphasis on Ground Zero air quality
and the health consequences that followed — after settling two lawsuits brought by 9/11
Health Watch. The release includes the "Harding Memo", the 68 boxes of Department of
Environmental Protection records that were not located until 2025 despite repeated FOIL
requests, and records concerning 7 World Trade Center. More records are being published
over the twelve months following launch.

The portal has a search box. This gives an AI agent the same corpus as tools, so it can
search, page, and read full document text directly.

## Tools

| Tool | What it does |
| --- | --- |
| `corpus_overview` | What the collection is, plus a live document count. |
| `search_documents` | Full-text search with agency/box/folder filters, excerpts, and paging. |
| `read_document` | Full OCR'd text of one document by key, with offset paging. |
| `list_agencies` | Sampled enumeration of agency / box / folder values. |

## Install

```bash
npm install
npm run build
```

Add to an MCP client (`claude_desktop_config.json`, `~/.claude.json`, etc.):

```json
{
  "mcpServers": {
    "sept11": {
      "command": "node",
      "args": ["/absolute/path/to/sept11-mcp/dist/index.js"]
    }
  }
}
```

No API key. The portal's search API is unauthenticated.

## Verifying it works

Two live tests, both of which hit the real portal:

```bash
node scripts/smoke.mjs      # the HTTP client layer
node scripts/mcp-smoke.mjs  # end-to-end through a real MCP client over stdio
```

## How it works, and what that cost

The portal runs Mindbreeze InSpire. Its `/api/v2/search` endpoint is open, but the request
format is not documented publicly, and several of its behaviours are silent rather than
loud. What `src/mindbreeze.ts` encodes, so nobody has to rediscover it:

- **The query goes in `user.query.and[]`, not at the top level.** A top-level `query`
  also returns results, which is what makes this easy to get wrong — the two paths
  disagree on result counts because only one of them honours `summarize_by`.
- **Pagination is not a token.** The client echoes back a `result_pages` structure
  describing the page it wants, tied to the `digest` of the query engine that served the
  first page. `scripts/probe-paging2.mjs` shows eight plausible paging mechanisms that
  all silently return page 1.
- **Paging only advances if `summarize_by` and `user_context` are both present**, and
  `user_context.service_id` must be byte-identical to the `service_id` inside the echoed
  cursor. Get it wrong and the server returns page 1 again with HTTP 200. This was found
  by capturing the portal UI's own traffic and deleting one field at a time
  (`scripts/probe-paging3.mjs`).
- **Documents are indexed twice**, once as the source PDF and once as an extracted-text
  twin (`NYC-WTC_000148192.pdf.md`). `summarize_by: {property: 'title'}` collapses the
  pair — which is why the raw index reports ~48,900 documents and this server reports
  ~24,500.
- **There is no get-document endpoint.** Full text is only reachable as the `content`
  property of a search hit, so `read_document` searches for the key and asks for a large
  content sample.
- **Source PDFs are scanned box bundles**, routinely over 300 MB for a single "document".
  The extracted text is the only practical way to read this corpus at scale.

## Caveats worth passing to users

The text is the City's own OCR of scanned paper. Handwriting, stamps, and fax artefacts
transcribe badly. A search returning nothing is weak evidence that a topic is absent —
vary the wording before concluding anything. `list_agencies` samples the corpus rather
than aggregating it, because this deployment does not expose working aggregations; it
says so in its own output.

## License

MIT. The underlying records are public documents released by the City of New York.
