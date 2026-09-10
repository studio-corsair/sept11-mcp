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
const ids = (j) => j.resultset.results.map((r) => r.id.slice(-26));

const base = { query: { unparsed: '*' }, count: 3, properties: [{ name: 'title', formats: ['VALUE'] }] };
const p1 = await search(base);
console.log('page1:', ids(p1));
const ps = p1.resultset.per_service_dataset;
console.log('paging_state:', JSON.stringify(ps).slice(0, 300));

// Try the documented shapes for "give me the next page".
const attempts = {
  'source_context.per_service_dataset': { ...base, source_context: { per_service_dataset: ps } },
  'top-level per_service_dataset': { ...base, per_service_dataset: ps },
  'source_context (whole resultset ctx)': { ...base, source_context: { paging_states: ps.map((d) => d.paging_state) } },
  'next_page flag': { ...base, source_context: { per_service_dataset: ps }, next_page: true },
};
for (const [label, body] of Object.entries(attempts)) {
  try {
    const j = await search(body);
    const got = ids(j);
    const fresh = got.every((g) => !ids(p1).includes(g));
    console.log(`${fresh ? 'OK  ' : 'same'} ${label}: ${JSON.stringify(got)}`);
  } catch (e) { console.log(`ERR  ${label}: ${e.message.slice(0, 120)}`); }
}

// Facets / aggregations: what shape does this build accept?
console.log('\n=== facet attempts ===');
const facetBodies = {
  'aggregations of-string': { query: { unparsed: '*' }, count: 0, aggregations: [{ name: 'agency', of: 'agency' }] },
  'aggregations with datasources': { query: { unparsed: '*' }, count: 0, aggregations: [{ name: 'agency', of: 'agency', datasources: [{ id: 'https://nyc.mindbreeze.com/search/september-11/' }] }] },
  'constraints empty + facet prop': { query: { unparsed: '*' }, count: 0, properties: [{ name: 'agency', formats: ['VALUE'] }], facets: ['agency'] },
};
for (const [label, body] of Object.entries(facetBodies)) {
  try {
    const j = await search(body);
    const found = j.aggregation_results ?? j.aggregations ?? j.facets;
    console.log(`${label}: ${found ? JSON.stringify(found).slice(0, 600) : 'no agg key; status=' + JSON.stringify(j.status_messages ?? []).slice(0, 200)}`);
  } catch (e) { console.log(`${label}: ERR ${e.message.slice(0, 140)}`); }
}
