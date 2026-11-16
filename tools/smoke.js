#!/usr/bin/env node
/**
 * End-to-end smoke test of demos/sparkline/table.html over file://.
 * Captures the full page (table + probe panel) as smoke.png and writes the
 * structured probe results to smoke-failures.json / smoke-report.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {launch} = require('./chrome');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'sparkline');
const DEMO = 'file://' + path.join(ROOT, 'demos', 'sparkline', 'table.html');

async function main() {
  const browser = await launch();
  try {
    const pg = await browser.newPage();
    const errors = [];
    // Browsers auto-request /favicon.ico over file://; that network noise is
    // not a page error and must not fail the smoke test.
    pg.on('pageerror', e => errors.push(e.message));
    pg.on('console', m => {
      if (m.type() === 'error' && m.text().indexOf('favicon') === -1 &&
          m.text().indexOf('ERR_FILE_NOT_FOUND') === -1) {
        errors.push(m.text());
      }
    });
    pg.on('requestfailed', req => {
      if (req.url().indexOf('favicon') === -1) errors.push('request failed: ' + req.url());
    });
    await pg.setViewport({width: 980, height: 1100, deviceScaleFactor: 2});
    await pg.goto(DEMO, {waitUntil: 'networkidle0'});

    const state = await pg.evaluate(() => ({
      probes: window.__probeResults,
      tolerance: window.__toleranceResults,
      allProbesPassed: window.__allProbesPassed,
      rowCount: document.querySelectorAll('#metrics-body tr').length,
      svgCount: document.querySelectorAll('#metrics svg').length
    }));

    await pg.screenshot({path: path.join(OUT, 'smoke.png'), fullPage: true});
    await pg.close();

    const failures = {
      generatedAt: new Date().toISOString(),
      consoleErrors: errors,
      probes: state.probes,
      tolerance: state.tolerance
    };
    fs.writeFileSync(path.join(OUT, 'smoke-failures.json'),
      JSON.stringify(failures, null, 2) + '\n');

    const report = {
      generatedAt: failures.generatedAt,
      demoUrl: DEMO,
      tableRows: state.rowCount,
      sparklineSvgsInTable: state.svgCount,
      probesRun: state.probes.length,
      toleranceChecks: state.tolerance.length,
      allProbesPassed: state.allProbesPassed,
      noConsoleErrors: errors.length === 0,
      ok: state.allProbesPassed && errors.length === 0 &&
        state.rowCount === 6 && state.svgCount === 24
    };
    fs.writeFileSync(path.join(OUT, 'smoke-report.json'),
      JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
