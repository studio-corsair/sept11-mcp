#!/usr/bin/env node
/**
 * sept11-mcp — an MCP server over the NYC 9/11 Document Portal.
 *
 * On 2026-09-08 the City of New York published ~170,000 pages (~48,900 indexed
 * documents, ~24,500 after de-duplication) of internal records on the post-9/11
 * response, with an emphasis on Ground Zero air quality and the health effects that
 * followed. This server puts that corpus behind MCP tools so an agent can search and
 * read it directly instead of clicking through a search UI.
 *
 * More records are being released over the twelve months following launch, so
 * counts returned here are point-in-time.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  PORTAL_BASE,
  PDF_SIZE_WARNING_BYTES,
  corpusStats,
  documentLinks,
  readDocument,
  sampleFieldValues,
  search,
  type DocumentHit,
} from './mindbreeze.js';

const CORPUS_CONTEXT = `The corpus is the City of New York's own internal records — memos, faxes, air and \
dust sampling results, inspection reports, contractor correspondence — released via the \
9/11 Document Portal on 2026-09-08 after litigation by 9/11 Health Watch. It includes the \
"Harding Memo", the 68 boxes of Department of Environmental Protection records that were not \
located until 2025 despite repeated FOIL requests, and records concerning 7 World Trade Center. \
Text comes from the City's own OCR of scanned documents, so expect transcription errors, \
partial lines, and fax headers.`;

const server = new McpServer({ name: 'sept11-mcp', version: '0.1.0' });

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return 'unknown size';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHit(hit: DocumentHit, index: number): string {
  const trail = [hit.agency, hit.boxName, hit.folderName].filter(Boolean).join(' › ');
  const lines = [
    `${index}. ${hit.title}`,
    `   key: ${hit.key}`,
    trail ? `   ${trail}` : undefined,
    hit.date ? `   indexed: ${hit.date}` : undefined,
    hit.pdfSizeBytes !== undefined ? `   source PDF: ${formatBytes(hit.pdfSizeBytes)}` : undefined,
    hit.excerpt ? `   ${hit.excerpt.replace(/\n+/g, ' ').slice(0, 500)}` : undefined,
  ];
  return lines.filter(Boolean).join('\n');
}

server.registerTool(
  'search_documents',
  {
    title: 'Search the NYC 9/11 document corpus',
    description:
      `Full-text search across the City of New York's released September 11th records. ` +
      `Returns matching documents with their agency/box/folder provenance and a text excerpt ` +
      `around the match. Use the returned \`key\` with read_document to get the full text.\n\n` +
      `${CORPUS_CONTEXT}\n\n` +
      `Search tips: the index supports quoted phrases ("no asbestos detected") and boolean ` +
      `operators (AND, OR, NOT). Because the text is OCR'd, try several spellings and synonyms ` +
      `before concluding something is absent — an absence of hits is weak evidence.`,
    inputSchema: {
      query: z
        .string()
        .min(1)
        .describe('Search terms. Supports quoted phrases and AND/OR/NOT. Use * to match everything.'),
      limit: z.number().int().min(1).max(50).default(10).describe('Results per page (1-50).'),
      cursor: z
        .string()
        .optional()
        .describe('Pass the `nextCursor` from a previous call to get the following page.'),
      agency: z
        .string()
        .optional()
        .describe('Restrict to one agency, e.g. "Environmental Protection, Dept. of". Must match exactly.'),
      boxName: z.string().optional().describe('Restrict to one archive box, e.g. "DEP Box 10".'),
      folderName: z.string().optional().describe('Restrict to one folder, e.g. "AIR ASBESTOS MONITORING REPORTS".'),
      excerptLength: z
        .number()
        .int()
        .min(100)
        .max(5000)
        .default(400)
        .describe('Characters of surrounding text to return per hit.'),
    },
  },
  async ({ query, limit, cursor, agency, boxName, folderName, excerptLength }) => {
    const result = await search({ query, limit, cursor, agency, boxName, folderName, excerptLength });

    if (result.hits.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text:
              `No documents matched ${JSON.stringify(query)}` +
              `${agency ? ` in agency ${JSON.stringify(agency)}` : ''}.\n\n` +
              `The text is OCR'd from scanned paper, so a zero-result search is weak evidence of absence. ` +
              `Try a shorter phrase, an alternative spelling, or drop the filters.`,
          },
        ],
      };
    }

    const filters = [
      agency ? `agency=${agency}` : undefined,
      boxName ? `box=${boxName}` : undefined,
      folderName ? `folder=${folderName}` : undefined,
    ].filter(Boolean);

    const header =
      `~${result.estimatedTotal.toLocaleString()} documents match ${JSON.stringify(query)}` +
      `${filters.length ? ` (${filters.join(', ')})` : ''}. Showing ${result.hits.length}.`;

    const body = result.hits.map((hit, i) => formatHit(hit, i + 1)).join('\n\n');
    const footer = result.nextCursor
      ? `\n\nMore results available. Call again with cursor: ${result.nextCursor}`
      : '\n\nNo further pages.';

    return { content: [{ type: 'text', text: `${header}\n\n${body}${footer}` }] };
  },
);

server.registerTool(
  'read_document',
  {
    title: 'Read the full text of one document',
    description:
      `Fetch the complete OCR'd text of a single document by its key (from search_documents). ` +
      `Documents are scanned box bundles and can run to hundreds of thousands of characters, so ` +
      `use offset/maxChars to page through long ones rather than pulling everything at once.\n\n` +
      `The text is the City's own OCR output. Handwriting, stamps, and fax artefacts transcribe ` +
      `poorly — quote cautiously and check the source PDF on the portal before relying on an exact wording.`,
    inputSchema: {
      key: z
        .string()
        .min(1)
        .describe('Document key from a search result, e.g. "NYC-WTC_000148192_MD".'),
      offset: z.number().int().min(0).default(0).describe('Character offset to start from.'),
      maxChars: z
        .number()
        .int()
        .min(500)
        .max(100_000)
        .default(20_000)
        .describe('Maximum characters to return in this call.'),
    },
  },
  async ({ key, offset, maxChars }) => {
    // Pull generously so `offset` can address deep into a long document, but cap the
    // slice we actually return so a single call cannot flood the context window.
    const doc = await readDocument(key, Math.max(offset + maxChars, 50_000));
    const slice = doc.text.slice(offset, offset + maxChars);
    const trail = [doc.agency, doc.boxName, doc.folderName].filter(Boolean).join(' › ');
    const links = documentLinks(doc.key);

    const oversizedPdf =
      doc.pdfSizeBytes !== undefined && doc.pdfSizeBytes > PDF_SIZE_WARNING_BYTES
        ? `\nSource PDF is ${formatBytes(doc.pdfSizeBytes)} — a scanned box bundle, not a single memo. Do not try to download it inline.`
        : '';

    const remaining = doc.text.length - (offset + slice.length);
    const more =
      remaining > 0
        ? `\n\n[${remaining.toLocaleString()} more characters. Call again with offset=${offset + slice.length}.]`
        : doc.complete
          ? '\n\n[End of document.]'
          : '\n\n[Document may be truncated by the portal.]';

    return {
      content: [
        {
          type: 'text',
          text:
            `${doc.title} (${doc.key})\n` +
            `${trail ? `${trail}\n` : ''}` +
            `Characters ${offset.toLocaleString()}–${(offset + slice.length).toLocaleString()} of ${doc.text.length.toLocaleString()}.` +
            `${oversizedPdf}\n` +
            `Portal: ${links.portalSearch}\n` +
            `\n---\n${slice}${more}`,
        },
      ],
    };
  },
);

server.registerTool(
  'list_agencies',
  {
    title: 'List agencies and boxes present in the corpus',
    description:
      `Enumerate the distinct values of a provenance field (agency, box, or folder) so you can ` +
      `scope a search. IMPORTANT: the portal does not expose working aggregations, so these values ` +
      `are derived from a SAMPLE of documents, not the full index. The response states the sample ` +
      `size. Treat the list as "these definitely exist", never as "these are the only ones".`,
    inputSchema: {
      field: z
        .enum(['agency', 'box_name', 'folder_name'])
        .default('agency')
        .describe('Which provenance field to enumerate.'),
      sampleSize: z
        .number()
        .int()
        .min(50)
        .max(1000)
        .default(200)
        .describe('How many documents to sample. Larger is slower but sees more values.'),
    },
  },
  async ({ field, sampleSize }) => {
    const { values, sampled, corpusTotal } = await sampleFieldValues(field, sampleSize);
    const lines = values.map((v) => `  ${v.value}  (${v.seen} of ${sampled} sampled)`).join('\n');
    return {
      content: [
        {
          type: 'text',
          text:
            `Distinct ${field} values found in a sample of ${sampled} documents ` +
            `(corpus is ~${corpusTotal.toLocaleString()} documents):\n\n${lines}\n\n` +
            `This is a sample, not an exhaustive list — other values almost certainly exist. ` +
            `To find them, sample more, or search for a term you expect and read the provenance of the hits.`,
        },
      ],
    };
  },
);

server.registerTool(
  'corpus_overview',
  {
    title: 'What is in this corpus and how big is it',
    description:
      'Background on the NYC 9/11 document corpus plus a live document count. Call this first if you ' +
      'have not worked with this collection before.',
    inputSchema: {},
  },
  async () => {
    const stats = await corpusStats();
    return {
      content: [
        {
          type: 'text',
          text:
            `NYC 9/11 Document Portal — ${PORTAL_BASE}\n\n` +
            `${CORPUS_CONTEXT}\n\n` +
            `Live count: ~${stats.totalDocuments.toLocaleString()} documents currently searchable ` +
            `(de-duplicated; the raw index carries roughly twice that because each document is ` +
            `indexed both as a source PDF and as its extracted-text twin).\n\n` +
            `The City said the initial release is ~170,000 pages and that further records will be ` +
            `published over the twelve months following the 2026-09-08 launch, so this count grows. ` +
            `Only personally identifiable information and security evaluations of Lower Manhattan ` +
            `buildings were withheld; the City stated nothing else is redacted.\n\n` +
            `Start with search_documents. Because the text is OCR'd, vary your wording before ` +
            `concluding a topic is absent.`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
