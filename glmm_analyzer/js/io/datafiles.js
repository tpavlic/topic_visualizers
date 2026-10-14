// The data files a dataset exports and the regenerate scripts read past the
// numbers cap: the dataset's own CSV (every column under its name, with `#`
// provenance lines) and, for the Diagnostics page's discrete families, the
// uniforms behind the randomized quantile residuals. Pure functions, no DOM;
// the export row and the recipes both use them.

import { datasetCsv, tableCsv, slug } from './export.js';
import { RESIDUAL_SEED } from '../stats/residuals.js';
import { derivedColumns, derivationText } from '../data/model.js';

/** The most numbers a script embeds; past it, the scripts read these files. */
export const MAX_NUMBERS = 200000;

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * A timestamp for provenance lines, local time to the second.
 * @param {Date} d
 * @returns {string}
 */
export function stamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/**
 * The `#` lines a dataset's data file carries: what the dataset is, its
 * size, which column is the response, which are the other outcomes, which
 * is the group, and where it came from.
 * @param {object} ds
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, unknown>}
 */
export function dsProvenance(ds, extra) {
  const resp = ds.columns.find(c => c.role === 'response');
  const groups = ds.columns.filter(c => c.role === 'group').map(c => c.name);
  const preds = ds.columns.filter(c => c.role === 'predictor').map(c => c.name + ' (' + c.type + ')');
  const outs = ds.columns.filter(c => c.role === 'outcome').map(c => c.name);
  const p = { dataset: ds.name, rows: ds.rows.length, columns: ds.columns.length };
  if (resp) p.response = resp.name;
  if (outs.length) p['other outcomes'] = outs.join(', ');
  if (preds.length) p.predictors = preds.join(', ');
  if (groups.length) p.group = groups.join(', ');
  if (ds.source && ds.source.file) p['source file'] = ds.source.file;
  const der = derivedColumns(ds).map(derivationText);
  if (der.length) p['derived columns'] = der.join('; ');
  Object.assign(p, extra || {});
  p.exported = stamp(new Date());
  return p;
}

/**
 * The file name a dataset's data file takes, as the Import page writes it
 * and the regenerate scripts read it.
 * @param {object} ds
 */
export function csvFileName(ds) {
  return slug(ds.name) + '.csv';
}

/**
 * The text of a dataset's data file.
 * @param {object} ds
 * @returns {string}
 */
export function dataFileText(ds) {
  return datasetCsv(ds, dsProvenance(ds));
}

/**
 * The file name of the residual uniforms a Diagnostics script reads in CSV mode.
 * @param {object} ds
 */
export function uniformsFileName(ds) {
  return slug(ds.name) + '-residual-uniforms.csv';
}

/**
 * The text of the residual uniforms file: one column, `u`, in the order of
 * the rows the model was fitted to.
 * @param {object} ds
 * @param {ArrayLike<number>} u
 * @returns {string}
 */
export function uniformsFileText(ds, u) {
  return tableCsv(['u'], Array.from(u, v => [v]), { dataset: ds.name, 'residual seed': RESIDUAL_SEED, rows: u.length, exported: stamp(new Date()) });
}
