# CLAUDE.md — conventions for this repository

This repository hosts standalone interactive web demonstrations and other visualizations on
topics in science, mathematics, statistics, and engineering, built by Theodore P. Pavlic. The live site is at
<https://tpavlic.github.io/topic_visualizers/>.

---

## Registering an existing visualization

**Confine setup edits to the file's outer edges (the `<head>` and the back-link footer); leave the
body interior untouched.** These apps are often authored or edited in a separate tool (such as Claude
Desktop) and then re-imported, so the body between the head and the footer is owned by that tool.
When you register, add, or set up a demo here, restrict your changes to the head metadata (title,
description, OG/Twitter/GA tags) and the back-link footer with its iframe-hiding script, and do not
restructure or restyle anything in between, so a later re-import of the app body does not have to
re-apply your interior edits. This applies to the setup/import path; when the user explicitly asks
you to change the body (for example a footer or layout review pass), that is fine. Otherwise, if the
interior seems to need a change, flag it and ask rather than editing it silently.

When a user asks to add an existing demo to the index/README/CLAUDE.md, **always also audit
the demo's HTML file itself** before finishing:

1. Check that `<head>` has a `<meta name="description">`, the full OG block, the Twitter/X
   card block, and the Google Analytics gtag block. If any are missing, add them (use the
   preview image dimensions from the actual file; aspect ratio should be close to 2:1 for Twitter).
2. Check that the bottom of `<body>` has the standard back-link `<footer>` and the
   iframe-hiding `<script>`. If missing, add them.

Do this proactively — the user should not have to ask separately.

---

## Adding a new visualization — full checklist

Each visualization lives in its own subdirectory:

```bash
my_demo/
  my_demo.html          # self-contained page (no build step)
  my_demo-preview.png   # preview image for OG/Twitter cards
```

### 1. `<head>` metadata in `my_demo.html`

Every demo page must have a proper HTML5 document structure (`<!DOCTYPE html>`, `<html lang="en">`,
`<head>`, `<body>`) — do not leave the file as a bare fragment.

Inside `<head>`, include all of the following, filling in the actual values:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Demo Title — interactive explainer</title>
<meta name="description" content="One or two sentences describing the demo.">

<!-- Open Graph (Facebook, LinkedIn, Slack, iMessage, etc.) -->
<meta property="og:type" content="website">
<meta property="og:title" content="Demo Title — interactive explainer">
<meta property="og:description" content="One or two sentences describing the demo.">
<meta property="og:image" content="https://tpavlic.github.io/topic_visualizers/my_demo/my_demo-preview.png">
<meta property="og:image:width" content="ACTUAL_WIDTH">
<meta property="og:image:height" content="ACTUAL_HEIGHT">
<meta property="og:url" content="https://tpavlic.github.io/topic_visualizers/my_demo/my_demo.html">
<meta property="fb:app_id" content="2385695445236853">

<!-- Twitter/X card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Demo Title — interactive explainer">
<meta name="twitter:description" content="One or two sentences describing the demo.">
<meta name="twitter:image" content="https://tpavlic.github.io/topic_visualizers/my_demo/my_demo-preview.png">

<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-P0S68QRGVP"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-P0S68QRGVP');
</script>
</head>
```

**No HTML entities in `<head>` metadata text:** use a literal `&`, not the `&amp;` entity, in
every human-readable metadata string in the `<head>`. That means the page `<title>` and the
`content` of `og:title`, `og:description`, `twitter:title`, `twitter:description`, and the
`<meta name="description">` (and any other such metadata string). The same applies to other
entities, not just ampersands. Although `&amp;` is the technically correct HTML encoding
(parsers decode it in attribute values, and in the `<title>` text), many card scrapers (Slack's
notably) read the raw string without decoding entities and display the literal `&amp;`. A bare
`&` followed by a space is not an ambiguous ampersand, so it stays valid HTML. This rule is
about `<head>` metadata only; body content (headings, prose) is rendered by a real HTML parser,
so entities there decode fine and need no change.

**Twitter/X image requirements** (stricter than other platforms):

- Aspect ratio must be close to **2:1** (e.g. 1200×600, 2400×1200). Twitter silently drops
  images that deviate significantly, even if Facebook/Mastodon/Bluesky render them fine.
- File size must be **under 5 MB**.
- If the natural preview image is the wrong ratio, create a cropped/padded version for
  `twitter:image` while leaving `og:image` pointing at the full-resolution original.

### 2. Footer with back-link and iframe-hiding script

At the very bottom of `<body>`, before `</body>`, add:

```html
<footer id="back-link-footer" style="max-width:CONTENT_MAX_WIDTH;margin:0 auto;padding:0 CONTENT_HPAD 1.5rem;">
  <div style="padding-top:0.75rem;border-top:1px solid #e0e0e0;font-size:0.8rem;color:#888;">
    <a href="../" style="color:PAGE_LINK_COLOR;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'"><span style="font-family:sans-serif">&larr;</span> All visualizations</a>
  </div>
