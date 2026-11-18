#!/usr/bin/env node
// Failure-path and degradation tests for the SVG -> PDF converter.
// Every case asserts either a thrown error with a stable machine code, or a
// recorded warning (never a silently dropped element).
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const svg2pdf = require(path.join(root, 'src/pdf/svg2pdf.js'));
const stagePdf = require(path.join(root, 'src/pdf/stagePdf.js'));

const fontBytes = new Uint8Array(fs.readFileSync(
    path.join(root, 'artifacts/fonts/wqy-zenhei.ttf')));
stagePdf.registerFont('WenQuanYi Zen Hei', fontBytes);

let passed = 0, failed = 0;
function expectError(name, fn, expectedCode) {
  try {
    fn();
    console.log('FAIL', name, '- expected error', expectedCode, 'but none thrown');
    failed++;
  } catch (e) {
    if (e.code === expectedCode) { passed++; console.log('PASS', name, '->', e.code); }
    else { failed++; console.log('FAIL', name, '- expected', expectedCode, 'got', e.code, e.message); }
  }
}
function expectWarning(name, svg, warningCode) {
  try {
    const r = svg2pdf.convert(svg, { width: 200, height: 200 }, stagePdf.registry());
    const hit = r.warnings.some(w => w.code === warningCode);
    if (hit) { passed++; console.log('PASS', name, '-> warning', warningCode); }
    else { failed++; console.log('FAIL', name, '- no warning', warningCode, '; got',
      r.warnings.map(w => w.code)); }
  } catch (e) { failed++; console.log('FAIL', name, '- threw', e.code, e.message); }
}

// 1. empty / non-string input
expectError('empty svg', () => svg2pdf.convert('', {}, stagePdf.registry()), 'E_SVG_EMPTY');
expectError('null svg', () => svg2pdf.convert(null, {}, stagePdf.registry()), 'E_SVG_EMPTY');

// 2. malformed XML
expectError('malformed xml', () => svg2pdf.convert('<svg><text>hi', {}, stagePdf.registry()), 'E_SVG_PARSE');
expectError('wrong root', () => svg2pdf.convert('<html></html>', {}, stagePdf.registry()), 'E_SVG_PARSE');
expectError('mismatched tags', () => svg2pdf.convert('<svg><g></svg></g>', {}, stagePdf.registry()), 'E_SVG_PARSE');

// 3. page configuration
expectError('zero dpi',
  () => svg2pdf.convert('<svg width="10" height="10"/>', { dpi: 0 }, stagePdf.registry()), 'E_PAGE_CONFIG');
expectError('negative width',
  () => svg2pdf.convert('<svg width="10" height="10"/>', { width: -5 }, stagePdf.registry()), 'E_PAGE_CONFIG');
expectError('undeterminable size (percentage, no viewBox, no explicit size)',
  () => svg2pdf.convert('<svg width="100%" height="100%"/>', {}, stagePdf.registry()), 'E_PAGE_CONFIG');

// 4. font failures
const cff = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]);
expectError('CFF/OTF font rejected', () => stagePdf.registerFont('broken', cff), 'E_FONT_CFF_UNSUPPORTED');
expectError('truncated font', () => stagePdf.registerFont('tiny', new Uint8Array([0, 1, 0, 0])), 'E_FONT_TRUNCATED');

// 5. unsupported image format -> explicit warning, element not silently dropped
const gifDataUri = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
expectWarning('unsupported image mime warns',
  '<svg width="200" height="200"><image href="' + gifDataUri + '" x="0" y="0" width="10" height="10"/></svg>',
  'W_IMAGE_FORMAT');

// external (non-data-URI) image
expectWarning('external image warns',
  '<svg width="200" height="200"><image href="http://example.com/x.png" x="0" y="0" width="10" height="10"/></svg>',
  'W_IMAGE_EXTERNAL');

// interlaced PNG is explicitly rejected (build one via zlib header flag is
// hard; instead feed a PNG whose IHDR claims interlace=1)
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pngBytes = Buffer.from(pngBase64, 'base64');
pngBytes[28] = 1; // IHDR interlace method byte -> Adam7
expectWarning('interlaced PNG warns',
  '<svg width="200" height="200"><image href="data:image/png;base64,' + pngBytes.toString('base64') +
  '" x="0" y="0" width="1" height="1"/></svg>',
  'E_IMAGE_FORMAT');

// 6. unsupported elements -> warnings, not silent drops
expectWarning('<use> unsupported',
  '<svg width="200" height="200"><use href="#x"/></svg>', 'W_USE_UNSUPPORTED');
expectWarning('radial gradient downgraded',
  '<svg width="200" height="200" xmlns:xlink="http://www.w3.org/1999/xlink">' +
  '<defs><radialGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/>' +
  '</radialGradient></defs><rect x="0" y="0" width="50" height="50" fill="url(#g)"/></svg>',
  'W_RADIAL_GRADIENT_DOWNGRADE');
expectWarning('pattern fill downgraded',
  '<svg width="200" height="200"><defs><pattern id="p" width="4" height="4">' +
  '<rect width="4" height="4" fill="red"/></pattern></defs>' +
  '<rect x="0" y="0" width="50" height="50" fill="url(#p)"/></svg>',
  'W_PATTERN_DOWNGRADE');
expectWarning('unknown fill reference',
  '<svg width="200" height="200"><rect x="0" y="0" width="50" height="50" fill="url(#nope)"/></svg>',
  'W_FILL_REF_MISSING');
expectWarning('unknown element skipped',
  '<svg width="200" height="200"><foreignObject><div>x</div></foreignObject></svg>',
  'W_ELEMENT_UNSUPPORTED');

// 7. font style/weight downgrades
expectWarning('bold downgraded',
  '<svg width="200" height="200"><text x="0" y="20" font-weight="bold" font-family="WenQuanYi Zen Hei">A</text></svg>',
  'W_FONT_WEIGHT_DOWNGRADE');
expectWarning('italic downgraded',
  '<svg width="200" height="200"><text x="0" y="20" font-style="italic" font-family="WenQuanYi Zen Hei">A</text></svg>',
  'W_FONT_STYLE_DOWNGRADE');

// 8. gradient stroke not silently dropped
expectWarning('gradient stroke warns',
  '<svg width="200" height="200"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/>' +
  '<stop offset="1" stop-color="blue"/></linearGradient></defs>' +
  '<line x1="0" y1="0" x2="50" y2="50" stroke="url(#g)"/></svg>',
  'W_STROKE_GRADIENT_UNSUPPORTED');

// 9. valid happy path still returns zero warnings baseline
const ok = svg2pdf.convert(
  '<svg width="100" height="100"><rect x="0" y="0" width="50" height="50" fill="#ff0000"/></svg>',
  {}, stagePdf.registry());
if (ok.warnings.length === 0 && ok.bytes.length > 100) { passed++; console.log('PASS happy path, no warnings'); }
else { failed++; console.log('FAIL happy path', ok.warnings); }

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
