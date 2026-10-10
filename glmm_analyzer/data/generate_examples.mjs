// Generates the bundled example datasets for the GLMM Analyzer.
//
// Every example is drawn from a seeded simulation, and so the files are
// reproducible: re-running this script writes the same bytes. The queueing
// examples simulate a single-server queue with exponential interarrival and
// service times, started empty, with waiting times from the Lindley
// recursion W[n+1] = max(0, W[n] + S[n] - A[n+1]). The colony example draws
// from a Poisson model with a random intercept and slope per colony.
//
// Randomness: mulberry32 streams, with exponential draws by inverse
// transform, normal draws by Box-Muller, and Poisson draws by inversion.
//
// Datasets (the seeds are in SEEDS below):
//   on_time.csv         served within 2 minutes, per customer: a binary response against
//                       the number in queue at arrival and the policy (A, mean service 0.8;
//                       B, mean service 0.7), with the replication's random-number seed shared
//                       by both policies as the group; 8 days, the first 50 customers of each
//   cycle_time.csv      time in system per job (positive) against the offered load (the
//                       arrival rate on that shift) and the job's class (standard, express),
//                       a gamma response with a log link; 6 loads, 60 jobs each after a warm-up
//
// Usage, from anywhere:
//   node glmm_analyzer/data/generate_examples.mjs [--out <dir>]
// With no argument the files are written in place (data/ and js/data/examples.js next to
// this script's parent directory). With --out, the same layout is written under <dir>.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SEEDS = {
  onTime: 310000,
  cycle: 420000
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const expo = (u, mean) => -Math.log(1 - u) * mean;

/**
 * An event-driven single-server queue with one or two job classes, FIFO.
 * Each arrival draws its class from `classes` (an array of
 * `{ name, prob, meanService }`), and the record of every customer holds
 * its arrival time, the number waiting in queue when it arrived, its wait,
 * its service time, its class, and its time in system.
 */
function queue(st, meanArr, classes, { until = Infinity, maxCustomers = Infinity } = {}) {
  const out = [];
  let clock = 0, w = 0, prevS = 0;
  // The queue at arrival is read from the departure times of earlier customers.
  const departures = [];
  for (let n = 0; n < maxCustomers; n++) {
    const a = expo(st.arr(), meanArr);
    clock += a;
    if (clock >= until) break;
    let cls = classes[0];
    if (classes.length > 1) { const u = st.cls(); let acc = 0; for (const c of classes) { acc += c.prob; if (u < acc) { cls = c; break; } } }
    w = n === 0 ? 0 : Math.max(0, w + prevS - a);
    const s = expo(st.srv(), cls.meanService);
    while (departures.length && departures[0] <= clock) departures.shift();
    // Those with a departure after now are in the system; the one in
    // service began before now, and the rest wait.
    const inQueue = Math.max(0, departures.length - 1);
    const dep = clock + w + s;
    departures.push(dep);
    departures.sort((x, y) => x - y);
    out.push({ arrival: clock, inQueue, wait: w, service: s, cls: cls.name, system: w + s });
    prevS = s;
  }
  return out;
}

function fmt(x, d = 4) {
  return String(Number(x.toFixed(d)));
}

function csv(header, rows) {
  return header.join(',') + '\n' + rows.map(r => r.join(',')).join('\n') + '\n';
}

/** on_time.csv */
function onTimeCsv() {
  const rows = [];
  const policies = [{ name: 'A', meanService: 0.8 }, { name: 'B', meanService: 0.7 }];
  for (let rep = 1; rep <= 8; rep++) {
    for (const p of policies) {
      // The same seed per replication for both policies: common random numbers.
      const st = { arr: mulberry32(SEEDS.onTime + rep), srv: mulberry32(SEEDS.onTime + rep + 0x9E3779B1), cls: () => 0 };
      const cust = queue(st, 1.0, [{ name: p.name, prob: 1, meanService: p.meanService }], { maxCustomers: 50 });
      for (const c of cust) rows.push([c.wait + c.service <= 2 ? 1 : 0, c.inQueue, p.name, 'seed' + rep]);
    }
  }
  return csv(['on_time', 'queue', 'policy', 'seed'], rows);
}

