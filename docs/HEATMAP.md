# 热力图（Heatmap）改造交付说明

面向“时段热度”场景，在 GraphicsJS 现有散点能力之上新增网格热力图。改造为**纯增量**：
`dist/graphics.js` 与 `src/` 下任何既有文件均未修改，热力图代码全部位于 `src/heatmap/`，
渲染只调用既有的 `layer.rect()` 图元，因此原有图表类型零变化。

## 1. 设计总览

| 模块 | 文件 | 职责 | 依赖 |
| --- | --- | --- | --- |
| 色阶 | `src/heatmap/colorScale.js` | 可配置颜色锚点、分段线性插值、输出 rgb | 无 |
| 聚合网格 | `src/heatmap/grid.js` | 分桶、聚合、数据域归一化、稀疏填充标记 | 无 |
| 渲染层 | `src/heatmap/renderer.js` | 纯函数渲染计划 + acgraph 渲染门面 | 仅 acgraph 图元 |
| Node 入口 | `src/heatmap/index.js` | CommonJS 聚合 | — |

关键不变量：**颜色只由数据空间的归一化值 `t∈[0,1]` 决定**。缩放（`setView`）只改变像素
几何，网格、数据域与 `t` 不变，所以同一份数据缩放后颜色映射保持一致。

### 聚合规则
- 每个点按 `(x,y)` 落到 `rows×cols` 桶，边界点归入最后一个桶，不会丢点。
- 聚合方式可配：`sum`（默认）、`mean`、`count`、`min`、`max`，或 `function(values)`。
- 数据域 `domain` 默认取聚合结果的 `[min,max]`，也可显式指定；归一化结果夹取到 `[0,1]`。
- 零跨度数据域（含全零）归一化恒返回 `0`，杜绝 `NaN/Infinity`。

### 标尺（色阶）规则
- 锚点至少 2 个，支持 `#rgb`/`#rrggbb`/`rgb(...)` 与 `[r,g,b]`；裸颜色自动均分偏移。
- 锚点偏移排序并规范化到 `[0,1]`，通道间线性插值，越界夹取。

### 稀疏与特殊状态（明确表现，绝不全黑）
| 状态 | 触发条件 | 表现 | 标记 |
| --- | --- | --- | --- |
| `normal` | 有数据且域跨度 > 0 | 色阶着色，空格用 `emptyColor`（默认 `#e8e8e8`） | `empty` 单元 `special='empty'` |
| `no-data` | 输入 0 个点 | 全部单元用 `noDataColor`（默认 `#f5f5f5`） | `state='no-data'` |
| `zero-span` | 有数据但域跨度为 0（如全零） | 有值单元固定为色阶最低端颜色，空格仍为 `emptyColor` | `state='zero-span'` |

`fillEmpty` 默认 `true`：每个单元都会产出渲染记录，稀疏数据不留空洞；设为 `false` 时
只渲染有值单元。

## 2. 用法

```js
var heat = acgraph.heatmap.create({
  rows: 24, cols: 7,                 // 例如 24 小时 x 7 天
  aggregation: 'sum',                // sum|mean|count|min|max|function
  domain: [0, 1000],                 // 可选，省略则自动取数据 min/max
  colorStops: ['#08306b', '#f7fbff', '#7f0000'],
  emptyColor: '#e8e8e8',
  noDataColor: '#f5f5f5'
});
heat.setData(points);                // [{x, y, value?}]，value 缺省为 1
heat.setView({x: 40, y: 20, width: 480, height: 320});
heat.renderTo(stage);                // 或任意 layer
// 缩放只改视图，颜色不变：
heat.setView({x: 40, y: 20, width: 960, height: 640});
```

浏览器引入顺序见 `demos/heatmap/index.html`；Node 中 `require('src/heatmap')` 即可。

## 3. 四项强制交付物

所有产物位于 `artifacts/heatmap/`，均可由 `npm run test:heatmap` 重新生成。

### 交付物 A — 改造前后对比数据（同一组输入）

脚本 `test/heatmap/before-after.js`，输入固定为 `artifacts/heatmap/sparse-input.json`
（50 个点，确定性 LCG 生成）。

| 指标 | 改造前（散点） | 改造后（热力图） |
| --- | --- | --- |
| 图元 | 每点一个 `acgraph.circle` | 每单元一个 `rect` |
| 元素数量 | 50 | 100（40 有值 + 60 空格） |
| 聚合 | 无 | `sum` |
| 输入值校验和 | 2433 | 2433（`checksumPreserved: true`，聚合守恒） |

产物：`before-scatter.svg`、`after-heatmap.svg`、`before-scatter.png`、`after-heatmap.png`、
`before-after-side-by-side.png`、`before-after-report.json`（含每个有值单元的
`row/col/value/t/color`）。

### 交付物 B — 失败路径可复现步骤与预期错误

脚本 `test/heatmap/failure-paths.js`，共 12 条，单条复现示例：

```bash
node test/heatmap/failure-paths.js bad-grid
# ok - bad-grid -> "Grid rows/cols must be positive integers"
```

