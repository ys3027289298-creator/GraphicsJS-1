/**
 * Generates the two required rendering artifacts plus their data reports:
 *  1. 100x100 grid over 200 dense points (aggregation + derived scale)
 *  2. 10x10 grid over 50 sparse points (empty-cell filling + scale handling)
 * Also emits no-data and all-zero reference renders and a zoom comparison.
 *
 * Run: node test/heatmap/render-artifacts.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const harness = require('./harness');
const heatmap = require(path.join(harness.REPO_ROOT, 'src', 'heatmap', 'index.js'));

const OUT = path.join(harness.REPO_ROOT, 'artifacts', 'heatmap');
fs.mkdirSync(OUT, {recursive: true});

let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function makePoints(count) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      x: Math.round(rand() * 1000) / 10,
      y: Math.round(rand() * 1000) / 10,
      value: Math.round(rand() * 100)
    });
  }
  return points;
}

function writePng(name, plan) {
  const image = harness.rasterizePlan(plan);
  fs.writeFileSync(path.join(OUT, name), harness.encodePng(image.width, image.height, image.rgba));
  return image;
}

const report = {generatedAt: new Date().toISOString(), scenarios: []};
function record(scenario) {
  report.scenarios.push(scenario);
  console.log(' - ' + scenario.file + ' (' + scenario.width + 'x' + scenario.height + ' px, ' +
      scenario.cells + ' cells, state=' + scenario.state + ')');
}

// --------------------------------------------- scenario 1: dense 100x100 grid
console.log('Rendering artifacts:');
const densePoints = makePoints(200);
const dense = heatmap.create({
  rows: 100, cols: 100,
  bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
  aggregation: 'sum',
  colorStops: ['#08306b', '#f7fbff', '#7f0000']
});
dense.setData(densePoints);
dense.setView({x: 0, y: 0, width: 500, height: 500});
const densePlan = dense.getRenderPlan();
const denseImage = writePng('dense-100x100.png', densePlan);
const denseOccupied = densePlan.cells.filter(c => !c.empty).length;
record({
  file: 'dense-100x100.png',
  width: denseImage.width, height: denseImage.height,
  grid: '100x100', inputPoints: densePoints.length,
  aggregation: 'sum',
  occupiedCells: denseOccupied,
  emptyCells: densePlan.cells.length - denseOccupied,
  domain: dense.grid.domain,
  scaleStops: dense.colorScale.getStops(),
  cells: densePlan.cells.length,
  state: densePlan.state
});

// --------------------------------------------- scenario 2: sparse 50 points
seed = 7;
const sparsePoints = makePoints(50);
const sparse = heatmap.create({
  rows: 10, cols: 10,
  bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
  aggregation: 'sum',
  colorStops: ['#08306b', '#f7fbff', '#7f0000'],
  emptyColor: '#e8e8e8'
});
sparse.setData(sparsePoints);
sparse.setView({x: 0, y: 0, width: 200, height: 200});
const sparsePlan = sparse.getRenderPlan();
const sparseImage = writePng('sparse-50points.png', sparsePlan);
const sparseOccupied = sparsePlan.cells.filter(c => !c.empty).length;
record({
  file: 'sparse-50points.png',
  width: sparseImage.width, height: sparseImage.height,
  grid: '10x10', inputPoints: sparsePoints.length,
  aggregation: 'sum',
  occupiedCells: sparseOccupied,
  emptyCells: sparsePlan.cells.length - sparseOccupied,
  domain: sparse.grid.domain,
  emptyColor: '#e8e8e8',
  cells: sparsePlan.cells.length,
  state: sparsePlan.state
});

// zoomed view of the same sparse data: colors must match, geometry doubles
sparse.setView({x: 0, y: 0, width: 400, height: 400});
const zoomedPlan = sparse.getRenderPlan();
const zoomedImage = writePng('sparse-50points-zoom2x.png', zoomedPlan);
const colorMismatches = zoomedPlan.cells.filter((cell, i) => cell.color !== sparsePlan.cells[i].color).length;
record({
  file: 'sparse-50points-zoom2x.png',
  width: zoomedImage.width, height: zoomedImage.height,
  grid: '10x10', inputPoints: sparsePoints.length,
  colorMismatchesVsBase: colorMismatches,
  cellWidthBase: sparsePlan.cellWidth,
  cellWidthZoomed: zoomedPlan.cellWidth,
  cells: zoomedPlan.cells.length,
  state: zoomedPlan.state
});

// --------------------------------------------- special states, explicit look
const noData = heatmap.create({rows: 10, cols: 10, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
  noDataColor: '#f5f5f5'});
noData.setData([]);
noData.setView({x: 0, y: 0, width: 200, height: 200});
const noDataPlan = noData.getRenderPlan();
const noDataImage = writePng('no-data.png', noDataPlan);
record({file: 'no-data.png', width: noDataImage.width, height: noDataImage.height,
  inputPoints: 0, noDataColor: '#f5f5f5', cells: noDataPlan.cells.length, state: noDataPlan.state});

const zeros = heatmap.create({rows: 10, cols: 10, bounds: {minX: 0, minY: 0, maxX: 100, maxY: 100},
  colorStops: ['#102030', '#ff0000'], emptyColor: '#e8e8e8'});
zeros.setData(sparsePoints.map(p => ({x: p.x, y: p.y, value: 0})));
zeros.setView({x: 0, y: 0, width: 200, height: 200});
const zeroPlan = zeros.getRenderPlan();
const zeroImage = writePng('all-zero.png', zeroPlan);
record({file: 'all-zero.png', width: zeroImage.width, height: zeroImage.height,
  inputPoints: sparsePoints.length, occupiedColor: 'rgb(16,32,48)',
  emptyColor: '#e8e8e8', cells: zeroPlan.cells.length, state: zeroPlan.state});

fs.writeFileSync(path.join(OUT, 'render-report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, 'dense-input.json'), JSON.stringify(densePoints));
fs.writeFileSync(path.join(OUT, 'sparse-input.json'), JSON.stringify(sparsePoints));
console.log('\nReport: artifacts/heatmap/render-report.json');
