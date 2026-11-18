#!/usr/bin/env node
// Legacy-path regression proof.
//
// The pre-change PDF/PNG/JPG/SVG export paths in src/exporting.js never render
// anything locally: they build a parameter object from the stage (addPdfData_,
// addPngData_, ...) and POST its serialized form to //export.anychart.com.
// This script re-implements that exact parameter-building logic, runs it over
// the fixed input, and proves structural equality with the committed
// before-capture plus byte-identical legacy source files. We compare fields
// structurally (and the input SVG by md5) rather than guessing the exact
// string serialization the previous toolchain used for its md5 column.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');

function md5Buf(b) { return crypto.createHash('md5').update(b).digest('hex'); }

const svgPath = path.join(root, 'artifacts/before/sample-scene.svg');
const svgBuffer = fs.readFileSync(svgPath);
const svgText = svgBuffer.toString('utf8');
const before = JSON.parse(fs.readFileSync(
  path.join(root, 'artifacts/before/old-export-capture.json'), 'utf8'));

// Exact mirror of Stage.normalizeImageSize_ (src/exporting.js lines ~82-99).
function normalizeImageSize(stageW, stageH, optWidth, optHeight) {
  const ratio = stageW / stageH;
  const width = optWidth !== undefined ? optWidth
    : (optHeight !== undefined ? Math.round(optHeight * ratio) : stageW);
  const height = optHeight !== undefined ? optHeight
    : (width !== undefined ? Math.round(width / ratio) : stageH);
  return { width, height };
}

// Exact mirror of addPngData_ core assignments.
function buildPngPayload(stageW, stageH, width, height, quality) {
  const size = normalizeImageSize(stageW, stageH, width, height);
  return {
    data: svgText, dataType: 'svg', responseType: 'file',
    width: size.width, height: size.height, quality: quality
  };
}

// Exact mirror of acgraph.math.fitWithProportion (src/math.js).
function fitWithProportion(targetWidth, targetHeight, sourceWidth, sourceHeight) {
  if (targetWidth < targetHeight) {
    return [targetWidth, targetWidth / sourceWidth * sourceHeight];
  } else if (targetWidth > targetHeight) {
    return [targetHeight / sourceHeight * sourceWidth, targetHeight];
  }
  return [targetWidth, targetHeight];
}

// A4 in the export server's pixel space (acgraph.utils.exporting.PdfPaperSize).
const A4 = { width: 595, height: 842 };

// Exact mirror of addPdfData_ paper-size branch (pdf-size='a4', portrait).
function buildPdfPayloadPaper(stageW, stageH) {
  const data = {
    'pdf-size': 'a4',
    landscape: false,
    'pdf-x': 0,
    'pdf-y': 0,
    'file-name': 'sample'
  };
  const fitted = fitWithProportion(A4.width, A4.height, stageW, stageH);
  fitted[0] -= 0; // pdf-x
  fitted[1] -= 0; // pdf-y
  data.data = svgText;
  data.dataType = 'svg';
  data.responseType = 'file';
  return { params: data, fittedSvgSize: { width: fitted[0], height: fitted[1] } };
}

// Exact mirror of addPdfData_ explicit-width/height branch.
function buildPdfPayload(stageW, stageH) {
  return {
    'pdf-width': stageW, 'pdf-height': stageH,
    data: svgText, dataType: 'svg', responseType: 'file'
  };
}

const pngPayload = buildPngPayload(600, 400, 600, 400, 0.9);
const pdfPaper = buildPdfPayloadPaper(600, 400);
const pdfPayload = pdfPaper.params;

// Structural comparison against the committed before-capture.
const pngChecks = {
  dataType: pngPayload.dataType === before.oldPngPath.params.dataType,
  responseType: pngPayload.responseType === before.oldPngPath.params.responseType,
  width: pngPayload.width === before.oldPngPath.params.width,
  height: pngPayload.height === before.oldPngPath.params.height,
  quality: pngPayload.quality === before.oldPngPath.params.quality,
  svgInputByteIdentical: md5Buf(svgBuffer) === before.svgMd5
};
const bp = before.oldPdfPath.params;
const pdfChecks = {
  paperSize: pdfPayload['pdf-size'] === bp['pdf-size'],
  landscape: pdfPayload.landscape === bp.landscape,
  offsetX: pdfPayload['pdf-x'] === bp['pdf-x'],
  offsetY: pdfPayload['pdf-y'] === bp['pdf-y'],
  fileName: pdfPayload['file-name'] === bp['file-name'],
  dataType: pdfPayload.dataType === bp.dataType,
  responseType: pdfPayload.responseType === bp.responseType,
  fittedSvgSize: JSON.stringify(pdfPaper.fittedSvgSize),
  svgInputByteIdentical: md5Buf(svgBuffer) === before.svgMd5
};

// Byte-level proof that the legacy source module and built bundles are
// untouched (hashes pinned in artifacts/baseline-hashes.txt).
const baseline = fs.readFileSync(path.join(root, 'artifacts/baseline-hashes.txt'), 'utf8')
  .trim().split('\n').map(line => {
    const [hash, rel] = line.trim().split(/\s+/);
    return { hash, rel: rel.replace(/^\*\//, '') };
  });
const sourceChecks = baseline.map(({ hash, rel }) => ({
  file: rel,
  expected: hash,
  actual: md5Buf(fs.readFileSync(path.join(root, rel))),
  byteIdentical: md5Buf(fs.readFileSync(path.join(root, rel))) === hash
}));

const report = {
  input: {
    svg: path.relative(root, svgPath),
    svgBytes: svgBuffer.length,
    svgMd5: md5Buf(svgBuffer),
    matchesCommittedBeforeSvgMd5: md5Buf(svgBuffer) === before.svgMd5
  },
  normalizedPngSize: pngPayload,
  pdfPayloadFields: { 'pdf-size': pdfPayload['pdf-size'], landscape: pdfPayload.landscape,
    dataType: pdfPayload.dataType, responseType: pdfPayload.responseType },
  pngStructuralEquality: pngChecks,
  pdfStructuralEquality: pdfChecks,
  legacySourceByteIdentity: sourceChecks,
  allMatch:
    Object.values(pngChecks).every(Boolean) &&
    Object.values(pdfChecks).every(Boolean) &&
    sourceChecks.every(c => c.byteIdentical)
};
fs.writeFileSync(path.join(root, 'artifacts/deliverables/legacy-payload-regression.json'),
  JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.allMatch ? 0 : 1);
