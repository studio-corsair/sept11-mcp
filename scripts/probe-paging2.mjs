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
const base = (extra = {}) => ({
  name: 'sept11search', count: 4, content_sample_length: 1, max_page_count: 10,
  properties: [{ name: 'mes:key', formats: ['VALUE'] }],
  user: { query: { and: [{ unparsed: 'asbestos', id: 'query' }] }, constraints: [] },
  paging_states: [], path: 'search', ...extra,
});
const keys = (j) => (j.resultset?.results ?? []).map((r) => r.properties?.[0]?.data?.[0]?.value?.str);

const p1 = await search(base());
const k1 = keys(p1);
console.log('page1:', k1);
const psd = p1.resultset.per_service_dataset ?? [];
const rp = p1.resultset.result_pages ?? {};
console.log('per_service_dataset:', JSON.stringify(psd).slice(0, 260));
console.log('qeng_ids:', JSON.stringify(rp.qeng_ids));
console.log('pages[0..2]:', JSON.stringify((rp.pages ?? []).slice(0, 3)));

const attempts = {
  'paging_states = [state obj]': base({ paging_states: psd.map((d) => d.paging_state) }),
  'paging_states = per_service_dataset': base({ paging_states: psd }),
  'result_pages echo + page_number 1': base({
    result_pages: { qeng_ids: rp.qeng_ids, pages: rp.pages }, page_number: 1,
  }),
  'paging_states + after page1 order': base({
    paging_states: psd.map((d) => d.paging_state),
    after: (rp.pages ?? [])[1]?.order,
  }),
  'source_context.paging_states': base({ source_context: { paging_states: psd.map((d) => d.paging_state) } }),
  'count 4 + start 4': base({ start: 4 }),
  'count 4 + offset 4': base({ offset: 4 }),
  'result_pages.pages[1].starts via start_index': base({ start_index: 4 }),
};

for (const [label, body] of Object.entries(attempts)) {
  try {
    const j = await search(body);
    const k = keys(j);
    const fresh = k.length > 0 && k.every((x) => !k1.includes(x));
    console.log(`${fresh ? '>>> OK ' : '    same'}  ${label}: ${JSON.stringify(k)}`);
  } catch (e) { console.log(`    ERR   ${label}: ${e.message.slice(0, 110)}`); }
}
