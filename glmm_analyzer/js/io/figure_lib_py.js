// Python (numpy and matplotlib) figure helpers for the regenerate scripts. Each value is the
// text of one function (or, for `common`, the shared constants and small helpers) that a
// script carries so that a figure is one readable call. Every helper imports matplotlib inside
// itself, makes its own figure, and returns it; none calls plt.show(). The script calls
// show_figures() once at the end. This file is pure text: no snippet holds a backtick or a
// dollar-brace, and none touches the DOM.
export const FIG_PY = {};

FIG_PY.common = `
# Colors used by every figure.
FIG_EST = "#2b6cb0"      # data points and series
FIG_TRUTH = "#1a1a1a"    # intervals, means, estimates
FIG_MISS = "#c0392b"     # a flagged interval
FIG_OK = "#2e7d32"       # survivors, batch means, highlights
FIG_MUTED = "#9e9e9e"    # reference lines, eliminated rows, excluded stretches
FIG_ACCENT = "#8c1d40"   # the cut or fence, letters


def show_figures():
    import warnings
    import matplotlib.pyplot as plt
    with warnings.catch_warnings():   # a backend that only writes files cannot show figures
        warnings.filterwarnings("ignore", message=".*non-interactive", category=UserWarning)
        plt.show()


def fig_vec(x):
    """x as a flat float array with the NaN entries removed."""
    x = np.asarray(x, dtype=float).ravel()
    return x[~np.isnan(x)]


def fig_flags(f, n):
    """A list of n booleans from f, which may be None or shorter than n."""
    out = [False] * n
    if f is not None:
        for i, v in enumerate(list(f)[:n]):
            out[i] = bool(v)
    return out


def fig_span(lo, hi, pad=0.0):
    """(lo, hi) widened by 1 on each side when they coincide (or differ only by rounding), then
    padded by a fraction."""
    if not (np.isfinite(lo) and np.isfinite(hi)):
        lo, hi = 0.0, 1.0
    if hi - lo <= 1e-10 * max(1.0, abs(lo), abs(hi)):
        mid = (lo + hi) / 2
        lo, hi = mid - 1.0, mid + 1.0
    d = (hi - lo) * pad
    return lo - d, hi + d


def fig_range(arrays, pad=0.05):
    """The padded range of every finite number in the given arrays (None entries are skipped)."""
    keep = []
    for a in arrays:
        if a is not None:
            a = np.asarray(a, dtype=float).ravel()
            keep.append(a[np.isfinite(a)])
    allv = np.concatenate(keep) if keep else np.array([])
    if allv.size == 0:
        return fig_span(np.nan, np.nan, pad)
    return fig_span(allv.min(), allv.max(), pad)


def fig_labels(labels, n):
    """n row labels: the given ones, with the row number where one is missing."""
    labels = [] if labels is None else list(labels)
    return [str(labels[i]) if i < len(labels) else str(i + 1) for i in range(n)]


def fig_empty(ax, title, xlab="", ylab=""):
    """An empty frame that says there is nothing to draw."""
    ax.text(0.5, 0.5, "nothing to draw", ha="center", va="center",
            transform=ax.transAxes, color=FIG_MUTED)
    ax.set_title(title)
    ax.set_xlabel(xlab)
    ax.set_ylabel(ylab)
    ax.set_xticks([])
    ax.set_yticks([])


def fig_stack(v):
    """Small vertical offsets so that values that nearly tie do not hide each other."""
    v = np.asarray(v, dtype=float)
    if v.size == 0:
        return v
    width = (v.max() - v.min()) / 60.0
    if width <= 0:
        width = 1.0
    cell = np.floor((v - v.min()) / width).astype(int)
    pattern = [0.0, 1.0, -1.0, 2.0, -2.0]
    seen = {}
    out = np.zeros(v.size)
    for k in np.argsort(v, kind="stable"):
        c = seen.get(cell[k], 0)
        seen[cell[k]] = c + 1
        out[k] = 0.09 * pattern[c % 5]
    return out
`;

