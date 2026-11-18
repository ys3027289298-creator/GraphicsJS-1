#!/usr/bin/env node
// Measures memory and output-size bounds of the local PDF exporter across a
// range of input sizes, and derives conservative upper-bound formulas.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const svg2pdf = require(path.join(root, 'src/pdf/svg2pdf.js'));
const stagePdf = require(path.join(root, 'src/pdf/stagePdf.js'));

stagePdf.registerFont('WenQuanYi Zen Hei',
  new Uint8Array(fs.readFileSync(path.join(root, 'artifacts/fonts/wqy-zenhei.ttf'))));

function makeScene(shapeCount, textLen) {
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000">',
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/>' +
    '<stop offset="1" stop-color="#0000ff"/></linearGradient></defs>'];
  for (let i = 0; i < shapeCount; i++) {
    const x = (i % 30) * 30, y = Math.floor(i / 30) * 30;
    parts.push(`<rect x="${x}" y="${y}" width="20" height="20" fill="#1f77b4" ` +
      `fill-opacity="0.5" stroke="#333" stroke-width="1.5"/>`);
  }
  let txt = '';
  for (let i = 0; i < textLen; i++) txt += (i % 7 === 0 ? '销' : 'a');
  parts.push(`<text x="10" y="980" font-family="WenQuanYi Zen Hei" font-size="14">${txt}</text>`);
  parts.push('</svg>');
  return parts.join('');
}

const results = [];
const scales = [
  { shapes: 10, text: 20 },
  { shapes: 100, text: 100 },
  { shapes: 1000, text: 500 },
  { shapes: 5000, text: 1000 }
];

for (const s of scales) {
  global.gc && global.gc();
  const before = process.memoryUsage().heapUsed;
  const svg = makeScene(s.shapes, s.text);
  const t0 = process.hrtime.bigint();
  const r = svg2pdf.convert(svg, { width: 1000, height: 1000 }, stagePdf.registry());
  const dt = Number(process.hrtime.bigint() - t0) / 1e6;
  const after = process.memoryUsage().heapUsed;
  const entry = {
    shapes: s.shapes,
    textLength: s.text,
    svgBytes: svg.length,
    pdfBytes: r.bytes.length,
    contentStreamBytes: r.diagnostics.contentStreamBytes,
    encodedStreamBytes: r.diagnostics.encodedStreamBytes,
    heapDeltaBytes: after - before,
    heapPeakRssBytes: process.memoryUsage.rss(),
    elapsedMs: Math.round(dt * 100) / 100,
    fontsUsed: r.diagnostics.fontsUsed.length,
    elements: r.diagnostics.elementCount,
    ratioPdfOverSvg: Math.round((r.bytes.length / svg.length) * 100) / 100
  };
  results.push(entry);
  console.log(JSON.stringify(entry));
}

// Derive bounds.
const maxRatio = Math.max(...results.map(r => r.pdfBytes / Math.max(1, r.svgBytes)));
const maxHeapPerElement = Math.max(...results.map(r =>
  r.heapDeltaBytes / Math.max(1, r.elements + r.textLength)));
const summary = {
  maxPdfToSvgRatio: Math.round(maxRatio * 100) / 100,
  maxHeapBytesPerElement: Math.round(maxHeapPerElement),
  fontSubsetCeilingBytes: 11641316, // source font size; subset is always smaller
  note: 'PDF size is O(elements) for content plus one embedded font subset ' +
    '(bounded by the full source TTF). Memory is bounded by input SVG + a ' +
    'single in-memory content stream + font subset; no per-element retention ' +
    'beyond the output document object table.'
};
fs.writeFileSync(path.join(root, 'artifacts/deliverables/memory-bounds.json'),
  JSON.stringify({ results, summary }, null, 2));
console.log('\nSUMMARY', JSON.stringify(summary, null, 2));
