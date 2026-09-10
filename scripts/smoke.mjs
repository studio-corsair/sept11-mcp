#!/usr/bin/env node
// Live smoke test against the real portal. Every assertion prints what it saw,
// so a failure says which capability broke rather than just "false".
import {
  search, readDocument, corpusStats, sampleFieldValues, documentLinks,
} from '../dist/mindbreeze.js';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. Corpus size
const stats = await corpusStats();
check('corpusStats returns a plausible document count', stats.totalDocuments > 10_000,
  `totalDocuments=${stats.totalDocuments}`);

// 2. Search returns hits with metadata
const asbestos = await search({ query: 'asbestos', limit: 5 });
check('search("asbestos") returns hits', asbestos.hits.length === 5,
  `got ${asbestos.hits.length}, estimatedTotal=${asbestos.estimatedTotal}`);
const first = asbestos.hits[0];
check('hit has a usable key', /_MD$/.test(first?.key ?? ''), `key=${first?.key}`);
check('hit has an excerpt', (first?.excerpt?.length ?? 0) > 20,
  `excerpt=${JSON.stringify(first?.excerpt?.slice(0, 90))}`);
check('excerpt has no <em> markup', !/<em>/.test(first?.excerpt ?? ''), '');
const withAgency = asbestos.hits.find((h) => h.agency);
check('at least one hit carries agency metadata', Boolean(withAgency),
  `agency=${withAgency?.agency}, box=${withAgency?.boxName}, folder=${withAgency?.folderName}`);

// 3. Pagination actually advances
check('search exposes a next cursor', Boolean(asbestos.nextCursor), `cursor=${asbestos.nextCursor}`);
const page2 = await search({ query: 'asbestos', limit: 5, cursor: asbestos.nextCursor });
const overlap = page2.hits.filter((h) => asbestos.hits.some((p) => p.key === h.key));
check('page 2 is disjoint from page 1', page2.hits.length > 0 && overlap.length === 0,
  `page2=${page2.hits.length} hits, overlap=${overlap.length}`);

// 4. Full document text by key
const doc = await readDocument(first.key);
check('readDocument returns the right document', doc.key === first.key, `key=${doc.key}`);
check('readDocument returns substantive text', doc.text.length > 200,
  `${doc.text.length} chars, complete=${doc.complete}`);
console.log(`      first 180 chars: ${JSON.stringify(doc.text.slice(0, 180))}`);

// 5. Filtering by agency narrows results
if (withAgency?.agency) {
  const filtered = await search({ query: 'asbestos', limit: 5, agency: withAgency.agency });
  const allMatch = filtered.hits.length > 0 && filtered.hits.every((h) => h.agency === withAgency.agency);
  check('agency filter constrains results', allMatch,
    `${filtered.hits.length} hits, total=${filtered.estimatedTotal}, agencies=${[...new Set(filtered.hits.map((h) => h.agency))].join(' | ')}`);
}

// 6. Field sampling
const agencies = await sampleFieldValues('agency', 150);
check('sampleFieldValues finds agencies', agencies.values.length > 0,
  `sampled=${agencies.sampled}, agencies=${agencies.values.slice(0, 6).map((v) => `${v.value}(${v.seen})`).join(', ')}`);

// 7. Links
check('documentLinks builds a portal URL', documentLinks(first.key).portalSearch.startsWith('https://'),
  documentLinks(first.key).portalSearch);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