FIG_PY.intervals = `
def fig_intervals(mid, lo, hi, labels, xlab, title, ref=np.nan, flagged=None, muted=None,
                  right=None, brackets=None, ok=None):
    """A forest plot: one interval per row, with optional texts and brackets at the right."""
    import matplotlib.pyplot as plt
    mid, lo, hi = [np.asarray(a, dtype=float).ravel() for a in (mid, lo, hi)]
    n = max(mid.size, lo.size, hi.size)
    fig, ax = plt.subplots(figsize=(7.0, 1.0 + 0.35 * max(n, 1) + 0.4))
    if n == 0:
        fig_empty(ax, title, xlab)
        fig.tight_layout()
        return fig
    pad = lambda a: np.concatenate([a, np.full(n - a.size, np.nan)])
    mid, lo, hi = pad(mid), pad(lo), pad(hi)
    flagged, muted, ok = fig_flags(flagged, n), fig_flags(muted, n), fig_flags(ok, n)
    xlo, xhi = fig_range([mid, lo, hi, np.array([ref])], 0.05)
    # Place each bracket in the leftmost column where its rows are free.
    placed = []   # (first row, last row, column), rows counted from 0
    pairs = [] if brackets is None else [tuple(sorted((int(p[0]) - 1, int(p[1]) - 1)))
                                         for p in brackets]
    for a, b in sorted(pairs, key=lambda p: p[1] - p[0]):
        col = 0
        while any(c == col and not (b < pa or a > pb) for pa, pb, c in placed):
            col += 1
        placed.append((a, b, col))
    ncols = 1 + max([c for _, _, c in placed]) if placed else 0
    texts = [] if right is None else list(right)
    span = xhi - xlo
    extra = (0.16 if any(str(t) != "" for t in texts) else 0.0) + 0.03 * ncols
    if placed:
        extra += 0.02
    for i in range(n):
        color = FIG_MUTED if muted[i] else FIG_MISS if flagged[i] else FIG_OK if ok[i] \
            else FIG_TRUTH
        weak = muted[i] or flagged[i]
        style = "--" if weak else "-"
        if np.isfinite(lo[i]) or np.isfinite(hi[i]):
            a = lo[i] if np.isfinite(lo[i]) or np.isnan(lo[i]) else xlo
            b = hi[i] if np.isfinite(hi[i]) or np.isnan(hi[i]) else xhi
            ends = [e for e in (a, b) if not np.isnan(e)]
            ax.plot([min(ends), max(ends)], [i, i], color=color, linestyle=style, linewidth=1.5)
            for e, real in ((a, lo[i]), (b, hi[i])):
                if np.isfinite(real):
                    ax.plot([e, e], [i - 0.2, i + 0.2], color=color, linewidth=1.5)
        if np.isfinite(mid[i]):
            ax.plot([mid[i]], [i], "o", color=color, markersize=5,
                    markerfacecolor="white" if weak else color)
    if np.isfinite(ref):
        ax.axvline(ref, color=FIG_MUTED, linestyle="--", linewidth=1)
    for i, t in enumerate(texts[:n]):
        if str(t) != "":
            color = FIG_MUTED if muted[i] else FIG_OK if ok[i] else FIG_ACCENT
            ax.text(xhi + 0.02 * span, i, str(t), color=color, va="center", ha="left",
                    fontsize=9)
    for a, b, col in placed:
        x = xhi + span * (0.17 + 0.03 * col)
        tick = 0.012 * span
        ax.plot([x - tick, x, x, x - tick], [a, a, b, b], color=FIG_TRUTH, linewidth=0.9,
                clip_on=False)
    ax.set_xlim(xlo, xhi + span * extra)
    ticks = [t for t in ax.get_xticks() if xlo - 1e-9 <= t <= xhi + 1e-9]
    ax.set_xticks(ticks)
    ax.set_xlim(xlo, xhi + span * extra)
    ax.set_ylim(n - 0.4, -0.6)
    ax.set_yticks(range(n))
    ax.set_yticklabels(fig_labels(labels, n))
    ax.set_xlabel(xlab)
    ax.set_title(title)
    fig.tight_layout()
    return fig
`;

