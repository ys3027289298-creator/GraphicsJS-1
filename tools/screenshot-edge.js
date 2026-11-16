#!/usr/bin/env node
/**
 * One-page visual matrix of every special state:
 * empty data, single point, constant (zero-variance) series, sparse entries,
 * band annotation, pinned markerIndices, all-markers mode, normal series,
 * 24px and 40px widths. Screenshot saved as edge-cases.png.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {launch} = require('./chrome');
const {page} = require('./page-builder');

const OUT = path.join(__dirname, '..', 'artifacts', 'sparkline', 'edge-cases.png');

const BODY = `
<div style="padding:14px">
  <table id="matrix">
    <thead><tr><th>State</th><th>Sparkline</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</div>`;

const TEST = `
const cases = [
  ['empty data (null)', null, {width:120, height:24}],
  ['empty array', [], {width:120, height:24}],
  ['single point', [42], {width:120, height:24}],
  ['constant series (zero change)', [7,7,7,7,7,7], {width:120, height:24}],
  ['sparse null/NaN entries', [1,null,2,undefined,NaN,3,4,null,5], {width:120, height:24}],
  ['band annotation', [3,5,4,7,6,9,8,11,10,13,12,15],
    {width:120, height:24, bands:[{from:3,to:7,fill:'#2a78d6',opacity:0.16}]}],
  ['pinned markerIndices', [3,5,4,7,6,9,8,11,10,13,12,15],
    {width:120, height:24, markerIndices:[2,8]}],
  ['all markers mode', [3,5,4,7,6,9,8,11], {width:120, height:24, markers:true}],
  ['fixed yDomain across rows', [3,5,4,7,6,9], {width:120, height:24, yDomain:[0,20]}],
  ['normal 24px cell', [3,5,4,7,6,9,8,11,10,13,12,15], {width:24, height:24}],
  ['normal 40px cell', [3,5,4,7,6,9,8,11,10,13,12,15], {width:40, height:24}],
  ['axis disabled', [3,5,4,7,6,9,8,11], {width:120, height:24, axis:false}]
];
const tbody = document.getElementById('rows');
window.__counts = [];
cases.forEach(function (c) {
  const tr = document.createElement('tr');
  const td1 = document.createElement('td'); td1.textContent = c[0];
  const td2 = document.createElement('td');
  const cell = document.createElement('div');
  td2.appendChild(cell);
  tr.appendChild(td1); tr.appendChild(td2);
  tbody.appendChild(tr);
  const spark = acgraph.sparkline.create(cell, c[1], c[2]);
  window.__counts.push({name: c[0], elements: spark.getElementCount(),
    layout: spark.getLayout()});
});
`;

async function main() {
  const browser = await launch();
  try {
    const pg = await browser.newPage();
    await pg.setViewport({width: 420, height: 420, deviceScaleFactor: 2});
    await pg.setContent(page('edge-cases', BODY, TEST), {waitUntil: 'networkidle0'});
    const counts = await pg.evaluate(() => window.__counts);
    await pg.screenshot({path: OUT, fullPage: true});
    console.log('saved', OUT);
    for (const c of counts) {
      console.log(c.name.padEnd(34), 'elements=' + c.elements,
        'rendered=' + c.layout.rendered.length,
        c.layout.empty ? '[empty]' : '', c.layout.single ? '[single]' : '');
    }
    await pg.close();
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
