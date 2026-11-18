goog.provide('acgraph.utils.Eps');

/**
 * @fileoverview
 * A DOM-only SVG to Encapsulated PostScript (EPSF-3.0 / PostScript
 * LanguageLevel 2) converter. It is used by {@link acgraph.vector.Stage#toEps}
 * to feed typesetting systems that only accept EPS instead of the SVG/PNG/JPG/PDF
 * outputs the library otherwise produces.
 *
 * Design contract:
 *  - paths are emitted as native PostScript path operators (moveto/lineto/
 *    curveto/closepath); SVG arcs are parametrized per the SVG 1.1
 *    specification and approximated with cubic Beziers;
 *  - text is emitted with the PostScript base-14 fonts and `show`; transformed
 *    text installs an affine matrix through `concat` because a glyph stream
 *    cannot be transformed point-by-point;
 *  - the BoundingBox is measured from the actual painted geometry (two passes
 *    over the same transformed path data), expanded by stroke width, so the
 *    content is neither clipped nor padded with large empty margins;
 *  - effects that EPS Level 2 cannot express are degraded explicitly and every
 *    degradation is recorded both in the returned `warnings` array and as a
 *    `% EPS degradation:` header comment;
 *  - the converter never touches the source SVG DOM or any other exporter, so
 *    the pre-existing export behavior is unchanged.
 */


/**
 * Maximum number of degradation warnings attached to a single document. Any
 * further degradation is summarized by one final suppression message, so the
 * warning list is bounded independently of the input size.
 * @type {number}
 * @const
 */
acgraph.utils.Eps.MAX_WARNINGS = 100;


/**
 * Smallest BoundingBox dimension emitted for an empty (or fully unsupported)
 * document: an EPS must declare a non-empty box.
 * @type {number}
 * @const
 * @private
 */
acgraph.utils.Eps.EMPTY_BOX_SIZE_ = 1;


/**
 * Half-line-width-independent safety padding, in PostScript points, applied to
 * the measured BoundingBox so rasterized anti-aliasing fringes cannot clip.
 * @type {number}
 * @const
 * @private
 */
acgraph.utils.Eps.BOX_PADDING_ = 1;


/**
 * Converts an SVG document string into an EPS document.
 * @param {string} svgString A serialized SVG document (as produced by
 *     {@link acgraph.vector.Stage#toSvg}).
 * @return {{eps: string, warnings: Array.<string>, boundingBox: Array.<number>,
 *     width: number, height: number}}
 */
acgraph.utils.Eps.fromSvg = function(svgString) {
  if (!goog.isString(svgString) || !svgString.length) {
    throw new Error('SVG input must be a non-empty string');
  }
  // The library serializer emits both an XML declaration and a duplicated
  // default xmlns attribute, which strict XML parsers reject as malformed.
  // Normalize the input before handing it to DOMParser.
  svgString = svgString.replace(/^\s*<\?xml[^?]*\?>\s*/, '');
  var xmlnsSeen = false;
  svgString = svgString.replace(/\sxmlns="[^"]*"/g, function(match) {
    if (xmlnsSeen) return '';
    xmlnsSeen = true;
    return match;
  });
  var parser = new DOMParser();
  var doc = parser.parseFromString(svgString, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length ||
      doc.documentElement.localName != 'svg') {
    throw new Error('input is not a valid SVG document');
  }
  var converter = new acgraph.utils.Eps.Converter_(doc);
  return converter.convert();
};


/**
 * Base-14 font resolver. Family names coming from SVG `font-family` attributes
 * are free-form CSS lists, so matching is substring based.
 * @param {string} fontFamily Raw SVG font-family value.
 * @param {?string} fontWeight Raw SVG font-weight value.
 * @param {?string} fontStyle Raw SVG font-style value.
 * @return {string} A PostScript base-14 font name.
 * @private
 */
acgraph.utils.Eps.resolveFont_ = function(fontFamily, fontWeight, fontStyle) {
  var family = (fontFamily || '').toLowerCase();
  var bold = fontWeight == 'bold' || fontWeight == 'bolder' ||
      (parseFloat(fontWeight) >= 600);
  var italic = fontStyle == 'italic' || fontStyle == 'oblique';
  var prefix;
  if (family.indexOf('courier') != -1 || family.indexOf('mono') != -1) {
    prefix = 'Courier';
  } else if (family.indexOf('times') != -1 || family.indexOf('serif') != -1) {
    prefix = 'Times';
  } else {
    prefix = 'Helvetica';
  }
  if (prefix == 'Times') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (bold && italic) return prefix + '-BoldOblique';
  if (bold) return prefix + '-Bold';
  if (italic) return prefix + '-Oblique';
  return prefix;
};


/**
 * Average glyph advance factors per base-14 family, as a fraction of the font
 * size. They are only used for BoundingBox estimation of `show` strings (EPS
 * has no DOM text metrics); the values slightly exceed the real averages so
 * glyphs can never be clipped by the declared box.
 * @enum {number}
 * @private
 */
acgraph.utils.Eps.ADVANCE_FACTOR_ = {
  'Courier': 0.61,
  'Times': 0.5,
  'Helvetica': 0.55
};


/**
 * The subset of the SVG 1.1 named colors that the library scene API can emit.
 * Unknown names fall back to black with a degradation warning.
 * @const {Object.<string, string>}
 * @private
 */
