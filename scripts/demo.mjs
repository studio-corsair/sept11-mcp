#!/usr/bin/env node
// Demonstrate the server on the questions the release is actually about.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const client = new Client({ name: 'demo', version: '0.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry] }));
const text = (r) => r.content.map((c) => c.text ?? '').join('\n');

const queries = [
  '"safe to breathe"',
  '"Harding"',
  '"limit liability" OR "liability exposure"',
  '"do not disclose" OR "not for public release"',
  '"respirator" AND "compliance"',
  '"exceeded" AND "asbestos"',
];

for (const q of queries) {
  const out = text(await client.callTool({
    name: 'search_documents', arguments: { query: q, limit: 2, excerptLength: 260 },
  }));
  console.log(`\n${'='.repeat(74)}\nQUERY: ${q}`);
  console.log(out.split('\n\nMore results')[0]);
}

await client.close();
