#!/usr/bin/env node
// End-to-end test through a real acgraph Stage using a vm context whose global
// is a jsdom window (the closest headless equivalent of a browser). Loads the
// built graphics.js bundle plus the new local PDF modules and exercises the
// Stage-level toPdfDocument() API against an actual virtual-DOM stage.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('/tmp/resvg-tool/node_modules/jsdom');

const root = path.resolve(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="stage"></div></body></html>',
  { pretendToBeVisual: true, runScripts: 'dangerously' });
const ctx = dom.getInternalVMContext();
vm.createContext(ctx);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
}

// Built library (defines window.acgraph) then the new PDF modules.
load('dist/graphics.js');
for (const f of ['ttfSubset.js', 'pdfWriter.js', 'svg2pdf.js', 'stagePdf.js']) {
  load('src/pdf/' + f);
}

const acgraph = dom.window.acgraph;
const assert = require('assert');

// Register the CJK-capable font.
const fontBytes = new Uint8Array(fs.readFileSync(path.join(root, 'artifacts/fonts/wqy-zenhei.ttf')));
acgraph.pdf.registerFont('WenQuanYi Zen Hei', fontBytes);

// Build a stage with vector shapes (jsdom lacks SVG getBBox, so text
// measurement is exercised through the raw-SVG converter tests instead).
const stage = acgraph.create('stage');
stage.resize(600, 400);
const layer = stage.layer();
layer.rect(40, 110, 150, 90).fill('#1f77b4', 0.6).stroke('#333', 2.5);
layer.rect(100, 140, 150, 90).fill('#d62728', 0.45);
layer.circle(320, 150, 55).fill('#2ca02c', 0.3).stroke('#2ca02c', 3, 0.8);
layer.path().moveTo(40, 260).curveTo(120, 240, 200, 300, 300, 270)
  .stroke('#444', 2, '2 2');

// The stage must still produce real SVG through the unchanged toSvg path.
const svgOut = stage.toSvg();
assert.ok(svgOut.indexOf('<svg') === 0 || svgOut.indexOf('<?xml') === 0, 'stage.toSvg works');
assert.ok(svgOut.indexOf('<path') >= 0 && svgOut.indexOf('<circle') >= 0, 'SVG contains shapes');

assert.strictEqual(typeof stage.toPdfDocument, 'function', 'stage.toPdfDocument attached');
assert.strictEqual(typeof stage.saveAsPdfLocal, 'function', 'stage.saveAsPdfLocal attached');

const result = stage.toPdfDocument({ width: 600, height: 400 });
// Duck-type rather than instanceof: the PDF is built inside the vm realm, so
// its Uint8Array constructor differs from the test runner's.
assert.ok(result.bytes && result.bytes.length > 500 && typeof result.bytes.slice === 'function',
  'PDF bytes produced');
assert.strictEqual(result.diagnostics.elementCount, 4, 'four vector elements rendered');
assert.strictEqual(result.warnings.length, 0, 'no warnings: ' + JSON.stringify(result.warnings));

// Text extraction on a shape-only stage is empty but must not error.
// JSON comparison avoids cross-realm array prototype mismatches.
assert.strictEqual(JSON.stringify(result.extractedText), '[]', 'no text on shape-only stage');

const out = path.join(root, 'artifacts/deliverables/stage-integration.pdf');
fs.writeFileSync(out, Buffer.from(result.bytes));
console.log(JSON.stringify({
  ok: true,
  output: out,
  pdfBytes: result.bytes.length,
  warningCount: result.warnings.length,
  warnings: result.warnings,
  extractedText: result.extractedText,
  note: 'rendered through a real acgraph Stage virtual DOM via stage.toPdfDocument()'
}, null, 2));
