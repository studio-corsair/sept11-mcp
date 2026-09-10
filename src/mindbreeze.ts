/**
 * Client for the NYC 9/11 Document Portal.
 *
 * The portal (sept11documents.cityofnewyork.us) runs Mindbreeze InSpire. Its
 * /api/v2/search endpoint is unauthenticated. The request shape below was lifted
 * from the portal's own UI traffic — notably the query belongs in `user.query.and[]`,
 * not at the top level, and paging is done by echoing back the `order` cursor from
 * `resultset.result_pages.pages[n]`.
 *
 * The indexed documents are Markdown conversions of the source PDFs (the City ran
 * its own OCR pipeline; filenames come back as `NYC-WTC_000148192.pdf.md`), so the
 * `content` property gives clean text rather than a scanned image.
 */

export const PORTAL_BASE = 'https://sept11documents.cityofnewyork.us';
const SEARCH_URL = `${PORTAL_BASE}/api/v2/search`;

/**
 * The server ties a paging cursor to the `service_id` that issued the first page,
 * so this string must be byte-identical between `user_context` and the echoed
 * `result_pages.qeng_ids`. Paging silently returns page 1 again if they disagree —
 * it does not error.
 */
const SERVICE_ID = `${PORTAL_BASE}/api/v2/`;

/** Required for paging to advance at all; omitting it re-serves page 1. */
const USER_CONTEXT = {
  locale: 'en-US',
  service_id: SERVICE_ID,
  service_url: SEARCH_URL,
  utc_time_zone_differential_in_seconds: 0,
};

/** Source PDFs are scanned box bundles — hundreds of MB each. Never inline one. */
export const PDF_SIZE_WARNING_BYTES = 25 * 1024 * 1024;

export interface DocumentHit {
  /** Stable document key, e.g. `NYC-WTC_000148192_MD`. Use with `readDocument`. */
  key: string;
  title: string;
  agency?: string;
  boxName?: string;
  boxId?: string;
  folderName?: string;
  /** Bytes of the source PDF this text was extracted from. Often enormous. */
  pdfSizeBytes?: number;
  date?: string;
  /** Text around the query match, with <em> highlights stripped. */
  excerpt?: string;
  relevance?: number;
}

export interface SearchResult {
  /** Portal's estimate of total matches — not a guaranteed exact count. */
  estimatedTotal: number;
  hits: DocumentHit[];
  /** Opaque cursor for the next page; undefined when exhausted. */
  nextCursor?: string;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  cursor?: string;
  agency?: string;
  boxName?: string;
  folderName?: string;
  excerptLength?: number;
}

interface MbValue {
  str?: string;
  num?: number;
  [k: string]: unknown;
}
interface MbDatum {
  value?: MbValue;
  html?: string;
  properties?: MbProperty[];
}
interface MbProperty {
  id: string;
  name?: string;
  data?: MbDatum[];
}
interface MbResult {
  id: string;
  relevance_score?: number;
  properties?: MbProperty[];
}
interface MbPage {
  page_number: number;
  starts?: number[];
  counts?: number[];
  order?: { num: number };
  order_range?: number[];
}
interface MbQengId {
  service_id?: string;
  qeng_id?: string;
  digest?: string;
}
interface MbResponse {
  estimated_count?: number;
  status_messages?: { id: string; info?: string }[];
  resultset?: {
    results?: MbResult[];
    next_avail?: boolean;
    more_avail?: boolean;
    result_pages?: { pages?: MbPage[]; qeng_ids?: MbQengId[] };
  };
}

/**
 * Everything needed to ask for the *next* page. Mindbreeze has no opaque
 * continuation token — the client is expected to echo back a `result_pages`
 * structure describing the page it wants, keyed to the query engine that served
 * the first page (`digest`). We serialise that into one base64 string so callers
 * see an ordinary cursor.
 */
interface Cursor {
  digest: string;
  qengId: string;
  pageNumber: number;
  start: number;
  count: number;
  orderRange: number[];
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new Error(`Invalid cursor. Pass back the exact \`nextCursor\` string from a previous search.`);
  }
  const c = parsed as Partial<Cursor>;
  if (typeof c.digest !== 'string' || typeof c.pageNumber !== 'number' || typeof c.start !== 'number') {
    throw new Error(`Invalid cursor payload. Pass back the exact \`nextCursor\` string from a previous search.`);
  }
  return {
    digest: c.digest,
    qengId: c.qengId ?? 'https://localhost:23301',
    pageNumber: c.pageNumber,
    start: c.start,
    count: c.count ?? 10,
    orderRange: c.orderRange ?? [],
  };
}

