// Copyright (c) 2026 GraphicsJS PDF export contributors
// SPDX-License-Identifier: BSD-3-Clause

/**
 * @fileoverview Minimal, dependency-free TrueType (TTF) font subsetter.
 *
 * Produces a valid TTF containing only the glyphs required by the exported
 * document, so PDF text stays selectable while embedded font streams stay
 * small. Only glyf-based TTF files are supported; CFF-based OTF files are
 * rejected explicitly (callers must record a degradation warning instead of
 * silently dropping text).
 *
 * The module is written in plain ES5 and exposes itself both as a Closure
 * namespace (acgraph.pdf.ttfSubset) and as a CommonJS module.
 */
if (typeof goog !== 'undefined' && goog.provide) goog.provide('acgraph.pdf.ttfSubset');

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

  /**
   * Error thrown for fonts that cannot be subset (CFF/OTF, TTC without index,
   * truncated tables). Carries a machine readable code.
   * @param {string} code
   * @param {string} message
   * @constructor
   */
  function TtfError(code, message) {
    this.name = 'TtfError';
    this.code = code;
    this.message = message;
  }
  TtfError.prototype = new Error();

  /* ------------------------------------------------------------------ */
  /* Small byte helpers                                                  */
  /* ------------------------------------------------------------------ */

  function Reader(bytes) {
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.bytes = bytes;
  }
  Reader.prototype.u16 = function (o) { return this.dv.getUint16(o); };
  Reader.prototype.i16 = function (o) { return this.dv.getInt16(o); };
  Reader.prototype.u32 = function (o) { return this.dv.getUint32(o); };
  Reader.prototype.i32 = function (o) { return this.dv.getInt32(o); };

  function Writer(size) {
    this.buf = new ArrayBuffer(size);
    this.dv = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
    this.pos = 0;
  }
  Writer.prototype.u16 = function (v) { this.dv.setUint16(this.pos, v); this.pos += 2; };
  Writer.prototype.i16 = function (v) { this.dv.setInt16(this.pos, v); this.pos += 2; };
  Writer.prototype.u32 = function (v) { this.dv.setUint32(this.pos, v >>> 0); this.pos += 4; };
  Writer.prototype.i32 = function (v) { this.dv.setInt32(this.pos, v); this.pos += 4; };
  Writer.prototype.bytesAt = function (data, offset, length) {
    this.bytes.set(data.subarray(offset, offset + length), this.pos);
    this.pos += length;
  };
  Writer.prototype.zero = function (n) {
    while (n--) this.bytes[this.pos++] = 0;
  };

  /* ------------------------------------------------------------------ */
  /* Table directory                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * @param {Uint8Array} fontBytes
   * @param {number=} opt_ttcIndex For TTC collections, which font to pick.
   * @return {{tables: Object, reader: Reader}}
   */
  function readDirectory(fontBytes, opt_ttcIndex) {
    var r = new Reader(fontBytes);
    if (fontBytes.length < 12) throw new TtfError('E_FONT_TRUNCATED', 'font file is too small');
    var sig = r.u32(0);
    var tableDirOffset = 0;

    if (sig === 0x74746366 /* 'ttcf' */) {
      var fontIndex = opt_ttcIndex || 0;
      var numFonts = r.u32(8);
      if (fontIndex >= numFonts) {
        throw new TtfError('E_FONT_TTC_INDEX', 'TTC font index out of range: ' + fontIndex);
      }
      tableDirOffset = r.u32(12 + fontIndex * 4);
      sig = r.u32(tableDirOffset);
    }

    if (sig === 0x4f54544f /* 'OTTO' */) {
      throw new TtfError('E_FONT_CFF_UNSUPPORTED',
          'CFF-based OpenType fonts cannot be subset by the built-in TTF subsetter');
    }
    if (sig !== 0x00010000 && sig !== 0x74727565 /* 'true' */) {
      throw new TtfError('E_FONT_FORMAT', 'not a TrueType font (sfnt signature 0x' + sig.toString(16) + ')');
    }

    var numTables = r.u16(tableDirOffset + 4);
    var tables = {};
    var p = tableDirOffset + 12;
    for (var i = 0; i < numTables; i++, p += 16) {
      var tag = '';
      for (var j = 0; j < 4; j++) tag += String.fromCharCode(r.bytes[p + j]);
      tables[tag] = {
        tag: tag,
        checksum: r.u32(p + 4),
        offset: r.u32(p + 8),
        length: r.u32(p + 12)
      };
    }
    ['cmap', 'glyf', 'loca', 'head', 'hhea', 'hmtx', 'maxp', 'name'].forEach(function (t) {
      if (!tables[t]) throw new TtfError('E_FONT_TABLE_MISSING', 'required table missing: ' + t);
    });
    return { tables: tables, reader: r };
  }

  /* ------------------------------------------------------------------ */
  /* cmap reading                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Returns a function codepoint -> glyph id (0 when unmapped).
   */
  function buildCmapLookup(fontBytes, tables, reader) {
    var base = tables.cmap.offset;
    var numSubtables = reader.u16(base + 2);
    var best = null; // score, offset
    // Prefer Windows Unicode BMP (3,1), then Unicode (0,*), then anything.
    for (var i = 0; i < numSubtables; i++) {
      var rec = base + 4 + i * 8;
      var platform = reader.u16(rec);
      var encoding = reader.u16(rec + 2);
      var off = reader.u32(rec + 4);
      var score = -1;
      if (platform === 3 && (encoding === 1 || encoding === 10)) score = 5;
      else if (platform === 0) score = 4;
      else if (platform === 3 && encoding === 0) score = 3;
      if (score > 0 && (!best || score > best.score)) best = { score: score, offset: off };
    }
    if (!best) {
      var first = reader.u32(base + 4 + 4);
      best = { score: 0, offset: first };
    }
    var fmtOffset = base + best.offset;
    var format = reader.u16(fmtOffset);
    var map = {};

    if (format === 0) {
      for (var c = 0; c < 256; c++) {
        var g = reader.bytes[fmtOffset + 6 + c];
        if (g) map[c] = g;
      }
    } else if (format === 4) {
      var segCount = reader.u16(fmtOffset + 6) / 2;
      var endP = fmtOffset + 14;
      var startP = endP + 2 * segCount + 2;
      var deltaP = startP + 2 * segCount;
      var rangeP = deltaP + 2 * segCount;
      for (var s = 0; s < segCount; s++) {
        var endCode = reader.u16(endP + s * 2);
        var startCode = reader.u16(startP + s * 2);
        var idDelta = reader.i16(deltaP + s * 2);
        var idRangeOffset = reader.u16(rangeP + s * 2);
        for (var code = startCode; code <= endCode && code !== 0xFFFF; code++) {
          var glyph;
          if (idRangeOffset === 0) {
            glyph = (code + idDelta) & 0xFFFF;
          } else {
            // The offset is relative to the location of the idRangeOffset
            // field itself; the glyph id array starts right after the array.
            var addr = rangeP + s * 2 + idRangeOffset + 2 * (code - startCode);
            glyph = addr + 2 <= fontBytes.length ? reader.u16(addr) : 0;
            if (glyph) glyph = (glyph + idDelta) & 0xFFFF;
          }
          if (glyph) map[code] = glyph;
        }
      }
    } else if (format === 12 || format === 13) {
      var nGroups = reader.u32(fmtOffset + 12);
      var gp = fmtOffset + 16;
      for (var k = 0; k < nGroups; k++, gp += 12) {
        var startChar = reader.u32(gp);
        var endChar = reader.u32(gp + 4);
        var startGlyph = reader.u32(gp + 8);
        for (var ch = startChar; ch <= endChar; ch++) {
          var gid = format === 12 ? startGlyph + (ch - startChar) : startGlyph;
          if (gid) map[ch] = gid;
        }
      }
    } else {
      throw new TtfError('E_FONT_CMAP_FORMAT', 'unsupported cmap subtable format: ' + format);
    }
    return function (codepoint) { return map[codepoint] || 0; };
  }

  /* ------------------------------------------------------------------ */
  /* Composite glyph traversal                                           */
  /* ------------------------------------------------------------------ */

  var FLAG_WORDS = 0x0001;
  var FLAG_MORE_COMPONENTS = 0x0020;
  var FLAG_WE_HAVE_SCALE = 0x0008;
  var FLAG_WE_HAVE_XY_SCALE = 0x0040;
  var FLAG_WE_HAVE_2X2 = 0x0080;

  function componentGids(reader, glyfOffset, glyfLength) {
    var out = [];
    if (glyfLength < 2) return out;
    var numContours = reader.i16(glyfOffset);
    if (numContours >= 0) return out;
    var p = glyfOffset + 10; // skip header (numberOfContours + bbox)
    var flags;
    do {
      flags = reader.u16(p);
      var gid = reader.u16(p + 2);
      out.push(gid);
      p += 4;
      p += flags & FLAG_WORDS ? 4 : 2;
      if (flags & FLAG_WE_HAVE_SCALE) p += 2;
      else if (flags & FLAG_WE_HAVE_XY_SCALE) p += 4;
      else if (flags & FLAG_WE_HAVE_2X2) p += 8;
    } while (flags & FLAG_MORE_COMPONENTS);
    return out;
  }

  /**
   * Rewrites a composite glyph's component glyph indexes to the new GID space.
   */
  function remapComposite(reader, glyfOffset, glyfLength, gidMap, out) {
    var p = glyfOffset;
    out.i16(reader.i16(p)); p += 2;
    out.i16(reader.i16(p)); p += 2; // xMin
    out.i16(reader.i16(p)); p += 2; // yMin
    out.i16(reader.i16(p)); p += 2; // xMax
    out.i16(reader.i16(p)); p += 2; // yMax
    var flags;
    do {
      flags = reader.u16(p);
      var oldGid = reader.u16(p + 2);
      var newGid = gidMap[oldGid];
      if (newGid === undefined) {
        throw new TtfError('E_FONT_SUBSET', 'composite references glyph outside subset: ' + oldGid);
      }
      out.u16(flags);
      out.u16(newGid);
      p += 4;
      var argSize = flags & FLAG_WORDS ? 4 : 2;
      out.bytesAt(reader.bytes, p, argSize);
      p += argSize;
      var transformSize = 0;
      if (flags & FLAG_WE_HAVE_SCALE) transformSize = 2;
      else if (flags & FLAG_WE_HAVE_XY_SCALE) transformSize = 4;
      else if (flags & FLAG_WE_HAVE_2X2) transformSize = 8;
      if (transformSize) {
        out.bytesAt(reader.bytes, p, transformSize);
        p += transformSize;
      }
    } while (flags & FLAG_MORE_COMPONENTS);
  }

  /* ------------------------------------------------------------------ */
  /* cmap format 4 builder (BMP only)                                    */
  /* ------------------------------------------------------------------ */

  function buildCmapFormat4(chars, charToGid, gidMap) {
    // Build contiguous segments over the sorted BMP codepoints.
    var points = chars.filter(function (c) { return c > 0 && c <= 0xFFFF; }).sort(function (a, b) {
      return a - b;
    });
    var segments = [];
    for (var i = 0; i < points.length; i++) {
      var start = points[i];
      var end = start;
      while (i + 1 < points.length && points[i + 1] === end + 1) { end = points[++i]; }
      segments.push([start, end]);
    }
    // Format 4 needs a final 0xFFFF sentinel segment.
    segments.push([0xFFFF, 0xFFFF]);
    var segCount = segments.length;

    // Layout: 14 byte header, endCode[n], reservedPad, startCode[n],
    // idDelta[n], idRangeOffset[n], then the glyphIdArray (one u16 per
    // covered codepoint; the sentinel contributes a literal 0).
    var glyphIds = [];
    segments.forEach(function (s) {
      if (s[0] === 0xFFFF) { glyphIds.push(0); return; }
      for (var code = s[0]; code <= s[1]; code++) {
        glyphIds.push(gidMap[charToGid[code]]);
      }
    });
    // Subtable body: 14 byte header + four u16 arrays (8 u16 per segment)
    // + glyphIdArray entries. Allocate a conservative upper bound and record
    // the true written length afterwards.
    var subtableLength = 14 + 16 * segCount + glyphIds.length * 2;
    var body = new Writer(subtableLength);
    body.u16(4);                                  // format
    body.u16(0);                                  // length placeholder, backfilled
    body.u16(0);                                  // language
    body.u16(segCount * 2);                       // segCountX2
    var maxPow2 = Math.pow(2, Math.floor(Math.log(segCount) / Math.LN2));
    body.u16(maxPow2 * 2);                        // searchRange
    body.u16(Math.floor(Math.log(segCount) / Math.LN2)); // entrySelector
    body.u16(segCount * 2 - maxPow2 * 2);         // rangeShift
    segments.forEach(function (s) { body.u16(s[1]); }); // endCode
    body.u16(0);                                  // reservedPad
    segments.forEach(function (s) { body.u16(s[0]); }); // startCode
    // idDelta is unused because every segment reads its glyph id directly
    // from the glyphIdArray that immediately follows idRangeOffset.
    segments.forEach(function () { body.u16(0); });
    // Constant offset from any idRangeOffset slot to the glyph array start.
    var rangeOffsetConstant = 2 * segCount;
    segments.forEach(function () { body.u16(rangeOffsetConstant); });
    glyphIds.forEach(function (gid) { body.u16(gid); });
    body.dv.setUint16(2, body.pos); // backfill true subtable length
    return body;
  }

  /* ------------------------------------------------------------------ */
  /* Checksum + full font assembly                                       */
  /* ------------------------------------------------------------------ */

  function tableChecksum(bytes) {
    var padded = bytes.length + (4 - (bytes.length % 4 || 4));
    var sum = 0;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var i = 0;
    for (; i + 4 <= bytes.length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
    var tail = bytes.length - i;
    if (tail) {
      var rem = 0;
      for (var j = 0; j < 4; j++) {
        rem = ((rem << 8) | (j < tail ? bytes[i + j] : 0)) >>> 0;
      }
      sum = (sum + rem) >>> 0;
    }
    return sum;
  }

  function readGlyphRange(reader, tables, gid) {
    var locaLong = reader.u16(tables.head.offset + 50) === 1;
    if (locaLong) {
      return {
        start: reader.u32(tables.loca.offset + gid * 4),
        end: reader.u32(tables.loca.offset + (gid + 1) * 4)
      };
    }
    return {
      start: reader.u16(tables.loca.offset + gid * 2) * 2,
      end: reader.u16(tables.loca.offset + (gid + 1) * 2) * 2
    };
  }

  /**
   * Subset a TTF font.
   *
   * @param {Uint8Array} fontBytes Source font (TTF or first face of a TTC).
   * @param {number[]} codepoints Unicode codepoints that must be present.
   * @param {function(number):number} cmapLookup codepoint -> source GID.
   * @param {Object} tables Parsed table directory.
   * @param {Reader} reader
   * @return {{bytes: Uint8Array, gidMap: Object, missing: number[], widths: Object,
   *           unitsPerEm: number, bbox: number[], ascent: number, descent: number}}
   */
  function assembleSubset(fontBytes, codepoints, cmapLookup, tables, reader) {
    // 1. Resolve the GID set (0 = .notdef always included), expanding composites.
    var oldGids = [0];
    var seen = { 0: true };
    var missing = [];
    var charToGid = {};
    codepoints.forEach(function (cp) {
      var gid = cmapLookup(cp);
      charToGid[cp] = gid;
      if (!gid) {
        if (missing.indexOf(cp) < 0) missing.push(cp);
        return;
      }
      if (!seen[gid]) { seen[gid] = true; oldGids.push(gid); }
    });
    var queue = oldGids.slice();
    while (queue.length) {
      var g = queue.shift();
      var range = readGlyphRange(reader, tables, g);
      componentGids(reader, tables.glyf.offset + range.start, range.end - range.start).forEach(function (cg) {
        if (!seen[cg]) { seen[cg] = true; oldGids.push(cg); queue.push(cg); }
      });
    }

    // Keep .notdef at GID 0, everything else in deterministic arrival order.
    var gidMap = { 0: 0 };
    oldGids.forEach(function (oldGid, idx) { gidMap[oldGid] = idx; });
    var numGlyphs = oldGids.length;

    // 2. Build glyf + loca (long format).
    var glyfChunks = [];
    var locaValues = [0];
    var glyfLen = 0;
    oldGids.forEach(function (oldGid) {
      var range = readGlyphRange(reader, tables, oldGid);
      var gOffset = tables.glyf.offset + range.start;
      var gLen = range.end - range.start;
      var chunk;
      if (gLen === 0) {
        chunk = new Uint8Array(0);
      } else if (reader.i16(gOffset) < 0) {
        var cw = new Writer(gLen + 16);
        remapComposite(reader, gOffset, gLen, gidMap, cw);
        chunk = cw.bytes.subarray(0, cw.pos);
      } else {
        chunk = fontBytes.subarray(gOffset, gOffset + gLen);
      }
      glyfChunks.push(chunk);
      glyfLen += chunk.length;
      if (chunk.length % 2) {
        glyfChunks.push(new Uint8Array([0]));
        glyfLen++;
      }
      locaValues.push(glyfLen);
    });
    var glyfOut = new Writer(glyfLen);
    glyfChunks.forEach(function (c) { glyfOut.bytesAt(c, 0, c.length); });
    var locaOut = new Writer((numGlyphs + 1) * 4);
    locaValues.forEach(function (v) { locaOut.u32(v); });

    // 3. hmtx: every retained glyph gets a full long horizontal metric.
    var numLong = reader.u16(tables.hhea.offset + 34);
    var hmtxOut = new Writer(numGlyphs * 4);
    var widths = {};
    var upm = reader.u16(tables.head.offset + 18);
    oldGids.forEach(function (oldGid) {
      var metricIndex = Math.min(oldGid, numLong - 1);
      var aw = reader.u16(tables.hmtx.offset + metricIndex * 4);
      var lsbOffset;
      if (oldGid < numLong) {
        lsbOffset = tables.hmtx.offset + oldGid * 4 + 2;
      } else {
        lsbOffset = tables.hmtx.offset + numLong * 4 + (oldGid - numLong) * 2;
      }
      var lsb = reader.i16(lsbOffset);
      hmtxOut.u16(aw);
      hmtxOut.i16(lsb);
      widths[gidMap[oldGid]] = aw;
    });

    // 4. head copy with indexToLocFormat = 1 and cleared checksum adjustment.
    var headOut = new Writer(tables.head.length);
    headOut.bytesAt(fontBytes, tables.head.offset, tables.head.length);
    headOut.dv.setUint32(8, 0); // checkSumAdjustment, re-computed at the end
    headOut.dv.setInt16(50, 1); // indexToLocFormat = long

    // 5. hhea copy with new numberOfHMetrics.
    var hheaOut = new Writer(tables.hhea.length);
    hheaOut.bytesAt(fontBytes, tables.hhea.offset, tables.hhea.length);
    hheaOut.dv.setUint16(34, numGlyphs);

    // 6. maxp copy with new numGlyphs (keep the source table version/size).
    var maxpOut = new Writer(tables.maxp.length);
    maxpOut.bytesAt(fontBytes, tables.maxp.offset, tables.maxp.length);
    maxpOut.dv.setUint16(4, numGlyphs);

    // 7. post format 3 (no glyph names).
    var postOut = new Writer(32);
    postOut.u32(0x00030000);
    postOut.u32(0); // italicAngle (Fixed 0)
    postOut.i16(reader.i16(tables.post.offset + 8));  // underlinePosition
    postOut.i16(reader.i16(tables.post.offset + 10)); // underlineThickness
    postOut.u32(reader.u32(tables.post.offset + 12)); // isFixedPitch
    postOut.u32(0); postOut.u32(0); postOut.u32(0); postOut.u32(0);

    // 8. Fresh format-4 cmap over the covered codepoints.
    var covered = codepoints.filter(function (cp) { return charToGid[cp] && cp <= 0xFFFF; });
    var cmapSegments = buildCmapFormat4(covered, charToGid, gidMap);
    // cmap header: version(2) + numTables(2) + one record(8) + subtable.
    var cmapOut = new Writer(12 + cmapSegments.pos);
    cmapOut.u16(0);
    cmapOut.u16(1);
    cmapOut.u16(3); // platform Windows
    cmapOut.u16(1); // encoding UCS-2
    cmapOut.u32(12); // offset of subtable
    cmapOut.bytesAt(cmapSegments.bytes, 0, cmapSegments.pos);

    // 9. Tables copied verbatim.
    function copyTable(tag) {
      if (!tables[tag]) return null;
      var w = new Writer(tables[tag].length);
      w.bytesAt(fontBytes, tables[tag].offset, tables[tag].length);
      return w.bytes.subarray(0, w.pos);
    }
    var os2 = copyTable('OS/2');
    var name = copyTable('name');

    var outTables = [
      { tag: 'head', data: headOut.bytes.subarray(0, headOut.pos) },
      { tag: 'hhea', data: hheaOut.bytes.subarray(0, hheaOut.pos) },
      { tag: 'maxp', data: maxpOut.bytes.subarray(0, maxpOut.pos) }
    ];
    if (os2) outTables.push({ tag: 'OS/2', data: os2 });
    outTables.push({ tag: 'cmap', data: cmapOut.bytes.subarray(0, cmapOut.pos) });
    outTables.push({ tag: 'hmtx', data: hmtxOut.bytes.subarray(0, hmtxOut.pos) });
    ['cvt ', 'fpgm', 'prep'].forEach(function (tag) {
      var t = copyTable(tag);
      if (t) outTables.push({ tag: tag, data: t });
    });
    outTables.push({ tag: 'loca', data: locaOut.bytes.subarray(0, locaOut.pos) });
    outTables.push({ tag: 'glyf', data: glyfOut.bytes.subarray(0, glyfOut.pos) });
    if (name) outTables.push({ tag: 'name', data: name });
    outTables.push({ tag: 'post', data: postOut.bytes.subarray(0, postOut.pos) });

    // 10. Directory + table bodies with 4-byte alignment.
    var headerSize = 12 + 16 * outTables.length;
    var offset = headerSize;
    outTables.forEach(function (t) {
      t.offset = offset;
      t.checksum = tableChecksum(t.data);
      offset += t.data.length + ((4 - (t.data.length % 4)) % 4);
    });
    var font = new Writer(offset);
    font.u32(0x00010000);
    font.u16(outTables.length);
    var maxPow2 = Math.pow(2, Math.floor(Math.log(outTables.length) / Math.LN2));
    font.u16(maxPow2 * 16);
    font.u16(Math.floor(Math.log(outTables.length) / Math.LN2));
    font.u16(outTables.length * 16 - maxPow2 * 16);
    outTables.forEach(function (t) {
      for (var i = 0; i < 4; i++) font.bytes[font.pos++] = t.tag.charCodeAt(i);
      font.u32(t.checksum);
      font.u32(t.offset);
      font.u32(t.data.length);
    });
    outTables.forEach(function (t) {
      font.bytesAt(t.data, 0, t.data.length);
      var pad = (4 - (t.data.length % 4)) % 4;
      font.zero(pad);
    });

    // 11. Whole-font checksum adjustment (head.checkSumAdjustment at head+8).
    var total = tableChecksum(font.bytes.subarray(0, font.pos));
    var adjustment = (0xB1B0AFBA - total) >>> 0;
    var headDir = outTables[0];
    new DataView(font.buf).setUint32(headDir.offset + 8, adjustment);

    var bbox = [
      reader.i16(tables.head.offset + 36),
      reader.i16(tables.head.offset + 38),
      reader.i16(tables.head.offset + 40),
      reader.i16(tables.head.offset + 42)
    ];
    return {
      bytes: font.bytes.subarray(0, font.pos),
      gidMap: gidMap,
      charToGid: charToGid,
      missing: missing,
      widths: widths,
      unitsPerEm: upm,
      bbox: bbox,
      ascent: reader.i16(tables.hhea.offset + 4),
      descent: reader.i16(tables.hhea.offset + 6),
      capHeight: os2 && os2.length >= 88 ? new DataView(os2.buffer, os2.byteOffset).getInt16(86) : bbox[3]
    };
  }

  /**
   * Public entry point.
   * @param {Uint8Array} fontBytes TTF bytes.
   * @param {number[]} codepoints Unicode codepoints needed.
   * @param {number=} opt_ttcIndex TTC face index.
   * @return {Object} Subset result (see assembleSubset).
   */
  function subset(fontBytes, codepoints, opt_ttcIndex) {
    var dir = readDirectory(fontBytes, opt_ttcIndex);
    var lookup = buildCmapLookup(fontBytes, dir.tables, dir.reader);
    return assembleSubset(fontBytes, codepoints, lookup, dir.tables, dir.reader);
  }

  /**
   * Reads metadata without subsetting.
   * @param {Uint8Array} fontBytes
   * @return {{unitsPerEm:number, bbox:number[], ascent:number, descent:number,
   *           covers:function(number):boolean, family:string}}
   */
  function inspect(fontBytes) {
    var dir = readDirectory(fontBytes, 0);
    var r = dir.reader;
    var lookup = buildCmapLookup(fontBytes, dir.tables, r);
    var nameOffset = dir.tables.name.offset;
    var count = r.u16(nameOffset + 2);
    var stringStorage = nameOffset + r.u16(nameOffset + 4);
    var family = '';
    for (var i = 0; i < count; i++) {
      var rec = nameOffset + 6 + i * 12;
      var platformID = r.u16(rec);
      var nameId = r.u16(rec + 6);
      if (nameId !== 1 && nameId !== 4) continue;
      var len = r.u16(rec + 8);
      var off = r.u16(rec + 10);
      var raw = fontBytes.subarray(stringStorage + off, stringStorage + off + len);
      var s = '';
      if (platformID === 0 || platformID === 3) {
        // Unicode / Windows: UTF-16BE.
        for (var j = 0; j + 1 < raw.length; j += 2) {
          s += String.fromCharCode((raw[j] << 8) | raw[j + 1]);
        }
      } else {
        // Macintosh/platform 1: single-byte MacRoman (ASCII subset suffices).
        for (var k = 0; k < raw.length; k++) s += String.fromCharCode(raw[k]);
      }
      family = s;
      break;
    }
    var os2 = dir.tables['OS/2'];
    return {
      family: family,
      unitsPerEm: r.u16(dir.tables.head.offset + 18),
      bbox: [
        r.i16(dir.tables.head.offset + 36), r.i16(dir.tables.head.offset + 38),
        r.i16(dir.tables.head.offset + 40), r.i16(dir.tables.head.offset + 42)
      ],
      ascent: r.i16(dir.tables.hhea.offset + 4),
      descent: r.i16(dir.tables.hhea.offset + 6),
      capHeight: os2 && os2.length >= 88 ?
          new DataView(fontBytes.buffer, fontBytes.byteOffset + os2.offset).getInt16(86) :
          r.i16(dir.tables.head.offset + 42),
      covers: function (cp) { return !!lookup(cp); },
      lookup: lookup
    };
  }

  pdfNs.ttfSubset = {
    subset: subset,
    inspect: inspect,
    TtfError: TtfError
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = pdfNs.ttfSubset;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
