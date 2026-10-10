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
//   balks.csv           balks per shift (count) against load and staffing, with week-level and
//                       shift-level extra variation: Poisson against negative binomial
//   utilization.csv     one server's busy fraction over 60 days (unit interval) against the
//                       arrival rate and the day type: beta
//   colony_recruits.csv recruits per trial at 12 colonies (count) against temperature and a
//                       treatment, with a random intercept and slope by colony
//   rating.csv          a four-level rating (ordinal) against the wait and the express lane
//   tour_*.csv          the seven small datasets of the Classic tests as GLMM page
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
  cycle: 420000,
  balks: 530000,
  utilization: 640000,
  colony: 750000,
  rating: 860000,
  tour: 970000
};

// A standard normal by Box-Muller, and a Poisson by inversion.
const normal = u => { const [a, b] = u; return Math.sqrt(-2 * Math.log(1 - a)) * Math.cos(2 * Math.PI * b); };
function poisson(rng, mu) {
  const L = Math.exp(-mu);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

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

/** balks.csv: balks per shift, with extra shift-to-shift variation beyond the Poisson. */
function balksCsv() {
  const rng = mulberry32(SEEDS.balks);
  const rows = [];
  for (let week = 1; week <= 12; week++) {
    const weekEffect = 0.35 * normal([rng(), rng()]);
    for (let shift = 1; shift <= 5; shift++) {
      const load = Number((0.6 + 0.35 * rng()).toFixed(2));
      const staffing = rng() < 0.5 ? '2 servers' : '3 servers';
      const extra = 0.3 * normal([rng(), rng()]);
      const mu = Math.exp(0.2 + 3.2 * load - (staffing === '3 servers' ? 0.9 : 0) + weekEffect + extra);
      rows.push([poisson(rng, mu), load, staffing, 'week' + String(week).padStart(2, '0')]);
    }
  }
  return csv(['balks', 'load', 'staffing', 'week'], rows);
}

/** utilization.csv: the busy fraction of one server over a day, against the arrival rate. */
function utilizationCsv() {
  const rows = [];
  for (let day = 0; day < 60; day++) {
    const st = { arr: mulberry32(SEEDS.utilization + day), srv: mulberry32(SEEDS.utilization + day + 0x9E3779B1), cls: () => 0 };
    const rng = mulberry32(SEEDS.utilization + day + 0x3C6EF372);
    const lambda = Number((0.45 + 0.5 * rng()).toFixed(3));
    const dayType = rng() < 0.7 ? 'weekday' : 'weekend';
    const cust = queue(st, 1 / lambda, [{ name: 'c', prob: 1, meanService: dayType === 'weekend' ? 0.8 : 1.0 }], { until: 480 });
    let busy = 0;
    for (const c of cust) busy += c.service;
    const util = Math.min(0.999, Math.max(0.001, busy / 480));
    rows.push([fmt(util), fmt(lambda, 3), dayType]);
  }
  return csv(['utilization', 'arrival_rate', 'day_type'], rows);
}

/** colony_recruits.csv: recruits per trial by colony, the slope on temperature varying by colony. */
function colonyCsv() {
  const rng = mulberry32(SEEDS.colony);
  const rows = [];
  for (let c = 1; c <= 12; c++) {
    const u0 = 0.4 * normal([rng(), rng()]), u1 = 0.03 * normal([rng(), rng()]);
    const treatment = c % 2 === 0 ? 'sugar' : 'control';
    for (let t = 1; t <= 8; t++) {
      const temp = Number((15 + 20 * rng()).toFixed(1));
      const mu = Math.exp(0.4 + 0.06 * (temp - 25) + (treatment === 'sugar' ? 0.5 : 0) + u0 + u1 * (temp - 25));
      rows.push([poisson(rng, mu), temp, treatment, 'colony' + String(c).padStart(2, '0')]);
    }
  }
  return csv(['recruits', 'temperature', 'treatment', 'colony'], rows);
}

/** rating.csv: an ordered rating of each customer's visit against the wait. */
function ratingCsv() {
  const rng = mulberry32(SEEDS.rating);
  const rows = [];
  const levels = ['poor', 'fair', 'good', 'great'];
  const zeta = [-2.2, -0.6, 1.0];
  for (let i = 0; i < 200; i++) {
    const wait = Number((6 * rng()).toFixed(2));
    const express = rng() < 0.4 ? 'yes' : 'no';
    const eta = -0.8 * wait + (express === 'yes' ? 0.6 : 0);
    const u = rng();
    let k = 0;
    for (const z of zeta) if (u > 1 / (1 + Math.exp(-(z - eta)))) k++;
    rows.push([levels[k], wait, express]);
  }
  return csv(['rating', 'wait', 'express'], rows);
}

/** The five small datasets of the Tests as models page. */
function tourCsv(which) {
  const rng = mulberry32(SEEDS.tour + { one: 5, t: 1, anova: 2, paired: 3, repeated: 6, chisq: 4, proportion: 9 }[which]);
  const rows = [];
  if (which === 'one') {
    for (let i = 0; i < 25; i++) rows.push([fmt(1.5 + 3.5 * normal([rng(), rng()]), 2)]);
    return csv(['deviation'], rows);
  }
  if (which === 'repeated') {
    for (let d = 1; d <= 10; d++) {
      const day = 1.2 + 2 * normal([rng(), rng()]);
      for (let i = 0; i < 20; i++) rows.push([fmt(day + 3 * normal([rng(), rng()]), 2), 'D' + String(d).padStart(2, '0')]);
    }
    return csv(['deviation', 'day'], rows);
  }
  if (which === 't') {
    for (const [line, m] of [['A', 48], ['B', 52]]) for (let i = 0; i < 15; i++) rows.push([fmt(m + 4 * normal([rng(), rng()]), 2), line]);
    return csv(['throughput', 'line'], rows);
  }
  if (which === 'anova') {
    for (const [shift, m] of [['day', 2.0], ['evening', 2.6], ['night', 2.3]]) for (let i = 0; i < 12; i++) rows.push([fmt(Math.max(0.1, m + 0.6 * normal([rng(), rng()])), 2), shift]);
    return csv(['defect_rate', 'shift'], rows);
  }
  if (which === 'paired') {
    for (let s = 1; s <= 14; s++) {
      const base = 30 + 5 * normal([rng(), rng()]);
      rows.push([fmt(base + 1.5 * normal([rng(), rng()]), 1), 'before', 'S' + String(s).padStart(2, '0')]);
      rows.push([fmt(base - 2 + 1.5 * normal([rng(), rng()]), 1), 'after', 'S' + String(s).padStart(2, '0')]);
    }
    return csv(['time', 'condition', 'subject'], rows);
  }
  if (which === 'chisq') {
    const counts = { web: { early: 18, on_time: 42, late: 20 }, phone: { early: 9, on_time: 31, late: 35 } };
    for (const channel of ['web', 'phone']) for (const outcome of ['early', 'on_time', 'late']) rows.push([counts[channel][outcome], outcome, channel]);
    return csv(['count', 'outcome', 'channel'], rows);
  }
  for (const [offer, p] of [['A', 0.30], ['B', 0.55]]) for (let i = 0; i < 50; i++) rows.push([rng() < p ? 1 : 0, offer]);
  return csv(['converted', 'offer'], rows);
}

const EXAMPLES = [
  {
    id: 'on-time',
    title: 'On-time service: a binary response with a random effect',
    file: 'on_time.csv',
    description: 'Whether each of the first fifty customers of a day was served within two minutes of arriving, against the number waiting in queue when the customer arrived and the service policy (A, mean service 0.8 minutes; B, mean service 0.7), in a single-server queue with exponential interarrival times of mean 1.0 minute. Eight days were run under each policy from the same eight random-number seeds, and so the seed is a grouping factor shared by both policies. A binomial model with a logit link and a random intercept per seed.',
    build: onTimeCsv,
    mapping: { name: 'On-time service', response: 'on_time', columns: { on_time: { role: 'response', type: 'continuous' }, queue: { role: 'predictor', type: 'continuous' }, policy: { role: 'predictor', type: 'categorical' }, seed: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'cycle-time',
    title: 'Cycle time: a positive response against load and class',
    file: 'cycle_time.csv',
    description: 'The time in system of sixty jobs on each of six shifts, after a warm-up of two hundred jobs, in a single-server queue whose offered load (the arrival rate, with mean service time 1.0 for a standard job and 0.5 for an express job) differs by shift. Time in system is positive and right skewed, and its spread grows with its mean as the load rises: a gamma model with a log link, with load as a continuous predictor and class as a categorical one.',
    build: cycleTimeCsv,
    mapping: { name: 'Cycle time', response: 'time_in_system', columns: { time_in_system: { role: 'response', type: 'continuous' }, load: { role: 'predictor', type: 'continuous' }, class: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'balks',
    title: 'Balks per shift: an overdispersed count',
    file: 'balks.csv',
    description: 'The number of customers who balked (arrived and left without joining) on each of sixty shifts, against the shift’s offered load and its staffing, with the week as a grouping factor. The counts vary more from shift to shift than a Poisson allows, which the Pearson dispersion on the Model page shows: compare the Poisson family with the negative binomial, and with the Poisson-lognormal that an observation-level random effect gives, on the Compare page.',
    build: balksCsv,
    mapping: { name: 'Balks', response: 'balks', columns: { balks: { role: 'response', type: 'continuous' }, load: { role: 'predictor', type: 'continuous' }, staffing: { role: 'predictor', type: 'categorical' }, week: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'utilization',
    title: 'Utilization: a proportion against the arrival rate',
    file: 'utilization.csv',
    description: 'The fraction of an eight-hour day a single server was busy, on sixty days with different arrival rates and a shorter mean service on weekends. Utilization is a measured proportion, strictly between 0 and 1, whose spread shrinks toward both ends: the beta family with a logit link.',
    build: utilizationCsv,
    mapping: { name: 'Utilization', response: 'utilization', columns: { utilization: { role: 'response', type: 'continuous' }, arrival_rate: { role: 'predictor', type: 'continuous' }, day_type: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'colony-recruits',
    title: 'Colony recruits: a count with a random slope',
    file: 'colony_recruits.csv',
    description: 'The number of nestmates recruited in each of eight trials at twelve colonies, against the temperature and a feeding treatment applied per colony. Colonies differ in their baseline and in how strongly temperature moves them: a Poisson model with a random intercept and a random slope on temperature by colony. The treatment varies only between colonies, and so its test leans on the colony effect being in the model.',
    build: colonyCsv,
    mapping: { name: 'Colony recruits', response: 'recruits', columns: { recruits: { role: 'response', type: 'continuous' }, temperature: { role: 'predictor', type: 'continuous' }, treatment: { role: 'predictor', type: 'categorical' }, colony: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'rating',
    title: 'Visit ratings: an ordered response',
    file: 'rating.csv',
    description: 'Each of two hundred customers rated the visit poor, fair, good, or great, against the minutes waited and whether the express lane was used. The levels are ordered but not spaced: the ordinal family models the cumulative probabilities with one slope and three thresholds.',
    build: ratingCsv,
    mapping: { name: 'Visit ratings', response: 'rating', columns: { rating: { role: 'response', type: 'ordinal', levels: ['poor', 'fair', 'good', 'great'] }, wait: { role: 'predictor', type: 'continuous' }, express: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-one', tour: 'one', title: 'Deviation from a target (for the one-sample t test)', file: 'tour_one.csv',
    description: 'The delivery time of twenty-five orders, each as its deviation from the thirty-minute target.',
    build: () => tourCsv('one'),
    mapping: { name: 'Deviation from target', response: 'deviation', columns: { deviation: { role: 'response', type: 'continuous' } } }
  },
  {
    id: 'tour-t', tour: 't', title: 'Two production lines (for the t test)', file: 'tour_t.csv',
    description: 'Throughput on fifteen days of each of two production lines.',
    build: () => tourCsv('t'),
    mapping: { name: 'Two lines', response: 'throughput', columns: { throughput: { role: 'response', type: 'continuous' }, line: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-anova', tour: 'anova', title: 'Three shifts (for one-way ANOVA)', file: 'tour_anova.csv',
    description: 'The defect rate on twelve days of each of three shifts.',
    build: () => tourCsv('anova'),
    mapping: { name: 'Three shifts', response: 'defect_rate', columns: { defect_rate: { role: 'response', type: 'continuous' }, shift: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-paired', tour: 'paired', title: 'Before and after (for the paired t test)', file: 'tour_paired.csv',
    description: 'The task time of fourteen operators before and after a change.',
    build: () => tourCsv('paired'),
    mapping: { name: 'Before and after', response: 'time', columns: { time: { role: 'response', type: 'continuous' }, condition: { role: 'predictor', type: 'categorical' }, subject: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'tour-repeated', tour: 'repeated', title: 'Orders on ten days (for repeated measures)', file: 'tour_repeated.csv',
    description: 'The delivery time of twenty orders on each of ten days, each as its deviation from the thirty-minute target.',
    build: () => tourCsv('repeated'),
    mapping: { name: 'Orders on ten days', response: 'deviation', columns: { deviation: { role: 'response', type: 'continuous' }, day: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'tour-chisq', tour: 'chisq', title: 'Delivery outcome by channel (for the chi-square test)', file: 'tour_chisq.csv',
    description: 'The count of orders delivered early, on time, or late, by the channel the order came through.',
    build: () => tourCsv('chisq'),
    mapping: { name: 'Outcome by channel', response: 'count', columns: { count: { role: 'response', type: 'continuous' }, outcome: { role: 'predictor', type: 'categorical' }, channel: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-proportion', tour: 'proportion', title: 'Two offers (for the two-proportion z test)', file: 'tour_proportion.csv',
    description: 'Whether each of fifty customers shown each of two offers converted.',
    build: () => tourCsv('proportion'),
    mapping: { name: 'Two offers', response: 'converted', columns: { converted: { role: 'response', type: 'continuous' }, offer: { role: 'predictor', type: 'categorical' } } }
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
    entries.push({ id: ex.id, title: ex.title, file: ex.file, description: ex.description, mapping: ex.mapping, text, tour: ex.tour || null });
  }
  const lines = ['// Generated by data/generate_examples.mjs; do not edit by hand.', '',
    '/**', ' * Bundled example datasets. `text` is the file\'s contents as the importer reads it, and',
    ' * `mapping` is the role assignment that loads it without a dialog.',
    ' * tour names the section of the Tests as models page an example serves or is null.',
    ' * @type {{id: string, title: string, file: string, description: string, text: string, mapping: object, tour: string|null}[]}', ' */',
    'export const EXAMPLES = ['];
  entries.forEach((e, i) => {
    lines.push('  {');
    lines.push('    id: ' + JSON.stringify(e.id) + ',');
    lines.push('    title: ' + JSON.stringify(e.title) + ',');
    lines.push('    file: ' + JSON.stringify(e.file) + ',');
    lines.push('    description: ' + JSON.stringify(e.description) + ',');
    lines.push('    mapping: ' + JSON.stringify(e.mapping) + ',');
    lines.push('    tour: ' + JSON.stringify(e.tour) + ',');
    lines.push('    text: `' + e.text + '`');
    lines.push('  }' + (i < entries.length - 1 ? ',' : ''));
  });
  lines.push('];', '');
  fs.writeFileSync(path.join(modDir, 'examples.js'), lines.join('\n'));
  console.log('Wrote ' + entries.length + ' examples under ' + outRoot);
}

main();