</footer>
<script>
if (window.self !== window.top) { var f = document.getElementById('back-link-footer'); if (f) f.style.display = 'none'; }
</script>
```

The `<script>` hides the footer when the page is embedded in a Canvas LMS iframe.

**Set the back-link color to the page's own link color.** Replace `PAGE_LINK_COLOR` with the
literal hex that the demo uses for its prominent hyperlinks (the `a` color, e.g. the
`.ref-body a` / `--accent` / `--orange` color), so the back-link reads as one of the page's
links rather than a foreign green. Use a literal hex, not the widget's CSS variable, so the
footer stays self-contained and survives re-pasting the widget source. Pick a shade with
adequate contrast on the footer's background. Existing demos: jacobian `#e07a23`, lyapunov
`#c97d35`, chaos `#2a5a8c`, survival `#2a5a8c`.

**Match the page's content width.** Replace `CONTENT_MAX_WIDTH` and `CONTENT_HPAD` with the
`max-width` and horizontal `padding` of the demo's main centered content container (e.g.
`.widget`, `.page-inner`, or whatever wraps the app). This keeps the back-link aligned with
the rest of the page instead of drifting to the viewport's left edge. The `border-top` (the
horizontal rule) goes on the **inner `<div>`**, inside the horizontal padding, so the rule
spans the content width and matches the length of the main footer's rule — not the full
element width.

**Watch for body padding:** if the demo's `body` CSS has no `padding-bottom`, the footer will
sit flush against the viewport edge. Add `padding-bottom` to the body, bump the footer's
bottom padding, or add `margin-bottom` if needed.

**Back-link arrow (`&larr;`) glyph varies by font fallback.** The page webfonts usually lack a
`←` glyph, so it falls back down the stack. A stack containing `system-ui`/`-apple-system`
renders a short, stubby `←` (San Francisco on macOS), whereas falling through to the generic
`sans-serif` gives a longer, nicer `←` (Helvetica/Arial). For a consistent long arrow, wrap just
the arrow in `<span style="font-family:sans-serif">&larr;</span>` (as in the template above) so
it never picks up `system-ui`.

**A generic `footer { … }` rule can leak onto `#back-link-footer`.** If a demo styles its own
copyright `footer{}` (font-family, `text-align`, `border-top`, `margin-top`, padding), those
properties also land on the back-link footer, since both are `<footer>` elements — giving an
unwanted second horizontal rule, a mono font, or a large gap. Reset the offending properties on
`#back-link-footer` inline, or scope the rule to `footer:not(#back-link-footer)`.

**Link decoration (underline) consistency.** Within each page, the copyright/license "MIT
License" link(s) and the back-link should share ONE underline behavior; the default is
**hover-underline** (no resting underline, no hover-bold, no hover color-shift — the underline
appears only on hover). Use a resting (always-on) underline only when a link is the *same color*
as its surrounding text so nothing else signals it is a link; better still, give such links a
distinct accent color and keep hover-underline. Colors may differ by context and need not match
across header/footer:

- Choose each link's color to be readable **and** distinct from adjacent text *in its own
  context*. An accent that reads on a light footer (orange, maroon, green) is often unreadable on
  a dark header banner — there, let the header "MIT License" link keep the banner's own text
  color (it is fine if it does not obviously look like a link).
- The back-link should match the page's link color (see the `PAGE_LINK_COLOR` note above): set
  the `#back-link-footer` element's `color` to that accent and keep the anchor's hover-underline.
- Bring body/reference links into the same behavior (e.g. via the page's global `a{}` rule:
  `a{…;text-decoration:none} a:hover{text-decoration:underline}`) so the whole page is consistent.

**At most one hard rule in the footer area.** The copyright block and the `#back-link-footer` can
each carry a `border-top`, and having both stacks two rules bracketing the copyright, which reads as
too much. Keep at most one. If the page body is built from panels with hard edges, no footer rule is
needed. If the body is borderless, a single rule above the copyright can help, mirroring the rule
under the lede at the top of the page, but then do not also put one on the back-link footer.

**When you remove a footer rule, drop the `padding-top` that paired with it.** The `#back-link-footer`
template pairs `border-top:1px solid #e0e0e0` with `padding-top:0.75rem` on its inner `<div>` (the
padding seats the link below the rule). Once you remove the border, reduce that padding (about
`0.35rem`) or the back-link floats with a phantom gap.

**Tighten the copyright-to-back-link gap from the content side, not with a negative margin on the
back-link footer.** The copyright is usually the last child inside the main content wrapper, so the
gap below it is the wrapper's `padding-bottom`, not the copyright's own margin. Reduce that wrapper
bottom padding (a positive value) rather than pulling the back-link up with a negative `margin-top`.

**Space under the back-link: do not stack `body` padding-bottom and the footer's own `padding-bottom`.**
If `body` has all-sides padding (e.g. `padding:18px`), a `#back-link-footer` that also sets a bottom
padding doubles the space, so that page's back-link sits visibly lower than sibling pages whose
footers have none. Pick one source (usually the body padding) and keep it consistent across pages.

