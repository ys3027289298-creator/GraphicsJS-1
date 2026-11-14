/**
 * Reproducible failure-path checks. Every case is also runnable on its own:
 *   node test/heatmap/failure-paths.js bad-grid
 * Each entry documents the trigger and the exact expected error message.
 *
 * Run all: node test/heatmap/failure-paths.js
 */
'use strict';

const path = require('path');
const heatmap = require(path.join(__dirname, '..', '..', 'src', 'heatmap', 'index.js'));
const Grid = heatmap.Grid;
const ColorScale = heatmap.ColorScale;

const cases = {
  'bad-grid': {
    expect: /Grid rows\/cols must be positive integers/,
    run: () => new Grid({rows: 0, cols: 10})
  },
  'bad-point': {
    expect: /Point x and y must be finite numbers/,
    run: () => new Grid({rows: 2, cols: 2}).addPoints([{x: 'oops', y: 1}])
  },
  'bad-value': {
    expect: /Point value must be a finite number when provided/,
    run: () => new Grid({rows: 2, cols: 2}).addPoints([{x: 1, y: 1, value: NaN}])
  },
  'bad-aggregation': {
    expect: /Unknown aggregation: median/,
    run: () => new Grid({rows: 2, cols: 2, aggregation: 'median'})
      .addPoints([{x: 1, y: 1, value: 1}])
  },
  'bad-domain-order': {
    expect: /Color domain must be ordered \[min, max\]/,
    run: () => new Grid({rows: 2, cols: 2, domain: [5, 1]})
      .addPoints([{x: 1, y: 1, value: 1}]).fit()
  },
  'bad-color': {
    expect: /Unsupported color format: crimson/,
    run: () => new ColorScale(['crimson', '#ffffff'])
  },
  'single-stop': {
    expect: /Color scale requires at least 2 color stops/,
    run: () => new ColorScale(['#ffffff'])
  },
  'stop-out-of-range': {
    expect: /Color stop offset must be within \[0, 1\]/,
    run: () => new ColorScale([{offset: 1.5, color: '#fff'}, {offset: 0, color: '#000'}])
  },
  'view-before-size': {
    expect: /View must define a positive width and height/,
    run: () => {
      const grid = new Grid({rows: 2, cols: 2});
      grid.fit();
      return heatmap.buildRenderPlan(grid, {x: 0, y: 0, width: 0, height: 10}, new ColorScale(['#fff', '#000']));
    }
  },
  'render-before-view': {
    expect: /Call setView\(\) before rendering/,
    run: () => heatmap.create({rows: 2, cols: 2}).setData([{x: 1, y: 1, value: 1}]).getRenderPlan()
  },
  'unfitted-plan': {
    expect: /Grid must be fit\(\) before building a render plan/,
    run: () => heatmap.buildRenderPlan(
      new Grid({rows: 2, cols: 2}),
      {x: 0, y: 0, width: 10, height: 10},
      new ColorScale(['#fff', '#000']))
  },
  'non-array-input': {
    expect: /addPoints expects an array/,
    run: () => new Grid({rows: 2, cols: 2}).addPoints({x: 1, y: 1})
  }
};

function runCase(name) {
  const entry = cases[name];
  if (!entry) throw new Error('Unknown case: ' + name + '; available: ' + Object.keys(cases).join(', '));
  let threw = null;
  try {
    entry.run();
  } catch (e) {
    threw = e;
  }
  if (!threw) throw new Error('[' + name + '] expected an error but none was thrown');
  if (!entry.expect.test(threw.message)) {
    throw new Error('[' + name + '] expected ' + entry.expect + ' but got: ' + threw.message);
  }
  return {name, message: threw.message};
}

if (require.main === module) {
  const only = process.argv[2];
  const names = only ? [only] : Object.keys(cases);
  for (const name of names) {
    const result = runCase(name);
    console.log('  ok - ' + result.name + ' -> "' + result.message + '"');
  }
  console.log('\n' + names.length + ' failure paths verified');
}

module.exports = cases;
module.exports.runCase = runCase;