/** cycle_time.csv */
function cycleTimeCsv() {
  const rows = [];
  const loads = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9];
  loads.forEach((lambda, k) => {
    const st = { arr: mulberry32(SEEDS.cycle + k), srv: mulberry32(SEEDS.cycle + k + 0x9E3779B1), cls: mulberry32(SEEDS.cycle + k + 0x3C6EF372) };
    const classes = [{ name: 'standard', prob: 0.6, meanService: 1.0 }, { name: 'express', prob: 0.4, meanService: 0.5 }];
    const cust = queue(st, 1 / lambda, classes, { maxCustomers: 260 });
    // The first 200 jobs are the warm-up; the next 60 are the shift's record.
    for (const c of cust.slice(200, 260)) rows.push([fmt(c.system), fmt(lambda, 2), c.cls]);
  });
  return csv(['time_in_system', 'load', 'class'], rows);
}

const EXAMPLES = [
  {
    id: 'on-time',
    title: 'On-time service: a binary response with a random effect',
    file: 'on_time.csv',
    description: 'Whether each of the first fifty customers of a day was served within two minutes of arriving, against the number waiting in queue when the customer arrived and the service policy (A, mean service 0.8 minutes; B, mean service 0.7), in a single-server queue with exponential interarrival times of mean 1.0 minute. Eight days were run under each policy from the same eight random-number seeds, and so the seed is a grouping factor shared by both policies. A binomial model with a logit link, and a random intercept per seed.',
    build: onTimeCsv,
    mapping: { name: 'On-time service', response: 'on_time', columns: { on_time: { role: 'response', type: 'continuous' }, queue: { role: 'predictor', type: 'continuous' }, policy: { role: 'predictor', type: 'categorical' }, seed: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'cycle-time',
    title: 'Cycle time: a positive response against load and class',
    file: 'cycle_time.csv',
    description: 'The time in system of sixty jobs on each of six shifts, after a warm-up of two hundred jobs, in a single-server queue whose offered load (the arrival rate, with mean service time 1.0 for a standard job and 0.5 for an express job) differs by shift. Time in system is positive and right-skewed, and its spread grows with its mean as the load rises: a gamma model with a log link, with load as a continuous predictor and class as a categorical one.',
    build: cycleTimeCsv,
    mapping: { name: 'Cycle time', response: 'time_in_system', columns: { time_in_system: { role: 'response', type: 'continuous' }, load: { role: 'predictor', type: 'continuous' }, class: { role: 'predictor', type: 'categorical' } } }
  }
];

function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outRoot = outIdx >= 0 ? path.resolve(argv[outIdx + 1]) : ROOT;
  const dataDir = path.join(outRoot, 'data');
  const modDir = path.join(outRoot, 'js', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(modDir, { recursive: true });
  const entries = [];
  for (const ex of EXAMPLES) {
    const text = ex.build();
    fs.writeFileSync(path.join(dataDir, ex.file), text);
    entries.push({ id: ex.id, title: ex.title, file: ex.file, description: ex.description, mapping: ex.mapping, text });
  }
  const lines = ['// Generated by data/generate_examples.mjs; do not edit by hand.', '',
    '/**', ' * Bundled example datasets. `text` is the file\'s contents as the importer reads it, and',
    ' * `mapping` is the role assignment that loads it without a dialog.',
    ' * @type {{id: string, title: string, file: string, description: string, text: string, mapping: object}[]}', ' */',
    'export const EXAMPLES = ['];
  entries.forEach((e, i) => {
    lines.push('  {');
    lines.push('    id: ' + JSON.stringify(e.id) + ',');
    lines.push('    title: ' + JSON.stringify(e.title) + ',');
    lines.push('    file: ' + JSON.stringify(e.file) + ',');
    lines.push('    description: ' + JSON.stringify(e.description) + ',');
    lines.push('    mapping: ' + JSON.stringify(e.mapping) + ',');
    lines.push('    text: `' + e.text + '`');
    lines.push('  }' + (i < entries.length - 1 ? ',' : ''));
  });
  lines.push('];', '');
  fs.writeFileSync(path.join(modDir, 'examples.js'), lines.join('\n'));
  console.log('Wrote ' + entries.length + ' examples under ' + outRoot);
}

main();
