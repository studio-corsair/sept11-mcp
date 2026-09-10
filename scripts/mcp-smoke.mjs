#!/usr/bin/env node
// End-to-end test through a real MCP client over stdio — proves the server is
// usable by an agent, not merely that it compiles.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry] }));

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const textOf = (r) => r.content.map((c) => c.text ?? '').join('\n');

const { tools } = await client.listTools();
check('server advertises its tools', tools.length === 4, tools.map((t) => t.name).join(', '));
check('every tool has a description', tools.every((t) => (t.description ?? '').length > 60), '');

const overview = textOf(await client.callTool({ name: 'corpus_overview', arguments: {} }));
check('corpus_overview reports a live count', /~[\d,]{5,} documents currently searchable/.test(overview),
  overview.split('\n').find((l) => l.includes('Live count')));

const found = textOf(await client.callTool({
  name: 'search_documents',
  arguments: { query: '"World Trade Center 7"', limit: 3 },
}));
check('search returns provenance and keys', /key: NYC-WTC_\d+/.test(found), found.split('\n')[0]);
check('search offers a pagination cursor', /Call again with cursor: /.test(found), '');

const key = found.match(/key: (\S+)/)?.[1];
const doc = textOf(await client.callTool({
  name: 'read_document', arguments: { key, maxChars: 1200 },
}));
check('read_document returns text for that key', doc.includes(key) && doc.length > 800,
  `${doc.length} chars for ${key}`);
check('read_document reports its position in the document', /Characters [\d,]+–[\d,]+ of [\d,]+/.test(doc),
  doc.split('\n').find((l) => l.startsWith('Characters')));

// Paging through the MCP surface, not just the client library.
const cursor = found.match(/Call again with cursor: (\S+)/)?.[1];
const page2 = textOf(await client.callTool({
  name: 'search_documents', arguments: { query: '"World Trade Center 7"', limit: 3, cursor },
}));
const keysOf = (t) => [...t.matchAll(/key: (\S+)/g)].map((m) => m[1]);
check('page 2 through MCP is disjoint from page 1',
  keysOf(page2).length > 0 && keysOf(page2).every((k) => !keysOf(found).includes(k)),
  `p1=${keysOf(found).join(',')} p2=${keysOf(page2).join(',')}`);

const agencies = textOf(await client.callTool({ name: 'list_agencies', arguments: { sampleSize: 50 } }));
check('list_agencies flags that it is a sample', /sample, not an exhaustive list/.test(agencies), '');

// A bad key must fail loudly and usefully, not return empty text.
let errored = false;
try {
  await client.callTool({ name: 'read_document', arguments: { key: 'NOT_A_REAL_KEY' } });
} catch (e) { errored = /No document with key/.test(String(e)); }
if (!errored) {
  const bad = await client.callTool({ name: 'read_document', arguments: { key: 'NOT_A_REAL_KEY' } })
    .then(textOf).catch((e) => String(e));
  errored = /No document with key/.test(bad);
}
check('unknown document key produces an explanatory error', errored, '');

await client.close();
console.log(`\n${failures === 0 ? 'ALL MCP CHECKS PASSED' : `${failures} MCP CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