acgraph.utils.Eps.NAMED_COLORS_ = {
  'aliceblue': '#f0f8ff', 'antiquewhite': '#faebd7', 'aqua': '#00ffff',
  'aquamarine': '#7fffd4', 'azure': '#f0ffff', 'beige': '#f5f5dc',
  'bisque': '#ffe4c4', 'black': '#000000', 'blanchedalmond': '#ffebcd',
  'blue': '#0000ff', 'blueviolet': '#8a2be2', 'brown': '#a52a2a',
  'burlywood': '#deb887', 'cadetblue': '#5f9ea0', 'chartreuse': '#7fff00',
  'chocolate': '#d2691e', 'coral': '#ff7f50', 'cornflowerblue': '#6495ed',
  'cornsilk': '#fff8dc', 'crimson': '#dc143c', 'cyan': '#00ffff',
  'darkblue': '#00008b', 'darkcyan': '#008b8b', 'darkgoldenrod': '#b8860b',
  'darkgray': '#a9a9a9', 'darkgreen': '#006400', 'darkgrey': '#a9a9a9',
  'darkkhaki': '#bdb76b', 'darkmagenta': '#8b008b', 'darkolivegreen': '#556b2f',
  'darkorange': '#ff8c00', 'darkorchid': '#9932cc', 'darkred': '#8b0000',
  'darksalmon': '#e9967a', 'darkseagreen': '#8fbc8f', 'darkslateblue': '#483d8b',
  'darkslategray': '#2f4f4f', 'darkslategrey': '#2f4f4f', 'darkturquoise': '#00ced1',
  'darkviolet': '#9400d3', 'deeppink': '#ff1493', 'deepskyblue': '#00bfff',
  'dimgray': '#696969', 'dimgrey': '#696969', 'dodgerblue': '#1e90ff',
  'firebrick': '#b22222', 'floralwhite': '#fffaf0', 'forestgreen': '#228b22',
  'fuchsia': '#ff00ff', 'gainsboro': '#dcdcdc', 'ghostwhite': '#f8f8ff',
  'gold': '#ffd700', 'goldenrod': '#daa520', 'gray': '#808080',
  'green': '#008000', 'greenyellow': '#adff2f', 'grey': '#808080',
  'honeydew': '#f0fff0', 'hotpink': '#ff69b4', 'indianred': '#cd5c5c',
  'indigo': '#4b0082', 'ivory': '#fffff0', 'khaki': '#f0e68c',
  'lavender': '#e6e6fa', 'lavenderblush': '#fff0f5', 'lawngreen': '#7cfc00',
  'lemonchiffon': '#fffacd', 'lightblue': '#add8e6', 'lightcoral': '#f08080',
  'lightcyan': '#e0ffff', 'lightgoldenrodyellow': '#fafad2', 'lightgray': '#d3d3d3',
  'lightgreen': '#90ee90', 'lightgrey': '#d3d3d3', 'lightpink': '#ffb6c1',
  'lightsalmon': '#ffa07a', 'lightseagreen': '#20b2aa', 'lightskyblue': '#87cefa',
  'lightslategray': '#778899', 'lightslategrey': '#778899', 'lightsteelblue': '#b0c4de',
  'lightyellow': '#ffffe0', 'lime': '#00ff00', 'limegreen': '#32cd32',
  'linen': '#faf0e6', 'magenta': '#ff00ff', 'maroon': '#800000',
  'mediumaquamarine': '#66cdaa', 'mediumblue': '#0000cd', 'mediumorchid': '#ba55d3',
  'mediumpurple': '#9370db', 'mediumseagreen': '#3cb371', 'mediumslateblue': '#7b68ee',
  'mediumspringgreen': '#00fa9a', 'mediumturquoise': '#48d1cc',
  'mediumvioletred': '#c71585', 'midnightblue': '#191970', 'mintcream': '#f5fffa',
  'mistyrose': '#ffe4e1', 'moccasin': '#ffe4b5', 'navajowhite': '#ffdead',
  'navy': '#000080', 'oldlace': '#fdf5e6', 'olive': '#808000',
  'olivedrab': '#6b8e23', 'orange': '#ffa500', 'orangered': '#ff4500',
  'orchid': '#da70d6', 'palegoldenrod': '#eee8aa', 'palegreen': '#98fb98',
  'paleturquoise': '#afeeee', 'palevioletred': '#db7093', 'papayawhip': '#ffefd5',
  'peachpuff': '#ffdab9', 'peru': '#cd853f', 'pink': '#ffc0cb',
  'plum': '#dda0dd', 'powderblue': '#b0e0e6', 'purple': '#800080',
  'red': '#ff0000', 'rosybrown': '#bc8f8f', 'royalblue': '#4169e1',
  'saddlebrown': '#8b4513', 'salmon': '#fa8072', 'sandybrown': '#f4a460',
  'seagreen': '#2e8b57', 'seashell': '#fff5ee', 'sienna': '#a0522d',
  'silver': '#c0c0c0', 'skyblue': '#87ceeb', 'slateblue': '#6a5acd',
  'slategray': '#708090', 'slategrey': '#708090', 'snow': '#fffafa',
  'springgreen': '#00ff7f', 'steelblue': '#4682b4', 'tan': '#d2b48c',
  'teal': '#008080', 'thistle': '#d8bfd8', 'tomato': '#ff6347',
  'turquoise': '#40e0d0', 'violet': '#ee82ee', 'wheat': '#f5deb3',
  'white': '#ffffff', 'whitesmoke': '#f5f5f5', 'yellow': '#ffff00',
  'yellowgreen': '#9acd32', 'transparent': 'none'
};


/**
 * Hatch fill type names serialized by the library. They are not colors and are
 * always degraded to a solid gray.
 * @const {Object.<string, boolean>}
 * @private
 */
acgraph.utils.Eps.HATCH_TYPES_ = {
  'backward-diagonal': true, 'forward-diagonal': true, 'horizontal': true,
  'vertical': true, 'dashed-backward-diagonal': true, 'grid': true,
  'dashed-forward-diagonal': true, 'dashed-horizontal': true,
  'dashed-vertical': true, 'diagonal-cross': true, 'diagonal-brick': true,
  'horizontal-brick': true, 'vertical-brick': true
};


//----------------------------------------------------------------------------------------------------------------------
// Converter
//----------------------------------------------------------------------------------------------------------------------
/**
 * @param {Document} doc Parsed SVG document.
 * @constructor
 * @private
 */
acgraph.utils.Eps.Converter_ = function(doc) {
  /**
   * @type {Document}
   * @private
   */
  this.doc_ = doc;

  /**
   * @type {Element}
   * @private
   */
  this.root_ = doc.documentElement;

  /**
   * PostScript body operators accumulated during the single DOM traversal.
   * @type {Array.<string>}
   * @private
   */
  this.body_ = [];

  /**
   * @type {Array.<string>}
   * @private
   */
  this.warnings_ = [];

  /**
   * Current SVG-space affine transform stack; each entry is [a,b,c,d,e,f].
   * @type {Array.<Array.<number>>}
   * @private
   */
  this.matrixStack_ = [];

  /**
   * Measured content hull in SVG (top-left origin) coordinates.
   * @type {?{minX: number, minY: number, maxX: number, maxY: number}}
   * @private
   */
  this.hull_ = null;

  /**
   * Lookup of defs elements by id (gradients, clips, patterns).
   * @type {Object.<string, Element>}
   * @private
   */
  this.defs_ = {};
};


/**
 * Runs the conversion and assembles the EPS document.
 * @return {{eps: string, warnings: Array.<string>, boundingBox: Array.<number>,
 *     width: number, height: number}}
 */
acgraph.utils.Eps.Converter_.prototype.convert = function() {
  var width = parseFloat(this.root_.getAttribute('width')) || 0;
  var height = parseFloat(this.root_.getAttribute('height')) || 0;
  this.stageHeight_ = height;

  var indexed = this.doc_.querySelectorAll('[id]');
  for (var i = 0; i < indexed.length; i++) {
    this.defs_[indexed[i].getAttribute('id')] = indexed[i];
  }

  this.matrixStack_ = [[1, 0, 0, 1, 0, 0]];
  this.visitChildren_(this.root_);

  var box = this.computeBoundingBox_();
  var eps = this.assemble_(box);
  return {
    eps: eps,
    warnings: this.warnings_,
    boundingBox: box,
    width: width,
    height: height
  };
};


