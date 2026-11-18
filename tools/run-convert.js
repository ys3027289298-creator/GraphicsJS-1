#!/usr/bin/env node
// End-to-end SVG -> PDF conversion smoke test.
// Usage: node tools/run-convert.js <input.svg> <output.pdf> [font.ttf ...]
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const svg2pdf = require(path.join(root, 'src/pdf/svg2pdf.js'));
const stagePdf = require(path.join(root, 'src/pdf/stagePdf.js'));

const input = process.argv[2];
const output = process.argv[3];
const fonts = process.argv.slice(4);
if (!input || !output) {
  console.error('usage: run-convert.js <input.svg> <output.pdf> [font.ttf ...]');
  process.exit(2);
}

fonts.forEach((fp, i) => {
  const family = i === 0 ? 'WenQuanYi Zen Hei' : path.basename(fp, '.ttf');
  stagePdf.registerFont(family, new Uint8Array(fs.readFileSync(fp)));
});

const svgText = fs.readFileSync(input, 'utf8');
const options = {
  width: Number(process.env.PDF_WIDTH) || undefined,
  height: Number(process.env.PDF_HEIGHT) || undefined,
  dpi: Number(process.env.PDF_DPI) || 72,
  compress: process.env.PDF_COMPRESS !== '0',
  title: 'GraphicsJS PDF export sample'
};
Object.keys(options).forEach(k => options[k] === undefined && delete options[k]);

try {
  const result = svg2pdf.convert(svgText, options, stagePdf.registry());
  fs.writeFileSync(output, Buffer.from(result.bytes));
  console.log(JSON.stringify({
    ok: true,
    output: output,
    pdfBytes: result.bytes.length,
    extractedText: result.extractedText,
    diagnostics: result.diagnostics
  }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: e.code, message: e.message }, null, 2));
  process.exit(1);
}