FIG_PY.pairsByRep = `
def fig_pairs_by_rep(a, b, ids, xlab="Replication id", title="Pairs by replication"):
    """Each matched pair as a filled dot (A) and a hollow dot (B) joined by a dashed segment."""
    import matplotlib.pyplot as plt
    a = np.asarray(a, dtype=float).ravel()
    b = np.asarray(b, dtype=float).ravel()
    n = min(a.size, b.size)
    fig, ax = plt.subplots(figsize=(7.0, 4.0))
    if n == 0:
        fig_empty(ax, title, xlab, "Replication outcome")
        fig.tight_layout()
        return fig
    a, b = a[:n], b[:n]
    x = np.arange(1, n + 1)
    ax.vlines(x, np.fmin(a, b), np.fmax(a, b), color=FIG_MUTED, linestyle="--", linewidth=1)
    ax.plot(x, a, "o", color=FIG_EST, markersize=6, label="A")
    ax.plot(x, b, "o", color=FIG_EST, markerfacecolor="white", markersize=6, label="B")
    step = int(np.ceil(n / 20.0))
    shown = list(range(0, n, step))
    names = fig_labels(ids, n)
    ax.set_xticks([x[k] for k in shown])
    ax.set_xticklabels([names[k] for k in shown], rotation=45 if step == 1 and n > 10 else 0)
    ax.set_xlim(0.4, n + 0.6)
    ax.set_xlabel(xlab)
    ax.set_ylabel("Replication outcome")
    ax.set_title(title)
    ax.legend(loc="best")
    fig.tight_layout()
    return fig
`;

FIG_PY.pairsSlopes = `
def fig_pairs_slopes(a, b, label_a="A", label_b="B", title="Pairs as slopes"):
    """One line per pair from design A to design B, dashed gray when it runs against the mean."""
    import matplotlib.pyplot as plt
    a = np.asarray(a, dtype=float).ravel()
    b = np.asarray(b, dtype=float).ravel()
    n = min(a.size, b.size)
    a, b = a[:n], b[:n]
    keep = np.isfinite(a) & np.isfinite(b)
    a, b = a[keep], b[keep]
    fig, ax = plt.subplots(figsize=(5.0, 4.5))
    if a.size == 0:
        fig_empty(ax, title, "Design", "Replication outcome")
        fig.tight_layout()
        return fig
    mean_sign = np.sign(np.mean(a - b))
    for k in range(a.size):
        same = np.sign(a[k] - b[k]) == mean_sign
        ax.plot([1, 2], [a[k], b[k]], color=FIG_EST if same else FIG_MUTED,
                linestyle="-" if same else "--", linewidth=1.2, marker="o", markersize=3)
    ax.plot([0.9, 1.1], [a.mean()] * 2, color=FIG_TRUTH, linewidth=3.5)
    ax.plot([1.9, 2.1], [b.mean()] * 2, color=FIG_TRUTH, linewidth=3.5)
    ax.plot([], [], color=FIG_EST, label="same direction as the mean")
    ax.plot([], [], color=FIG_MUTED, linestyle="--", label="opposite direction")
    ax.set_xticks([1, 2])
    ax.set_xticklabels([str(label_a), str(label_b)])
    ax.set_xlim(0.5, 2.5)
    ax.set_xlabel("Design")
    ax.set_ylabel("Replication outcome")
    ax.set_title(title)
    ax.legend(loc="best", fontsize=8)
    fig.tight_layout()
    return fig
`;

