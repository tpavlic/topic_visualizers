// Generates the bundled example datasets for the GLMM Analyzer.
//
// Every example but one is drawn from a seeded simulation, and so the files
// are reproducible: re-running this script writes the same bytes. The queueing
// examples simulate a single-server queue with exponential interarrival and
// service times, started empty, with waiting times from the Lindley
// recursion W[n+1] = max(0, W[n] + S[n] - A[n+1]). The oven example is not
// simulated here: it holds the runs of a batch oven fed by calls of 2 to 12
// muffins, one a minute, which starts baking whenever it is empty and enough
// muffins wait, against a hand-simulation exercise's ten demand streams, whose
// call sizes are not published (see OVEN_RUNS). The colony
// example draws from a Poisson model with a random intercept and slope per
// colony.
//
// Randomness: mulberry32 streams, with exponential draws by inverse
// transform, normal draws by Box-Muller, and Poisson draws by inversion.
//
// Datasets (the seeds are in SEEDS below):
//   service_speed.csv   mean time in system per replication (continuous) against the mean
//                       service time (0.9, 0.8, 0.7, 0.6, 0.5 minutes), with the replication's
//                       random-number seed shared by all five designs as the group; 10
//                       replications, each the mean of 200 customers after 100 of warm-up
//   muffin_oven.csv     four outputs of a 30-minute batch-oven run (average time in system,
//                       utilization, most muffins waiting, muffins unfinished) against the
//                       loading threshold (1, 5, ..., 30) and the bake time (2 to 5 minutes),
//                       with the demand stream shared by all 28 settings as the group;
//                       10 replications, r0 to r9; written in, not simulated
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
//   tour_*.csv          the eleven small datasets of the Classic tests as GLMM page
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
  serviceSpeed: 1084000,
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

/** service_speed.csv */
function serviceSpeedCsv() {
  const rows = [];
  for (let rep = 1; rep <= 10; rep++) {
    for (const meanService of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      // The same seed per replication for every design: common random numbers.
      const st = { arr: mulberry32(SEEDS.serviceSpeed + rep), srv: mulberry32(SEEDS.serviceSpeed + rep + 0x9E3779B1), cls: () => 0 };
      const kept = queue(st, 1.0, [{ name: 'only', prob: 1, meanService }], { maxCustomers: 300 }).slice(100);
      rows.push([fmt(kept.reduce((a, c) => a + c.system, 0) / kept.length), meanService, 'r' + String(rep).padStart(2, '0')]);
    }
  }
  return csv(['time_in_system', 'mean_service', 'replication'], rows);
}

/**
 * The batch oven's runs, one block per demand stream (0 to 9): within it, one row per bake time
 * (2, 3, 4, and 5 minutes), and in a row one run per threshold (1, 5, 10, 15, 20, 25, and 30),
 * each giving the average time in system of the muffins that left, the time average of the
 * fraction of the oven in use, the most muffins ever waiting, and the muffins still in the system
 * at the end. The oven holds 30 muffins, and a run ends at minute 30.
 */
