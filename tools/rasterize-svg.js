#!/usr/bin/env node
// Rasterizes the source SVG with an independent renderer (@resvg/resvg-js,
// installed in an isolated directory) so it can be pixel-compared with the
// MuPDF rasterization of our PDF output.
'use strict';
const fs = require('fs');
const path = require('path');
const { Resvg } = require('/tmp/resvg-tool/node_modules/@resvg/resvg-js');

const input = process.argv[2];
const output = process.argv[3];
const targetWidth = parseInt(process.argv[4], 10);
const svg = fs.readFileSync(input, 'utf8');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: targetWidth },
  background: 'white',
  font: { loadSystemFonts: true, fontFiles: [
    path.resolve(__dirname, '../artifacts/fonts/wqy-zenhei.ttf')
  ] }
});
const png = resvg.render().asPng();
fs.writeFileSync(output, png);
console.log(JSON.stringify({ ok: true, output, bytes: png.length }));