const PROPERTIES = [
  { name: 'mes:key', formats: ['VALUE'] },
  { name: 'title', formats: ['VALUE'] },
  { name: 'agency', formats: ['VALUE'] },
  { name: 'box_name', formats: ['VALUE'] },
  { name: 'box_id', formats: ['VALUE'] },
  { name: 'folder_name', formats: ['VALUE'] },
  { name: 'mes:date', formats: ['VALUE'] },
  { name: 'pdf_size', formats: ['VALUE'] },
  { name: 'content', formats: ['HTML'] },
];

function prop(result: MbResult, id: string): MbDatum | undefined {
  return result.properties?.find((p) => p.id === id)?.data?.[0];
}

function str(result: MbResult, id: string): string | undefined {
  const v = prop(result, id)?.value?.str;
  return v && v.length > 0 ? v : undefined;
}

function num(result: MbResult, id: string): number | undefined {
  return prop(result, id)?.value?.num;
}

/**
 * Mindbreeze returns excerpts as HTML with <em> around matched terms and long runs
 * of underscores where the OCR hit ruled form lines. Both are noise to a model.
 */
export function cleanExcerpt(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<\/?em>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[_\s]*_[_\s]{6,}/g, ' … ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Mindbreeze's query parser treats `:` and quotes specially. Values coming from a
 * model can contain either (agency names include commas and periods), so quote and
 * escape rather than interpolating raw.
 */
function fieldConstraint(field: string, value: string): { unparsed: string } {
  return { unparsed: `${field}:"${value.replace(/"/g, '\\"')}"` };
}

async function post(body: unknown): Promise<MbResponse> {
  const response = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `9/11 portal search failed: HTTP ${response.status}. ` +
        `The portal is a live City service and may be rate-limiting or down. ` +
        `Response: ${text.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(text) as MbResponse;
  } catch {
    throw new Error(`9/11 portal returned non-JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
}

function buildRequest(opts: {
  query: string;
  count: number;
  excerptLength: number;
  constraints: { unparsed: string }[];
  cursor?: Cursor;
}) {
  const cursor = opts.cursor;
  return {
    name: 'sept11search',
    count: opts.count,
    max_page_count: 10,
    content_sample_length: opts.excerptLength,
    properties: PROPERTIES,
    user: {
      query: { and: [{ unparsed: opts.query, id: 'query' }] },
      constraints: opts.constraints,
    },
    paging_states: [],
    path: 'search',
    user_context: USER_CONTEXT,
    // Paging only advances when results are summarised; without this the server
    // re-serves page 1. It also collapses the duplicate `_MD` / source-PDF entries.
    summarize_by: { property: 'title' },
    ...(cursor
      ? {
          query_context_effective_client_result_page: cursor.pageNumber,
          result_pages: {
            qeng_ids: [
              {
                service_id: SERVICE_ID,
                qeng_id: cursor.qengId,
                digest: cursor.digest,
              },
            ],
            pages: [
              {
                starts: [cursor.start],
                counts: [cursor.count],
                page_number: cursor.pageNumber,
                page: cursor.pageNumber + 1,
                original_page_numbers: [cursor.pageNumber],
                order_range: cursor.orderRange,
                current_page: true,
              },
            ],
            page_size: cursor.count,
            page_count: 10,
            more_avail: true,
            onFirstPage: cursor.pageNumber === 0,
            onLastPage: false,
          },
        }
      : {}),
  };
}

function toHit(result: MbResult): DocumentHit {
  const timestamp = num(result, 'mes:date');
  return {
    key: str(result, 'mes:key') ?? result.id,
    title: str(result, 'title') ?? '(untitled)',
    agency: str(result, 'agency'),
    boxName: str(result, 'box_name'),
    boxId: str(result, 'box_id'),
    folderName: str(result, 'folder_name'),
    pdfSizeBytes: num(result, 'pdf_size'),
    date: timestamp ? new Date(timestamp).toISOString().slice(0, 10) : undefined,
    excerpt: cleanExcerpt(prop(result, 'content')?.html),
    relevance: result.relevance_score,
  };
}

export async function search(opts: SearchOptions): Promise<SearchResult> {
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const constraints: { unparsed: string }[] = [];
  if (opts.agency) constraints.push(fieldConstraint('agency', opts.agency));
  if (opts.boxName) constraints.push(fieldConstraint('box_name', opts.boxName));
  if (opts.folderName) constraints.push(fieldConstraint('folder_name', opts.folderName));

  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;

  const json = await post(
    buildRequest({
      query: opts.query,
      count: limit,
      excerptLength: opts.excerptLength ?? 400,
      constraints,
      cursor,
    }),
  );

  const results = json.resultset?.results ?? [];
  const resultPages = json.resultset?.result_pages;
  const pages = resultPages?.pages ?? [];
  const digest = resultPages?.qeng_ids?.[0]?.digest;
  const qengId = resultPages?.qeng_ids?.[0]?.qeng_id ?? 'https://localhost:23301';

  // The page we are currently on, as the server numbers them.
  const currentPageNumber = cursor?.pageNumber ?? 0;
  const next = pages.find((p) => p.page_number === currentPageNumber + 1);

  let nextCursor: string | undefined;
  if (results.length > 0 && next && digest && next.starts?.[0] !== undefined) {
    nextCursor = encodeCursor({
      digest,
      qengId,
      pageNumber: next.page_number,
      start: next.starts[0],
      count: next.counts?.[0] ?? limit,
      orderRange: next.order_range ?? (next.order ? [next.order.num, next.order.num] : []),
    });
  }

  return {
    estimatedTotal: json.estimated_count ?? 0,
    hits: results.map(toHit),
    nextCursor,
  };
}

export interface DocumentText {
  key: string;
  title: string;
  agency?: string;
  boxName?: string;
  folderName?: string;
  pdfSizeBytes?: number;
  text: string;
  /** True when the portal returned less than we asked for, i.e. this is the whole document. */
  complete: boolean;
}

/**
 * Fetch a document's full extracted text by key.
 *
 * There is no "get document" endpoint — the text is only reachable as the `content`
 * property of a search hit, so we search for the key itself and ask for a large
 * content sample.
 */
export async function readDocument(key: string, maxChars = 200_000): Promise<DocumentText> {
  const json = await post(
    buildRequest({
      query: '*',
      count: 1,
      excerptLength: maxChars,
      constraints: [fieldConstraint('mes:key', key)],
    }),
  );

  const result = json.resultset?.results?.[0];
  if (!result) {
    throw new Error(
      `No document with key "${key}". Keys look like NYC-WTC_000148192_MD and come from the ` +
        `\`key\` field of search results.`,
    );
  }

  const text = cleanExcerpt(prop(result, 'content')?.html) ?? '';
  return {
    key: str(result, 'mes:key') ?? key,
    title: str(result, 'title') ?? '(untitled)',
    agency: str(result, 'agency'),
    boxName: str(result, 'box_name'),
    folderName: str(result, 'folder_name'),
    pdfSizeBytes: num(result, 'pdf_size'),
    text,
    complete: text.length < maxChars,
  };
}

/**
 * Enumerate the distinct values of a metadata field (agency, box_name, folder_name)
 * by sampling documents.
 *
 * This build of the portal does not expose working aggregations, so the values are
 * derived from a sample rather than from the index. The caller is told the sample
 * size so it never presents this as an exhaustive list.
 */
export async function sampleFieldValues(
  field: 'agency' | 'box_name' | 'folder_name',
  sampleSize = 400,
): Promise<{ values: { value: string; seen: number }[]; sampled: number; corpusTotal: number }> {
  const counts = new Map<string, number>();
  let sampled = 0;
  let corpusTotal = 0;
  let cursor: string | undefined;

  const pageSize = 50;
  const pages = Math.ceil(sampleSize / pageSize);
  for (let i = 0; i < pages; i++) {
    const page: SearchResult = await search({
      query: '*',
      limit: pageSize,
      cursor,
      excerptLength: 1,
    });
    corpusTotal = page.estimatedTotal;
    for (const hit of page.hits) {
      sampled++;
      const value =
        field === 'agency' ? hit.agency : field === 'box_name' ? hit.boxName : hit.folderName;
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    if (!page.nextCursor || page.hits.length === 0) break;
    cursor = page.nextCursor;
  }

  return {
    values: [...counts.entries()]
      .map(([value, seen]) => ({ value, seen }))
      .sort((a, b) => b.seen - a.seen),
    sampled,
    corpusTotal,
  };
}

/** Human-facing links for a document, so a claim can carry its receipt. */
export function documentLinks(key: string): { portalSearch: string; note: string } {
  return {
    portalSearch: `${PORTAL_BASE}/?query=${encodeURIComponent(key.replace(/_MD$/, ''))}`,
    note:
      'The portal has no per-document permalink; this link runs a search for the document ID. ' +
      'Source PDFs are scanned box bundles and can exceed 300 MB, so download from the portal UI rather than inline.',
  };
}

export async function corpusStats(): Promise<{ totalDocuments: number }> {
  const page = await search({ query: '*', limit: 1, excerptLength: 1 });
  return { totalDocuments: page.estimatedTotal };
}
