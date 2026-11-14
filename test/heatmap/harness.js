/**
 * Shared test harness: boots the real, unmodified dist/graphics.js inside a
 * jsdom window and provides deterministic SVG serialization plus a tiny
 * dependency-free PNG rasterizer for pixel-level assertions.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const {JSDOM} = require('jsdom');

const REPO_ROOT = path.join(__dirname, '..', '..');

/**
 * Creates a fresh jsdom window with graphics.js evaluated inside it.
 * Every call starts from a clean document and a fresh acgraph instance.
 * @return {!{window:!Window, document:!Document, acgraph:!Object}}
 */
function bootGraphics() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="container"></div></body></html>',
      {pretendToBeVisual: true, runScripts: 'outside-only'});
  const context = dom.getInternalVMContext();
  // jsdom implements no SVG layout; give the renderer deterministic metrics
  // so text-dependent primitives remain byte-comparable across runs.
  context.SVGElement.prototype.getBBox = function() {
    return {x: 0, y: 0, width: 100, height: 16};
  };
  context.SVGElement.prototype.getComputedTextLength = function() {
    return 100;
  };
  const code = fs.readFileSync(path.join(REPO_ROOT, 'dist', 'graphics.js'), 'utf8');
  vm.runInContext(code, context, {filename: 'dist/graphics.js'});
  return {window: dom.window, document: dom.window.document, acgraph: dom.window.acgraph};
}

/**
 * Serializes the stage's live SVG element.
 */
function svgString(window, document) {
  const svg = document.getElementById('container').querySelector('svg');
  return new window.XMLSerializer().serializeToString(svg);
}

/**
 * Replaces the random per-instance hex segment of acgraph ids
 * (ac_<type>_<hex>_<counter>) with a stable token so two independent runs can
 * be compared byte-for-byte. The trailing numeric counter is preserved,
 * keeping ID ordering assertions meaningful.
 */
function normalizeSvgIds(svg) {
  return svg.replace(/_[0-9a-f]{6,8}_/g, '_TEST_');
}

/**
 * Minimal PNG encoder (truecolor, 8-bit). Used so pixel assertions have no
 * third-party native dependencies; zlib is part of Node's standard library.
 * @param {number} width
 * @param {number} height
 * @param {!Buffer|!Array<number>} rgba length width*height*4
 * @return {!Buffer}
 */
function encodePng(width, height, rgba) {
  const crcTable = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Rasterizes a render plan into an RGBA buffer. This is the same rect math
 * the acgraph renderer performs, evaluated with integer pixel coverage so
 * results are reproducible without a browser. Cell rectangles fully cover
 * the view, matching the SVG output where adjacent rects share edges.
 *
 * @param {!Object} plan output of acgraph.heatmap.buildRenderPlan
 * @return {!{width:number, height:number, rgba:!Buffer}}
 */
function rasterizePlan(plan) {
  const width = Math.round(plan.view.width);
  const height = Math.round(plan.view.height);
  const rgba = Buffer.alloc(width * height * 4);
  function parseCssColor(color) {
    const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(color.replace(/\s/g, ''));
    if (m) return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
    if (hex) {
      let value = hex[1];
      if (value.length === 3) value = value.split('').map(ch => ch + ch).join('');
      return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
    }
    throw new Error('rasterizePlan supports rgb()/#hex colors only, got ' + color);
  }
  for (const cell of plan.cells) {
    const [r, g, b] = parseCssColor(cell.color);
    const x0 = Math.max(0, Math.floor(cell.x - plan.view.x));
    const y0 = Math.max(0, Math.floor(cell.y - plan.view.y));
    const x1 = Math.min(width, Math.ceil(cell.x - plan.view.x + cell.width));
    const y1 = Math.min(height, Math.ceil(cell.y - plan.view.y + cell.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const offset = (y * width + x) * 4;
        rgba[offset] = r;
        rgba[offset + 1] = g;
        rgba[offset + 2] = b;
        rgba[offset + 3] = 255;
      }
    }
  }
  return {width, height, rgba};
}

module.exports = {
  REPO_ROOT,
  bootGraphics,
  svgString,
  normalizeSvgIds,
  encodePng,
  rasterizePlan
};
