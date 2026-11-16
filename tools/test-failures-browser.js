#!/usr/bin/env node
/**
 * DOM-level failure and lifecycle tests in headless Chrome.
 *  - five invalid calls must surface SparklineError (name + code)
 *  - create/setData/dispose must leave exactly the expected number of <svg>
 *    nodes in the container (1 -> 1 -> 0), proving no DOM leakage
 *  - double dispose is a no-op
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {launch} = require('./chrome');
const {page} = require('./page-builder');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline', 'failures-browser.json');

const BODY = `<div id="c"></div><div id="other"></div>`;
const TEST = `
window.__results = [];
function probe(name, fn, code) {
  let err = null;
  try { fn(); } catch (e) { err = {name: e.name, code: e.code, message: e.message}; }
  window.__results.push({
    name, expectedCode: code,
    threw: !!err,
    unexpectedSuccess: !err,
    ok: !!err && err.name === 'SparklineError' && err.code === code,
    actual: err
  });
}
probe('element id does not exist', () => acgraph.sparkline.create('missing-id', [1,2]),
  'SPARKLINE_BAD_CONTAINER');
probe('container is plain object', () => acgraph.sparkline.create({}, [1,2]),
  'SPARKLINE_BAD_CONTAINER');
probe('data is a string', () => acgraph.sparkline.create('c', 'nope'),
  'SPARKLINE_BAD_DATA');
probe('datum is a string', () => acgraph.sparkline.create('c', [1,'x',3]),
  'SPARKLINE_BAD_DATUM');
probe('band out of range',
  () => acgraph.sparkline.create('c', [1,2,3], {bands:[{from:0,to:9}]}),
  'SPARKLINE_BAD_BAND');

// Lifecycle on the real container.
function svgCount(id) {
  return document.getElementById(id).querySelectorAll('svg').length;
}
window.__lifecycle = {afterCreate: null, afterSetData: null, afterDispose: null,
  afterDoubleDispose: null, elementCounts: []};
const spark = acgraph.sparkline.create('c', [1,2,3,4], {width:40, height:24});
window.__lifecycle.afterCreate = svgCount('c');
window.__lifecycle.elementCounts.push(spark.getElementCount());
spark.setData([5,6,7,8,9]);
window.__lifecycle.afterSetData = svgCount('c');
window.__lifecycle.elementCounts.push(spark.getElementCount());
spark.dispose();
window.__lifecycle.afterDispose = svgCount('c');
let doubleDisposeThrew = false;
try { spark.dispose(); } catch (e) { doubleDisposeThrew = true; }
window.__lifecycle.afterDoubleDispose = svgCount('c');
window.__lifecycle.doubleDisposeThrew = doubleDisposeThrew;

// setData after dispose must throw SPARKLINE_BAD_OPTION.
let postDisposeErr = null;
try { spark.setData([1,2]); } catch (e) { postDisposeErr = {name:e.name, code:e.code}; }
window.__lifecycle.setDataAfterDispose = postDisposeErr;
`;

async function main() {
  const browser = await launch();
  try {
    const pg = await browser.newPage();
    await pg.setViewport({width: 300, height: 200, deviceScaleFactor: 2});
    await pg.setContent(page('failures-browser', BODY, TEST), {waitUntil: 'networkidle0'});
    const results = await pg.evaluate(() => window.__results);
    const lifecycle = await pg.evaluate(() => window.__lifecycle);
    const ok = results.every(r => r.ok) &&
      lifecycle.afterCreate === 1 && lifecycle.afterSetData === 1 &&
      lifecycle.afterDispose === 0 && lifecycle.afterDoubleDispose === 0 &&
      !lifecycle.doubleDisposeThrew &&
      lifecycle.setDataAfterDispose &&
      lifecycle.setDataAfterDispose.code === 'SPARKLINE_BAD_OPTION';
    const report = {
      generatedAt: new Date().toISOString(),
      probes: results,
      lifecycle,
      allPassed: ok
    };
    fs.mkdirSync(path.dirname(OUT), {recursive: true});
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (!ok) process.exitCode = 1;
    await pg.close();
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