**Header copyright in a colored banner.** For a right-aligned copyright/license in a colored header,
make it a flex child pushed right with `margin-left:auto`, styled like the muted subtitle. On a dark
or colored banner keep the license link `color:inherit` (the banner's light text) rather than the
page accent, which would be unreadable there, but keep hover-underline so its behavior matches the
footer link. To balance a two-line title, stack it on two lines by default (copyright on top, license
below) and collapse to one line as the header narrows, using a toggled `<br>` and a `·` separator
(two-line: the `<br>` shows and the separator is hidden; one-line: the `<br>` is hidden, the separator
shows, and `width:100%` drops the block onto its own line under the subtitle). Split it back to two
lines at a much narrower breakpoint. Match the header separator's spacing to the footer separator's
(e.g. `margin:0 .3em`) so both dots look the same.

### 3. Entry in `index.html`

Add a `<li>` inside the appropriate `<section class="demo-section">` in `index.html`.
If no suitable section exists, create one by copying the structure of an existing section block.

```html
<li>
  <a class="demo-row" href="my_demo/my_demo.html">
    <img class="demo-thumb"
         src="my_demo/my_demo-preview.png"
         alt="My Demo preview"
         width="120" height="90">
    <div class="demo-text">
      <h3>Demo Title — interactive explainer</h3>
      <p>One sentence description that conveys what the demo shows and why it matters.</p>
    </div>
  </a>
</li>
```

Sections are created on demand as demos are added — there are no predefined section headings.
Group related demos together under a shared topic heading.

### 4. Entry in `README.md`

Add a row to the appropriate table under `## Contents`. Create the table (and a heading for
the section) if it does not already exist:

```markdown
| [`my_demo/`](my_demo/) | Brief description matching the index entry |
```

### 5. Entry in `CLAUDE.md`

Update the **Current demos** list below to include the new demo.

---

## HiDPI `<canvas>` rendering

Any `<canvas>` drawing (plots, phase portraits, attractor traces, survival curves) looks blurry on
retina/HiDPI unless the backing store is scaled by `devicePixelRatio`. Draw in **logical** units
but size the backing store at `logical × dpr` and scale the context once:

```js
const dpr = window.devicePixelRatio || 1, W = 600, H = 175;   // logical size
cv.style.width = W + 'px';                                     // display size (height:auto keeps ratio)
cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
const ctx = cv.getContext('2d');
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                        // all drawing below uses logical W,H
```

- Draw with the logical `W`/`H`, **not** `cv.width`/`cv.height` (those are now the larger backing
  store — using them would double-scale).
- For a canvas redrawn every frame, guard the resize (`if (cv.width !== Math.round(W*dpr)) { … }`)
  so an incremental (non-clearing) draw loop is not wiped each frame.
- Mouse/click mapping that uses `getBoundingClientRect()` normalized to `[0,1]` is unaffected by
  the backing-store change, so interaction keeps working.

When adding or reviewing a demo with canvas graphics, check that this dpr scaling is present.

---

## Site structure

- `index.html` — the root landing page; self-contained HTML (no Jekyll/build step)
- `README.md` — GitHub repo landing page; mirrors the index structure for repo visitors
- Each demo is a **self-contained, single-file HTML page** with all CSS and JS inlined
- Preview images live alongside their HTML file in the same subdirectory
- The site is deployed via **GitHub Pages** directly from the `main` branch (no build step)

## Current demos

### Nonlinear Systems

- **Nullclines & Jacobian Linearization Explorer** — `jacobian_linearization/nullclines-jacobian-explorer.html`
  Interactive explorer of how nullclines locate equilibria, what the Jacobian linearization reveals about their stability, and what the nullcline geometry can and cannot show on its own.

- **Lyapunov Level-Set Explorer** — `lyapunov_functions/lyapunov_explorer.html`
  Interactive exploration of Lyapunov functions and level-set curves for common nonlinear dynamical systems, plus sum-of-squares synthesis that builds the semidefinite program and exports runnable MATLAB and Python code.

- **Multi-Scroll Attractors & Hyperchaos** — `chaos/multiscroll_hyperchaos.html`
  Interactive primer on multi-scroll chaotic attractors and hyperchaos, with applications to image encryption.

### Statistics

- **Survival & Recurrent-Event Analysis Visualizer** — `survival_analysis/survival_recurrent_visualizer.html`
  Interactive exploration of exponential transition rates, right censoring, and recurrent events via survival curves and two-state transition models.

---

## Shared conventions

- **Accent color:** `#2e7d32` (dark green) — used in links and section headings
- **Copyright:** © Theodore P. Pavlic, MIT License (`LICENSE` file at repo root)
- **fb:app_id:** `2385695445236853` — include in all OG blocks
- **GitHub Pages base URL:** `https://tpavlic.github.io/topic_visualizers/`
- **YouTube channel:** <https://www.youtube.com/@TedPavlic> — linked from the index header
- **Google Analytics measurement ID:** `G-P0S68QRGVP` — include the gtag block in every demo's `<head>`, after the Twitter/X card lines and before any `<link>` or `<style>` tags
- **Git commits:** do **not** add a `Co-Authored-By: Claude` (or any AI co-author) trailer to commit messages