/**
 * Records one degradation, honoring {@link acgraph.utils.Eps.MAX_WARNINGS}.
 * @param {string} message
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.warn_ = function(message) {
  if (this.warnings_.length == acgraph.utils.Eps.MAX_WARNINGS) {
    this.warnings_.push('... further degradation warnings were suppressed');
  } else if (this.warnings_.length < acgraph.utils.Eps.MAX_WARNINGS) {
    this.warnings_.push(message);
  }
};


/**
 * Expands the measured hull with an SVG-space rectangle, optionally transformed
 * by the current matrix.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {Array.<number>=} opt_matrix Matrix to map the corners through.
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.addRect_ = function(x, y, w, h, opt_matrix) {
  var corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  for (var i = 0; i < corners.length; i++) {
    var p = opt_matrix ?
        acgraph.utils.Eps.applyMatrix_(opt_matrix, corners[i][0], corners[i][1]) :
        corners[i];
    if (!this.hull_) {
      this.hull_ = {minX: p[0], minY: p[1], maxX: p[0], maxY: p[1]};
    } else {
      if (p[0] < this.hull_.minX) this.hull_.minX = p[0];
      if (p[1] < this.hull_.minY) this.hull_.minY = p[1];
      if (p[0] > this.hull_.maxX) this.hull_.maxX = p[0];
      if (p[1] > this.hull_.maxY) this.hull_.maxY = p[1];
    }
  }
};


/**
 * Adds a single painted point (already in absolute SVG coordinates of the
 * current matrix) to the hull.
 * @param {number} x
 * @param {number} y
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.addPoint_ = function(x, y) {
  this.addRect_(x, y, 0, 0);
};


/**
 * Finalizes the BoundingBox in PostScript (bottom-left origin) coordinates.
 * @return {Array.<number>} Integer [llx, lly, urx, ury].
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.computeBoundingBox_ = function() {
  if (!this.hull_) {
    return [0, 0, acgraph.utils.Eps.EMPTY_BOX_SIZE_,
      acgraph.utils.Eps.EMPTY_BOX_SIZE_];
  }
  var pad = acgraph.utils.Eps.BOX_PADDING_;
  var h = this.stageHeight_;
  // Flip the SVG hull to PostScript coordinates and apply the safety padding.
  var llx = Math.floor(this.hull_.minX - pad);
  var urx = Math.ceil(this.hull_.maxX + pad);
  var lly = Math.floor(h - this.hull_.maxY - pad);
  var ury = Math.ceil(h - this.hull_.minY + pad);
  if (urx <= llx) urx = llx + acgraph.utils.Eps.EMPTY_BOX_SIZE_;
  if (ury <= lly) ury = lly + acgraph.utils.Eps.EMPTY_BOX_SIZE_;
  return [llx, lly, urx, ury];
};


/**
 * @param {Array.<number>} box Integer BoundingBox.
 * @return {string} The complete EPS document text.
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.assemble_ = function(box) {
  var h = this.stageHeight_;
  var lines = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%BoundingBox: ' + box.join(' '),
    '%%HiResBoundingBox: ' +
        acgraph.utils.Eps.fmt_(box[0]) + ' ' + acgraph.utils.Eps.fmt_(box[1]) +
        ' ' + acgraph.utils.Eps.fmt_(box[2]) + ' ' + acgraph.utils.Eps.fmt_(box[3]),
    '%%Creator: GraphicsJS acgraph.utils.Eps',
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginSetup',
    '/mkfont { exch findfont exch scalefont setfont } bind def',
    '%%EndSetup'
  ];
  for (var i = 0; i < this.warnings_.length; i++) {
    lines.push('% EPS degradation: ' + this.warnings_[i]);
  }
  lines.push('% Coordinates are pre-flipped from SVG (top-left origin) to ' +
      'PostScript (bottom-left origin).');
  var body = this.body_.join('\n');
  if (body) lines.push(body);
  lines.push('%%EOF');
  return lines.join('\n');
};


/**
 * Visits every child element of an SVG container.
 * @param {Element} container
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.visitChildren_ = function(container) {
  var child = container.firstElementChild;
  while (child) {
    this.visitElement_(child);
    child = child.nextElementSibling;
  }
};


/**
 * Dispatches one SVG element to the matching emitter.
 * @param {Element} el
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.visitElement_ = function(el) {
  var name = el.localName;
  if (name == 'defs' || name == 'desc' || name == 'title' ||
      name == 'linearGradient' || name == 'radialGradient' ||
      name == 'pattern' || name == 'filter' || name == 'clipPath' ||
      name == 'mask' || name == 'symbol' || name == 'marker') {
    return;
  }
  if (name == 'g') {
    var matrix = this.pushTransform_(el.getAttribute('transform'));
    this.visitChildren_(el);
    if (matrix) this.matrixStack_.pop();
    return;
  }
  if (name == 'image') {
    this.warn_('<image>: raster <image> elements are not supported in EPS ' +
        'output and were skipped');
    return;
  }
  if (name == 'text') {
    this.emitText_(el);
    return;
  }
  var pushed = this.pushTransform_(el.getAttribute('transform'));
  var segments = this.buildPath_(el);
  if (segments) this.emitShape_(el, segments);
  if (pushed) this.matrixStack_.pop();
};


/**
 * Pushes an SVG transform attribute onto the matrix stack.
 * @param {?string} transform
 * @return {boolean} Whether a new matrix was pushed.
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.pushTransform_ = function(transform) {
  var matrix = acgraph.utils.Eps.parseTransform_(transform,
      this.matrixStack_[this.matrixStack_.length - 1]);
  if (!matrix) return false;
  this.matrixStack_.push(matrix);
  return true;
};


/**
 * Builds the absolute-segment path (M/L/C/Z in SVG coordinates of the current
 * matrix) for a geometry element, or null for unsupported element types.
 * @param {Element} el
 * @return {?Array.<acgraph.utils.Eps.Segment_>}
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.buildPath_ = function(el) {
  var name = el.localName;
  var raw;
  if (name == 'path') {
    raw = el.getAttribute('d');
    if (!raw) return null;
  } else if (name == 'rect') {
    raw = acgraph.utils.Eps.rectToPath_(el);
  } else if (name == 'circle') {
    raw = acgraph.utils.Eps.ellipseToPath_(
        parseFloat(el.getAttribute('cx')) || 0,
        parseFloat(el.getAttribute('cy')) || 0,
        parseFloat(el.getAttribute('r')) || 0,
        parseFloat(el.getAttribute('r')) || 0);
  } else if (name == 'ellipse') {
    raw = acgraph.utils.Eps.ellipseToPath_(
        parseFloat(el.getAttribute('cx')) || 0,
        parseFloat(el.getAttribute('cy')) || 0,
        parseFloat(el.getAttribute('rx')) || 0,
        parseFloat(el.getAttribute('ry')) || 0);
  } else if (name == 'line') {
    raw = 'M ' + el.getAttribute('x1') + ' ' + el.getAttribute('y1') +
        ' L ' + el.getAttribute('x2') + ' ' + el.getAttribute('y2');
  } else if (name == 'polyline' || name == 'polygon') {
    raw = 'M ' + (el.getAttribute('points') || '').replace(/\s+/g, ' L ');
  } else {
    return null;
  }
  var segments = acgraph.utils.Eps.parsePathData_(raw);
  var matrix = this.matrixStack_[this.matrixStack_.length - 1];
  for (var i = 0; i < segments.length; i++) {
    segments[i].map(matrix);
  }
  return segments;
};


/**
 * Emits one stroked/filled shape, including clipping and BoundingBox measuring.
 * @param {Element} el
 * @param {Array.<acgraph.utils.Eps.Segment_>} segments Path in the current SVG
 *     coordinate space.
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.emitShape_ = function(el, segments) {
  if (el.getAttribute('filter')) {
    this.warn_('<' + el.localName + '>: filter effects are not supported in ' +
        'EPS and were ignored');
  }

  var fillPaint = this.resolvePaint_(el, true);
  var strokePaint = this.resolvePaint_(el, false);
  var strokeWidth = parseFloat(el.getAttribute('stroke-width')) || 1;
  var clip = this.resolveClip_(el);

  // BoundingBox: every mapped path point, grown by the stroke half-width.
  var grow = strokePaint ? strokeWidth / 2 : 0;
  for (var i = 0; i < segments.length; i++) {
    segments[i].expandHull(this, grow);
  }

  var open = '';
  var close = '';
  if (clip) {
    open = 'gsave\n' + clip + '\n';
    close = 'grestore';
  }

  var blocks = [];
  if (fillPaint) {
    blocks.push(this.pathOperators_(segments) + '\n' +
        acgraph.utils.Eps.colorOperator_(fillPaint) + '\nfill');
  }
  if (strokePaint) {
    blocks.push(this.pathOperators_(segments) + '\n' +
        acgraph.utils.Eps.colorOperator_(strokePaint) + '\n' +
        this.strokeOperators_(el, strokeWidth));
  }
  if (!blocks.length) return;
  var text = blocks.join('\n');
  if (open) text = open + text + '\n' + close;
  this.body_.push(text);
};


/**
 * Resolves the clip-path attribute into PostScript clip operators.
 * @param {Element} el
 * @return {?string} Null when there is no (resolvable) clip.
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.resolveClip_ = function(el) {
  var attr = el.getAttribute('clip-path');
  if (!attr) return null;
  var match = /url\(["']?#([^"')]+)["']?\)/.exec(attr);
  if (!match) return null;
  var clipEl = this.defs_[match[1]];
  if (!clipEl) {
    this.warn_('unresolved clip-path "#' + match[1] +
        '"; the element was rendered without clipping');
    return null;
  }
  var lines = [];
  for (var child = clipEl.firstElementChild; child;
       child = child.nextElementSibling) {
    var pushed = this.pushTransform_(child.getAttribute('transform'));
    var segments = this.buildPath_(child);
    if (segments) lines.push(this.pathOperators_(segments) + '\nclip');
    if (pushed) this.matrixStack_.pop();
  }
  return lines.join('\n');
};


/**
 * Resolves an SVG fill/stroke paint to an RGB triple in [0,1].
 * @param {Element} el
 * @param {boolean} isFill true for fill, false for stroke.
 * @return {?Array.<number>} Null when the paint is "none".
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.resolvePaint_ = function(el, isFill) {
  var attrName = isFill ? 'fill' : 'stroke';
  var raw = el.getAttribute(attrName);
  var tag = '<' + el.localName + '>';
  if (raw == null) {
    // SVG default paint is black for fills, none for strokes.
    return isFill ? [0, 0, 0] : null;
  }
  if (raw == 'none' || raw == 'transparent') return null;

  var urlMatch = /url\(["']?#([^"')]+)["']?\)/.exec(raw);
  if (urlMatch) {
    var def = this.defs_[urlMatch[1]];
    if (def) {
      var defName = def.localName;
      if (defName == 'linearGradient' || defName == 'radialGradient') {
        this.warn_(tag + ': ' + defName + ' fill is not supported in EPS; ' +
            'the first gradient stop color was used');
        var stop = def.querySelector('stop');
        var stopColor = stop ?
            (stop.getAttribute('stop-color') ||
             acgraph.utils.Eps.styleValue_(stop.getAttribute('style'),
                 'stop-color')) :
            null;
        var rgb = acgraph.utils.Eps.parseColor_(stopColor);
        return this.applyOpacity_(el, rgb || [0, 0, 0], isFill, tag, true);
      }
      if (defName == 'pattern') {
        this.warn_(tag + ': pattern/hatch fill is not supported in EPS; a ' +
            'solid fill was used');
        return this.applyOpacity_(el, [0.2, 0.2, 0.2], isFill, tag, true);
      }
    }
    this.warn_(tag + ': unresolved paint reference ' + raw +
        '; black was used');
    return [0, 0, 0];
  }

  if (acgraph.utils.Eps.HATCH_TYPES_[raw]) {
    this.warn_(tag + ': pattern/hatch fill is not supported in EPS; a solid ' +
        'fill was used');
    return this.applyOpacity_(el, [0.2, 0.2, 0.2], isFill, tag, true);
  }

  var color = acgraph.utils.Eps.parseColor_(raw);
  if (!color) {
    this.warn_(tag + ': unrecognized color "' + raw + '"; black was used');
    color = [0, 0, 0];
  }
  return this.applyOpacity_(el, color, isFill, tag, false);
};


/**
 * Applies fill/stroke/text opacity to a color by compositing it over white,
 * which is the explicit EPS Level 2 degradation for partial transparency.
 * @param {Element} el
 * @param {Array.<number>} rgb
 * @param {boolean} isFill
 * @param {string} tag
 * @param {boolean} isDegradedPaint Whether the color itself came from a
 *     degraded fill (gradient/pattern); opacity is still applied on top.
 * @return {Array.<number>}
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.applyOpacity_ =
    function(el, rgb, isFill, tag, isDegradedPaint) {
  var opacityAttr = el.getAttribute(isFill ? 'fill-opacity' : 'stroke-opacity');
  var opacity = opacityAttr == null ? 1 : parseFloat(opacityAttr);
  var generic = parseFloat(el.getAttribute('opacity'));
  if (!isNaN(generic)) opacity *= generic;
  var rgba = /rgba?\(([^)]+)\)/.exec(el.getAttribute(isFill ? 'fill' : 'stroke'));
  if (rgba) {
    var parts = rgba[1].split(',');
    if (parts.length == 4) opacity *= parseFloat(parts[3]);
  }
  if (opacity >= 0.999) return rgb;
  this.warn_(tag + ': opacity ' + opacity.toFixed(3) + ' is not expressible ' +
      'in EPS Level 2; the color was composited over white');
  return [
    rgb[0] * opacity + (1 - opacity),
    rgb[1] * opacity + (1 - opacity),
    rgb[2] * opacity + (1 - opacity)
  ];
};


/**
 * Emits all PostScript line decoration operators for a stroke.
 * @param {Element} el
 * @param {number} width
 * @return {string}
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.strokeOperators_ = function(el, width) {
  var lines = [acgraph.utils.Eps.fmt_(width) + ' setlinewidth'];
  var join = (el.getAttribute('stroke-linejoin') || 'miter').toLowerCase();
  var joinCode = join == 'round' ? 1 : join == 'bevel' ? 2 : 0;
  lines.push(joinCode + ' setlinejoin');
  var cap = (el.getAttribute('stroke-linecap') || 'butt').toLowerCase();
  var capCode = cap == 'round' ? 1 : cap == 'square' ? 2 : 0;
  lines.push(capCode + ' setlinecap');
  var dash = el.getAttribute('stroke-dasharray');
  if (dash && dash != 'none') {
    var values = dash.split(/[\s,]+/).filter(Boolean).map(function(v) {
      return acgraph.utils.Eps.fmt_(parseFloat(v));
    });
    lines.push('[' + values.join(' ') + '] 0 setdash');
  }
  return lines.join('\n') + '\nstroke';
};


/**
 * Renders mapped path segments as PostScript path operators (y flipped).
 * @param {Array.<acgraph.utils.Eps.Segment_>} segments
 * @return {string}
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.pathOperators_ = function(segments) {
  var h = this.stageHeight_;
  var lines = ['newpath'];
  for (var i = 0; i < segments.length; i++) {
    lines.push(segments[i].toPs(h));
  }
  return lines.join('\n');
};


/**
 * Emits an SVG <text> element as base-14 `show` operators, handling tspans,
 * non-Latin-1 glyphs, opacity and affine transformations.
 * @param {Element} el
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.emitText_ = function(el) {
  var tag = '<text>';
  var fontSize = parseFloat(el.getAttribute('font-size')) || 12;
  var font = acgraph.utils.Eps.resolveFont_(
      el.getAttribute('font-family'),
      el.getAttribute('font-weight'),
      el.getAttribute('font-style'));

  var color = this.resolveTextColor_(el, tag);
  var baseX = parseFloat(el.getAttribute('x')) || 0;
  var baseY = parseFloat(el.getAttribute('y')) || 0;

  // Collect one entry per visual line (tspan or a bare text node).
  var lines = [];
  var pendingY = baseY;
  var tspans = el.getElementsByTagName('tspan');
  if (tspans.length) {
    for (var i = 0; i < tspans.length; i++) {
      var tspan = tspans[i];
      var dy = parseFloat(tspan.getAttribute('dy')) || 0;
      pendingY += dy;
      var x = tspan.getAttribute('x') != null ?
          parseFloat(tspan.getAttribute('x')) : baseX;
      lines.push({x: x, y: pendingY, text: tspan.textContent});
    }
  } else {
    lines.push({x: baseX, y: baseY, text: el.textContent});
  }

  var nonLatin = 0;
  for (i = 0; i < lines.length; i++) {
    var filtered = '';
    var text = lines[i].text;
    for (var j = 0; j < text.length; j++) {
      var code = text.charCodeAt(j);
      if (code > 255) {
        nonLatin++;
      } else {
        filtered += text.charAt(j);
      }
    }
    lines[i].text = acgraph.utils.Eps.escapePs_(filtered);
  }
  if (nonLatin) {
    this.warn_(tag + ': ' + nonLatin + ' non-Latin-1 character(s) cannot be ' +
        'rendered with the base-14 fonts and were dropped; use Latin text or ' +
        'embedded fonts');
  }

  var parent = this.matrixStack_[this.matrixStack_.length - 1];
  var local = acgraph.utils.Eps.parseTransform_(el.getAttribute('transform'),
      [1, 0, 0, 1, 0, 0]);
  var matrix = local ?
      acgraph.utils.Eps.multiplyMatrix_(parent, local) : parent;
  var transformed = !acgraph.utils.Eps.isIdentity_(matrix);

  // BoundingBox: always include the untransformed local line box, and for
  // transformed text also include the mapped corners. The conservative union
  // can never clip a glyph, while still tracking rotated geometry.
  var factor = acgraph.utils.Eps.ADVANCE_FACTOR_[
      font.indexOf('Courier') == 0 ? 'Courier' :
      font.indexOf('Times') == 0 ? 'Times' : 'Helvetica'];
  for (i = 0; i < lines.length; i++) {
    var line = lines[i];
    var visualLength = line.text.length;
    var w = visualLength * fontSize * factor;
    var x0 = line.x - 0.3 * fontSize;
    var top = line.y - 0.8 * fontSize;
    var boxW = w + 0.4 * fontSize;
    var boxH = 1.2 * fontSize;
    this.addRect_(x0, top, boxW, boxH);
    if (transformed) this.addRect_(x0, top, boxW, boxH, matrix);
  }

  var out = [acgraph.utils.Eps.colorOperator_(color),
    '/' + font + ' ' + acgraph.utils.Eps.fmt_(fontSize) + ' mkfont'];
  var h = this.stageHeight_;
  if (transformed) {
    // The SVG text matrix M=[a c e; b d f] maps local glyph coordinates into
    // y-down SVG space. The equivalent y-up PostScript frame for the font must
    // keep a positive determinant (otherwise glyphs mirror): its linear part
    // is [a -c; -b d] and its translation is (e, H-f). With that frame the
    // local pen (x, y) is entered as (x, -y), so the mapped origin equals
    // (ax+cy+e, H-(bx+dy+f)) - exactly the y-flipped SVG position.
    var ps = [matrix[0], -matrix[1], -matrix[2], matrix[3],
      matrix[4], h - matrix[5]];
    var psLine = '[' + ps.map(acgraph.utils.Eps.fmt_).join(' ') + '] concat';
    var block = ['gsave', psLine].concat(out);
    for (i = 0; i < lines.length; i++) {
      if (!lines[i].text) continue;
      block.push(acgraph.utils.Eps.fmt_(lines[i].x) + ' ' +
          acgraph.utils.Eps.fmt_(-lines[i].y) + ' moveto (' +
          lines[i].text + ') show');
    }
    block.push('grestore');
    this.body_.push(block.join('\n'));
  } else {
    for (i = 0; i < lines.length; i++) {
      if (!lines[i].text) continue;
      out.push(acgraph.utils.Eps.fmt_(lines[i].x) + ' ' +
          acgraph.utils.Eps.fmt_(h - lines[i].y) + ' moveto (' +
          lines[i].text + ') show');
    }
    this.body_.push(out.join('\n'));
  }
};


/**
 * Resolves the text fill color, including the text-level opacity degradation.
 * @param {Element} el
 * @param {string} tag
 * @return {Array.<number>}
 * @private
 */