FIG_PY.hist = `
def fig_hist(x, edges, xlab, title):
    """A histogram of counts over the given bin edges."""
    import matplotlib.pyplot as plt
    x = fig_vec(x)
    edges = np.asarray(edges, dtype=float).ravel()
    fig, ax = plt.subplots(figsize=(6.0, 4.0))
    if x.size == 0 or edges.size < 2:
        fig_empty(ax, title, xlab, "Frequency")
        fig.tight_layout()
        return fig
    ax.hist(x, bins=edges, color=FIG_EST, edgecolor="white")
    ax.set_xlabel(xlab)
    ax.set_ylabel("Frequency")
    ax.set_title(title)
    fig.tight_layout()
    return fig
`;

FIG_PY.box = `
def fig_box(x, xlab, title):
    """One horizontal box plot (Tukey's hinges) with the mean as a hollow diamond."""
    import matplotlib.pyplot as plt
    x = np.sort(fig_vec(x))
    fig, ax = plt.subplots(figsize=(6.0, 2.4))
    if x.size == 0:
        fig_empty(ax, title, xlab)
        fig.tight_layout()
        return fig
    n = x.size
    n4 = np.floor((n + 3) / 2.0) / 2.0
    d = np.array([1.0, n4, (n + 1) / 2.0, n + 1 - n4, float(n)]) - 1.0
    five = 0.5 * (x[np.floor(d).astype(int)] + x[np.ceil(d).astype(int)])
    h1, med, h2 = five[1], five[2], five[3]
    step = 1.5 * (h2 - h1)
    inside = x[(x >= h1 - step) & (x <= h2 + step)]
    w1, w2 = inside.min(), inside.max()
    out = x[(x < w1) | (x > w2)]
    ax.add_patch(plt.Rectangle((h1, 0.7), h2 - h1, 0.6, facecolor="white",
                               edgecolor=FIG_EST, linewidth=1.5))
    ax.plot([med, med], [0.7, 1.3], color=FIG_EST, linewidth=2.5)
    ax.plot([w1, h1], [1, 1], color=FIG_EST, linewidth=1.5)
    ax.plot([h2, w2], [1, 1], color=FIG_EST, linewidth=1.5)
    for w in (w1, w2):
        ax.plot([w, w], [0.85, 1.15], color=FIG_EST, linewidth=1.5)
    ax.plot(out, np.ones(out.size), "o", markerfacecolor="white", color=FIG_EST, markersize=5)
    ax.plot([x.mean()], [1], "D", markerfacecolor="white", color=FIG_TRUTH, markersize=7)
    lo, hi = fig_span(x[0], x[-1], 0.05)
    ax.set_xlim(lo, hi)
    ax.set_ylim(0.5, 1.5)
    ax.set_yticks([])
    ax.set_xlabel(xlab)
    ax.set_title(title)
    fig.tight_layout()
    return fig
`;

FIG_PY.qq = `
def fig_qq(x, ylab, title, xlab="Standard normal quantile"):
    """A normal quantile-quantile plot with the line through the quartiles."""
    import matplotlib.pyplot as plt
    from scipy import stats
    x = np.sort(fig_vec(x))
    fig, ax = plt.subplots(figsize=(5.0, 4.5))
    if x.size == 0:
        fig_empty(ax, title, xlab, ylab)
        fig.tight_layout()
        return fig
    n = x.size
    a = 3.0 / 8.0 if n <= 10 else 0.5
    p = (np.arange(1, n + 1) - a) / (n + 1 - 2 * a)
    q = stats.norm.ppf(p)
    ax.plot(q, x, "o", color=FIG_EST, markersize=4, alpha=0.8)
    y1, y3 = np.quantile(x, [0.25, 0.75])
    q1, q3 = stats.norm.ppf([0.25, 0.75])
    slope = (y3 - y1) / (q3 - q1)
    qs = np.array(fig_span(q.min(), q.max(), 0.05))
    ax.plot(qs, y1 + slope * (qs - q1), color=FIG_TRUTH, linestyle="--", linewidth=1.2)
    ax.set_xlim(qs[0], qs[1])
    ax.set_xlabel(xlab)
    ax.set_ylabel(ylab)
    ax.set_title(title)
    fig.tight_layout()
    return fig
`;


