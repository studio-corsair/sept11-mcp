#!/usr/bin/env node
// Probe: how do we get a document's *text* out of the NYC 9/11 portal
// (Mindbreeze InSpire) rather than its multi-hundred-MB source PDF?
const BASE = 'https://sept11documents.cityofnewyork.us';

async function search(body) {
  const r = await fetch(`${BASE}/api/v2/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`search HTTP ${r.status}`);
  return r.json();
}

const val = (p) => p?.data?.[0]?.value?.str ?? p?.data?.[0]?.value?.num ?? p?.data?.[0]?.html;

// 1. Grab one document and every content-ish property we can name.
const j = await search({
  query: { unparsed: 'asbestos' },
  count: 1,
  content_sample_length: 20000,
  properties: [
    { name: 'title', formats: ['VALUE'] },
    { name: 'full_filename', formats: ['VALUE'] },
    { name: 'mes:relevantcontent', formats: ['HTML', 'VALUE'] },
    { name: 'mes:content', formats: ['VALUE'] },
    { name: 'content', formats: ['VALUE'] },
    { name: 'mes:binarycontent_synthesized', formats: ['VALUE'] },
    { name: 'document:PageCount', formats: ['VALUE'] },
  ],
});

const res = j.resultset.results[0];
console.log('--- properties returned ---');
for (const p of res.properties ?? []) {
  const v = val(p);
  console.log(`${p.id}: ${typeof v === 'string' ? `${v.slice(0, 400)}${v.length > 400 ? ` …(${v.length} chars)` : ''}` : v}`);
}
console.log('\n--- content_sample / other top-level keys on result ---');
console.log(Object.keys(res).join(', '));
for (const k of ['content_sample', 'contentSample', 'snippet']) {
  if (res[k]) console.log(`${k}: ${JSON.stringify(res[k]).slice(0, 600)}`);
}

// 2. Does the export/csv or an "openapi" surface exist?
for (const path of ['/api/v2/openapi.json', '/api/v2/export', '/api/v2/getcontent', '/api/v2/aggregate']) {
  try {
    const r = await fetch(BASE + path, { method: 'GET' });
    console.log(`\nGET ${path} -> ${r.status} ${r.headers.get('content-type')}`);
  } catch (e) {
    console.log(`\nGET ${path} -> ERR ${e.message}`);
  }
}