acgraph.utils.Eps.Converter_.prototype.resolveTextColor_ = function(el, tag) {
  var raw = el.getAttribute('fill');
  var color = raw ? acgraph.utils.Eps.parseColor_(raw) : [0, 0, 0];
  if (!color) color = [0, 0, 0];
  var styleOpacity = parseFloat(
      acgraph.utils.Eps.styleValue_(el.getAttribute('style'), 'opacity'));
  var attrOpacity = parseFloat(el.getAttribute('opacity'));
  var opacity = 1;
  if (!isNaN(styleOpacity)) opacity = styleOpacity;
  if (!isNaN(attrOpacity)) opacity = attrOpacity;
  if (opacity < 0.999) {
    this.warn_(tag + ': text opacity ' + opacity.toFixed(3) + ' is not ' +
        'expressible in EPS Level 2; the color was composited over white');
    color = [
      color[0] * opacity + (1 - opacity),
      color[1] * opacity + (1 - opacity),
      color[2] * opacity + (1 - opacity)
    ];
  }
  return color;
};


//----------------------------------------------------------------------------------------------------------------------
// Static helpers: matrices
//----------------------------------------------------------------------------------------------------------------------
/**
 * Applies an SVG matrix [a,b,c,d,e,f] to a point.
 * @param {Array.<number>} m
 * @param {number} x
 * @param {number} y
 * @return {Array.<number>}
 * @private
 */