FIG_PY.effect = `
def fig_effect(x, y, lo, hi, xlab, ylab, title, px=None, py=None, labels=None):
    """Fitted curves (lists x, y, lo, hi) with their bands, and the data as points px, py."""
    import matplotlib.pyplot as plt
    if not isinstance(x, (list, tuple)):
        x, y, lo, hi = [x], [y], [lo], [hi]
    n = len(x)
    cols = [FIG_TRUTH, FIG_MISS, FIG_OK, FIG_ACCENT, FIG_EST, FIG_MUTED]
    styles = ["-", "--", ":", "-.", (0, (5, 1)), (0, (1, 1))]
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    if px is not None and py is not None:
        ax.plot(np.asarray(px, float), np.asarray(py, float), "o", color=FIG_EST, alpha=0.45, markersize=3.5)
    for k in range(n):
        c = cols[k % len(cols)]
        xk = np.asarray(x[k], float); yk = np.asarray(y[k], float)
        ax.fill_between(xk, np.asarray(lo[k], float), np.asarray(hi[k], float), color=c, alpha=0.15, linewidth=0)
        ax.plot(xk, yk, color=c, linewidth=2, linestyle=styles[k % len(styles)], label=(labels[k] if labels else None))
    if labels and n > 1:
        ax.legend(frameon=False)
    ax.set_xlabel(xlab); ax.set_ylabel(ylab); ax.set_title(title)
    fig.tight_layout()
    return fig
`;

FIG_PY.resid = `
def fig_resid(x, r, xlab, ylab, title):
    """Residuals r against x, with the mean residual in ten bins of about equal count."""
    import matplotlib.pyplot as plt
    x = np.asarray(x, float); r = np.asarray(r, float)
    keep = np.isfinite(x) & np.isfinite(r)
    x = x[keep]; r = r[keep]
    fig, ax = plt.subplots(figsize=(6.5, 4.0))
    if x.size == 0:
        fig_empty(ax, title, xlab, ylab)
        fig.tight_layout()
        return fig
    ax.plot(x, r, "o", color=FIG_EST, alpha=0.6, markersize=3.5)
    ax.axhline(0, linestyle="--", color=FIG_MUTED)
    o = np.argsort(x)
    k = max(1, min(10, x.size // 5))
    bins = np.array_split(o, k)
    bx = [x[i].mean() for i in bins]; br = [r[i].mean() for i in bins]
    ax.plot(bx, br, "-", color=FIG_TRUTH, linewidth=2)
    ax.plot(bx, br, "o", markerfacecolor="white", markeredgecolor=FIG_TRUTH, markersize=6)
    ax.set_xlabel(xlab); ax.set_ylabel(ylab); ax.set_title(title)
    fig.tight_layout()
    return fig
`;

FIG_PY.bars = `
def fig_bars(values, labels, ylab, title):
    \"\"\"One bar per label, with the values up from zero.\"\"\"
    import matplotlib.pyplot as plt
    v = np.asarray(values, float).ravel()
    fig, ax = plt.subplots(figsize=(6.5, 4.5))
    ax.bar(range(len(v)), v, color=FIG_EST, alpha=0.32, edgecolor=FIG_EST, linewidth=1)
    ax.set_xticks(range(len(v)))
    ax.set_xticklabels([str(l) for l in labels])
    ax.set_ylim(0, max(1.0, float(np.nanmax(v))))
    ax.set_ylabel(ylab)
    ax.set_title(title)
    return fig
`;
