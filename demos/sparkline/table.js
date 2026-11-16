/* Table demo: six product rows, three sparkline widths per row, plus the
 * live failure-path probe panel. No build step required. */
(function () {
  'use strict';

  var ROWS = [
    {name: 'Aurora DB',    data: [3, 5, 4, 7, 6, 9, 8, 11, 10, 13, 12, 15]},
    {name: 'Boreal Cache', data: [12, 11, 12, 10, 11, 9, 10, 8, 9, 7, 8, 6]},
    {name: 'Cinder Queue', data: [1, 2, 4, 3, 6, 5, 9, 8, 12, 11, 14, 18]},
    {name: 'Drift Store',  data: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]},
    {name: 'Ember Edge',   data: [5, 9, 6, 11, 7, 12, 8, 14, 9, 15, 10, 16]},
    {name: 'Fog Metrics',  data: []} // empty-state row
  ];

  var HEIGHT = 24;

  function buildTable() {
    var tbody = document.getElementById('metrics-body');
    ROWS.forEach(function (row) {
      var tr = document.createElement('tr');

      var nameTd = document.createElement('td');
      nameTd.textContent = row.name;
      tr.appendChild(nameTd);

      var cells = [
        {width: 120, opts: {height: HEIGHT,
          bands: row.data.length ? [{from: 4, to: 7, fill: '#2a78d6', opacity: 0.14}] : []}},
        {width: 40, opts: {height: HEIGHT}},
        {width: 24, opts: {height: HEIGHT}}
      ];
      cells.forEach(function (spec) {
        var td = document.createElement('td');
        tr.appendChild(td);
        acgraph.sparkline.create(td, row.data, spec);
      });

      var latest = document.createElement('td');
      latest.className = 'num';
      latest.textContent = row.data.length ? row.data[row.data.length - 1] : '—';
      tr.appendChild(latest);

      var markerTd = document.createElement('td');
      tr.appendChild(markerTd);
      if (row.data.length) {
        acgraph.sparkline.create(markerTd, row.data, {
          width: 120, height: HEIGHT, markers: true,
          markerIndices: [0], axis: true
        });
      } else {
        acgraph.sparkline.create(markerTd, null, {width: 120, height: HEIGHT});
      }

      tbody.appendChild(tr);
    });
  }

  // -- Live failure probes ----------------------------------------------------
  function probe(name, fn, expectedCode) {
    var err = null;
    try { fn(); } catch (e) { err = e; }
    var ok = !!err && err.name === 'SparklineError' && err.code === expectedCode;
    return {name: name, expectedCode: expectedCode, ok: ok,
      unexpectedSuccess: !err, actual: err && {code: err.code, message: err.message}};
  }

  function runProbes() {
    var host = document.createElement('div');
    document.body.appendChild(host);
    var results = [
      probe('unknown element id', function () { acgraph.sparkline.create('nope', [1, 2]); },
        'SPARKLINE_BAD_CONTAINER'),
      probe('container is {}', function () { acgraph.sparkline.create({}, [1, 2]); },
        'SPARKLINE_BAD_CONTAINER'),
      probe('container null', function () { acgraph.sparkline.create(null, [1, 2]); },
        'SPARKLINE_BAD_CONTAINER'),
      probe('data is string', function () { acgraph.sparkline.create(host, 'nope'); },
        'SPARKLINE_BAD_DATA'),
      probe('data is array-like object', function () { acgraph.sparkline.create(host, {0: 1, length: 1}); },
        'SPARKLINE_BAD_DATA'),
      probe('datum is string', function () { acgraph.sparkline.create(host, [1, 'x', 3]); },
        'SPARKLINE_BAD_DATUM'),
      probe('datum is object', function () { acgraph.sparkline.create(host, [1, {}, 3]); },
        'SPARKLINE_BAD_DATUM'),
      probe('marker index out of range', function () { acgraph.sparkline.create(host, [1, 2], {markerIndices: [5]}); },
        'SPARKLINE_BAD_MARKER'),
      probe('marker index non-integer', function () { acgraph.sparkline.create(host, [1, 2, 3], {markerIndices: [1.5]}); },
        'SPARKLINE_BAD_MARKER'),
      probe('markerIndices not array', function () { acgraph.sparkline.create(host, [1, 2], {markerIndices: '0'}); },
        'SPARKLINE_BAD_MARKER'),
      probe('band reversed', function () { acgraph.sparkline.create(host, [1, 2, 3, 4], {bands: [{from: 2, to: 1}]}); },
        'SPARKLINE_BAD_BAND'),
      probe('band out of range', function () { acgraph.sparkline.create(host, [1, 2, 3], {bands: [{from: 0, to: 9}]}); },
        'SPARKLINE_BAD_BAND'),
      probe('yDomain reversed', function () { acgraph.sparkline.create(host, [1, 2], {yDomain: [9, 1]}); },
        'SPARKLINE_BAD_OPTION'),
      probe('negative width', function () { acgraph.sparkline.create(host, [1, 2], {width: -5}); },
        'SPARKLINE_BAD_OPTION'),
      probe('setData after dispose', function () {
        var s = acgraph.sparkline.create(host, [1, 2, 3], {width: 40, height: 24});
        s.dispose();
        s.setData([4, 5, 6]);
      }, 'SPARKLINE_BAD_OPTION')
    ];

    // Tolerance checks: must not throw.
    var tolerance = [];
    function noThrow(name, fn) {
      var threw = false;
      try { fn(); } catch (e) { threw = true; }
      tolerance.push({name: name, ok: !threw});
    }
    noThrow('sparse entries skipped', function () { acgraph.sparkline.create(host, [1, null, 2, NaN, 3]); });
    noThrow('null data is empty state', function () { acgraph.sparkline.create(host, null); });
    noThrow('double dispose idempotent', function () {
      var s = acgraph.sparkline.create(host, [1, 2], {width: 40, height: 24});
      s.dispose(); s.dispose();
    });

    var out = document.getElementById('probe-output');
    out.textContent = '';
    results.concat(tolerance).forEach(function (r) {
      var line = (r.ok ? 'PASS' : 'FAIL') + ' — ' + r.name +
        (r.expectedCode ? ' [' + r.expectedCode + ']' : '');
      var div = document.createElement('div');
      div.className = r.ok ? 'pass' : 'fail';
      div.textContent = line;
      out.appendChild(div);
    });

    window.__probeResults = results;
    window.__toleranceResults = tolerance;
    window.__allProbesPassed = results.every(function (r) { return r.ok; }) &&
      tolerance.every(function (r) { return r.ok; });
  }

  buildTable();
  runProbes();
})();
