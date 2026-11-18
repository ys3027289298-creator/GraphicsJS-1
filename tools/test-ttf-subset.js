#!/usr/bin/env node
// Unit tests for the TTF subsetter. Run: node tools/test-ttf-subset.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ttf = require(path.resolve(__dirname, '../src/pdf/ttfSubset.js'));

const fontPath = process.argv[2] || path.resolve(__dirname, '../artifacts/fonts/wqy-zenhei.ttf');
const bytes = new Uint8Array(fs.readFileSync(fontPath));

// 1. inspect()
const info = ttf.inspect(bytes);
console.log('family:', info.family, 'unitsPerEm:', info.unitsPerEm, 'bbox:', info.bbox);
assert.ok(info.unitsPerEm > 0);
assert.ok(info.covers(0x9500), 'font must cover 销');
assert.ok(info.covers(0x41), 'font must cover A');

// 2. subset with mixed CJK + ASCII
const codepoints = '销售报告Sales2026¥（含税）'.split('').map(c => c.codePointAt(0));
const result = ttf.subset(bytes, codepoints);
const outPath = path.resolve(__dirname, '../artifacts/deliverables/unit-subset.ttf');
fs.writeFileSync(outPath, Buffer.from(result.bytes));
console.log('subset bytes:', result.bytes.length, 'glyphs:', Object.keys(result.gidMap).length);
assert.ok(result.bytes.length < bytes.length / 20, 'subset must be substantially smaller');
assert.ok(Object.keys(result.gidMap).length >= codepoints.length);
assert.strictEqual(result.missing.length, 0, 'no missing glyphs expected');

// 3. glyph mapping: every requested codepoint maps to a unique nonzero GID
const gids = codepoints.map(cp => result.charToGid[cp]);
assert.ok(gids.every(g => g > 0), 'all codepoints must map to real glyphs');
assert.strictEqual(new Set(gids).size, new Set(codepoints).size, 'distinct chars -> distinct gids');

// 4. widths present for every NEW glyph id
for (let gid = 0; gid < Object.keys(result.gidMap).length; gid++) {
  assert.ok(typeof result.widths[gid] === 'number', 'width for new gid ' + gid);
}

// 5. re-inspect the subset: tables must be self-consistent
const reInfo = ttf.inspect(result.bytes);
assert.ok(reInfo.unitsPerEm === info.unitsPerEm);
const reLookupCp = codepoints.slice(0, 5);
reLookupCp.forEach(cp => assert.ok(reInfo.covers(cp), 'subset cmap must cover U+' + cp.toString(16)));

// 6. CFF rejection path
const cff = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]);
assert.throws(() => ttf.subset(cff, [65]), e => e.code === 'E_FONT_CFF_UNSUPPORTED');

// 7. truncated font path
assert.throws(() => ttf.subset(new Uint8Array([0, 1, 0, 0]), [65]), e => e.code === 'E_FONT_TRUNCATED');

console.log('ttfSubset unit tests: PASS');
