// Copyright (c) 2026 GraphicsJS PDF export contributors
// SPDX-License-Identifier: BSD-3-Clause

/**
 * @fileoverview Dependency-free SVG -> PDF converter.
 *
 * Design constraints (see docs/pdf-export.md):
 *  - text is emitted as real PDF text operators (never outlines/bitmaps);
 *  - shapes are emitted as vector path operators with correct line widths,
 *    joins, caps, dashes and alpha;
 *  - page size in points and the DPI used to interpret user units are both
 *    configurable;
 *  - every unsupported construct is skipped explicitly and reported in the
 *    returned warnings array - nothing is dropped silently;
 *  - the module is plain ES5 and runs unchanged in browsers and Node.
 */
if (typeof goog !== 'undefined' && goog.provide) goog.provide('acgraph.pdf.svg2pdf');

(function () {
  'use strict';


  // Browser/jsdom: a bare `acgraph` resolves on the window. Node: no such
  // global, so create one on the module's global object. This keeps a single
  // acgraph.pdf namespace across every module without referencing self/window,
  // which are not in scope inside jsdom's window.eval.
  var g;
  if (typeof acgraph !== 'undefined') {
    g = acgraph;
  } else if (typeof globalThis !== 'undefined') {
    g = globalThis.acgraph = globalThis.acgraph || {};
  } else {
    g = (this.acgraph = this.acgraph || {});
  }
  var pdfNs = g.pdf = g.pdf || {};

  var ttfSubset = pdfNs.ttfSubset ||
      (typeof require === 'function' ? require('./ttfSubset.js') : null);
  var pdfWriterMod = pdfNs.pdfWriter ||
      (typeof require === 'function' ? require('./pdfWriter.js') : null);
  var PdfWriter = pdfWriterMod.PdfWriter;
  var f = pdfWriterMod.utils.f;

  /* ================================================================== */
  /* Error codes                                                         */
  /* ================================================================== */

  var Code = {
    E_SVG_PARSE: 'E_SVG_PARSE',
    E_SVG_EMPTY: 'E_SVG_EMPTY',
    E_PAGE_CONFIG: 'E_PAGE_CONFIG',
    E_FONT_CFF_UNSUPPORTED: 'E_FONT_CFF_UNSUPPORTED',
    E_FONT_FORMAT: 'E_FONT_FORMAT',
    E_FONT_TABLE_MISSING: 'E_FONT_TABLE_MISSING',
    E_FONT_TTC_INDEX: 'E_FONT_TTC_INDEX',
    E_FONT_TRUNCATED: 'E_FONT_TRUNCATED',
    E_NO_FONT_FOR_CODEPOINT: 'E_NO_FONT_FOR_CODEPOINT',
    E_IMAGE_FORMAT: 'E_IMAGE_FORMAT',
    E_IMAGE_DECODE: 'E_IMAGE_DECODE',
    E_TRANSFORM: 'E_TRANSFORM'
  };

  function Svg2PdfError(code, message, detail) {
    this.name = 'Svg2PdfError';
    this.code = code;
    this.message = message;
    this.detail = detail || null;
  }
  Svg2PdfError.prototype = new Error();

  /* ================================================================== */
  /* Minimal XML parser                                                  */
  /* ================================================================== */

  function XmlNode(tag) {
    this.tag = tag;
    this.attributes = {};
    this.children = [];
    this.text = '';
  }

  var XML_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };

  function decodeEntities(s) {
    return s.replace(/&#(x?[0-9a-fA-F]+);|&([a-zA-Z]+);/g, function (m, num, named) {
      if (num) {
        return String.fromCodePoint ?
            String.fromCodePoint(num[0] === 'x' ? parseInt(num.slice(1), 16) : parseInt(num, 10)) :
            String.fromCharCode(num[0] === 'x' ? parseInt(num.slice(1), 16) : parseInt(num, 10));
      }
      return XML_ENTITIES[named] !== undefined ? XML_ENTITIES[named] : m;
    });
  }

  function parseXml(xml) {
    var i = 0;
    var n = xml.length;
    var root = null;
    var stack = [];

    function skipProlog() {
      while (i < n) {
        if (xml.charCodeAt(i) === 0x3C /* < */) {
          if (xml.substr(i, 4) === '<!--') {
            i = xml.indexOf('-->', i + 4);
            i = i < 0 ? n : i + 3;
          } else if (xml.substr(i, 9) === '<!DOCTYPE') {
            i = xml.indexOf('>', i + 9) + 1;
          } else if (xml.substr(i, 8) === '<?xml') {
            i = xml.indexOf('?>', i + 8) + 2;
          } else if (xml.substr(i, 9) === '<![CDATA[') {
            var end = xml.indexOf(']]>', i + 9);
            var text = xml.slice(i + 9, end < 0 ? n : end);
            if (stack.length) stack[stack.length - 1].text += text;
            i = end < 0 ? n : end + 3;
          } else {
            return;
          }
        } else { i++; }
      }
    }

    function parseAttributes(tagEnd) {
      var attrs = {};
      var re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      var head = xml.slice(i, tagEnd);
      var m;
      while ((m = re.exec(head))) {
        attrs[m[1].toLowerCase()] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
      }
      return attrs;
    }

    skipProlog();
    while (i < n) {
      var lt = xml.indexOf('<', i);
      if (lt < 0) break;

      if (xml.substr(lt, 4) === '<!--') {
        var ce = xml.indexOf('-->', lt + 4);
        i = ce < 0 ? n : ce + 3;
        continue;
      }
      if (xml.substr(lt, 9) === '<![CDATA[') {
        var cEnd = xml.indexOf(']]>', lt + 9);
        var cdata = xml.slice(lt + 9, cEnd < 0 ? n : cEnd);
        if (stack.length) stack[stack.length - 1].text += cdata;
        i = cEnd < 0 ? n : cEnd + 3;
        continue;
      }
      if (xml[lt + 1] === '?') {
        var pi = xml.indexOf('?>', lt + 2);
        i = pi < 0 ? n : pi + 2;
        continue;
      }
      if (xml[lt + 1] === '!') {
        var dt = xml.indexOf('>', lt + 2);
        i = dt < 0 ? n : dt + 1;
        continue;
      }

      // Text before the tag.
      if (lt > i && stack.length) {
        var piece = xml.slice(i, lt);
        if (piece.trim()) stack[stack.length - 1].text += decodeEntities(piece);
      }

      var selfClosing = false;
      var gt = xml.indexOf('>', lt);
      if (xml[gt - 1] === '/') selfClosing = true;
      var isClosing = xml[lt + 1] === '/';
      var nameStart = lt + 1 + (isClosing ? 1 : 0);
      var tagNameEnd = nameStart;
      while (tagNameEnd < gt && /[^\s/>]/.test(xml[tagNameEnd])) tagNameEnd++;
      var tagName = xml.slice(nameStart, tagNameEnd).toLowerCase();
      i = tagNameEnd;

      if (isClosing) {
        var open = stack.pop();
        if (!open || open.tag !== tagName) {
          throw new Svg2PdfError(Code.E_SVG_PARSE,
              'mismatched closing tag </' + tagName + '> for <' + (open ? open.tag : 'root') + '>');
        }
        i = gt + 1;
        continue;
      }

      var node = new XmlNode(tagName);
      node.attributes = parseAttributes(gt);

      if (root) {
        if (!stack.length) {
          throw new Svg2PdfError(Code.E_SVG_PARSE, 'multiple root elements or malformed nesting at <' + tagName + '>');
        }
        var parent = stack[stack.length - 1];
        parent.children.push(node);
        node.parent = parent;
      } else {
        root = node;
      }
      if (!selfClosing) stack.push(node);
      i = gt + 1;
    }

    if (!root) throw new Svg2PdfError(Code.E_SVG_PARSE, 'no XML root element found');
    if (stack.length) {
      throw new Svg2PdfError(Code.E_SVG_PARSE, 'unclosed element <' + stack[stack.length - 1].tag + '>');
    }
    return root;
  }

  /* ================================================================== */
  /* CSS / presentation attributes                                       */
  /* ================================================================== */

  function parseStyle(styleStr) {
    var out = {};
    if (!styleStr) return out;
    styleStr.split(';').forEach(function (decl) {
      var p = decl.indexOf(':');
      if (p < 0) return;
      out[decl.slice(0, p).trim().toLowerCase()] = decl.slice(p + 1).trim();
    });
    return out;
  }

  var NAMED_COLORS = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
    blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff',
    magenta: '#ff00ff', gray: '#808080', grey: '#808080', orange: '#ffa500',
    purple: '#800080', silver: '#c0c0c0', lime: '#00ff00', maroon: '#800000',
    navy: '#000080', olive: '#808000', teal: '#008080', transparent: null,
    none: null
  };

  /**
   * @return {?Array<number>} [r,g,b] in 0..1, or null when the paint is none.
   */
  function parseColor(value) {
    if (value === undefined || value === null) return undefined; // inherit/unset
    value = String(value).trim().toLowerCase();
    if (value === 'none' || value === 'transparent') return null;
    if (NAMED_COLORS[value] !== undefined) {
      return NAMED_COLORS[value] === null ? null : parseHex(NAMED_COLORS[value]);
    }
    var m;
    if ((m = /^#([0-9a-f]{3})$/.exec(value))) {
      return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16),
              parseInt(m[1][2] + m[1][2], 16)].map(scale255);
    }
    if ((m = /^#([0-9a-f]{6})$/.exec(value))) {
      return parseHex(value);
    }
    if ((m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?\s*\)$/.exec(value))) {
      return [+m[1], +m[2], +m[3]].map(scale255);
    }
    return undefined; // url(...) references handled by caller
  }

  function parseHex(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16)].map(scale255);
  }
  function scale255(v) { return v / 255; }

  /* ================================================================== */
  /* Transforms                                                          */
  /* ================================================================== */

  // Matrices are [a,b,c,d,e,f] like SVG; composition m1 * m2.
  function identity() { return [1, 0, 0, 1, 0, 0]; }
  function multiply(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function parseTransform(str) {
    if (!str) return identity();
    var result = identity();
    var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    var m;
    while ((m = re.exec(str))) {
      var args = m[2].trim().split(/[\s,]+/).map(Number);
      var t;
      switch (m[1]) {
        case 'matrix': t = args; break;
        case 'translate': t = [1, 0, 0, 1, args[0], args[1] || 0]; break;
        case 'scale': t = [args[0], 0, 0, args.length > 1 ? args[1] : args[0], 0, 0]; break;
        case 'rotate': {
          var ang = args[0] * Math.PI / 180;
          var cos = Math.cos(ang), sin = Math.sin(ang);
          if (args.length === 3) {
            t = multiply([1, 0, 0, 1, args[1], args[2]],
                multiply([cos, sin, -sin, cos, 0, 0], [1, 0, 0, 1, -args[1], -args[2]]));
          } else {
            t = [cos, sin, -sin, cos, 0, 0];
          }
          break;
        }
        case 'skewX': {
          var a = Math.tan(args[0] * Math.PI / 180);
          t = [1, 0, a, 1, 0, 0];
          break;
        }
        case 'skewY': {
          var b = Math.tan(args[0] * Math.PI / 180);
          t = [1, b, 0, 1, 0, 0];
          break;
        }
      }
      result = multiply(result, t);
    }
    return result;
  }

  /* ================================================================== */
  /* SVG path data -> PDF operators                                      */
  /* ================================================================== */

  function tokenizePath(d) {
    var tokens = [];
    var re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
    var m;
    while ((m = re.exec(d))) {
      if (m[1]) tokens.push(m[1]);
      else tokens.push(parseFloat(m[2]));
    }
    return tokens;
  }

  function arcToBezier(x0, y0, rx, ry, xAxisRot, largeArc, sweep, x, y) {
    // Endpoint to center parameterization (SVG 1.1 Appendix F.6).
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return [['L', x, y]];
    var phi = xAxisRot * Math.PI / 180;
    var cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    var dx2 = (x0 - x) / 2, dy2 = (y0 - y) / 2;
    var x1p = cosPhi * dx2 + sinPhi * dy2;
    var y1p = -sinPhi * dx2 + cosPhi * dy2;
    var rx2 = rx * rx, ry2 = ry * ry;
    var x1p2 = x1p * x1p, y1p2 = y1p * y1p;
    var lambda = x1p2 / rx2 + y1p2 / ry2;
    if (lambda > 1) {
      var s = Math.sqrt(lambda);
      rx *= s; ry *= s; rx2 = rx * rx; ry2 = ry * ry;
    }
    var sign = largeArc !== sweep ? 1 : -1;
    var num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
    var coef = sign * Math.sqrt(num / (rx2 * y1p2 + ry2 * x1p2));
    var cxp = coef * (rx * y1p / ry);
    var cyp = coef * (-ry * x1p / rx);
    var cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
    var cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;

    function angle(ux, uy, vx, vy) {
      var dot = ux * vx + uy * vy;
      var len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
      var a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
      return ux * vy - uy * vx < 0 ? -a : a;
    }
    var theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry,
        (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

    var segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
    var out = [];
    // Point and tangent-derived control point on the rotated ellipse.
    // For angle a: P(a) = center + R(phi) * (rx cos a, ry sin a);
    // derivative dP/da = R(phi) * (-rx sin a, ry cos a).
    function point(ang) {
      return [
        cx + rx * (cosPhi * Math.cos(ang) - sinPhi * Math.sin(ang)),
        cy + ry * (sinPhi * Math.cos(ang) + cosPhi * Math.sin(ang))
      ];
    }
    function tangent(ang) {
      return [
        rx * (-cosPhi * Math.sin(ang) - sinPhi * Math.cos(ang)),
        ry * (-sinPhi * Math.sin(ang) + cosPhi * Math.cos(ang))
      ];
    }
    for (var i = 0; i < segments; i++) {
      var a0 = theta1 + dTheta * i / segments;
      var a1 = theta1 + dTheta * (i + 1) / segments;
      var delta = a1 - a0;
      var k = 4 / 3 * Math.sin(delta / 2) / (1 + Math.cos(delta / 2));
      var p0 = point(a0);
      var p1 = point(a1);
      var t0 = tangent(a0);
      var t1 = tangent(a1);
      // Cubic control points: P0 + k * dP0, P1 - k * dP1.
      var c1 = [p0[0] + k * t0[0], p0[1] + k * t0[1]];
      var c2 = [p1[0] - k * t1[0], p1[1] - k * t1[1]];
      out.push(['C', c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]]);
    }
    return out;
  }

  function pathToPdf(d) {
    var tokens = tokenizePath(d);
    var p = 0;
    var x = 0, y = 0, startX = 0, startY = 0;
    var lastCtrl = null, lastCmd = '';
    var commands = [];

    function num() { return tokens[p++]; }
    function reflect(cp) {
      return lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
    }
    function emit(op, args) { commands.push({ op: op, args: args }); }

    while (p < tokens.length) {
      var cmd = tokens[p++];
      if (typeof cmd !== 'string') {
        // Implicit repeat of the previous command.
        p--;
        cmd = lastCmd;
      }
      var rel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z';
      var upper = cmd.toUpperCase();
      switch (upper) {
        case 'M': {
          var nx = num(), ny = num();
          if (rel) { nx += x; ny += y; }
          x = startX = nx; y = startY = ny;
          emit('m', [nx, ny]);
          break;
        }
        case 'L': {
          var lx = num(), ly = num();
          if (rel) { lx += x; ly += y; }
          x = lx; y = ly;
          emit('l', [lx, ly]);
          break;
        }
        case 'H': {
          var hx = num();
          if (rel) hx += x;
          x = hx;
          emit('l', [hx, y]);
          break;
        }
        case 'V': {
          var vy = num();
          if (rel) vy += y;
          y = vy;
          emit('l', [x, vy]);
          break;
        }
        case 'C': {
          var c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num();
          if (rel) {
            c1x += x; c1y += y; c2x += x; c2y += y; ex += x; ey += y;
          }
          emit('c', [c1x, c1y, c2x, c2y, ex, ey]);
          lastCtrl = [c2x, c2y]; x = ex; y = ey;
          break;
        }
        case 'S': {
          var sc2x = num(), sc2y = num(), sex = num(), sey = num();
          var sr1 = reflect(lastCtrl);
          if (rel) { sc2x += x; sc2y += y; sex += x; sey += y; }
          emit('c', [sr1[0], sr1[1], sc2x, sc2y, sex, sey]);
          lastCtrl = [sc2x, sc2y]; x = sex; y = sey;
          break;
        }
        case 'Q': {
          var qx = num(), qy = num(), qex = num(), qey = num();
          if (rel) { qx += x; qy += y; qex += x; qey += y; }
          // Quadratic to cubic: c1 = p0 + 2/3 (q-p0), c2 = p1 + 2/3 (q-p1).
          var qc1x = x + 2 / 3 * (qx - x), qc1y = y + 2 / 3 * (qy - y);
          var qc2x = qex + 2 / 3 * (qx - qex), qc2y = qey + 2 / 3 * (qy - qey);
          emit('c', [qc1x, qc1y, qc2x, qc2y, qex, qey]);
          lastCtrl = [qx, qy]; x = qex; y = qey;
          break;
        }
        case 'T': {
          var tq = reflect(lastCtrl);
          var tex = num(), tey = num();
          if (rel) { tex += x; tey += y; }
          var tc1x = x + 2 / 3 * (tq[0] - x), tc1y = y + 2 / 3 * (tq[1] - y);
          var tc2x = tex + 2 / 3 * (tq[0] - tex), tc2y = tey + 2 / 3 * (tq[1] - tey);
          emit('c', [tc1x, tc1y, tc2x, tc2y, tex, tey]);
          lastCtrl = tq; x = tex; y = tey;
          break;
        }
        case 'A': {
          var arx = num(), ary = num(), rot = num(), large = num(), sweep = num(),
              ax = num(), ay = num();
          if (rel) { ax += x; ay += y; }
          var beziers = arcToBezier(x, y, arx, ary, rot, large, sweep, ax, ay);
          beziers.forEach(function (seg) {
            if (seg[0] === 'L') emit('l', [seg[1], seg[2]]);
            else emit('c', [seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]]);
          });
          lastCtrl = null;
          x = ax; y = ay;
          break;
        }
        case 'Z':
          emit('h', []);
          x = startX; y = startY;
          lastCtrl = null;
          break;
      }
      lastCmd = cmd;
    }
    // PDF order: operands first, operator last, one command per line.
    return commands.map(function (c) {
      return c.args.map(f).join(' ') + (c.args.length ? ' ' : '') + c.op;
    }).join('\n');
  }

  /* ================================================================== */
  /* Font registry                                                       */
  /* ================================================================== */

  /**
   * Registered fonts: {familyLower: {bytes, info, ...}} plus an ordered
   * fallback chain.
   * @constructor
   */
  function FontRegistry() {
    this.fonts = {};
    this.chain = [];
  }

  FontRegistry.prototype.register = function (family, bytes) {
    var info;
    try {
      info = ttfSubset.inspect(bytes);
    } catch (e) {
      throw new Svg2PdfError(e.code || Code.E_FONT_FORMAT,
          'cannot register font "' + family + '": ' + e.message);
    }
    var entry = { family: family, key: family.toLowerCase(), bytes: bytes, info: info };
    this.fonts[entry.key] = entry;
    if (this.chain.indexOf(entry.key) < 0) this.chain.push(entry.key);
    return entry;
  };

  FontRegistry.prototype.findFontForCodepoint = function (preferredFamily, cp) {
    var preferred = preferredFamily ? this.fonts[String(preferredFamily).toLowerCase()] : null;
    if (preferred && preferred.info.covers(cp)) return preferred;
    for (var i = 0; i < this.chain.length; i++) {
      var entry = this.fonts[this.chain[i]];
      if (entry !== preferred && entry.info.covers(cp)) return entry;
    }
    return null;
  };

  /* ================================================================== */
  /* PNG decoding (small, non-interlaced; interlaced warns)              */
  /* ================================================================== */

  function decodePng(bytes) {
    var zlib;
    try {
      zlib = typeof require === 'function' ? require('zlib') :
          (typeof pako !== 'undefined' ? pako : null);
    } catch (e) { zlib = null; }
    if (!zlib) throw new Svg2PdfError(Code.E_IMAGE_DECODE, 'no zlib/pako available for PNG decoding');

    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      throw new Svg2PdfError(Code.E_IMAGE_FORMAT, 'not a PNG image');
    }
    var pos = 8;
    var width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    var idat = [];
    while (pos + 8 <= bytes.length) {
      var len = (bytes[pos] << 24 | bytes[pos + 1] << 16 | bytes[pos + 2] << 8 | bytes[pos + 3]) >>> 0;
      var type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      var data = bytes.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') {
        width = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0;
        height = (data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]) >>> 0;
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        break;
      }
      pos += 12 + len;
    }
    if (interlace) {
      throw new Svg2PdfError(Code.E_IMAGE_FORMAT, 'interlaced PNG (Adam7) is not supported');
    }
    if (bitDepth !== 8) {
      throw new Svg2PdfError(Code.E_IMAGE_FORMAT, 'PNG bit depth ' + bitDepth + ' is not supported (only 8)');
    }
    var channels;
    if (colorType === 2) channels = 3;
    else if (colorType === 6) channels = 4;
    else if (colorType === 0) channels = 1;
    else throw new Svg2PdfError(Code.E_IMAGE_FORMAT, 'PNG color type ' + colorType + ' is not supported');

    var inflated = zlib.inflateSync(concatBytes(idat));
    var stride = width * channels;
    var raw = new Uint8Array(stride * height);
    var src = 0;
    function paeth(a, b, c) {
      var p = a + b - c;
      var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
    }
    for (var y = 0; y < height; y++) {
      var filter = inflated[src++];
      var rowStart = y * stride;
      var prevStart = rowStart - stride;
      for (var x = 0; x < stride; x++) {
        var val = inflated[src++];
        var left = x >= channels ? raw[rowStart + x - channels] : 0;
        var up = y > 0 ? raw[prevStart + x] : 0;
        var upLeft = y > 0 && x >= channels ? raw[prevStart + x - channels] : 0;
        if (filter === 1) val = (val + left) & 0xFF;
        else if (filter === 2) val = (val + up) & 0xFF;
        else if (filter === 3) val = (val + ((left + up) >> 1)) & 0xFF;
        else if (filter === 4) val = (val + paeth(left, up, upLeft)) & 0xFF;
        raw[rowStart + x] = val;
      }
    }

    var rgb, alpha = null;
    if (channels === 4) {
      rgb = new Uint8Array(width * height * 3);
      alpha = new Uint8Array(width * height);
      for (var i = 0; i < width * height; i++) {
        rgb[i * 3] = raw[i * 4];
        rgb[i * 3 + 1] = raw[i * 4 + 1];
        rgb[i * 3 + 2] = raw[i * 4 + 2];
        alpha[i] = raw[i * 4 + 3];
      }
    } else if (channels === 3) {
      rgb = raw;
    } else {
      rgb = new Uint8Array(width * height * 3);
      for (var j = 0; j < width * height; j++) {
        rgb[j * 3] = rgb[j * 3 + 1] = rgb[j * 3 + 2] = raw[j];
      }
    }
    return { width: width, height: height, data: rgb, alpha: alpha,
      colorSpace: 'DeviceRGB', bitsPerComponent: 8 };
  }

  function concatBytes(parts) {
    var total = parts.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  function dataUriToBytes(uri) {
    var m = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(uri);
    if (!m) return null;
    if (m[2]) {
      var bin = atob(m[3].replace(/\s/g, ''));
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { mime: m[1], bytes: bytes };
    }
    return { mime: m[1], bytes: utf8Bytes(decodeURIComponent(m[3])) };
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | c >> 6, 0x80 | c & 0x3F);
      else out.push(0xE0 | c >> 12, 0x80 | c >> 6 & 0x3F, 0x80 | c & 0x3F);
    }
    return new Uint8Array(out);
  }

  /* ================================================================== */
  /* Main converter                                                      */
  /* ================================================================== */

  var DEFAULTS = {
    width: null,       // page width in pt; defaults to SVG viewport width
    height: null,
    dpi: 72,           // user-unit -> point scale when width/height omitted
    compress: true,
    title: 'GraphicsJS Export',
    preserveAspectRatio: true
  };

  /**
   * @param {string} svgText
   * @param {Object} options
   * @param {FontRegistry} registry
   * @return {{bytes:Uint8Array, warnings:Array, diagnostics:Object,
   *          extractedText:Array<string>}}
   */
  function convert(svgText, options, registry) {
    var opts = {};
    Object.keys(DEFAULTS).forEach(function (k) { opts[k] = DEFAULTS[k]; });
    if (options) Object.keys(options).forEach(function (k) { opts[k] = options[k]; });

    if (typeof svgText !== 'string' || !svgText.trim()) {
      throw new Svg2PdfError(Code.E_SVG_EMPTY, 'SVG input is empty');
    }
    if (opts.dpi !== undefined && (!(opts.dpi > 0) || !isFinite(opts.dpi))) {
      throw new Svg2PdfError(Code.E_PAGE_CONFIG, 'dpi must be a positive number, got ' + opts.dpi);
    }
    if (opts.width !== undefined && opts.width !== null &&
        (!(opts.width > 0) || !isFinite(opts.width))) {
      throw new Svg2PdfError(Code.E_PAGE_CONFIG, 'page width must be a positive number');
    }
    if (opts.height !== undefined && opts.height !== null &&
        (!(opts.height > 0) || !isFinite(opts.height))) {
      throw new Svg2PdfError(Code.E_PAGE_CONFIG, 'page height must be a positive number');
    }

    var root = parseXml(svgText);
    if (root.tag !== 'svg') {
      throw new Svg2PdfError(Code.E_SVG_PARSE, 'root element is <' + root.tag + '>, expected <svg>');
    }

    var warnings = [];
    function warn(code, message, node) {
      warnings.push({
        code: code,
        message: message,
        element: node ? node.tag : null,
        id: node && (node.attributes.id || node.attributes['ac-id']) || null
      });
    }

    var scale = opts.dpi / 72;
    var view = parseViewBox(root.attributes.viewbox);
    var svgW = parseUserLength(root.attributes.width);
    var svgH = parseUserLength(root.attributes.height);
    // Percentage/100%-sized stages (GraphicsJS default) fall back to the
    // viewBox, then to an explicit page size.
    if (!(svgW > 0)) svgW = view ? view.width : 0;
    if (!(svgH > 0)) svgH = view ? view.height : 0;
    var pageW = opts.width || svgW * scale;
    var pageH = opts.height || svgH * scale;
    if (!(pageW > 0) || !(pageH > 0)) {
      throw new Svg2PdfError(Code.E_PAGE_CONFIG,
          'cannot determine page size: SVG has no usable width/height/viewBox and no explicit page size');
    }
    var uniform = Math.min(pageW / (svgW || pageW), pageH / (svgH || pageH));
    var sx, sy;
    if (!opts.preserveAspectRatio && svgW && svgH) {
      sx = pageW / svgW; sy = pageH / svgH;
    } else {
      sx = sy = uniform;
    }
    // Content origin inside the viewBox (default 0,0).
    var vbX = view ? view.minX : 0;
    var vbY = view ? view.minY : 0;

    var writer = new PdfWriter({
      width: pageW, height: pageH, title: opts.title, compress: opts.compress
    });

    var ctx = {
      writer: writer,
      registry: registry,
      warnings: warnings,
      warn: warn,
      pageW: pageW,
      pageH: pageH,
      // Flip Y once at the root: SVG top-left origin -> PDF bottom-left,
      // then translate so viewBox (minX,minY) maps to the page origin.
      rootMatrix: [sx, 0, 0, -sy, -vbX * sx, pageH + vbY * sy],
      fontSubsets: {},   // font entry key -> accumulated state
      extractedText: [],
      sourceText: [],
      defs: {},          // id -> def node
      clipPaths: {},
      elementCount: 0,
      textElementCount: 0,
      skippedElementCount: 0
    };

    indexDefs(root, ctx);
    prepareFonts(root, ctx);
    var content = renderNode(root, ctx.rootMatrix, ctx);
    writer.addPage(content);
    var bytes = writer.build();

    var diagnostics = {
      pageSize: { width: Math.round(pageW * 1000) / 1000, height: Math.round(pageH * 1000) / 1000 },
      dpi: opts.dpi,
      elementCount: ctx.elementCount,
      textElementCount: ctx.textElementCount,
      skippedElementCount: ctx.skippedElementCount,
      warningCount: warnings.length,
      warnings: warnings,
      pdfBytes: bytes.length,
      svgBytes: svgText.length,
      contentStreamBytes: writer.streamInputBytes,
      encodedStreamBytes: writer.streamOutputBytes,
      fontsUsed: Object.keys(ctx.fontSubsets),
      textLines: ctx.extractedText.slice()
    };

    return {
      bytes: bytes,
      warnings: warnings,
      diagnostics: diagnostics,
      extractedText: ctx.extractedText.slice(),
      sourceText: ctx.sourceText.slice()
    };
  }

  /* ================================================================== */
  /* Defs indexing                                                       */
  /* ================================================================== */

  function indexDefs(node, ctx) {
    if (node.tag === 'lineargradient' || node.tag === 'radialgradient') {
      var id = node.attributes.id;
      if (id) ctx.defs[id] = node;
    }
    if (node.tag === 'clippath') {
      var cid = node.attributes.id;
      if (cid) ctx.clipPaths[cid] = node;
    }
    if (node.tag === 'pattern') {
      var pid = node.attributes.id;
      if (pid) {
        ctx.defs[pid] = node;
        ctx.warn('W_PATTERN_DOWNGRADE',
            'pattern fills are rendered with the first pattern paint, not tiled', node);
      }
    }
    node.children.forEach(function (c) { indexDefs(c, ctx); });
  }

  /* ================================================================== */
  /* Rendering                                                           */
  /* ================================================================== */

  function renderNode(node, matrix, ctx) {
    var local = node.attributes.transform ? multiply(matrix, parseTransform(node.attributes.transform)) : matrix;
    var out = [];

    if (node.tag === 'svg' || node.tag === 'g') {
      // Container opacity applies to the whole subtree.
      var groupAlpha = parseOpacity(node.attributes.opacity);
      var gsName = null;
      if (groupAlpha !== null && groupAlpha < 1) {
        gsName = ctx.writer.addExtGState(groupAlpha, groupAlpha);
        out.push('/' + gsName + ' gs');
      }
      node.children.forEach(function (child) {
        out.push(renderNode(child, local, ctx));
      });
      return out.filter(Boolean).join('\n');
    }

    if (node.tag === 'defs' || node.tag === 'title' || node.tag === 'desc' ||
        node.tag === 'metadata') {
      return '';
    }

    ctx.elementCount++;

    if (node.tag === 'path') {
      return renderPath(node, local, ctx, node.attributes.d);
    }
    if (node.tag === 'rect') {
      return renderPath(node, local, ctx, rectToD(node.attributes));
    }
    if (node.tag === 'circle') {
      return renderPath(node, local, ctx, circleToD(node.attributes));
    }
    if (node.tag === 'ellipse') {
      return renderPath(node, local, ctx, ellipseToD(node.attributes));
    }
    if (node.tag === 'line') {
      var a = node.attributes;
      return renderPath(node, local, ctx,
          'M ' + numOr(a.x1, 0) + ' ' + numOr(a.y1, 0) + ' L ' + numOr(a.x2, 0) + ' ' + numOr(a.y2, 0));
    }
    if (node.tag === 'polyline' || node.tag === 'polygon') {
      return renderPath(node, local, ctx, pointsToD(node.attributes, node.tag === 'polygon'));
    }
    if (node.tag === 'text') {
      return renderText(node, local, ctx);
    }
    if (node.tag === 'image') {
      return renderImage(node, local, ctx);
    }
    if (node.tag === 'use') {
      ctx.warn('W_USE_UNSUPPORTED', '<use> references are not inlined; element skipped', node);
      ctx.skippedElementCount++;
      return '';
    }
    if (node.tag === 'textpath') {
      ctx.warn('W_TEXTPATH_DOWNGRADE', 'textPath cannot follow a path in PDF; element skipped', node);
      ctx.skippedElementCount++;
      return '';
    }
    if (node.tag === 'filter' || node.tag === 'mask') {
      ctx.warn('W_FILTER_DOWNGRADE', node.tag + ' defs are not applied (PDF filters/masks unsupported)', node);
      ctx.skippedElementCount++;
      return '';
    }

    ctx.warn('W_ELEMENT_UNSUPPORTED', 'element <' + node.tag + '> has no PDF mapping and was skipped', node);
    ctx.skippedElementCount++;
    return '';
  }

  /* -------------------- shapes -------------------- */

  function rectToD(a) {
    var x = numOr(a.x, 0), y = numOr(a.y, 0);
    var w = numOr(a.width, 0), h = numOr(a.height, 0);
    var r = numOr(a.rx, numOr(a.ry, 0));
    if (!r) return 'M ' + x + ' ' + y + ' H ' + (x + w) + ' V ' + (y + h) + ' H ' + x + ' Z';
    r = Math.min(r, w / 2, h / 2);
    return 'M ' + (x + r) + ' ' + y +
        ' H ' + (x + w - r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) +
        ' V ' + (y + h - r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) +
        ' H ' + (x + r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r) +
        ' V ' + (y + r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + ' Z';
  }

  function circleToD(a) {
    var cx = numOr(a.cx, 0), cy = numOr(a.cy, 0), r = numOr(a.r, 0);
    if (!r) return '';
    return 'M ' + (cx - r) + ' ' + cy +
        ' A ' + r + ' ' + r + ' 0 1 0 ' + (cx + r) + ' ' + cy +
        ' A ' + r + ' ' + r + ' 0 1 0 ' + (cx - r) + ' ' + cy + ' Z';
  }

  function ellipseToD(a) {
    var cx = numOr(a.cx, 0), cy = numOr(a.cy, 0);
    var rx = numOr(a.rx, 0), ry = numOr(a.ry, 0);
    if (!rx || !ry) return '';
    return 'M ' + (cx - rx) + ' ' + cy +
        ' A ' + rx + ' ' + ry + ' 0 1 0 ' + (cx + rx) + ' ' + cy +
        ' A ' + rx + ' ' + ry + ' 0 1 0 ' + (cx - rx) + ' ' + cy + ' Z';
  }

  function pointsToD(a, close) {
    var pts = (a.points || '').trim().split(/[\s,]+/).filter(Boolean);
    if (pts.length < 2) return '';
    var d = 'M ' + pts[0] + ' ' + pts[1];
    for (var i = 2; i + 1 < pts.length; i += 2) d += ' L ' + pts[i] + ' ' + pts[i + 1];
    if (close) d += ' Z';
    return d;
  }

  function renderPath(node, matrix, ctx, d) {
    if (!d) {
      ctx.warn('W_EMPTY_PATH', 'path without geometry was skipped', node);
      ctx.skippedElementCount++;
      return '';
    }
    var style = parseStyle(node.attributes.style);
    var paint = resolvePaint(node, style, ctx);
    var stroke = resolveStroke(node, style, ctx);
    var out = [];

    out.push('q');
    out.push(formatMatrix(matrix));
    var alpha = parseOpacity(node.attributes.opacity);
    if (alpha !== null && alpha < 1) {
      var gs = ctx.writer.addExtGState(
          paint.fillAlpha === null ? alpha : Math.min(alpha, paint.fillAlpha),
          stroke.strokeAlpha === null ? alpha : Math.min(alpha, stroke.strokeAlpha));
      out.push('/' + gs + ' gs');
    } else {
      if (paint.fillAlpha !== null && paint.fillAlpha < 1) {
        out.push('/' + ctx.writer.addExtGState(paint.fillAlpha, stroke.strokeAlpha === null ? 1 : stroke.strokeAlpha) + ' gs');
      } else if (stroke.strokeAlpha !== null && stroke.strokeAlpha < 1) {
        out.push('/' + ctx.writer.addExtGState(1, stroke.strokeAlpha) + ' gs');
      }
    }

    var pathOps;
    try {
      pathOps = pathToPdf(d);
    } catch (e) {
      ctx.warn('W_PATH_PARSE', 'malformed path data, element skipped: ' + e.message, node);
      ctx.skippedElementCount++;
      return '';
    }
    out.push(pathOps);

    // PDF consumes the current path on a paint operator, so a shape that is
    // both filled and stroked must paint twice (re-emitting the identical
    // path). Stroke first, then fill, matching SVG's fill-over-stroke paint
    // order.
    if (stroke.paint) {
      out.push(stroke.paint.map(f).join(' ') + ' RG');
      out.push(f(stroke.width) + ' w');
      out.push(stroke.cap + ' J');
      out.push(stroke.join + ' j');
      if (stroke.miterLimit !== null) out.push(f(stroke.miterLimit) + ' M');
      if (stroke.dashArray.length) {
        out.push('[' + stroke.dashArray.map(f).join(' ') + '] ' + f(stroke.dashOffset) + ' d');
      }
      if (paint.fill) out.push(pathOps); // re-supply path consumed below by S
      out.push('S');
    }
    if (paint.fill) {
      if (paint.patternName) {
        out.push('/' + paint.patternName + ' scn');
      } else {
        out.push(paint.fill.map(f).join(' ') + ' rg');
      }
      if (stroke.paint) out.push(pathOps); // path was consumed by S above
      out.push(paint.evenOdd ? 'f*' : 'f');
    }
    out.push('Q');
    return out.join('\n');
  }

  function formatMatrix(m) {
    // PDF cm uses [a b c d e f] with the same layout as SVG, in user space.
    return [m[0], m[1], m[2], m[3], m[4], m[5]].map(f).join(' ') + ' cm';
  }

  /* -------------------- paint resolution -------------------- */

  function resolvePaint(node, style, ctx) {
    var fillAttr = firstDefined(style.fill, node.attributes.fill, '#000000');
    var result = { fill: null, fillAlpha: parseOpacity(style['fill-opacity'] !== undefined ?
        style['fill-opacity'] : node.attributes['fill-opacity']), patternName: null, evenOdd: false };

    if (node.attributes['fill-rule'] === 'evenodd' || style['fill-rule'] === 'evenodd') {
      result.evenOdd = true;
    }
    var urlRef = /url\(\s*["']?#([^)"']+)["']?\s*\)/.exec(fillAttr);
    if (urlRef) {
      var def = ctx.defs[urlRef[1]];
      if (!def) {
        ctx.warn('W_FILL_REF_MISSING', 'fill references unknown #' + urlRef[1] + ', element left unfilled', node);
        return result;
      }
      if (def.tag === 'lineargradient' || def.tag === 'radialgradient') {
        result.patternName = buildGradientPattern(def, node, ctx);
        result.fill = [0, 0, 0]; // color ignored when pattern color space is used
        return result;
      }
      if (def.tag === 'pattern') {
        // Explicit downgrade: use the first paint found inside the pattern.
        var firstColor = findFirstPaint(def);
        if (firstColor) result.fill = firstColor;
        return result;
      }
      ctx.warn('W_FILL_REF_UNSUPPORTED', 'fill reference #' + urlRef[1] + ' is not a gradient/pattern, unfilled', node);
      return result;
    }
    var color = parseColor(fillAttr);
    if (color === undefined) {
      ctx.warn('W_COLOR_UNPARSED', 'fill color "' + fillAttr + '" could not be parsed, using black', node);
      color = [0, 0, 0];
    }
    result.fill = color;
    return result;
  }

  function findFirstPaint(patternNode) {
    for (var i = 0; i < patternNode.children.length; i++) {
      var c = patternNode.children[i];
      var st = parseStyle(c.attributes.style);
      var color = parseColor(firstDefined(st.fill, c.attributes.fill));
      if (color) return color;
    }
    return [0, 0, 0];
  }

  function buildGradientPattern(gradientNode, targetNode, ctx) {
    var stops = [];
    gradientNode.children.forEach(function (child) {
      if (child.tag !== 'stop') return;
      var st = parseStyle(child.attributes.style);
      var colorAttr = firstDefined(st['stop-color'], child.attributes['stop-color'], '#000000');
      var color = parseColor(colorAttr) || [0, 0, 0];
      var offset = parseStopOffset(child.attributes.offset);
      var stopAlpha = parseOpacity(firstDefined(st['stop-opacity'], child.attributes['stop-opacity']));
      if (stopAlpha !== null && stopAlpha < 1) {
        ctx.writer && ctx.warn('W_GRADIENT_STOP_ALPHA',
            'gradient stop opacity is not representable in an axial shading; rendered opaque', child);
      }
      stops.push({ offset: offset, rgb: color });
    });
    if (!stops.length) stops = [{ offset: 0, rgb: [0, 0, 0] }, { offset: 1, rgb: [1, 1, 1] }];
    stops.sort(function (a, b) { return a.offset - b.offset; });

    // Object bounding box coordinates (gradientUnits default).
    var bbox = getBBox(targetNode);
    var x1, y1, x2, y2;
    if (gradientNode.tag === 'radialgradient') {
      ctx.warn('W_RADIAL_GRADIENT_DOWNGRADE',
          'radial gradients are approximated with an axial gradient', gradientNode);
      var cx = numOr(gradientNode.attributes.cx, 0.5), cy = numOr(gradientNode.attributes.cy, 0.5);
      var r = numOr(gradientNode.attributes.r, 0.5);
      x1 = bbox.x + (cx - r) * bbox.w; y1 = bbox.y + cy * bbox.h;
      x2 = bbox.x + (cx + r) * bbox.w; y2 = bbox.y + cy * bbox.h;
    } else {
      x1 = bbox.x + numOr(gradientNode.attributes.x1, 0) * bbox.w;
      y1 = bbox.y + numOr(gradientNode.attributes.y1, 0) * bbox.h;
      x2 = bbox.x + numOr(gradientNode.attributes.x2, 1) * bbox.w;
      y2 = bbox.y + numOr(gradientNode.attributes.y2, 0) * bbox.h;
    }
    if (gradientNode.attributes.gradientunits === 'userspaceonuse') {
      x1 = numOr(gradientNode.attributes.x1, 0); y1 = numOr(gradientNode.attributes.y1, 0);
      x2 = numOr(gradientNode.attributes.x2, 1); y2 = numOr(gradientNode.attributes.y2, 0);
    }
    return ctx.writer.addAxialPattern([x1, y1, x2, y2], stops,
        [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h]);
  }

  function getBBox(node) {
    var a = node.attributes;
    if (node.tag === 'rect') {
      return { x: numOr(a.x, 0), y: numOr(a.y, 0), w: numOr(a.width, 0), h: numOr(a.height, 0) };
    }
    if (node.tag === 'circle' || node.tag === 'ellipse') {
      var rx = node.tag === 'circle' ? numOr(a.r, 0) : numOr(a.rx, 0);
      var ry = node.tag === 'circle' ? numOr(a.r, 0) : numOr(a.ry, 0);
      return { x: numOr(a.cx, 0) - rx, y: numOr(a.cy, 0) - ry, w: rx * 2, h: ry * 2 };
    }
    // Fall back: scan the path data for a bounding box.
    var nums = (a.d || '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
    var xs = [], ys = [];
    if (nums) {
      for (var i = 0; i + 1 < nums.length; i += 2) {
        xs.push(parseFloat(nums[i]));
        ys.push(parseFloat(nums[i + 1]));
      }
    }
    if (!xs.length) return { x: 0, y: 0, w: 1, h: 1 };
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function resolveStroke(node, style, ctx) {
    var strokeAttr = firstDefined(style.stroke, node.attributes.stroke, 'none');
    var result = {
      paint: null,
      width: parseFloat(firstDefined(style['stroke-width'], node.attributes['stroke-width'], '1')),
      cap: { butt: 0, round: 1, square: 2 }[
          firstDefined(style['stroke-linecap'], node.attributes['stroke-linecap'], 'butt')] || 0,
      join: { miter: 0, round: 1, bevel: 2 }[
          firstDefined(style['stroke-linejoin'], node.attributes['stroke-linejoin'], 'miter')] || 0,
      miterLimit: numOr(firstDefined(style['stroke-miterlimit'], node.attributes['stroke-miterlimit']), null),
      dashArray: [],
      dashOffset: numOr(style['stroke-dashoffset'] || node.attributes['stroke-dashoffset'], 0),
      strokeAlpha: parseOpacity(firstDefined(style['stroke-opacity'], node.attributes['stroke-opacity']))
    };
    var urlRef = /url\(\s*["']?#([^)"']+)["']?\s*\)/.exec(strokeAttr);
    if (urlRef) {
      ctx.warn('W_STROKE_GRADIENT_UNSUPPORTED',
          'gradient strokes are not supported in PDF; stroke skipped', node);
      result.paint = null;
      return result;
    }
    var color = parseColor(strokeAttr);
    if (color === undefined) {
      ctx.warn('W_COLOR_UNPARSED', 'stroke color "' + strokeAttr + '" could not be parsed, stroke skipped', node);
      color = null;
    }
    result.paint = color;
    var dash = firstDefined(style['stroke-dasharray'], node.attributes['stroke-dasharray']);
    if (dash && dash !== 'none') {
      result.dashArray = dash.split(/[\s,]+/).filter(Boolean).map(Number);
    }
    return result;
  }

  /* -------------------- text -------------------- */

  /**
   * Pass 1: walk every <text> node in document order, resolve the covering
   * font for every codepoint, collect per-font codepoint sets and build the
   * embedded subset + PDF font resource once. Text order captured here is the
   * same order pass 2 emits operators, so extraction order matches the source.
   */
  function prepareFonts(node, ctx) {
    if (node.tag === 'text') {
      var style = parseStyle(node.attributes.style);
      var family = parseFontFamily(firstDefined(style['font-family'], node.attributes['font-family'], 'sans-serif'));
      var lines = collectTextLines(node);
      lines.forEach(function (line) {
        var runs = splitIntoRuns(line.text, family, ctx);
        runs.forEach(function (run) {
          var state = ctx.fontSubsets[run.font.key];
          if (!state) {
            state = { font: run.font, codepoints: {}, resourceName: null, subset: null };
            ctx.fontSubsets[run.font.key] = state;
          }
          for (var i = 0; i < run.text.length; i++) {
            var cp = run.text.codePointAt ? run.text.codePointAt(i) : run.text.charCodeAt(i);
            if (cp > 0xFFFF) i++;
            state.codepoints[cp] = true;
          }
        });
      });
    }
    node.children.forEach(function (child) { prepareFonts(child, ctx); });

    // Build subsets only when the traversal returns to the root call.
    if (node.tag === 'svg') {
      Object.keys(ctx.fontSubsets).forEach(function (key) {
        buildSubset(ctx.fontSubsets[key], ctx);
      });
    }
  }

  function renderText(node, matrix, ctx) {
    ctx.textElementCount++;
    var style = parseStyle(node.attributes.style);
    var fontSize = parseFloat(firstDefined(style['font-size'], node.attributes['font-size'], '16'));
    var fontFamily = parseFontFamily(firstDefined(style['font-family'], node.attributes['font-family'], 'sans-serif'));
    var anchor = firstDefined(style['text-anchor'], node.attributes['text-anchor'], 'start');
    var fillColor = parseColor(firstDefined(style.fill, node.attributes.fill, '#000000')) || [0, 0, 0];
    var fontWeight = firstDefined(style['font-weight'], node.attributes['font-weight'], 'normal');
    if (/bold|[7-9]00/.test(fontWeight)) {
      ctx.warn('W_FONT_WEIGHT_DOWNGRADE',
          'font weight "' + fontWeight + '" is not embedded; rendered with the registered regular face', node);
    }
    var fontStyle = firstDefined(style['font-style'], node.attributes['font-style'], 'normal');
    if (fontStyle === 'italic' || fontStyle === 'oblique') {
      ctx.warn('W_FONT_STYLE_DOWNGRADE', 'italic/oblique text is rendered upright (no synthetic slant)', node);
    }

    // Collect tspans (GraphicsJS emits one tspan per line) in document order.
    var lines = collectTextLines(node);
    if (!lines.length) return '';
    var out = ['q', formatMatrix(matrix), fillColor.map(f).join(' ') + ' rg'];

    lines.forEach(function (line) {
      var sourceLine = line.text;
      ctx.sourceText.push(sourceLine);
      var x = line.x !== null ? line.x : numOr(node.attributes.x, 0);
      var y = line.y !== null ? line.y : numOr(node.attributes.y, 0);

      // Split the source string into runs by covering font, preserving order.
      var runs = splitIntoRuns(sourceLine, fontFamily, ctx);
      var totalAdvance = 0;
      var runWidths = runs.map(function (run) {
        if (!run.text) return 0;
        var state = ctx.fontSubsets[run.font.key];
        return measureRun(run.text, state) / 1000 * fontSize;
      });
      runs.forEach(function (run, ri) {
        if (!run.text) return;
        totalAdvance += runWidths[ri];
      });

      var anchorOffset = anchor === 'middle' ? -totalAdvance / 2 :
          anchor === 'end' ? -totalAdvance : 0;
      // Total text transform = rootCm * Tm. The root cm flips Y (-sy), so a
      // Tm with d = -1 cancels the mirror and keeps glyphs upright; its
      // translation f equals the positive SVG baseline y, which the cm then
      // maps to the correct device-space position.
      var baselineY = y;
      var cursor = x + anchorOffset;
      out.push('BT');
      runs.forEach(function (run, ri) {
        if (!run.text) return;
        var state = ctx.fontSubsets[run.font.key];
        var encoded = encodeRun(run.text, state);
        out.push('1 0 0 -1 ' + f(cursor) + ' ' + f(baselineY) + ' Tm');
        out.push('/' + state.resourceName + ' ' + f(fontSize) + ' Tf');
        out.push('<' + encoded + '> Tj');
        cursor += runWidths[ri];
      });
      out.push('ET');
      ctx.extractedText.push(sourceLine);
    });

    out.push('Q');
    return out.join('\n');
  }

  function collectTextLines(node) {
    var lines = [];
    var baseX = numOr(node.attributes.x, 0);
    var baseY = numOr(node.attributes.y, 0);
    var tspans = node.children.filter(function (c) { return c.tag === 'tspan'; });
    if (!tspans.length) {
      var direct = node.text.trim();
      if (direct) lines.push({ text: direct, x: baseX, y: baseY });
      return lines;
    }
    var cumulativeY = baseY;
    tspans.forEach(function (ts) {
      var text = (ts.text + ts.children.filter(function (c) {
        return c.tag !== 'tspan';
      }).map(function (c) { return c.text; }).join('')).trim();
      if (!text) return;
      var x = ts.attributes.x !== undefined ? parseFloat(ts.attributes.x) : baseX;
      if (ts.attributes.dy !== undefined) cumulativeY += parseFloat(ts.attributes.dy);
      var y = ts.attributes.y !== undefined ? parseFloat(ts.attributes.y) : cumulativeY;
      lines.push({ text: text, x: x, y: y });
      cumulativeY = y;
    });
    return lines;
  }

  function parseFontFamily(value) {
    if (!value) return 'sans-serif';
    var first = value.split(',')[0].trim().toLowerCase();
    return first.replace(/['"]/g, '');
  }

  function splitIntoRuns(text, preferredFamily, ctx) {
    var runs = [];
    var current = null;
    for (var i = 0; i < text.length; i++) {
      var cp = text.codePointAt ? text.codePointAt(i) : text.charCodeAt(i);
      if (cp > 0xFFFF) i++; // surrogate pair
      var font = ctx.registry.findFontForCodepoint(preferredFamily, cp);
      if (!font) {
        ctx.warn(Code.E_NO_FONT_FOR_CODEPOINT,
            'no registered font covers U+' + cp.toString(16).toUpperCase() +
            ' ("' + text[i] + '"); glyph emitted as .notdef, text order preserved',
            null);
        font = ctx.registry.fonts[ctx.registry.chain[0]];
        if (!font) continue;
      }
      if (!current || current.font.key !== font.key) {
        current = { font: font, text: '' };
        runs.push(current);
      }
      current.text += cp > 0xFFFF ? String.fromCodePoint(cp) : text[i];
    }
    return runs;
  }

  // Maps a Unicode codepoint to its NEW glyph id inside the subset font.
  function newGidFor(cp, state) {
    var oldGid = state.subset.charToGid[cp] || 0;
    return state.subset.gidMap[oldGid] === undefined ? 0 : state.subset.gidMap[oldGid];
  }

  function encodeRun(text, state) {
    var hex = '';
    for (var i = 0; i < text.length; i++) {
      var cp = text.codePointAt ? text.codePointAt(i) : text.charCodeAt(i);
      if (cp > 0xFFFF) i++;
      var gid = newGidFor(cp, state);
      hex += ('0000' + gid.toString(16)).slice(-4);
    }
    return hex;
  }

  function measureRun(text, state) {
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      var cp = text.codePointAt ? text.codePointAt(i) : text.charCodeAt(i);
      if (cp > 0xFFFF) i++;
      var gid = newGidFor(cp, state);
      total += state.subset.widths[gid] || 0;
    }
    return total;
  }

  function buildSubset(state, ctx) {
    var cps = Object.keys(state.codepoints).map(Number);
    var result;
    try {
      result = ttfSubset.subset(state.font.bytes, cps);
    } catch (e) {
      throw new Svg2PdfError(e.code || Code.E_FONT_FORMAT, 'font subsetting failed: ' + e.message);
    }
    var numGlyphs = Object.keys(result.gidMap).length;
    var gidWidths = [];
    for (var gid = 0; gid < numGlyphs; gid++) {
      gidWidths.push(Math.round((result.widths[gid] || 0) * 1000 / result.unitsPerEm));
    }
    var gidToUnicode = {};
    Object.keys(result.charToGid).forEach(function (cpStr) {
      var oldGid = result.charToGid[cpStr];
      var newGid = result.gidMap[oldGid];
      if (newGid) gidToUnicode[newGid] = Number(cpStr);
    });
    state.subset = result;
    state.descriptor = {
      psName: makePsName(state.font.info.family || 'SubsetFont'),
      subsetBytes: result.bytes,
      bbox: result.bbox.map(function (v) {
        return Math.round(v * 1000 / result.unitsPerEm);
      }),
      ascent: Math.round(result.ascent * 1000 / result.unitsPerEm),
      descent: Math.round(result.descent * 1000 / result.unitsPerEm),
      capHeight: Math.round(result.capHeight * 1000 / result.unitsPerEm),
      gidWidths: gidWidths,
      gidToUnicode: gidToUnicode
    };
    state.resourceName = ctx.writer.addFont(state.descriptor);
  }

  function makePsName(family) {
    return family.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) || 'SubsetFont';
  }

  /* -------------------- images -------------------- */

  function renderImage(node, matrix, ctx) {
    var href = node.attributes.href || node.attributes['xlink:href'];
    if (!href) {
      ctx.warn('W_IMAGE_NO_SOURCE', 'image element without href was skipped', node);
      ctx.skippedElementCount++;
      return '';
    }
    var parsed = dataUriToBytes(href);
    if (!parsed) {
      ctx.warn('W_IMAGE_EXTERNAL',
          'external (non-data-URI) images cannot be embedded; element skipped', node);
      ctx.skippedElementCount++;
      return '';
    }
    var img;
    if (/jpe?g/.test(parsed.mime)) {
      img = { dctBytes: parsed.bytes,
        width: numOr(node.attributes.width, 0), height: numOr(node.attributes.height, 0) };
      // Width/height are needed for the XObject dictionary but JPEG carries its
      // own frame; recover via SOF0 marker.
      var dims = readJpegDimensions(parsed.bytes);
      img.width = dims.width;
      img.height = dims.height;
    } else if (/png/.test(parsed.mime)) {
      try {
        img = decodePng(parsed.bytes);
      } catch (e) {
        ctx.warn(e.code || Code.E_IMAGE_DECODE, e.message + '; image skipped', node);
        ctx.skippedElementCount++;
        return '';
      }
    } else {
      ctx.warn('W_IMAGE_FORMAT', 'image mime "' + parsed.mime + '" is not supported (PNG/JPEG only); skipped', node);
      ctx.skippedElementCount++;
      return '';
    }
    var name = ctx.writer.addImage(img);
    var x = numOr(node.attributes.x, 0);
    var y = numOr(node.attributes.y, 0);
    var w = numOr(node.attributes.width, img.width);
    var h = numOr(node.attributes.height, img.height);
    var opacity = parseOpacity(node.attributes.opacity);
    var out = ['q'];
    if (opacity !== null && opacity < 1) {
      out.push('/' + ctx.writer.addExtGState(opacity, opacity) + ' gs');
    }
    out.push(formatMatrix(matrix));
    // Place with bottom-left origin inside the (already Y-flipped) user space.
    out.push(f(w) + ' 0 0 ' + f(h) + ' ' + f(x) + ' ' + f(y) + ' cm');
    out.push('/' + name + ' Do');
    out.push('Q');
    return out.join('\n');
  }

  function readJpegDimensions(bytes) {
    var pos = 2;
    while (pos + 9 < bytes.length) {
      if (bytes[pos] !== 0xFF) { pos++; continue; }
      var marker = bytes[pos + 1];
      var segLen = (bytes[pos + 2] << 8 | bytes[pos + 3]);
      if (marker >= 0xC0 && marker <= 0xCF &&
          marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return {
          height: bytes[pos + 5] << 8 | bytes[pos + 6],
          width: bytes[pos + 7] << 8 | bytes[pos + 8]
        };
      }
      pos += 2 + segLen;
    }
    throw new Svg2PdfError(Code.E_IMAGE_DECODE, 'could not read JPEG dimensions');
  }

  /* ================================================================== */
  /* Small value helpers                                                 */
  /* ================================================================== */

  function firstDefined() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== undefined && arguments[i] !== '') return arguments[i];
    }
    return undefined;
  }

  function numOr(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    var n = parseFloat(value);
    return isNaN(n) ? fallback : n;
  }

  function parseOpacity(value) {
    if (value === undefined || value === null || value === '') return null;
    var n = parseFloat(value);
    if (isNaN(n)) return null;
    return Math.min(1, Math.max(0, n));
  }

  function parseLength(value) {
    if (value === undefined || value === null) return 0;
    var m = /^([\d.]+)(px|pt|mm|cm|in)?$/.exec(String(value).trim());
    if (!m) return parseFloat(value) || 0;
    var n = parseFloat(m[1]);
    switch (m[2]) {
      case 'pt': return n;
      case 'mm': return n * 72 / 25.4;
      case 'cm': return n * 72 / 2.54;
      case 'in': return n * 72;
      default: return n; // px/user unit
    }
  }

  // Like parseLength but returns 0 for percentages and non-length values.
  function parseUserLength(value) {
    if (value === undefined || value === null || /%$/.test(String(value).trim())) return 0;
    return parseLength(value);
  }

  function parseViewBox(value) {
    if (!value) return null;
    var parts = String(value).trim().split(/[\s,]+/).map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return null;
    return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
  }

  function parseStopOffset(value) {
    if (!value) return 0;
    if (/%$/.test(value)) return Math.min(1, parseFloat(value) / 100);
    return Math.min(1, Math.max(0, parseFloat(value)));
  }

  /* ================================================================== */
  /* Exports                                                             */
  /* ================================================================== */

  pdfNs.svg2pdf = {
    convert: convert,
    FontRegistry: FontRegistry,
    parseXml: parseXml,
    pathToPdf: pathToPdf,
    parseTransform: parseTransform,
    parseColor: parseColor,
    Svg2PdfError: Svg2PdfError,
    Code: Code
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = pdfNs.svg2pdf;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