acgraph.utils.Eps.applyMatrix_ = function(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
};


/**
 * Multiplies two SVG matrices m1 * m2.
 * @param {Array.<number>} m1
 * @param {Array.<number>} m2
 * @return {Array.<number>}
 * @private
 */
acgraph.utils.Eps.multiplyMatrix_ = function(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
};


/**
 * @param {Array.<number>} m
 * @return {boolean}
 * @private
 */
acgraph.utils.Eps.isIdentity_ = function(m) {
  return acgraph.utils.Eps.fmt_(m[0]) == '1' && acgraph.utils.Eps.fmt_(m[1]) == '0' &&
      acgraph.utils.Eps.fmt_(m[2]) == '0' && acgraph.utils.Eps.fmt_(m[3]) == '1' &&
      acgraph.utils.Eps.fmt_(m[4]) == '0' && acgraph.utils.Eps.fmt_(m[5]) == '0';
};


/**
 * Parses an SVG transform attribute and composes it over the parent matrix.
 * Supports matrix/translate/scale/rotate (with optional center)/skewX/skewY.
 * @param {?string} attr
 * @param {Array.<number>} parent
 * @return {?Array.<number>} Null when the attribute is empty/unsupported.
 * @private
 */
acgraph.utils.Eps.parseTransform_ = function(attr, parent) {
  if (!attr) return null;
  var result = parent;
  var re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  var match;
  while ((match = re.exec(attr))) {
    var args = match[2].split(/[\s,]+/).filter(Boolean).map(parseFloat);
    var local;
    switch (match[1]) {
      case 'matrix':
        local = args;
        break;
      case 'translate':
        local = [1, 0, 0, 1, args[0], args[1] || 0];
        break;
      case 'scale':
        local = [args[0], 0, 0, args.length > 1 ? args[1] : args[0], 0, 0];
        break;
      case 'rotate':
        var angle = args[0] * Math.PI / 180;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        local = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          // rotate(a, cx, cy)
          local = acgraph.utils.Eps.multiplyMatrix_(
              [1, 0, 0, 1, args[1], args[2]],
              acgraph.utils.Eps.multiplyMatrix_(local,
                  [1, 0, 0, 1, -args[1], -args[2]]));
        }
        break;
      case 'skewX':
        local = [1, 0, Math.tan(args[0] * Math.PI / 180), 1, 0, 0];
        break;
      case 'skewY':
        local = [1, Math.tan(args[0] * Math.PI / 180), 0, 1, 0, 0];
        break;
      default:
        local = null;
    }
    if (local) result = acgraph.utils.Eps.multiplyMatrix_(result, local);
  }
  return result;
};


