# acgraph.sparkline

Mini trend lines designed for table cells. Purely additive: the module only
consumes the public `acgraph` API (`create`, `layer`, `path`, `circle`,
`rect`, `stroke`, `fill`, `stage.remove`) and lives under the
`acgraph.sparkline` namespace. No existing `src/` or `dist/` file is modified.

## Files

| File | Role |
| --- | --- |
| `sparkline-core.js` | DOM-free validation and geometry. Works in Node; the single source of truth for every coordinate the renderer paints. |
| `sparkline.js` | acgraph renderer over the core. Owns one private stage per instance. |

Load order in a page:

```html
<script>var CLOSURE_NO_DEPS = true;</script>
<script src="dist/graphics.js"></script>
<script src="src/sparkline/sparkline-core.js"></script>
<script src="src/sparkline/sparkline.js"></script>
```

## API

```js
var spark = acgraph.sparkline.create(container, data, options);
spark.setData(newData);   // removes the old stage DOM, then repaints
spark.getLayout();        // deterministic geometry snapshot (JSON copy)
spark.getElementCount();  // graphic elements currently owned
spark.dispose();          // removes all DOM; idempotent
```

`container` is a DOM element or an existing element id. `data` is an array of
finite numbers; `null`/`undefined`/`NaN` entries are skipped, and `data = null`
renders the empty state.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `width` / `height` | `40` / `16` | Cell size in px; must be positive finite numbers. |
| `axis` | `true` | Label-free L-shaped baseline (no ticks, no text). |
| `lastPoint` | always on | Red marker pinned on the final value. |
| `markers` | `false` | Mark every rendered point (thinned to a 4px minimum spacing). |
| `markerIndices` | – | Integer indices that are hard-pinned through both decimation passes. |
| `bands` | – | `[{from, to, fill?, opacity?}]` vertical range annotations by data index. |
| `yDomain` | auto | Fixed `[min, max]` (`min < max`, finite) for cross-row comparability. |

## Width compression strategy

The plot box reserves `padding(2px) + markerRadius` on every side. With
`minPointSpacing = 2px`, the point capacity is
`capacity = floor(plotWidth / 2) + 1`.

1. `n <= capacity` — every point keeps its true proportional x.
2. `n > capacity` — points map onto `capacity` fixed 2px slots
   (`slot = floor(i*(capacity-1)/(n-1))`); each occupied slot keeps the sample
   with the largest absolute deviation from the series mean (earliest index
   wins ties). First/last samples and `markerIndices` are hard pins.
3. Adjacent rendered x positions are therefore always an integer multiple of
   2px apart and never collapse into a vertical smear — verified over
   500 random series × 3 widths with zero violations.
4. Marker dots get a second thinning pass at a 4px minimum spacing; the last
   point always survives.
5. The y domain comes from data min/max; a constant series gets a synthesized
   symmetric domain so it paints as a centered horizontal line instead of
   collapsing to a pixel row.

At 24px the capacity is 8 points, at 40px it is 16, at 120px it is 56 —
independent of input length.

## Special states

- **Empty** (`null` / `[]`): gray dashed mid baseline with a hollow circle.
- **Single point**: one centered marker; no fabricated line segment.
- **Zero change**: centered horizontal line on a synthesized symmetric domain.

## Errors

All failures throw `SparklineError` with a stable `code`:

| Code | Trigger |
| --- | --- |
| `SPARKLINE_BAD_CONTAINER` | container is not an element / existing id |
| `SPARKLINE_BAD_DATA` | data argument is not an array |
| `SPARKLINE_BAD_DATUM` | an entry is present but not a finite number |
| `SPARKLINE_BAD_MARKER` | markerIndices malformed or out of range |
| `SPARKLINE_BAD_BAND` | band missing/integer-bad or outside `[0, n)` |
| `SPARKLINE_BAD_OPTION` | bad size, yDomain, or setData after dispose |

## Resource bounds

- Time `O(n)` (one normalization pass + one slot scan), space `O(capacity)`.
- Per instance: 1 stage + 1 layer, 1 polyline, ≤ `capacity` marker circles,
  ≤ `bands.length` band rectangles, plus 1 axis path when enabled.
- Empty cell: 2 elements (dashed path + hollow circle). Single-point cell:
  2 elements (axis + marker).
- `dispose()` calls `stage.remove()` once; `setData()` tears down and rebuilds.
  Measured SVG count in the container: 1 after create → 1 after setData →
  0 after dispose.
