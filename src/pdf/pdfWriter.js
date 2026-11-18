// Copyright (c) 2026 GraphicsJS PDF export contributors
// SPDX-License-Identifier: BSD-3.

/**
 * @fileoverview Low level, dependency-free PDF 1.7 writer.
 *
 * The writer owns object numbering, stream dictionaries (with optional Flate
 * compression), the cross-reference table and the document catalog. Higher
 * level concerns (SVG parsing, font subsetting) live in the other modules.
 */
if (typeof goog !== 'undefined' && goog.provide) goog.provide('acgraph.pdf.pdfWriter');

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

  /* ------------------------------------------------------------------ */
  /* Optional Flate compression (Node zlib; browsers may inject pako)    */
  /* ------------------------------------------------------------------ */

  var deflate = null;
  try {
    if (typeof require === 'function') {
      deflate = require('zlib').deflateSync;
    }
  } catch (e) { deflate = null; }

  /**
   * Lets browser bundles inject a synchronous deflate implementation
   * (e.g. pako.deflate). Without one, streams are written uncompressed,
   * which remains a fully valid PDF.
   * @param {function(Uint8Array):Uint8Array} fn
   */
  function setDeflate(fn) { deflate = fn; }

  /* ------------------------------------------------------------------ */
  /* Text/number formatting helpers                                       */
  /* ------------------------------------------------------------------ */

  function pdfEscape(str) {
    return str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
        .replace(/\r/g, '\\r');
  }

  function f(n) {
    // 4 decimals max, strip trailing zeros; -0 -> 0.
    if (!isFinite(n)) return '0';
    var r = Math.round(n * 10000) / 10000;
    if (r === 0) r = 0;
    return String(r);
  }

  // Formats an indirect object reference: 14 -> "14 0 R".
  function R(ref) { return ref + ' 0 R'; }

  function utf16beHex(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out += cp.toString(16).toUpperCase();
        i++;
      } else {
        out += (c < 16 ? '0' : '') + c.toString(16).toUpperCase() +
               (str.charCodeAt(i) <= 0xFF ? '' : '');
        // ensure exactly 4 hex digits per BMP unit
        if (c <= 0xFF) out = out.slice(0, out.length - 2) + '00' + c.toString(16).toUpperCase();
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Writer                                                               */
  /* ------------------------------------------------------------------ */

  /**
   * @param {{width:number, height:number, title?:string, author?:string,
   *          compress?:boolean}} options Page size in PDF points.
   * @constructor
   */
  function PdfWriter(options) {
    this.width = options.width;
    this.height = options.height;
    this.title = options.title || 'GraphicsJS Export';
    this.author = options.author || 'GraphicsJS';
    this.compress = options.compress !== false && !!deflate;
    this.objects = [];          // index 1..n, entries are strings or Uint8Array
    this.objectBytes = 0;       // accounting only
    this.streamInputBytes = 0;
    this.streamOutputBytes = 0;
    this.pageRefs = [];
    this.fontCount = 0;
    this.gsCount = 0;
    this.shadingCount = 0;
    this.patternCount = 0;
    this.imageCount = 0;
    this.usedResourceFonts = [];
    this.usedResourceGs = [];
    this.usedResourcePatterns = [];
    this.usedResourceImages = [];
    this.usedResourceShadings = [];
  }

  PdfWriter.prototype.alloc = function () {
    this.objects.push(null);
    return this.objects.length; // 1-based object number
  };

  PdfWriter.prototype.writeObject = function (ref, body) {
    this.objects[ref - 1] = body;
    this.objectBytes += body.length;
  };

  /**
   * Writes a stream object. Returns the object reference.
   * @param {string} dictExtra Extra dictionary entries (without outer << >>).
   * @param {Uint8Array|string} data Stream payload.
   * @return {number}
   */
  PdfWriter.prototype.addStream = function (dictExtra, data) {
    var ref = this.alloc();
    if (typeof data === 'string') data = uint8FromAscii(data);
    this.streamInputBytes += data.length;
    var filter = '';
    var payload = data;
    if (this.compress && data.length) {
      var z = deflate(data);
      payload = z instanceof Uint8Array ? z : new Uint8Array(z);
      filter = '/Filter /FlateDecode ';
    }
    this.streamOutputBytes += payload.length;
    var dict = '<< ' + filter + '/Length ' + payload.length + ' ' + dictExtra + ' >>';
    var body = dict + '\nstream\n';
    this.writeObject(ref, { head: body, bytes: payload, tail: '\nendstream' });
    return ref;
  };

  /* -------------------- resources -------------------- */

  /**
   * @param {Object} font Subset descriptor from the font registry.
   * @return {string} Resource name usable in content, e.g. /F1.
   */
  PdfWriter.prototype.addFont = function (font) {
    var n = ++this.fontCount;
    var baseName = '/ABCDEE+' + font.psName;
    var descriptor = this.alloc();
    var fileRef = this.addStream('/Length1 ' + font.subsetBytes.length + ' /Subtype /TrueType',
        font.subsetBytes);
    var cidFont = this.alloc();
    var tounicode = this.addStream('', buildToUnicode(font));
    var widths = this.alloc();

    this.writeObject(widths, '[0 [' + font.gidWidths.map(f).join(' ') + ']]');

    this.writeObject(descriptor,
      '<< /Type /FontDescriptor /FontName ' + baseName +
      ' /Flags 4 /FontBBox [' + font.bbox.map(f).join(' ') + ']' +
      ' /ItalicAngle 0 /Ascent ' + f(font.ascent) + ' /Descent ' + f(font.descent) +
      ' /CapHeight ' + f(font.capHeight) + ' /StemV 80' +
      ' /FontFile2 ' + R(fileRef) + ' >>');

    this.writeObject(cidFont,
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont ' + baseName +
      ' /CIDToGIDMap /Identity /FontDescriptor ' + R(descriptor) +
      ' /DW 1000 /W ' + R(widths) + ' >>');

    var topFont = this.alloc();
    this.writeObject(topFont,
      '<< /Type /Font /Subtype /Type0 /BaseFont ' + baseName +
      ' /Encoding /Identity-H /DescendantFonts [' + R(cidFont) + ']' +
      ' /ToUnicode ' + R(tounicode) + ' >>');

    var name = 'F' + n;
    this.usedResourceFonts.push({ name: name, ref: topFont });
    return name;
  };

  /**
   * @param {number} fillAlpha 0..1
   * @param {number} strokeAlpha 0..1
   * @return {string} Resource name, e.g. /GS1.
   */
  PdfWriter.prototype.addExtGState = function (fillAlpha, strokeAlpha) {
    var n = ++this.gsCount;
    var ref = this.alloc();
    this.writeObject(ref, '<< /Type /ExtGState /ca ' + f(fillAlpha) + ' /CA ' + f(strokeAlpha) +
        ' /AIS false >>');
    var name = 'GS' + n;
    this.usedResourceGs.push({ name: name, ref: ref });
    return name;
  };

  /**
   * Axial shading with arbitrary stop count (stitching function for >2 stops).
   * coords in PDF user space; stops are [{offset, rgb:[r,g,b]}].
   * @return {string} Pattern resource name.
   */
  PdfWriter.prototype.addAxialPattern = function (coords, stops, bbox) {
    var shadingRef = this.alloc();
    var functionBody;
    if (stops.length === 2) {
      functionBody = exponentialFunction(stops[0].rgb, stops[1].rgb);
    } else {
      var bounds = [];
      var encode = [];
      var functions = [];
      for (var i = 0; i < stops.length - 1; i++) {
        functions.push(this.alloc());
        if (i > 0) bounds.push(stops[i].offset);
        encode.push('0 1');
      }
      for (var j = 0; j < stops.length - 1; j++) {
        this.writeObject(functions[j], exponentialFunction(stops[j].rgb, stops[j + 1].rgb));
      }
      functionBody = '<< /FunctionType 3 /Domain [0 1] /Functions [' + functions.map(R).join(' ') + ']' +
          ' /Bounds [' + bounds.map(f).join(' ') + '] /Encode [' + encode.join(' ') + '] >>';
    }
    this.writeObject(shadingRef,
      '<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [' + coords.map(f).join(' ') + ']' +
      ' /Function ' + functionBody + ' /Extend [true true] >>');

    var patternRef = this.alloc();
    this.writeObject(patternRef,
      '<< /Type /Pattern /PatternType 2 /Shading ' + R(shadingRef) +
      ' /Matrix [1 0 0 1 0 0] /BBox [' + bbox.map(f).join(' ') + '] >>');
    var name = 'P' + (++this.patternCount);
    this.usedResourcePatterns.push({ name: name, ref: patternRef });
    return name;
  };

  /**
   * Embeds a raster image.
   * @param {Object} img Decoded image {width,height,data(RGB bytes),alpha(bytes|null),
   *                     colorSpace, bitsPerComponent, dctBytes?}.
   * @return {string} Image resource name.
   */
  PdfWriter.prototype.addImage = function (img) {
    var name = 'Im' + (++this.imageCount);
    var ref;
    if (img.dctBytes) {
      ref = this.addStream(
          '/Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /DCTDecode', img.dctBytes);
    } else {
      var extra = '/Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
          ' /ColorSpace /' + (img.colorSpace || 'DeviceRGB') +
          ' /BitsPerComponent ' + (img.bitsPerComponent || 8);
      if (img.alpha) {
        var smask = this.addStream(
            '/Type /XObject /Subtype /Image /Width ' + img.width + ' /Height ' + img.height +
            ' /ColorSpace /DeviceGray /BitsPerComponent 8', img.alpha);
        extra += ' /SMask ' + R(smask);
      }
      ref = this.addStream(extra, img.data);
    }
    this.usedResourceImages.push({ name: name, ref: ref });
    return name;
  };

  /* -------------------- document assembly -------------------- */

  /**
   * @param {string} content Full page content stream source.
   */
  PdfWriter.prototype.addPage = function (content) {
    var contentRef = this.addStream('', content);
    var pageRef = this.alloc();
    var resources = ['/Resources <<'];
    if (this.usedResourceFonts.length) {
      resources.push('/Font << ' + this.usedResourceFonts.map(function (x) {
        return '/' + x.name + ' ' + R(x.ref);
      }).join(' ') + ' >>');
    }
    if (this.usedResourceGs.length) {
      resources.push('/ExtGState << ' + this.usedResourceGs.map(function (x) {
        return '/' + x.name + ' ' + R(x.ref);
      }).join(' ') + ' >>');
    }
    if (this.usedResourcePatterns.length) {
      resources.push('/Pattern << ' + this.usedResourcePatterns.map(function (x) {
        return '/' + x.name + ' ' + R(x.ref);
      }).join(' ') + ' >>');
    }
    if (this.usedResourceImages.length) {
      resources.push('/XObject << ' + this.usedResourceImages.map(function (x) {
        return '/' + x.name + ' ' + R(x.ref);
      }).join(' ') + ' >>');
    }
    resources.push('>>');
    this.writeObject(pageRef,
      '<< /Type /Page /Parent PAGES_REF /MediaBox [0 0 ' + f(this.width) + ' ' + f(this.height) + ']' +
      ' ' + resources.join(' ') + ' /Contents ' + R(contentRef) + ' >>');
    this.pageRefs.push(pageRef);
    return pageRef;
  };

  /**
   * Serializes the whole document.
   * @return {Uint8Array}
   */
  PdfWriter.prototype.build = function () {
    var pagesRef = this.alloc();
    var catalogRef = this.alloc();
    var infoRef = this.alloc();

    this.writeObject(catalogRef,
      '<< /Type /Catalog /Pages ' + R(pagesRef) +
      ' /ViewerPreferences << /DisplayDocTitle true >> >>');
    this.writeObject(pagesRef,
      '<< /Type /Pages /Kids [' + this.pageRefs.map(R).join(' ') + '] /Count ' + this.pageRefs.length + ' >>');
    this.writeObject(infoRef, '<< /Title (' + pdfEscape(this.title) + ')' +
      ' /Author (' + pdfEscape(this.author) + ')' +
      ' /Producer (GraphicsJS local PDF exporter 1.0) >>');

    // Patch PAGES_REF placeholders in page objects.
    for (var i = 0; i < this.pageRefs.length; i++) {
      var idx = this.pageRefs[i] - 1;
      this.objects[idx] = this.objects[idx].replace('PAGES_REF', R(pagesRef));
    }

    var chunks = [];
    var header = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
    chunks.push(uint8FromAscii(header));
    var offsets = [0];
    var position = chunks[0].length;

    for (var ref = 1; ref <= this.objects.length; ref++) {
      var obj = this.objects[ref - 1];
      offsets[ref] = position;
      var head = ref + ' 0 obj\n';
      if (obj && typeof obj === 'object' && obj.head !== undefined) {
        var tailStr = obj.tail + '\nendobj\n';
        chunks.push(uint8FromAscii(head + obj.head));
        chunks.push(obj.bytes);
        chunks.push(uint8FromAscii(tailStr));
        position += head.length + obj.head.length + obj.bytes.length + tailStr.length;
      } else {
        var body = head + obj + '\nendobj\n';
        chunks.push(uint8FromAscii(body));
        position += body.length;
      }
    }

    var xrefStart = position;
    // Each xref entry is exactly 20 bytes (including the line ending).
    var xref = 'xref\n0 ' + (this.objects.length + 1) + '\n0000000000 65535 f \n';
    for (var k = 1; k <= this.objects.length; k++) {
      xref += pad10(offsets[k]) + ' 00000 n ' + '\n';
    }
    xref += 'trailer\n<< /Size ' + (this.objects.length + 1) + ' /Root ' + R(catalogRef) +
        ' /Info ' + R(infoRef) + ' >>\nstartxref\n' + xrefStart + '\n%%EOF';
    chunks.push(uint8FromAscii(xref));

    var total = 0;
    chunks.forEach(function (c) { total += c.length; });
    var out = new Uint8Array(total);
    var pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  };

  /* -------------------- helpers -------------------- */

  function buildToUnicode(font) {
    var lines = ['/CIDInit /ProcSet findresource begin',
      '12 dict begin', 'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
      '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
    // bfchar blocks allow at most 100 entries.
    var entries = [];
    Object.keys(font.gidToUnicode).forEach(function (gidStr) {
      var gid = Number(gidStr);
      entries.push('<' + pad4(gid) + '> <' + pad4(font.gidToUnicode[gid]) + '>');
    });
    for (var i = 0; i < entries.length; i += 100) {
      var block = entries.slice(i, i + 100);
      lines.push(block.length + ' beginbfchar');
      lines = lines.concat(block);
      lines.push('endbfchar');
    }
    lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
    return lines.join('\n');
  }

  function exponentialFunction(c0, c1) {
    return '<< /FunctionType 2 /Domain [0 1] /C0 [' + c0.map(f).join(' ') + ']' +
        ' /C1 [' + c1.map(f).join(' ') + '] /N 1 >>';
  }

  function pad10(n) { return ('0000000000' + n).slice(-10); }
  function pad4(n) { var s = n.toString(16).toUpperCase(); while (s.length < 4) s = '0' + s; return s; }

  function uint8FromAscii(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
    return out;
  }

  pdfNs.pdfWriter = {
    PdfWriter: PdfWriter,
    setDeflate: setDeflate,
    utils: { f: f, pdfEscape: pdfEscape, utf16beHex: utf16beHex }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = pdfNs.pdfWriter;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
