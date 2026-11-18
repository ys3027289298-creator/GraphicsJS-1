# 本地 PDF 导出（真文本 + 矢量 + 字体子集嵌入）

## 背景与目标

GraphicsJS 原有 PDF 导出（`src/exporting.js` 的 `saveAsPdf`/`shareAsPdf`）只把
舞台序列化成 SVG，再 `POST` 到远程服务器 `//export.anychart.com/pdf` 渲染。
印刷流程需要离线、可选中文字的 PDF。本次新增一条**纯本地、零运行时依赖**的
SVG→PDF 转换链路，满足：

- 文本输出为**可选中的真文本**（PDF 文本操作符 + Type0/CIDFontType2 + 嵌入的
  TrueType 子集 + ToUnicode），绝不转曲线、绝不整页位图；
- 图形元素以**矢量路径**输出，线宽、线帽、连接、虚线、透明度（ExtGState）、
  线性渐变（Pattern/Shading）正确；
- 页面尺寸（pt）与 DPI 可配置；
- 不支持的特性**显式降级并记录 warning**，不静默丢弃任何元素；
- 原有导出路径**零变化**。

## 模块结构（全部为新增，未改动旧文件逻辑）

```
src/pdf/
  ttfSubset.js   纯 JS TrueType 子集化器（glyf/cmap/loca/hmtx/head/hhea/maxp/post）
  pdfWriter.js   底层 PDF 1.7 写出器（对象表、xref、Flate、字体、透明度、Pattern、图像）
  svg2pdf.js     XML 解析、SVG→PDF 转换、字体注册表、渐变/路径/文本/图像处理
  stagePdf.js    Stage 集成：acgraph.pdf.registerFont / stage.toPdfDocument / saveAsPdfLocal
```

四个文件均为 ES5、UMD 风格：浏览器中挂到全局 `acgraph.pdf`，Node 中走
`module.exports`，不引入任何第三方运行时依赖（压缩用 Node 内置 zlib，浏览器可
通过 `setDeflate` 注入 pako，无 deflate 时输出未压缩的合法 PDF）。

## 公共 API

```js
// 注册 TTF 字体（CFF/OTF 显式拒绝；注册顺序即字形回退链）
acgraph.pdf.registerFont('WenQuanYi Zen Hei', uint8Array);
acgraph.pdf.setDefaultFonts(['WenQuanYi Zen Hei']);

// 在真实 Stage 上（新增方法，不影响旧 saveAsPdf）
const doc = stage.toPdfDocument({
  width: 600, height: 400, // 页面尺寸（PDF point），省略时按 SVG 视口 * dpi/72
  dpi: 72,                 // user-unit→point 分辨率
  compress: true,          // Flate 压缩
  title: '...'
});
// doc.bytes (Uint8Array), doc.warnings[], doc.diagnostics,
// doc.extractedText[], doc.sourceText[]

stage.saveAsPdfLocal({ filename: 'x.pdf' }); // 浏览器触发下载
```

## 坐标系

PDF 原点在左下、Y 向上；SVG 原点在左上、Y 向下。根 `cm` 用
`[sx 0 0 -sy 0 pageH]` 一次性翻转 Y 轴处理所有形状。文本为避免被镜像，在 `BT`
内以 `[1 0 0 -1 x y] Tm` 抵消翻转（推导见 `svg2pdf.js#renderText` 注释），保证
字形正向且基线位置正确。

## 特性覆盖与降级策略（均有 warning，不静默丢元素）

| 特性 | 处理 | 降级/警告码 |
|---|---|---|
| path/rect/circle/ellipse/line/polyline/polygon | 矢量路径（含 arc→cubic 贝塞尔） | — |
| fill/stroke 纯色、fill/stroke-opacity、元素 opacity | DeviceRGB + ExtGState `ca/CA` | — |
| stroke-width/cap/join/miter/dasharray | `w/J/j/M/d` 操作符 | — |
| linearGradient | Type2 Pattern + Axial Shading（多 stop 用 stitching function） | — |
| radialGradient | 近似为轴向渐变 | `W_RADIAL_GRADIENT_DOWNGRADE` |
| pattern fill | 取 pattern 内首个绘制色平铺为纯色 | `W_PATTERN_DOWNGRADE` |
| 渐变描边 | 跳过描边并记录 | `W_STROKE_GRADIENT_UNSUPPORTED` |
| PNG/JPEG data-URI 图像 | Image XObject（PNG 自行 inflate+反滤波，含 SMask 透明） | 外部 URL：`W_IMAGE_EXTERNAL`；GIF 等：`W_IMAGE_FORMAT`；Adam7/非 8bit：`E_IMAGE_FORMAT` |
| font-weight bold / font-style italic | 常规字面渲染并记录 | `W_FONT_WEIGHT_DOWNGRADE` / `W_FONT_STYLE_DOWNGRADE` |
| 缺字形码点 | .notdef 占位，文字顺序保留并记录 | `E_NO_FONT_FOR_CODEPOINT` |
| use/textPath/filter/mask/foreignObject 等 | 跳过并记录 | `W_USE_UNSUPPORTED` 等 |
| CFF/OTF 字体 | 注册时直接抛错 | `E_FONT_CFF_UNSUPPORTED` |

## 文本顺序保证

转换分两遍：先 `prepareFonts` 按文档顺序遍历所有 `<text>`，按覆盖字体拆分 run、
收集码点并一次性构建子集与 PDF 字体资源；第二遍渲染时严格按同一文档顺序产出
`BT/Tm/Tf/Tj/ET`。每个 run 用绝对 `Tm` 定位，因此多字体混排也不会错位。
ToUnicode CMap 保证提取文本与源逐行一致（见 `verify-report.json#lineComparison`）。

## 验证方式

```bash
bash tools/run-all.sh   # 7 个阶段，全部产出在 artifacts/deliverables/
```

- `tools/test-ttf-subset.js`：子集化单测，并经 fontTools 独立校验 cmap/glyf/loca/校验和；
- `tools/test-failure-paths.js`：22 项失败/降级用例；
- `tools/test-stage-integration.js`：jsdom+vm 内真实 acgraph Stage 端到端；
- `tools/verify-pdf.py`：pypdf 与 PyMuPDF 双引擎文本提取、字体嵌入结构、操作符检查；
- `tools/compare-pixels.py`：与独立渲染器 resvg 的像素几何对比；
- `tools/verify-legacy-payload.js`：旧导出 payload 结构 + 旧文件 MD5 逐位回归；
- `tools/measure-bounds.js`：内存/输出尺寸上界测量。
