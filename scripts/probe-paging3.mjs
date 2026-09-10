#!/usr/bin/env node
// Replay the UI's own page-1 then page-2 bodies, then strip fields from page-2
// until pagination breaks — that isolates what the server actually keys on.
import { readFileSync } from 'node:fs';
const BASE = 'https://sept11documents.cityofnewyork.us';
const post = async (body) => {
  const r = await fetch(`${BASE}/api/v2/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 160)}`);
  return JSON.parse(t);
};
const keyOf = (res) => res.properties?.find((p) => p.id === 'mes:key')?.data?.[0]?.value?.str
  ?? res.properties?.find((p) => p.id === 'title')?.data?.[0]?.value?.str ?? res.id.slice(-22);
const keys = (j) => (j.resultset?.results ?? []).map(keyOf);

const p1body = JSON.parse(readFileSync(new URL('./ui-page1.json', import.meta.url), 'utf8'));
const p2body = JSON.parse(readFileSync(new URL('./ui-page2.json', import.meta.url), 'utf8'));

// Fresh page 1 — the digest in the saved page-2 body may be stale, so re-derive it.
const p1 = await post(p1body);
const k1 = keys(p1);
console.log('replayed page1:', k1.slice(0, 4));
const rp = p1.resultset.result_pages;
console.log('fresh digest:', rp?.qeng_ids?.[0]?.digest, '| saved digest:', p2body.result_pages?.qeng_ids?.[0]?.digest);

// Page 2, with the digest refreshed from this run.
const fresh = structuredClone(p2body);
fresh.result_pages.qeng_ids[0].digest = rp.qeng_ids[0].digest;
const p2 = await post(fresh);
const k2 = keys(p2);
const disjoint = k2.length > 0 && k2.every((k) => !k1.includes(k));
console.log(`${disjoint ? 'OK  ' : 'SAME'} verbatim UI page2 (fresh digest):`, k2.slice(0, 4));
if (!disjoint) {
  const p2stale = await post(p2body);
  console.log('     with the ORIGINAL saved digest:', keys(p2stale).slice(0, 4));
}

// Now strip one field at a time from the working body to find the minimum.
const stripCandidates = [
  'sort_date_facets_by_value', 'facets', 'summarize_by', 'query_context',
  'user_context', 'query_context_user_query', 'answer_count', 'max_page_count',
  'query_context_effective_client_result_page', 'paging_states', 'path', 'name',
];
console.log('\n--- strip one field at a time from page2 ---');
for (const field of stripCandidates) {
  const body = structuredClone(fresh);
  if (!(field in body)) { console.log(`  (absent) ${field}`); continue; }
  delete body[field];
  try {
    const j = await post(body);
    const k = keys(j);
    const ok = k.length > 0 && k.every((x) => !k1.includes(x));
    console.log(`  ${ok ? 'still paginates' : 'BREAKS        '} without ${field}`);
  } catch (e) { console.log(`  ERROR          without ${field}: ${e.message.slice(0, 80)}`); }
}
