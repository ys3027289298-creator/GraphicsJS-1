/**
 * Browser demo: same dataset rendered as the legacy scatter view and as the
 * new heatmap. Zoom buttons resize the view only; colors stay unchanged.
 */
(function () {
  var BOUNDS = {minX: 0, minY: 0, maxX: 100, maxY: 100};
  var seed = 7;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  function samplePoints(count) {
    var points = [];
    for (var i = 0; i < count; i++) {
      points.push({x: Math.round(rand() * 1000) / 10, y: Math.round(rand() * 1000) / 10,
        value: Math.round(rand() * 100)});
    }
    return points;
  }

  var points = samplePoints(50);
  var zoom = 1;

  function drawScatter() {
    var stage = acgraph.create('scatter', 240, 240);
    points.forEach(function (p) {
      var cx = 20 + p.x;
      var cy = 20 + p.y;
      stage.circle(cx, cy, 3).fill('#3366cc').stroke(null);
    });
  }

  function drawHeatmap() {
    var stage = acgraph.create('heatmap', 240, 240);
    var heat = acgraph.heatmap.create({
      rows: 10, cols: 10, bounds: BOUNDS, aggregation: 'sum',
      colorStops: ['#08306b', '#f7fbff', '#7f0000'],
      emptyColor: '#e8e8e8', noDataColor: '#f5f5f5'
    });
    heat.setData(points);
    heat.setView({x: 20, y: 20, width: 200 * zoom, height: 200 * zoom});
    heat.renderTo(stage);
  }

  function redraw() {
    document.getElementById('scatter').innerHTML = '';
    document.getElementById('heatmap').innerHTML = '';
    drawScatter();
    drawHeatmap();
  }

  document.getElementById('zoomIn').onclick = function () { zoom = 2; redraw(); };
  document.getElementById('zoomOut').onclick = function () { zoom = 1; redraw(); };
  document.getElementById('empty').onclick = function () { points = []; redraw(); };
  document.getElementById('zeros').onclick = function () {
    points = samplePoints(50).map(function (p) { return {x: p.x, y: p.y, value: 0}; });
    redraw();
  };
  document.getElementById('reset').onclick = function () {
    seed = 7; points = samplePoints(50); zoom = 1; redraw();
  };

  redraw();
})();
