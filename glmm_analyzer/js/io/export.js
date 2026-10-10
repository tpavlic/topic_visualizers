// Writing results back out: CSV text with `#` provenance lines, the slug that
// file names are built from, and, in the browser only, SVG and PNG figures and
// file downloads. The CSV writers and the slug are pure; the browser functions
// check for a DOM and throw without one.

/**
 * One CSV field by RFC 4180: a field holding a comma, a double quote, or a
 * line break is wrapped in double quotes with inner quotes doubled. null,
 * undefined, and non-finite numbers become an empty field.
 * @param {unknown} v
 * @returns {string}
 */
export function csvEscape(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Rows of fields as CSV text, one line per row, each line ending in "\n".
 * @param {unknown[][]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  return rows.map(r => r.map(csvEscape).join(',') + '\n').join('');
}

/**
 * Provenance as `# key: value` lines, in the object's key order. Undefined
 * values are skipped and line breaks inside a value become spaces, and so every
 * line stays a comment.
 * @param {Record<string, unknown>|null} [fields]
 * @returns {string[]}
 */
export function provenanceLines(fields) {
  const out = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined) continue;
    const text = Array.isArray(v) ? v.join(', ') : String(v);
    out.push('# ' + k + ': ' + text.replace(/[\r\n]+/g, ' '));
  }
  return out;
}

// One field of a data file: as csvEscape writes it, and also quoted when it
// holds a '#'. R's read.csv(comment.char = "#") ends a line at an unquoted '#'
// and would cut a level such as run#1 short. An unquoted csvEscape field
// holds no double quote, and so wrapping it is safe.
function dataField(v) {
  const s = csvEscape(v);
  return s[0] !== '"' && s.includes('#') ? '"' + s + '"' : s;
}

function dataCsv(rows) {
  return rows.map(r => r.map(dataField).join(',') + '\n').join('');
}

// One field of a result table: as csvEscape writes it, except that an
// infinite number is written as Inf or -Inf, which R, Python, and MATLAB all
// read back as infinity. NaN stays an empty field.
function resultField(v) {
  if (v === Infinity) return 'Inf';
  if (v === -Infinity) return '-Inf';
  return csvEscape(v);
}

function resultCsv(rows) {
  return rows.map(r => r.map(resultField).join(',') + '\n').join('');
}

function withProvenance(provenance, rows, write = toCsv) {
  const head = provenanceLines(provenance);
  return (head.length ? head.join('\n') + '\n' : '') + write(rows);
}

/**
 * A file-name slug of a title: lower-case letters and digits, each run of
 * anything else turned into one hyphen, at most 60 characters, and never
 * starting or ending in a hyphen, even where the cut falls just after one.
 * @param {string} s
 * @returns {string}
 */
export function slug(s) {
  const t = String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (t || 'data').slice(0, 60).replace(/-+$/, '');
}

/**
 * A dataset's table as CSV: the header, then one row per observation, with
 * a missing value as an empty field. Every column is written, whatever its
 * role, so that the file reads back in as it was loaded; the `#` lines say
 * which column is the response and which the group.
 * @param {import('../data/model.js').Dataset} ds
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function datasetCsv(ds, provenance) {
  const rows = [ds.columns.map(c => c.name)].concat(ds.rows);
  return withProvenance(provenance, rows, dataCsv);
}

/**
 * Any result table as CSV after its provenance lines. An infinite number is
 * written as Inf or -Inf, and NaN as an empty field.
 * @param {string[]} headers
 * @param {unknown[][]} rows
 * @param {Record<string, unknown>} [provenance]
 * @returns {string}
 */
export function tableCsv(headers, rows, provenance) {
  return withProvenance(provenance, [headers, ...rows], resultCsv);
}

/**
 * The start of a CSV file this module wrote, for a preview: its `#` lines
 * without the mark, its header's fields, the fields of its first `n` records,
 * and how many records follow those. Fields are read by RFC 4180, and so a
 * quoted field keeps its commas and line breaks and an empty field stays.
 * @param {string} text
 * @param {number} [n]
 * @returns {{notes: string[], header: string[], rows: string[][], more: number}}
 */
export function csvHead(text, n = 8) {
  const out = { notes: [], header: [], rows: [], more: 0 };
  let fields = [], cur = '', quoted = false, started = false, header = false;
  const len = text.length;
  const endRecord = () => {
    fields.push(cur);
    if (!header) { out.header = fields; header = true; }
    else if (out.rows.length < n) out.rows.push(fields);
    else out.more++;
    fields = []; cur = ''; started = false;
  };
  let i = 0;
  while (i < len) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
        quoted = false;
      } else cur += ch;
      i++;
      continue;
    }
    if (!started && ch === '#') {
      let e = text.indexOf('\n', i);
      if (e < 0) e = len;
      out.notes.push(text.slice(i + 1, e).replace(/\r$/, '').trim());
      i = e + 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (started) endRecord();
      i++;
      continue;
    }
    started = true;
    if (ch === '"' && cur === '') quoted = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
    i++;
  }
  if (started) endRecord();
  return out;
}

function requireDom(what) {
  if (typeof document === 'undefined') throw new Error(what + ' needs a browser.');
}

/**
 * Serialize an SVG element as a stand-alone SVG file: the SVG namespace is
 * set, and the given CSS, when there is any, is inlined as a `<style>`
 * element so the file renders the same away from the page.
 * @param {SVGSVGElement} svg
 * @param {string} [css]
 * @returns {string}
 */
export function svgToString(svg, css = '') {
  requireDom('svgToString');
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  if (css) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Rasterize an SVG element to a PNG blob at `scale` times its rendered size
 * (pass devicePixelRatio for a sharp image on a high-density screen). The
 * background is filled white, as an image viewer would otherwise show the
 * transparent areas black or checkered.
 * @param {SVGSVGElement} svg
 * @param {number} [scale]
 * @param {string} [css]
 * @returns {Promise<Blob>}
 */
export function svgToPngBlob(svg, scale = 1, css = '') {
  requireDom('svgToPngBlob');
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const w = box.width || (vb && vb.width) || 600;
  const h = box.height || (vb && vb.height) || 400;
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const text = svgToString(clone, css);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The PNG could not be created.'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The figure could not be rasterized.'));
    };
    img.src = url;
  });
}

/**
 * Save a blob as a file through a temporary link.
 * @param {string} name
 * @param {Blob} blob
 */
export function downloadBlob(name, blob) {
  requireDom('downloadBlob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Save text as a file.
 * @param {string} name
 * @param {string} text
 * @param {string} [mime]
 */
export function downloadText(name, text, mime = 'text/csv;charset=utf-8') {
  requireDom('downloadText');
  downloadBlob(name, new Blob([text], { type: mime }));
}