//----------------------------------------------------------------------------------------------------------------------
// Static helpers: path data
//----------------------------------------------------------------------------------------------------------------------
/**
 * @param {Element} el
 * @return {string}
 * @private
 */
acgraph.utils.Eps.rectToPath_ = function(el) {
  var x = parseFloat(el.getAttribute('x')) || 0;
  var y = parseFloat(el.getAttribute('y')) || 0;
  var w = parseFloat(el.getAttribute('width')) || 0;
  var h = parseFloat(el.getAttribute('height')) || 0;
  var rx = parseFloat(el.getAttribute('rx')) || 0;
  var ry = parseFloat(el.getAttribute('ry')) || 0;
  if (!rx && !ry) {
    return 'M ' + x + ' ' + y + ' L ' + (x + w) + ' ' + y + ' L ' + (x + w) +
        ' ' + (y + h) + ' L ' + x + ' ' + (y + h) + ' Z';
  }
  rx = Math.min(rx || ry, w / 2);
  ry = Math.min(ry || rx, h / 2);
  var k = acgraph.utils.Eps.KAPPA_;
  return 'M ' + (x + rx) + ' ' + y +
      ' L ' + (x + w - rx) + ' ' + y +
      ' C ' + (x + w - rx + k * rx) + ' ' + y + ' ' + (x + w) + ' ' +
      (y + k * ry) + ' ' + (x + w) + ' ' + (y + ry) +
      ' L ' + (x + w) + ' ' + (y + h - ry) +
      ' C ' + (x + w) + ' ' + (y + h - k * ry) + ' ' + (x + w - k * rx) +
      ' ' + (y + h) + ' ' + (x + w - rx) + ' ' + (y + h) +
      ' L ' + (x + rx) + ' ' + (y + h) +
      ' C ' + (x + k * rx) + ' ' + (y + h) + ' ' + x + ' ' +
      (y + h - k * ry) + ' ' + x + ' ' + (y + h - ry) +
      ' L ' + x + ' ' + (y + ry) +
      ' C ' + x + ' ' + (y + k * ry) + ' ' + (x + k * rx) + ' ' + y + ' ' +
      (x + rx) + ' ' + y + ' Z';
};


/**
 * Builds a four-segment cubic Bezier circle/ellipse path.
 * @param {number} cx
 * @param {number} cy
 * @param {number} rx
 * @param {number} ry
 * @return {string}
 * @private
 */
acgraph.utils.Eps.ellipseToPath_ = function(cx, cy, rx, ry) {
  var k = acgraph.utils.Eps.KAPPA_;
  var ox = rx * k;
  var oy = ry * k;
  return 'M ' + (cx - rx) + ' ' + cy +
      ' C ' + (cx - rx) + ' ' + (cy - oy) + ' ' + (cx - ox) + ' ' +
      (cy - ry) + ' ' + cx + ' ' + (cy - ry) +
      ' C ' + (cx + ox) + ' ' + (cy - ry) + ' ' + (cx + rx) + ' ' +
      (cy - oy) + ' ' + (cx + rx) + ' ' + cy +
      ' C ' + (cx + rx) + ' ' + (cy + oy) + ' ' + (cx + ox) + ' ' +
      (cy + ry) + ' ' + cx + ' ' + (cy + ry) +
      ' C ' + (cx - ox) + ' ' + (cy + ry) + ' ' + (cx - rx) + ' ' +
      (cy + oy) + ' ' + (cx - rx) + ' ' + cy + ' Z';
};


/**
 * Cubic Bezier approximation constant for a quarter circle.
 * @const {number}
 * @private
 */
acgraph.utils.Eps.KAPPA_ = 0.5522847498307936;


/**
 * Parses an SVG path `d` string into absolute M/L/C/Z segments.
 * @param {string} d
 * @return {Array.<acgraph.utils.Eps.Segment_>}
 * @private
 */
acgraph.utils.Eps.parsePathData_ = function(d) {
  var tokens = acgraph.utils.Eps.tokenizePath_(d);
  var segments = [];
  var current = null;
  var start = null;
  var prevControl = null;
  var prevCommand = null;
  var i = 0;

  function point(rel) {
    var p = [parseFloat(tokens[i]), parseFloat(tokens[i + 1])];
    i += 2;
    if (rel && current) {
      p[0] += current[0];
      p[1] += current[1];
    }
    return p;
  }
  function scalar() {
    return parseFloat(tokens[i++]);
  }

  while (i < tokens.length) {
    var token = tokens[i];
    var command;
    if (acgraph.utils.Eps.isCommand_(token)) {
      command = token;
      i++;
    } else {
      // Implicit command repetition (SVG 1.1 F.3.3).
      command = prevCommand;
    }
    var rel = command >= 'a' && command <= 'z';
    var abs = command.toUpperCase();
    var p, p1, p2, c1, c2;
    switch (abs) {
      case 'M':
        p = point(rel);
        current = p;
        start = [p[0], p[1]];
        segments.push(new acgraph.utils.Eps.Move_(p[0], p[1]));
        prevCommand = rel ? 'l' : 'L';
        break;
      case 'L':
        p = point(rel);
        segments.push(new acgraph.utils.Eps.Line_(p[0], p[1]));
        current = p;
        prevCommand = rel ? 'l' : 'L';
        break;
      case 'H':
        p = [scalar(), current[1]];
        if (rel) p[0] += current[0];
        segments.push(new acgraph.utils.Eps.Line_(p[0], p[1]));
        current = p;
        prevCommand = rel ? 'h' : 'H';
        break;
      case 'V':
        p = [current[0], scalar()];
        if (rel) p[1] += current[1];
        segments.push(new acgraph.utils.Eps.Line_(p[0], p[1]));
        current = p;
        prevCommand = rel ? 'v' : 'V';
        break;
      case 'C':
        c1 = point(rel);
        c2 = point(rel);
        p = point(rel);
        segments.push(new acgraph.utils.Eps.Curve_(c1[0], c1[1], c2[0], c2[1],
            p[0], p[1]));
        prevControl = c2;
        current = p;
        prevCommand = rel ? 'c' : 'C';
        break;
      case 'S':
        c1 = prevControl && (prevCommand == 'c' || prevCommand == 'C' ||
            prevCommand == 's' || prevCommand == 'S') ?
            [2 * current[0] - prevControl[0], 2 * current[1] - prevControl[1]] :
            current;
        c2 = point(rel);
        p = point(rel);
        segments.push(new acgraph.utils.Eps.Curve_(c1[0], c1[1], c2[0], c2[1],
            p[0], p[1]));
        prevControl = c2;
        current = p;
        prevCommand = rel ? 's' : 'S';
        break;
      case 'Q':
        p1 = point(rel);
        p = point(rel);
        acgraph.utils.Eps.appendQuad_(segments, current, p1, p);
        prevControl = p1;
        current = p;
        prevCommand = rel ? 'q' : 'Q';
        break;
      case 'T':
        p1 = prevControl && (prevCommand == 'q' || prevCommand == 'Q' ||
            prevCommand == 't' || prevCommand == 'T') ?
            [2 * current[0] - prevControl[0], 2 * current[1] - prevControl[1]] :
            current;
        p = point(rel);
        acgraph.utils.Eps.appendQuad_(segments, current, p1, p);
        prevControl = p1;
        current = p;
        prevCommand = rel ? 't' : 'T';
        break;
      case 'A':
        var rx = scalar();
        var ry = scalar();
        var xAxisRotation = scalar();
        var largeArc = scalar();
        var sweep = scalar();
        p = point(rel);
        acgraph.utils.Eps.appendArc_(segments, current, rx, ry, xAxisRotation,
            largeArc, sweep, p);
        current = p;
        prevControl = null;
        prevCommand = rel ? 'a' : 'A';
        break;
      case 'Z':
        segments.push(new acgraph.utils.Eps.Close_());
        current = start ? [start[0], start[1]] : current;
        prevControl = null;
        prevCommand = rel ? 'z' : 'Z';
        break;
      default:
        i++;
        break;
    }
  }
  return segments;
};


