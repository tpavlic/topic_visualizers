# Topic Visualizers

Interactive web demonstrations built by
[Theodore P. Pavlic](https://search.asu.edu/profile/1995237)
covering a range of topics in science, mathematics, and engineering.

**Live site:** <https://tpavlic.github.io/topic_visualizers/>

Each visualization is a self-contained HTML page that works standalone or can be embedded
in course management systems (e.g., Canvas LMS) as an iframe.

---

## Contents

No visualizations yet — add entries here as demos are created.

---

## Adding a new visualization

Each visualization lives in its own subdirectory:

```bash
my_demo/
  my_demo.html          # self-contained page
  my_demo-preview.png   # preview image for OG/Twitter cards
```

For a new `my_demo.html`, the checklist is:

1. **`<head>` metadata:**

   * Include `<title>`, `<meta name="description">`, and the full Open Graph + Twitter
     card block (see any existing demo for the template)
   * Use the preview image as `og:image` and `twitter:image`; set width/height
     accurately
   * For Twitter/X, the image should be close to **2:1 aspect ratio**
     and under **5 MB**

2. **Back-link footer** — add at the bottom of `<body>`:

   ```html
   <footer style="margin-top:1.5rem;padding-top:0.75rem;border-top:1px solid #e0e0e0;font-size:0.8rem;color:#888;">
     <a href="../" style="color:#2e7d32;text-decoration:none;">&larr; All visualizations</a>
   </footer>
   <script>if (window.self !== window.top) { var f = document.querySelector('footer'); if (f) f.style.display = 'none'; }</script>
   ```

   The script hides the footer when the page is embedded in a Canvas iframe.

3. **Index entry** — add a `<li>` to the appropriate `<section>` in [`index.html`](index.html),
   following the existing pattern (thumbnail + title + one-sentence description). Create
   a new `<section class="demo-section">` block if no suitable section exists yet.

4. **README entry** — add a row to the appropriate table under `## Contents`.

---

## License

Released under the [MIT License](LICENSE).
Copyright &copy; 2026 Theodore P. Pavlic.
