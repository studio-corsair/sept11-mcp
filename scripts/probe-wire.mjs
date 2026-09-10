#!/usr/bin/env node
// Verify the wire format lifted from the portal's own UI works from node,
// and find out what `enrichment_summary` / `index_hierarchy` actually contain.
const BASE = 'https://sept11documents.cityofnewyork.us';
const search = async (body) => {
  const r = await fetch(`${BASE}/api/v2/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
};

const req = (q, extra = {}) => ({
  name: 'sept11search',
  count: 5,
  content_sample_length: 400,
  max_page_count: 10,
  user: { query: { and: [{ unparsed: q, id: 'query' }] }, constraints: [] },
  properties: [
    { name: 'mes:key', formats: ['VALUE'] },
    { name: 'title', formats: ['VALUE'] },
    { name: 'agency', formats: ['PROPERTY'] },
    { name: 'box_name', formats: ['PROPERTY'] },
    { name: 'box_id', formats: ['PROPERTY'] },
    { name: 'folder_name', formats: ['VALUE'] },
    { name: 'enrichment_summary', formats: ['PROPERTY'] },
    { name: 'content', formats: ['HTML'] },
    { name: 'pdf_size', formats: ['VALUE'] },
    { name: 'actions', formats: ['VALUE', 'PROPERTY', 'HTML'] },
  ],
  facets: [{ name: 'index_hierarchy', formats: ['HTML'] }],
  paging_states: [],
  path: 'search',
  summarize_by: { property: 'title' },
  ...extra,
});

const j = await search(req('asbestos'));
console.log('estimated_count:', j.estimated_count);
console.log('resultset keys:', Object.keys(j.resultset ?? {}).join(', '));
console.log('result_pages:', JSON.stringify(j.resultset?.result_pages).slice(0, 700));

const r0 = j.resultset.results[0];
console.log('\n--- first result properties ---');
for (const p of r0.properties ?? []) {
  console.log(`  ${p.id}: ${JSON.stringify(p.data?.[0]).slice(0, 380)}`);
}

console.log('\n--- facets ---');
console.log(JSON.stringify(j.facets ?? j.available_facets).slice(0, 1500));

// Page 2 via result_pages order
const pg = (j.resultset.result_pages?.pages ?? j.resultset.result_pages)?.[1];
if (pg) {
  const j2 = await search(req('asbestos', { after: pg.order, count: 5 }));
  const idsOf = (x) => x.resultset.results.map((r) => r.id.slice(-24));
  console.log('\npage1 ids:', idsOf(j));
  console.log('page2 ids:', idsOf(j2));
  console.log('distinct:', idsOf(j2).every((i) => !idsOf(j).includes(i)));
}