| 用例 | 触发 | 预期错误信息（正则） |
| --- | --- | --- |
| `bad-grid` | `rows:0` | `Grid rows/cols must be positive integers` |
| `bad-point` | `x:'oops'` | `Point x and y must be finite numbers` |
| `bad-value` | `value:NaN` | `Point value must be a finite number when provided` |
| `bad-aggregation` | `aggregation:'median'` | `Unknown aggregation: median` |
| `bad-domain-order` | `domain:[5,1]` | `Color domain must be ordered [min, max]` |
| `bad-color` | 命名色 `'crimson'` | `Unsupported color format: crimson` |
| `single-stop` | 仅 1 个锚点 | `Color scale requires at least 2 color stops` |
| `stop-out-of-range` | 偏移 `1.5` | `Color stop offset must be within [0, 1]` |
| `view-before-size` | 视图宽 0 | `View must define a positive width and height` |
| `render-before-view` | 未 `setView` | `Call setView() before rendering` |
| `unfitted-plan` | 未 `fit` 就出图 | `Grid must be fit() before building a render plan` |
| `non-array-input` | `addPoints({})` | `addPoints expects an array` |

### 交付物 C — 资源 / 内存上界

脚本 `test/heatmap/memory-bounds.js`（`node --expose-gc`），实测（Node 18，堆增量）：

| 场景 | 单元数 | 点数 | 实测堆增量 |
| --- | --- | --- | --- |
| 10×10 | 100 | 100 | +0.07 MB |
| 100×100 | 10,000 | 10,000 | +2.46 MB |
| 100×100 | 10,000 | 100,000 | +2.52 MB |
| 500×500 压力 | 250,000 | 250,000 | +60.66 MB |

解析上界（`R=rows*cols`，`N=点数`）：
- 网格数据：`values`/`counts` 各 `R` 个槽，桶数组仅占用单元创建，总量 `O(R+N)`；
  `fit()` 后桶立即释放，稳态为 `O(R)`。
- 渲染计划：恰好 `R` 个描述符（`fillEmpty:true`），每个 10 个标量字段，`O(R)`。
- DOM 输出：恰好 `R` 个 acgraph rect 元素；SVG 字符串规模 `O(R)`。
- 时间：分桶 `O(N)`，归约 `O(N)`，建计划与渲染 `O(R)`，总体 `O(N+R)`。
- 工程护栏：测试强制 100×100 堆增量 < 25 MB（实测 2.46 MB）；建议生产网格上限
  `R ≤ 250,000`，再大的分辨率应改用 canvas/位图方案。

### 交付物 D — 旧行为逐字节 / 逐像素一致性

脚本 `test/heatmap/regression.test.js`，6 项全部通过：
1. 同一组遗留图元（rect/circle/ellipse/path/text）在两个独立 jsdom 运行时中
   SVG **逐字节相同**（随机实例 ID 经确定性规范化后比较，计数器序号保留）。
2. 加载热力图模块前后，遗留场景 SVG **逐字节相同**。
3. `acgraph` 命名空间键集合不变（热力图只挂在 `acgraph.heatmap` 子命名空间）。
4. 遗留填充的栅格化结果重复渲染**逐像素相同**（`Buffer.compare === 0`）。
5. `git status --porcelain dist/ src/acgraph.js src/vector` 输出为空，既有产物零改动。
6. 遗留 SVG 字节长度稳定并落盘 `legacy-svg-bytes.txt`（当前 765 字节）。

## 4. 两组规定渲染结果与处理说明

由 `test/heatmap/render-artifacts.js` 生成，数据见 `render-report.json`。

### 4.1 100×100 网格（200 个点）— `dense-100x100.png`
- 聚合：`sum`；10,000 个单元中 200 个有值、9,800 个为空，空格全部渲染为 `#e8e8e8`，无空洞。
- 标尺：自动域 `[1,100]`，三色锚点 `#08306b → #f7fbff → #7f0000`，有值单元按
  `t=(value-1)/99` 插值；同份 SVG 另存 `dense-100x100.svg`（10,000 个 rect）。

### 4.2 稀疏 50 点（10×10）— `sparse-50points.png`
- 聚合：`sum`；100 个单元中 40 个有值、60 个为空。
- 标尺：自动域 `[3,182]`；空格统一 `emptyColor`，与有值单元视觉可区分。
- 缩放一致性：`sparse-50points-zoom2x.png` 为同数据 2× 视图，报告中
  `colorMismatchesVsBase: 0`，单元宽 20px→40px，颜色零漂移。

### 4.3 特殊状态参考图
- `no-data.png`：0 输入，整图 `#f5f5f5`（`state=no-data`）。
- `all-zero.png`：50 个全零点，有值单元固定色阶最低端 `rgb(16,32,48)`，
  空格 `#e8e8e8`（`state=zero-span`）。

## 5. 验证方式

```bash
npm install            # 仅测试需要 jsdom；库本身零运行时依赖
npm run test:heatmap   # 单元16 + 回归6 + 集成8 + 失败路径12 + 内存/产物
```

测试构成：`unit.test.js`（数据逻辑 16 项）、`regression.test.js`（旧行为 6 项）、
`integration.test.js`（真实 graphics.js + jsdom 8 项）、`failure-paths.js`（12 项）、
`memory-bounds.js`、`render-artifacts.js`、`before-after.js`。
浏览器人工验证：打开 `demos/heatmap/index.html`（含缩放、空数据、全零按钮）。