/**
 * Splits a path data string into command letters and numbers.
 * @param {string} d
 * @return {Array.<string>}
 * @private
 */
acgraph.utils.Eps.tokenizePath_ = function(d) {
  var tokens = [];
  var re = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;
  var match;
  while ((match = re.exec(d))) {
    tokens.push(match[0]);
  }
  return tokens;
};


/**
 * @param {string} token
 * @return {boolean}
 * @private
 */
acgraph.utils.Eps.isCommand_ = function(token) {
  return /^[MmLlHhVvCcSsQqTtAaZz]$/.test(token);
};


/**
 * Converts a quadratic Bezier to a cubic one and appends it.
 * @param {Array.<acgraph.utils.Eps.Segment_>} segments
 * @param {Array.<number>} p0
 * @param {Array.<number>} c
 * @param {Array.<number>} p1
 * @private
 */
acgraph.utils.Eps.appendQuad_ = function(segments, p0, c, p1) {
  segments.push(new acgraph.utils.Eps.Curve_(
      p0[0] + 2 / 3 * (c[0] - p0[0]),
      p0[1] + 2 / 3 * (c[1] - p0[1]),
      p1[0] + 2 / 3 * (c[0] - p1[0]),
      p1[1] + 2 / 3 * (c[1] - p1[1]),
      p1[0], p1[1]));
};


/**
 * Implements SVG 1.1 F.6.5 endpoint-to-center arc conversion and appends cubic
 * Bezier segments (no arc span exceeds 90 degrees).
 * @param {Array.<acgraph.utils.Eps.Segment_>} segments
 * @param {Array.<number>} p0 Start point.
 * @param {number} rx
 * @param {number} ry
 * @param {number} xAxisRotation
 * @param {number} largeArc
 * @param {number} sweep
 * @param {Array.<number>} p1 End point.
 * @private
 */
acgraph.utils.Eps.appendArc_ =
    function(segments, p0, rx, ry, xAxisRotation, largeArc, sweep, p1) {
  if (p0[0] == p1[0] && p0[1] == p1[1]) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx == 0 || ry == 0) {
    segments.push(new acgraph.utils.Eps.Line_(p1[0], p1[1]));
    return;
  }
  var phi = xAxisRotation * Math.PI / 180;
  var cosPhi = Math.cos(phi);
  var sinPhi = Math.sin(phi);
  var dx = (p0[0] - p1[0]) / 2;
  var dy = (p0[1] - p1[1]) / 2;
  var x1p = cosPhi * dx + sinPhi * dy;
  var y1p = -sinPhi * dx + cosPhi * dy;

  var rx2 = rx * rx;
  var ry2 = ry * ry;
  var x1p2 = x1p * x1p;
  var y1p2 = y1p * y1p;
  var lambda = x1p2 / rx2 + y1p2 / ry2;
  if (lambda > 1) {
    var scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
    rx2 = rx * rx;
    ry2 = ry * ry;
  }
  var sign = largeArc != sweep ? 1 : -1;
  var num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  var factor = sign * Math.sqrt(Math.max(0, num) / (rx2 * y1p2 + ry2 * x1p2));
  var cxp = factor * rx * y1p / ry;
  var cyp = factor * -ry * x1p / rx;
  var cx = cosPhi * cxp - sinPhi * cyp + (p0[0] + p1[0]) / 2;
  var cy = sinPhi * cxp + cosPhi * cyp + (p0[1] + p1[1]) / 2;

  function angle(ux, uy, vx, vy) {
    // Standard oriented angle (counter-clockwise positive) between two unit
    // vectors, per SVG 1.1 F.6.5.
    var dot = ux * vx + uy * vy;
    var len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    var a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -a : a;
  }
  var theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry,
      (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  delta %= 2 * Math.PI;
  // SVG sweep=1 is the positive-angle (clockwise in y-down) arc; normalize the
  // modulo remainder to the requested sweep direction.
  if (sweep == 1 && delta < 0) delta += 2 * Math.PI;
  if (sweep == 0 && delta > 0) delta -= 2 * Math.PI;

  var segmentsCount = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  var startAngle = theta1;
  for (var i = 0; i < segmentsCount; i++) {
    var endAngle = startAngle + delta / segmentsCount;
    // Cubic Bezier control factor for the sub-arc.
    var t = (4 / 3) * Math.tan((endAngle - startAngle) / 4);
    function arcPoint(angleIn, radiusFactor) {
      var ex = Math.cos(angleIn) * rx;
      var ey = Math.sin(angleIn) * ry;
      var tx = -Math.sin(angleIn) * rx * radiusFactor;
      var ty = Math.cos(angleIn) * ry * radiusFactor;
      return [
        cx + cosPhi * ex - sinPhi * ey,
        cy + sinPhi * ex + cosPhi * ey,
        cosPhi * tx - sinPhi * ty,
        sinPhi * tx + cosPhi * ty
      ];
    }
    var a0 = arcPoint(startAngle, t);
    var a1 = arcPoint(endAngle, t);
    segments.push(new acgraph.utils.Eps.Curve_(
        a0[0] + a0[2], a0[1] + a0[3],
        a1[0] - a1[2], a1[1] - a1[3],
        a1[0], a1[1]));
    startAngle = endAngle;
  }
};


//----------------------------------------------------------------------------------------------------------------------
// Static helpers: colors and formatting
//----------------------------------------------------------------------------------------------------------------------
/**
 * @param {string} value
 * @return {?Array.<number>} RGB in [0,1], null when unrecognized.
 * @private
 */
