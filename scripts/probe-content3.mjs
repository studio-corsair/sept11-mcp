#!/usr/bin/env node
const BASE = 'https://sept11documents.cityofnewyork.us';
const search = async (body) => {
  const r = await fetch(`${BASE}/api/v2/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
};
const contentOf = (res) =>
  res.properties?.find((p) => p.id === 'content')?.data?.[0]?.html ?? '';
const strOf = (res, id) => res.properties?.find((p) => p.id === id)?.data?.[0]?.value?.str;

// 1. How much text can we actually pull? Is it the whole document?
console.log('=== content_sample_length ladder ===');
for (const len of [1000, 50_000, 500_000, 5_000_000]) {
  try {
    const j = await search({
      query: { unparsed: 'asbestos' }, count: 1, content_sample_length: len,
      properties: [
        { name: 'content', formats: ['HTML'] },
        { name: 'document:PageCount', formats: ['VALUE'] },
        { name: 'title', formats: ['VALUE'] },
      ],
    });
    const res = j.resultset.results[0];
    const c = contentOf(res);
    const pages = res.properties?.find((p) => p.id === 'document:PageCount')?.data?.[0]?.value?.num;
    console.log(`  ask=${len} -> got ${c.length} chars, pages=${pages}, title=${strOf(res, 'title')}`);
  } catch (e) { console.log(`  ask=${len} -> ${e.message.slice(0, 140)}`); }
}

// 2. Pagination: how do we walk the whole 48,900?
console.log('\n=== pagination ===');
const page1 = await search({
  query: { unparsed: '*' }, count: 3,
  properties: [{ name: 'title', formats: ['VALUE'] }],
});
console.log('  page1 ids:', page1.resultset.results.map((r) => r.id.slice(-28)));
console.log('  next_avail:', page1.resultset.next_avail, '| order_next_result:', JSON.stringify(page1.resultset.order_next_result));

const page2 = await search({
  query: { unparsed: '*' }, count: 3,
  properties: [{ name: 'title', formats: ['VALUE'] }],
  after: page1.resultset.order_next_result,
});
console.log('  page2 ids:', page2.resultset.results.map((r) => r.id.slice(-28)));
console.log('  distinct from page1:', page2.resultset.results.every((r) => !page1.resultset.results.some((x) => x.id === r.id)));

// 3. Facets: enumerate agencies + boxes so an agent can browse, not just search.
console.log('\n=== facets via constraints ===');
try {
  const f = await search({
    query: { unparsed: '*' }, count: 0,
    source_context: {},
    properties: [],
    constraints: [],
    facets: [{ name: 'agency', max_count: 50 }, { name: 'box_name', max_count: 10 }],
  });
  console.log('  keys:', Object.keys(f).join(', '));
  console.log('  ', JSON.stringify(f.facets ?? f.available_facets).slice(0, 900));
} catch (e) { console.log('  facets ->', e.message.slice(0, 200)); }
