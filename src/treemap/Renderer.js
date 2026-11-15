/**
 * @fileoverview Two rendering paths for a Treemap:
 * 1. renderToSvg: deterministic, DOM-free SVG string (byte-identical across
 *    runs, module systems and platforms);
 * 2. renderToStage: draws into an existing acgraph Stage via its public API,
 *    without touching any acgraph internals.
 */

'use strict';

function round2(value) {
  return Math.round(value * 100) / 100;
}

function fmt(value) {
  var rounded = round2(value);
  return String(rounded);
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baselineY(rect, label, lineIndex) {
  var blockHeight = label.lines.length * label.lineHeight;
  var top = rect.y + (rect.height - blockHeight) / 2;
  return top + lineIndex * label.lineHeight + label.fontSize * 0.8;
}

/**
 * Renders the treemap as a deterministic SVG string.
 * @param {Object} treemap A Treemap instance.
 * @return {string}
 */
function renderToSvg(treemap) {
  var options = treemap.options;
  var lines = [];
  lines.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + options.width +
    '" height="' + options.height + '" viewBox="0 0 ' + options.width + ' ' +
    options.height + '">');

  if (treemap.allZeroWeight) {
    var cx = options.width / 2;
    var cy = options.height / 2;
    lines.push('  <text font-family="sans-serif" font-size="18" fill="#333333" ' +
      'text-anchor="middle">');
    lines.push('    <tspan x="' + fmt(cx) + '" y="' + fmt(cy + 6) + '">' +
      escapeXml('No data (all weights are zero)') + '</tspan>');
    lines.push('  </text>');
    lines.push('</svg>');
    return lines.join('\n') + '\n';
  }

  treemap.flat.forEach(function(node) {
    if (!node.rect) return;
    var fill = node.isLeaf && node.color ? node.color : 'none';
    var stroke = node.isLeaf && node.color ? '#ffffff' : '#333333';
    lines.push('  <rect data-id="' + escapeXml(node.id) + '" x="' +
      fmt(node.rect.x) + '" y="' + fmt(node.rect.y) + '" width="' +
      fmt(node.rect.width) + '" height="' + fmt(node.rect.height) +
      '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>');
  });

  treemap.flat.forEach(function(node) {
    if (!node.rect || !node.label) return;
    var label = node.label;
    var centerX = node.rect.x + node.rect.width / 2;
    lines.push('  <text data-id="' + escapeXml(node.id) + '" font-family="' +
      options.fontFamily + '" font-size="' + label.fontSize +
      '" fill="#ffffff" text-anchor="middle">');
    for (var i = 0; i < label.lines.length; i++) {
      lines.push('    <tspan x="' + fmt(centerX) + '" y="' +
        fmt(baselineY(node.rect, label, i)) + '">' +
        escapeXml(label.lines[i]) + '</tspan>');
    }
    lines.push('  </text>');
  });

  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

/**
 * Draws the treemap into an acgraph Stage. Only the documented public API
 * (stage.rect / stage.text / chaining setters) is used.
 * @param {Object} treemap
 * @param {Object} stage acgraph Stage instance.
 * @return {Object} The same stage, for chaining.
 */
function renderToStage(treemap, stage) {
  if (!stage || typeof stage.rect !== 'function' || typeof stage.text !== 'function') {
    throw new TypeError('renderToStage requires an acgraph Stage');
  }
  if (treemap.allZeroWeight) {
    stage.text(treemap.options.width / 2, treemap.options.height / 2)
      .text('No data (all weights are zero)')
      .fontSize(18)
      .color('#333333');
    return stage;
  }
  treemap.flat.forEach(function(node) {
    if (!node.rect) return;
    var fill = node.isLeaf && node.color ? node.color : 'none';
    var stroke = node.isLeaf && node.color ? '#ffffff' : '#333333';
    stage.rect(node.rect.x, node.rect.y, node.rect.width, node.rect.height)
      .fill(fill)
      .stroke(stroke, 1);
  });
  treemap.flat.forEach(function(node) {
    if (!node.rect || !node.label) return;
    var label = node.label;
    var centerX = node.rect.x + node.rect.width / 2;
    var text = stage.text(centerX, baselineY(node.rect, label, 0))
      .text(label.lines.join('\n'))
      .fontSize(label.fontSize)
      .color('#ffffff');
    if (typeof text.anchor === 'function') {
      text.anchor('middle');
    }
  });
  return stage;
}

module.exports = {
  renderToSvg: renderToSvg,
  renderToStage: renderToStage,
  baselineY: baselineY,
  round2: round2
};