acgraph.utils.Eps.parseColor_ = function(value) {
  if (!value) return null;
  value = value.trim().toLowerCase();
  var match;
  if ((match = /^#([0-9a-f]{3})$/.exec(value))) {
    return [
      parseInt(match[1].charAt(0) + match[1].charAt(0), 16) / 255,
      parseInt(match[1].charAt(1) + match[1].charAt(1), 16) / 255,
      parseInt(match[1].charAt(2) + match[1].charAt(2), 16) / 255
    ];
  }
  if ((match = /^#([0-9a-f]{6})$/.exec(value))) {
    return [
      parseInt(match[1].substring(0, 2), 16) / 255,
      parseInt(match[1].substring(2, 4), 16) / 255,
      parseInt(match[1].substring(4, 6), 16) / 255
    ];
  }
  if ((match = /^rgba?\(([^)]+)\)$/.exec(value))) {
    var parts = match[1].split(',').map(parseFloat);
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  if (acgraph.utils.Eps.NAMED_COLORS_[value]) {
    return acgraph.utils.Eps.parseColor_(acgraph.utils.Eps.NAMED_COLORS_[value]);
  }
  return null;
};


/**
 * Reads one declaration value from an inline CSS style string.
 * @param {?string} style
 * @param {string} key
 * @return {?string}
 * @private
 */
acgraph.utils.Eps.styleValue_ = function(style, key) {
  if (!style) return null;
  var match = new RegExp('(?:^|;)\\s*' + key + '\\s*:\\s*([^;]+)').exec(style);
  return match ? match[1].trim() : null;
};


/**
 * @param {Array.<number>} rgb
 * @return {string}
 * @private
 */
acgraph.utils.Eps.colorOperator_ = function(rgb) {
  return '/DeviceRGB setcolorspace ' + rgb.map(acgraph.utils.Eps.fmt_).join(' ') +
      ' setcolor';
};


/**
 * Escapes text for a PostScript literal string.
 * @param {string} text
 * @return {string}
 * @private
 */
acgraph.utils.Eps.escapePs_ = function(text) {
  return text.replace(/[\\()]/g, '\\$&');
};


/**
 * Formats a number with at most four decimals and no negative zero.
 * @param {number} value
 * @return {string}
 * @private
 */
acgraph.utils.Eps.fmt_ = function(value) {
  if (Math.abs(value) < 5e-11) value = 0;
  var rounded = Math.round(value * 10000) / 10000;
  var s = rounded.toFixed(4).replace(/0+$/, '');
  if (s.charAt(s.length - 1) == '.') s = s.slice(0, -1);
  return s;
};


//----------------------------------------------------------------------------------------------------------------------
// Path segment types
//----------------------------------------------------------------------------------------------------------------------
/**
 * @interface
 * @private
 */
acgraph.utils.Eps.Segment_ = function() {};

/**
 * Maps every point of the segment through an SVG matrix.
 * @param {Array.<number>} matrix
 */
acgraph.utils.Eps.Segment_.prototype.map = function(matrix) {};

/**
 * Adds every point of the segment to the converter hull.
 * @param {acgraph.utils.Eps.Converter_} converter
 * @param {number} grow Stroke half-width to expand by.
 */
acgraph.utils.Eps.Segment_.prototype.expandHull = function(converter, grow) {};

/**
 * @param {number} stageHeight Stage height for the y-axis flip.
 * @return {string}
 */
acgraph.utils.Eps.Segment_.prototype.toPs = function(stageHeight) {};


/**
 * @param {number} x
 * @param {number} y
 * @constructor
 * @implements {acgraph.utils.Eps.Segment_}
 * @private
 */
acgraph.utils.Eps.Move_ = function(x, y) {
  this.x = x;
  this.y = y;
};
acgraph.utils.Eps.Move_.prototype.map = function(m) {
  var p = acgraph.utils.Eps.applyMatrix_(m, this.x, this.y);
  this.x = p[0];
  this.y = p[1];
};
acgraph.utils.Eps.Move_.prototype.expandHull = function(c, grow) {
  c.addRect_(this.x - grow, this.y - grow, grow * 2, grow * 2);
};
acgraph.utils.Eps.Move_.prototype.toPs = function(h) {
  return acgraph.utils.Eps.fmt_(this.x) + ' ' + acgraph.utils.Eps.fmt_(h - this.y) +
      ' moveto';
};


/**
 * @param {number} x
 * @param {number} y
 * @constructor
 * @implements {acgraph.utils.Eps.Segment_}
 * @private
 */
acgraph.utils.Eps.Line_ = function(x, y) {
  this.x = x;
  this.y = y;
};
acgraph.utils.Eps.Line_.prototype.map = acgraph.utils.Eps.Move_.prototype.map;
acgraph.utils.Eps.Line_.prototype.expandHull =
    acgraph.utils.Eps.Move_.prototype.expandHull;
acgraph.utils.Eps.Line_.prototype.toPs = function(h) {
  return acgraph.utils.Eps.fmt_(this.x) + ' ' + acgraph.utils.Eps.fmt_(h - this.y) +
      ' lineto';
};


/**
 * @param {number} c1x
 * @param {number} c1y
 * @param {number} c2x
 * @param {number} c2y
 * @param {number} x
 * @param {number} y
 * @constructor
 * @implements {acgraph.utils.Eps.Segment_}
 * @private
 */
acgraph.utils.Eps.Curve_ = function(c1x, c1y, c2x, c2y, x, y) {
  this.c1x = c1x;
  this.c1y = c1y;
  this.c2x = c2x;
  this.c2y = c2y;
  this.x = x;
  this.y = y;
};
acgraph.utils.Eps.Curve_.prototype.map = function(m) {
  var c1 = acgraph.utils.Eps.applyMatrix_(m, this.c1x, this.c1y);
  var c2 = acgraph.utils.Eps.applyMatrix_(m, this.c2x, this.c2y);
  var p = acgraph.utils.Eps.applyMatrix_(m, this.x, this.y);
  this.c1x = c1[0];
  this.c1y = c1[1];
  this.c2x = c2[0];
  this.c2y = c2[1];
  this.x = p[0];
  this.y = p[1];
};
acgraph.utils.Eps.Curve_.prototype.expandHull = function(c, grow) {
  c.addRect_(Math.min(this.c1x, this.c2x, this.x) - grow,
      Math.min(this.c1y, this.c2y, this.y) - grow,
      Math.max(this.c1x, this.c2x, this.x) -
          Math.min(this.c1x, this.c2x, this.x) + grow * 2,
      Math.max(this.c1y, this.c2y, this.y) -
          Math.min(this.c1y, this.c2y, this.y) + grow * 2);
};
acgraph.utils.Eps.Curve_.prototype.toPs = function(h) {
  var f = acgraph.utils.Eps.fmt_;
  return f(this.c1x) + ' ' + f(h - this.c1y) + ' ' +
      f(this.c2x) + ' ' + f(h - this.c2y) + ' ' +
      f(this.x) + ' ' + f(h - this.y) + ' curveto';
};


/**
 * @constructor
 * @implements {acgraph.utils.Eps.Segment_}
 * @private
 */
acgraph.utils.Eps.Close_ = function() {};
acgraph.utils.Eps.Close_.prototype.map = function() {};
acgraph.utils.Eps.Close_.prototype.expandHull = function() {};
acgraph.utils.Eps.Close_.prototype.toPs = function() {
  return 'closepath';
};


goog.exportSymbol('acgraph.utils.Eps', acgraph.utils.Eps);
goog.exportSymbol('acgraph.utils.Eps.fromSvg', acgraph.utils.Eps.fromSvg);
goog.exportSymbol('acgraph.utils.Eps.MAX_WARNINGS', acgraph.utils.Eps.MAX_WARNINGS);
