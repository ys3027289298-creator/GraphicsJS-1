'use strict';
/**
 * Chrome bootstrap shared by every browser test.
 * Honors SPARKLINE_CHROME for a preinstalled binary; otherwise downloads and
 * caches chrome-headless-shell under .chrome-cache (gitignored).
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const {computeExecutablePath, install, Browser} = require('@puppeteer/browsers');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.chrome-cache');
const BUILD_ID = process.env.SPARKLINE_CHROME_BUILD || '160.0.8164.0';

async function resolveExecutable() {
  if (process.env.SPARKLINE_CHROME) return process.env.SPARKLINE_CHROME;
  const computed = computeExecutablePath({
    cacheDir: CACHE_DIR,
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: BUILD_ID
  });
  if (fs.existsSync(computed)) return computed;
  const installed = await install({
    cacheDir: CACHE_DIR,
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: BUILD_ID
  });
  return installed.executablePath;
}

async function launch() {
  const executablePath = await resolveExecutable();
  return puppeteer.launch({
    executablePath,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--force-color-profile=srgb', '--hide-scrollbars']
  });
}

/**
 * Renders a page built from inline HTML and returns the page handle plus the
 * browser, so callers can run assertions and screenshots then close().
 */
async function openPage(browser, html, {width = 800, height = 600, dsf = 2} = {}) {
  const page = await browser.newPage();
  await page.setViewport({width, height, deviceScaleFactor: dsf});
  await page.setContent(html, {waitUntil: 'networkidle0'});
  return page;
}

module.exports = {launch, openPage, ROOT, BUILD_ID};
