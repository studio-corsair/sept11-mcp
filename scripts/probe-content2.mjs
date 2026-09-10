#!/usr/bin/env node
const BASE = 'https://sept11documents.cityofnewyork.us';

async function search(body) {
  const r = await fetch(`${BASE}/api/v2/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// A. Ask for relevant content in every format Mindbreeze knows.
console.log('=== A: content properties, all formats ===');
for (const props of [
  [{ name: 'mes:relevantcontent', formats: ['HTML'] }],
  [{ name: 'mes:relevantcontent', formats: ['VALUE'] }],
  [{ name: 'content', formats: ['HTML'] }],
  [{ name: 'mes:binarycontent_synthesized', formats: ['HTML'] }],
]) {
  try {
    const a = await search({
      query: { unparsed: 'asbestos' }, count: 1, content_sample_length: 30000, properties: props,
    });
    const got = JSON.stringify(a.resultset.results[0].properties);
    console.log(`${props[0].name} [${props[0].formats}] -> ${got.slice(0, 900)}`);
  } catch (e) {
    console.log(`${props[0].name} [${props[0].formats}] -> ${e.message.slice(0, 120)}`);
  }
}

// B. What does /api/v2/export actually take?
console.log('\n=== B: /api/v2/export ===');
for (const [method, body] of [
  ['GET', null],
  ['POST', JSON.stringify({ query: { unparsed: 'asbestos' }, count: 2 })],
]) {
  const r = await fetch(`${BASE}/api/v2/export`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body,
  });
  const t = await r.text();
  console.log(`${method} -> ${r.status} ${r.headers.get('content-type')} len=${t.length}`);
  console.log('  ', t.slice(0, 500).replace(/\n/g, ' '));
}

// C. The pdfviewer says fetch_from_index=true. Try /content variants for the TEXT.
console.log('\n=== C: /content variants (HEAD-ish, range-limited) ===');
const qs = (o) => new URLSearchParams(o).toString();
const common = {
  docid: '73362', key: 'NYC-WTC_000148192_MD',
  category: 'september11 Connector', category_instance: 'September11_MD',
  category_class: 'default', query_service_location: 'https://localhost:23301',
};
for (const extra of [
  { disposition: 'false', fetch_from_index: 'true', preview: 'true' },
  { disposition: 'false', fetch_from_index: 'true' },
  { disposition: 'false' },
]) {
  const url = `${BASE}/content?${qs({ ...common, ...extra })}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-2047' }, signal: ctl.signal });
    const buf = Buffer.from(await r.arrayBuffer());
    console.log(`${JSON.stringify(extra)} -> ${r.status} ct=${r.headers.get('content-type')} cl=${r.headers.get('content-length')} cr=${r.headers.get('content-range')} got=${buf.length}`);
    console.log('   head:', JSON.stringify(buf.subarray(0, 200).toString('utf8')));
  } catch (e) {
    console.log(`${JSON.stringify(extra)} -> ${e.name}: ${e.message}`);
  } finally { clearTimeout(t); }
}