const OVEN_RUNS = [
  [
    [[2.4951, 0.4533, 12, 8], [2.4951, 0.4533, 12, 8], [2.5196, 0.4533, 12, 8], [2.7843, 0.4533, 14, 8], [3.1568, 0.4389, 19, 27], [3.4175, 0.4311, 23, 18], [4.1222, 0.4333, 29, 32]],
    [[3.9278, 0.6467, 19, 18], [3.9278, 0.6467, 19, 18], [3.8811, 0.6444, 19, 27], [3.9227, 0.6467, 19, 18], [4.1546, 0.6467, 22, 18], [4.4175, 0.6467, 23, 18], [5.1222, 0.6333, 29, 32]],
    [[5.5723, 0.8044, 28, 46], [5.5723, 0.8044, 28, 46], [5.6304, 0.8178, 31, 28], [5.6304, 0.8178, 31, 28], [5.9063, 0.8111, 32, 52], [5.8439, 0.8022, 31, 39], [6.1222, 0.8, 30, 32]],
    [[8.2903, 0.8611, 55, 57], [8.2903, 0.8611, 55, 57], [8.2963, 0.85, 50, 77], [8.2963, 0.85, 50, 77], [7.869, 0.8722, 49, 67], [7.869, 0.8722, 49, 67], [8.14, 0.8667, 54, 62]]
  ],
  [
    [[2.4096, 0.4178, 10, 14], [2.4096, 0.4178, 10, 14], [2.648, 0.4189, 12, 23], [2.8971, 0.4144, 14, 27], [3.1714, 0.4144, 18, 27], [3.5621, 0.4078, 24, 33], [4.3389, 0.4, 29, 22]],
    [[3.9665, 0.5967, 20, 23], [3.9665, 0.5967, 20, 23], [4.0343, 0.6089, 18, 27], [4.1173, 0.5967, 20, 23], [4.257, 0.5967, 20, 23], [4.5621, 0.5956, 24, 33], [5.3267, 0.5667, 29, 52]],
    [[5.2065, 0.7556, 27, 47], [5.2065, 0.7556, 27, 47], [5.4356, 0.7578, 25, 39], [5.5263, 0.76, 27, 31], [5.5161, 0.7556, 24, 47], [5.5621, 0.7511, 29, 33], [6.3267, 0.7333, 29, 52]],
    [[7.4295, 0.8667, 42, 46], [7.4295, 0.8667, 42, 46], [7.8828, 0.8444, 44, 74], [7.5, 0.8556, 39, 66], [7.5, 0.8556, 39, 66], [7.5267, 0.8667, 38, 52], [7.5267, 0.8667, 38, 52]]
  ],
  [
    [[2.3918, 0.4311, 12, 19], [2.3918, 0.4311, 12, 19], [2.5, 0.44, 10, 23], [2.8263, 0.44, 14, 23], [3.1784, 0.4344, 19, 28], [3.4595, 0.4111, 24, 28], [4.1944, 0.4, 28, 33]],
    [[3.9211, 0.6333, 19, 23], [3.9211, 0.6333, 19, 23], [3.9838, 0.64, 19, 28], [3.9842, 0.6333, 19, 23], [4.1784, 0.64, 19, 28], [4.4595, 0.6167, 24, 28], [5.1944, 0.6, 28, 33]],
    [[5.4195, 0.8178, 22, 39], [5.4195, 0.8178, 22, 39], [5.5946, 0.8222, 27, 28], [5.5946, 0.8222, 27, 28], [5.7333, 0.8167, 27, 48], [5.7803, 0.8022, 27, 40], [6.1944, 0.8, 28, 33]],
    [[9.2323, 0.8611, 51, 58], [9.2323, 0.8611, 51, 58], [8.7464, 0.8667, 49, 75], [8.7464, 0.8667, 49, 75], [8.7448, 0.8722, 45, 68], [8.7448, 0.8722, 45, 68], [9.0533, 0.8667, 50, 63]]
  ],
  [
    [[2.4893, 0.5178, 12, 18], [2.4893, 0.5178, 12, 18], [2.4888, 0.5133, 12, 28], [2.6309, 0.5178, 14, 18], [2.9641, 0.4956, 19, 28], [3.3734, 0.5178, 24, 18], [3.7095, 0.4667, 29, 41]],
    [[3.9596, 0.7433, 18, 28], [3.9596, 0.7433, 18, 28], [3.9612, 0.7467, 23, 45], [3.9612, 0.7467, 23, 45], [4.1505, 0.7467, 23, 45], [4.4417, 0.7467, 24, 45], [4.7095, 0.7, 29, 41]],
    [[6.8441, 0.8933, 38, 65], [6.8441, 0.8933, 38, 65], [6.4898, 0.9044, 37, 55], [6.4898, 0.9044, 37, 55], [6.5813, 0.9022, 37, 48], [6.6889, 0.9, 41, 71], [6.6889, 0.9, 41, 71]],
    [[10.6603, 0.8667, 83, 95], [10.6603, 0.8667, 83, 95], [9.5294, 0.8889, 85, 115], [9.5294, 0.8889, 85, 115], [9.5594, 0.8944, 78, 108], [9.6267, 0.9, 73, 101], [9.6267, 0.9, 73, 101]]
  ],
  [
    [[2.5714, 0.4511, 12, 10], [2.3958, 0.4456, 11, 21], [2.5813, 0.4511, 12, 10], [2.7833, 0.4511, 14, 10], [3.0443, 0.4511, 19, 10], [3.5417, 0.4267, 23, 21], [4.0444, 0.4, 29, 33]],
    [[4.0521, 0.64, 21, 21], [4, 0.6489, 21, 35], [3.9341, 0.6367, 22, 31], [3.8802, 0.64, 22, 21], [4.1629, 0.6489, 21, 35], [4.5417, 0.64, 23, 21], [5.0444, 0.6, 29, 33]],
    [[5.6867, 0.8044, 29, 47], [5.6517, 0.8244, 31, 35], [5.8122, 0.8044, 33, 32], [5.8122, 0.8044, 33, 32], [5.5641, 0.7933, 27, 57], [5.6061, 0.8, 27, 48], [6.2111, 0.8, 31, 33]],
    [[9.3553, 0.8444, 57, 61], [9.252, 0.8389, 56, 86], [8.8162, 0.8556, 47, 77], [8.8162, 0.8556, 47, 77], [8, 0.8889, 44, 65], [8, 0.8889, 44, 65], [8.7133, 0.8667, 53, 63]]
  ],
  [
    [[2.5333, 0.4667, 11, 13], [2.5333, 0.4667, 11, 13], [2.56, 0.4633, 11, 23], [2.7762, 0.4667, 14, 13], [3.019, 0.4667, 18, 13], [3.5211, 0.4522, 24, 33], [4.0095, 0.4667, 29, 13]],
    [[3.945, 0.6667, 18, 23], [3.945, 0.6667, 18, 23], [3.8656, 0.6733, 19, 37], [4.07, 0.6667, 19, 23], [4.0538, 0.6733, 18, 37], [4.5211, 0.6633, 24, 33], [5.1444, 0.6667, 29, 43]],
    [[5.848, 0.8267, 29, 52], [5.848, 0.8267, 29, 52], [5.6, 0.8333, 30, 43], [5.6105, 0.8444, 30, 33], [5.6667, 0.8333, 28, 58], [6.0391, 0.8289, 31, 44], [6.1444, 0.8333, 30, 43]],
    [[8.7949, 0.8667, 61, 67], [8.7949, 0.8667, 61, 67], [8.5455, 0.8667, 61, 91], [8.6087, 0.8667, 55, 85], [8.6944, 0.8667, 56, 79], [8.8267, 0.8667, 60, 73], [8.8267, 0.8667, 60, 73]]
  ],
  [
    [[2.4856, 0.4622, 12, 12], [2.4856, 0.4622, 12, 12], [2.522, 0.4556, 12, 15], [2.6974, 0.45, 14, 25], [3.0927, 0.4556, 19, 15], [3.1474, 0.4222, 23, 30], [4.0611, 0.4333, 29, 40]],
    [[3.922, 0.6833, 23, 15], [3.922, 0.6833, 23, 15], [3.922, 0.6833, 23, 15], [4.0821, 0.6667, 23, 25], [4.0927, 0.6833, 19, 15], [4.1474, 0.6333, 23, 30], [5.0611, 0.6333, 29, 40]],
    [[5.457, 0.8756, 26, 34], [5.457, 0.8756, 26, 34], [5.457, 0.8756, 26, 34], [5.8158, 0.8667, 31, 30], [5.5888, 0.8756, 28, 23], [5.6, 0.8778, 28, 45], [6.3944, 0.8333, 33, 40]],
    [[8.8827, 0.9, 59, 58], [8.8827, 0.9, 59, 58], [8.8827, 0.9, 59, 58], [9.0519, 0.8833, 60, 85], [8.2653, 0.9167, 50, 73], [8.2653, 0.9167, 50, 73], [8.84, 0.9, 55, 70]]
  ],
  [
    [[2.5637, 0.4533, 12, 13], [2.5637, 0.4533, 12, 13], [2.4307, 0.4622, 11, 15], [2.6823, 0.4511, 14, 25], [3.0269, 0.4444, 19, 31], [3.4478, 0.4467, 22, 16], [4.15, 0.4333, 28, 37]],
    [[3.8762, 0.6733, 17, 15], [3.8762, 0.6733, 17, 15], [4.0484, 0.66, 20, 31], [4.0484, 0.66, 20, 31], [4.0269, 0.6511, 19, 31], [4.4478, 0.67, 22, 16], [5.15, 0.6333, 28, 37]],
    [[5.6879, 0.8356, 29, 44], [5.6879, 0.8356, 29, 44], [5.4837, 0.8511, 23, 33], [5.4837, 0.8511, 23, 33], [5.5156, 0.8533, 26, 25], [5.5205, 0.86, 28, 46], [6.15, 0.8333, 28, 37]],
    [[8.4114, 0.8778, 56, 59], [8.4114, 0.8778, 56, 59], [7.8889, 0.8833, 52, 82], [7.8889, 0.8833, 52, 82], [8, 0.8833, 51, 76], [8.4207, 0.8722, 57, 72], [8.7133, 0.8667, 54, 67]]
  ],
  [
    [[2.4978, 0.5, 12, 14], [2.4955, 0.5044, 12, 17], [2.4955, 0.5044, 12, 17], [2.7594, 0.4933, 14, 27], [2.9198, 0.4933, 19, 27], [3.2667, 0.5, 24, 14], [3.6095, 0.4667, 29, 29]],
    [[4.1126, 0.74, 27, 17], [3.9353, 0.7233, 21, 38], [3.9353, 0.7233, 21, 38], [3.9717, 0.7289, 21, 27], [4.1351, 0.74, 27, 17], [4.4478, 0.7033, 27, 38], [4.7524, 0.7, 30, 29]],
    [[6.4505, 0.8756, 40, 57], [6.1458, 0.8867, 42, 47], [6.1458, 0.8867, 42, 47], [6.115, 0.8889, 36, 39], [6.115, 0.8889, 36, 39], [5.8701, 0.8867, 41, 62], [6.2222, 0.8667, 42, 59]],
    [[10.1316, 0.8444, 80, 87], [8.9015, 0.8667, 77, 107], [8.9015, 0.8667, 77, 107], [8.6312, 0.8833, 71, 98], [8.6312, 0.8833, 71, 98], [8.4533, 0.9, 72, 89], [8.4533, 0.9, 72, 89]]
  ],
  [
    [[2.4541, 0.4111, 12, 20], [2.4541, 0.4111, 12, 20], [2.4863, 0.4222, 11, 22], [2.8256, 0.41, 14, 33], [3.1386, 0.4022, 19, 39], [3.6687, 0.3956, 24, 42], [4.1944, 0.4, 27, 25]],
    [[3.8962, 0.61, 18, 22], [3.8962, 0.61, 18, 22], [3.8962, 0.61, 18, 22], [3.9759, 0.5956, 20, 39], [4.1386, 0.5867, 19, 39], [4.6687, 0.5767, 24, 42], [5.1944, 0.6, 27, 25]],
    [[5.5541, 0.76, 26, 48], [5.5541, 0.76, 26, 48], [5.5541, 0.76, 26, 48], [5.2733, 0.7644, 25, 33], [5.5099, 0.7711, 24, 54], [5.689, 0.7622, 26, 41], [6.3267, 0.7667, 27, 55]],
    [[7.6234, 0.8556, 43, 51], [7.6234, 0.8556, 43, 51], [7.6234, 0.8556, 43, 51], [7.3235, 0.8556, 39, 69], [7.3235, 0.8556, 39, 69], [7.5674, 0.85, 42, 64], [8.3267, 0.8333, 47, 55]]
  ]
];

