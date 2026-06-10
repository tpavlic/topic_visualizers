# CLAUDE.md — conventions for this repository

This repository hosts standalone interactive web demonstrations and other visualizations on
topics in science, mathematics, statistics, and engineering, built by Theodore P. Pavlic. The live site is at
<https://tpavlic.github.io/topic_visualizers/>.

---

## Registering an existing visualization

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

**Ampersands in OG/Twitter `content` titles:** use a literal `&`, not the `&amp;` entity, in
the `og:title`, `twitter:title`, and description `content` attributes. Although `&amp;` is the
technically correct HTML encoding (parsers decode it in attribute values), many card scrapers —
Slack's notably — read the `content` string without decoding entities and display the literal
`&amp;`. A bare `&` followed by a space is not an ambiguous ampersand, so it stays valid HTML.
(The page `<title>` already renders a literal `&` fine.)

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
    <a href="../" style="color:#2e7d32;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">&larr; All visualizations</a>
  </div>
</footer>
<script>
if (window.self !== window.top) { var f = document.getElementById('back-link-footer'); if (f) f.style.display = 'none'; }
</script>
```

The `<script>` hides the footer when the page is embedded in a Canvas LMS iframe.

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

## Site structure

- `index.html` — the root landing page; self-contained HTML (no Jekyll/build step)
- `README.md` — GitHub repo landing page; mirrors the index structure for repo visitors
- Each demo is a **self-contained, single-file HTML page** with all CSS and JS inlined
- Preview images live alongside their HTML file in the same subdirectory
- The site is deployed via **GitHub Pages** directly from the `main` branch (no build step)

## Current demos

### Nonlinear Systems

- **Lyapunov Level-Set Explorer** — `lyapunov_functions/lyapunov_explorer.html`
  Interactive exploration of Lyapunov functions and level-set curves for common nonlinear dynamical systems.

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