/** muffin_oven.csv */
function ovenCsv() {
  const rows = [];
  OVEN_RUNS.forEach((stream, rep) => {
    // One demand stream per replication, run under every setting: common random numbers.
    [2, 3, 4, 5].forEach((bake, b) => {
      [1, 5, 10, 15, 20, 25, 30].forEach((threshold, t) => rows.push(['r' + rep, bake, threshold, ...stream[b][t]]));
    });
  });
  return csv(['replication', 'bake_time', 'threshold', 'avg_time_in_system', 'utilization', 'max_waiting', 'unfinished'], rows);
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

/** The eleven small datasets of the Classic tests as GLMM page. */
function tourCsv(which) {
  const rng = mulberry32(SEEDS.tour + { one: 5, t: 1, anova: 2, twoway: 10, regression: 7, ancova: 8, paired: 3, repeated: 6, chisq: 4, gof: 11, proportion: 9 }[which]);
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
  if (which === 'twoway') {
    // A balanced 2 x 3 layout, six runs per cell, with a modest interaction:
    // catalyst C gains more from the high temperature than A and B do.
    const cell = { low: { A: 70, B: 74, C: 72 }, high: { A: 76, B: 79, C: 83 } };
    for (const temperature of ['low', 'high']) for (const catalyst of ['A', 'B', 'C']) for (let i = 0; i < 6; i++) rows.push([fmt(cell[temperature][catalyst] + 3 * normal([rng(), rng()]), 1), temperature, catalyst]);
    return csv(['yield', 'temperature', 'catalyst'], rows);
  }
  if (which === 'regression') {
    for (let i = 0; i < 30; i++) {
      const distance = 1 + 11 * rng();
      rows.push([fmt(12 + 2.2 * distance + 4 * normal([rng(), rng()]), 1), fmt(distance, 1)]);
    }
    return csv(['delivery_time', 'distance'], rows);
  }
  if (which === 'ancova') {
    // The new machine is faster at any size, but it was given the smaller
    // jobs, and so the unadjusted comparison overstates its advantage.
    for (const [machine, lo, hi, shift] of [['old', 4, 20, 0], ['new', 2, 16, -2]]) for (let i = 0; i < 16; i++) {
      const size = lo + (hi - lo) * rng();
      rows.push([fmt(5 + 0.8 * size + shift + 1.5 * normal([rng(), rng()]), 2), machine, fmt(size, 1)]);
    }
    return csv(['time', 'machine', 'size'], rows);
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
  if (which === 'gof') {
    const counts = { Mon: 16, Tue: 9, Wed: 12, Thu: 10, Fri: 26, Sat: 8 };
    for (const weekday of Object.keys(counts)) rows.push([counts[weekday], weekday]);
    return csv(['count', 'weekday'], rows);
  }
  for (const [offer, p] of [['A', 0.30], ['B', 0.55]]) for (let i = 0; i < 50; i++) rows.push([rng() < p ? 1 : 0, offer]);
  return csv(['converted', 'offer'], rows);
}

const EXAMPLES = [
  {
    id: 'service-speed',
    title: 'Blocked by common random numbers (time in system, 5 designs)',
    file: 'service_speed.csv',
    description: 'The mean time in system of two hundred customers, after a warm-up of one hundred, in a single-server queue with exponential interarrival times of mean 1.0 minute, under five designs that differ only in the mean service time: 0.9, 0.8, 0.7, 0.6, and 0.5 minutes. Each design was run for ten replications, and replication r of every design used the same random-number seed, and so within a replication the five designs see the same arrivals and the same service draws, scaled to their own means. These are common random numbers, and the replication is a grouping factor shared by all five designs.',
    build: serviceSpeedCsv,
    mapping: { name: 'Service speed', response: 'time_in_system', columns: { time_in_system: { role: 'response', type: 'continuous' }, mean_service: { role: 'predictor', type: 'categorical' }, replication: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'muffin-oven',
    title: 'Two factors, four outputs (muffin oven, 28 settings)',
    file: 'muffin_oven.csv',
    description: 'Calls for 2 to 12 muffins arrive once a minute for thirty minutes at an oven that holds 30 muffins and bakes for a fixed time. The oven is loaded, oldest muffins first, whenever it is empty and at least a threshold number of muffins wait: a threshold of 1 loads greedily, and one near 30 waits for a full oven. Seven thresholds (1, 5, 10, 15, 20, 25, and 30) were run at four bake times (2, 3, 4, and 5 minutes) against each of ten random demand streams, and every run of a replication used the same stream, and so the replication is a grouping factor shared by all twenty-eight settings. Each run reports four outputs: the average time in system of the muffins that finished, the oven’s utilization (the share of its 30 places in use, averaged over the half hour), the most muffins ever waiting, and the muffins unfinished at the end. The first is the response, and the other three are outcomes, which the Model page offers as the response but never as predictors.',
    build: ovenCsv,
    mapping: { name: 'Muffin oven', response: 'avg_time_in_system', columns: { replication: { role: 'group', type: 'categorical' }, bake_time: { role: 'predictor', type: 'continuous' }, threshold: { role: 'predictor', type: 'continuous' }, avg_time_in_system: { role: 'response', type: 'continuous' }, utilization: { role: 'outcome', type: 'continuous' }, max_waiting: { role: 'outcome', type: 'continuous' }, unfinished: { role: 'outcome', type: 'continuous' } } }
  },
  {
    id: 'on-time',
    title: 'Binary response with a random intercept (on-time service)',
    file: 'on_time.csv',
    description: 'Whether each of the first fifty customers of a day was served within two minutes of arriving, against the number waiting in queue when the customer arrived and the service policy (A, mean service 0.8 minutes; B, mean service 0.7), in a single-server queue with exponential interarrival times of mean 1.0 minute. Eight days were run under each policy from the same eight random-number seeds, and so the seed is a grouping factor shared by both policies. A binomial model with a logit link and a random intercept per seed.',
    build: onTimeCsv,
    mapping: { name: 'On-time service', response: 'on_time', columns: { on_time: { role: 'response', type: 'continuous' }, queue: { role: 'predictor', type: 'continuous' }, policy: { role: 'predictor', type: 'categorical' }, seed: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'cycle-time',
    title: 'Positive, skewed response (cycle time)',
    file: 'cycle_time.csv',
    description: 'The time in system of sixty jobs on each of six shifts, after a warm-up of two hundred jobs, in a single-server queue whose offered load (the arrival rate, with mean service time 1.0 for a standard job and 0.5 for an express job) differs by shift. Time in system is positive and right skewed, and its spread grows with its mean as the load rises: a gamma model with a log link, with load as a continuous predictor and class as a categorical one.',
    build: cycleTimeCsv,
    mapping: { name: 'Cycle time', response: 'time_in_system', columns: { time_in_system: { role: 'response', type: 'continuous' }, load: { role: 'predictor', type: 'continuous' }, class: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'balks',
    title: 'Overdispersed count (balks per shift)',
    file: 'balks.csv',
    description: 'The number of customers who balked (arrived and left without joining) on each of sixty shifts, against the shift’s offered load and its staffing, with the week as a grouping factor. The counts vary more from shift to shift than a Poisson allows, which the Pearson dispersion on the Model page shows: compare the Poisson family with the negative binomial, and with the Poisson-lognormal that an observation-level random effect gives, on the Compare page.',
    build: balksCsv,
    mapping: { name: 'Balks', response: 'balks', columns: { balks: { role: 'response', type: 'continuous' }, load: { role: 'predictor', type: 'continuous' }, staffing: { role: 'predictor', type: 'categorical' }, week: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'utilization',
    title: 'Measured proportion (utilization)',
    file: 'utilization.csv',
    description: 'The fraction of an eight-hour day a single server was busy, on sixty days with different arrival rates and a shorter mean service on weekends. Utilization is a measured proportion, strictly between 0 and 1, whose spread shrinks toward both ends: the beta family with a logit link.',
    build: utilizationCsv,
    mapping: { name: 'Utilization', response: 'utilization', columns: { utilization: { role: 'response', type: 'continuous' }, arrival_rate: { role: 'predictor', type: 'continuous' }, day_type: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'colony-recruits',
    title: 'Count with a random slope (colony recruits)',
    file: 'colony_recruits.csv',
    description: 'The number of nestmates recruited in each of eight trials at twelve colonies, against the temperature and a feeding treatment applied per colony. Colonies differ in their baseline and in how strongly temperature moves them: a Poisson model with a random intercept and a random slope on temperature by colony. The treatment varies only between colonies, and so its test leans on the colony effect being in the model.',
    build: colonyCsv,
    mapping: { name: 'Colony recruits', response: 'recruits', columns: { recruits: { role: 'response', type: 'continuous' }, temperature: { role: 'predictor', type: 'continuous' }, treatment: { role: 'predictor', type: 'categorical' }, colony: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'rating',
    title: 'Ordered response (visit ratings)',
    file: 'rating.csv',
    description: 'Each of two hundred customers rated the visit poor, fair, good, or great, against the minutes waited and whether the express lane was used. The levels are ordered but not spaced: the ordinal family models the cumulative probabilities with one slope and three thresholds.',
    build: ratingCsv,
    mapping: { name: 'Visit ratings', response: 'rating', columns: { rating: { role: 'response', type: 'ordinal', levels: ['poor', 'fair', 'good', 'great'] }, wait: { role: 'predictor', type: 'continuous' }, express: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-one', tour: 'one', title: 'One-sample t test (deviation from a target)', file: 'tour_one.csv',
    description: 'The delivery time of twenty-five orders, each as its deviation from the thirty-minute target.',
    build: () => tourCsv('one'),
    mapping: { name: 'Deviation from target', response: 'deviation', columns: { deviation: { role: 'response', type: 'continuous' } } }
  },
  {
    id: 'tour-t', tour: 't', title: 'Two-sample t test (two production lines)', file: 'tour_t.csv',
    description: 'Throughput on fifteen days of each of two production lines.',
    build: () => tourCsv('t'),
    mapping: { name: 'Two lines', response: 'throughput', columns: { throughput: { role: 'response', type: 'continuous' }, line: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-anova', tour: 'anova', title: 'One-way ANOVA (three shifts)', file: 'tour_anova.csv',
    description: 'The defect rate on twelve days of each of three shifts.',
    build: () => tourCsv('anova'),
    mapping: { name: 'Three shifts', response: 'defect_rate', columns: { defect_rate: { role: 'response', type: 'continuous' }, shift: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-twoway', tour: 'twoway', title: 'Two-way ANOVA (temperature and catalyst)', file: 'tour_twoway.csv',
    description: 'The yield of six runs in each of the six combinations of a temperature (low, high) and a catalyst (A, B, C).',
    build: () => tourCsv('twoway'),
    mapping: { name: 'Temperature and catalyst', response: 'yield', columns: { yield: { role: 'response', type: 'continuous' }, temperature: { role: 'predictor', type: 'categorical' }, catalyst: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-regression', tour: 'regression', title: 'Correlation and simple regression (delivery time against distance)', file: 'tour_regression.csv',
    description: 'The delivery time of thirty orders against the distance driven.',
    build: () => tourCsv('regression'),
    mapping: { name: 'Time against distance', response: 'delivery_time', columns: { delivery_time: { role: 'response', type: 'continuous' }, distance: { role: 'predictor', type: 'continuous' } } }
  },
  {
    id: 'tour-ancova', tour: 'ancova', title: 'ANCOVA (two machines and the job size)', file: 'tour_ancova.csv',
    description: 'The processing time of sixteen jobs on each of two machines, against the size of the job.',
    build: () => tourCsv('ancova'),
    mapping: { name: 'Two machines', response: 'time', columns: { time: { role: 'response', type: 'continuous' }, machine: { role: 'predictor', type: 'categorical' }, size: { role: 'predictor', type: 'continuous' } } }
  },
  {
    id: 'tour-paired', tour: 'paired', title: 'Paired t test (before and after)', file: 'tour_paired.csv',
    description: 'The task time of fourteen operators before and after a change.',
    build: () => tourCsv('paired'),
    mapping: { name: 'Before and after', response: 'time', columns: { time: { role: 'response', type: 'continuous' }, condition: { role: 'predictor', type: 'categorical' }, subject: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'tour-repeated', tour: 'repeated', title: 'Repeated measures (orders on ten days)', file: 'tour_repeated.csv',
    description: 'The delivery time of twenty orders on each of ten days, each as its deviation from the thirty-minute target.',
    build: () => tourCsv('repeated'),
    mapping: { name: 'Orders on ten days', response: 'deviation', columns: { deviation: { role: 'response', type: 'continuous' }, day: { role: 'group', type: 'categorical' } } }
  },
  {
    id: 'tour-chisq', tour: 'chisq', title: 'Chi-square test of independence (delivery outcome by channel)', file: 'tour_chisq.csv',
    description: 'The count of orders delivered early, on time, or late, by the channel the order came through.',
    build: () => tourCsv('chisq'),
    mapping: { name: 'Outcome by channel', response: 'count', columns: { count: { role: 'response', type: 'continuous' }, outcome: { role: 'predictor', type: 'categorical' }, channel: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-gof', tour: 'gof', title: 'Chi-square goodness-of-fit test (breakdowns by weekday)', file: 'tour_gof.csv',
    description: 'The count of machine breakdowns on each of the six working days of the week over a quarter.',
    build: () => tourCsv('gof'),
    mapping: { name: 'Breakdowns by weekday', response: 'count', columns: { count: { role: 'response', type: 'continuous' }, weekday: { role: 'predictor', type: 'categorical' } } }
  },
  {
    id: 'tour-proportion', tour: 'proportion', title: 'Two-proportion z test (two offers)', file: 'tour_proportion.csv',
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
