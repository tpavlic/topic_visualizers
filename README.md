# Topic Visualizers

Interactive web demonstrations and other visualizations built by
[Theodore P. Pavlic](https://search.asu.edu/profile/1995237)
covering a range of topics in science, mathematics, statistics, and engineering.

**Live site:** <https://tpavlic.github.io/topic_visualizers/>

Each visualization is a self-contained HTML page that works standalone or can be embedded
in course management systems (e.g., Canvas LMS) as an iframe.

---

## Contents

### Nonlinear Systems

| Demo                                                 | Description                                                                                                                                                                                              |
|------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [`jacobian_linearization/`](jacobian_linearization/) | See how nullclines locate equilibria, what the Jacobian linearization reveals about their stability, and what the nullcline geometry can and cannot show on its own.                                     |
| [`lyapunov_functions/`](lyapunov_functions/)         | Explore Lyapunov functions and level-set curves for common nonlinear dynamical systems, then synthesize them automatically with sum-of-squares programming that exports runnable MATLAB and Python code. |
| [`chaos/`](chaos/)                                   | Explore multi-scroll chaotic attractors and hyperchaos, and how their dynamics underpin image-encryption schemes.                                                                                        |

### Statistics

| Demo                                         | Description                                                                                                                                     |
|----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| [`survival_analysis/`](survival_analysis/)   | Explore exponential transition rates, right censoring, and repeated events through interactive survival curves and two-state transition models. |

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
   <footer id="back-link-footer" style="max-width:CONTENT_MAX_WIDTH;margin:0 auto;padding:0 CONTENT_HPAD 1.5rem;">
     <div style="padding-top:0.75rem;border-top:1px solid #e0e0e0;font-size:0.8rem;color:#888;">
       <a href="../" style="color:#2e7d32;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">&larr; All visualizations</a>
     </div>
   </footer>
   <script>
   if (window.self !== window.top) { var f = document.getElementById('back-link-footer'); if (f) f.style.display = 'none'; }
   </script>
   ```

   Set `CONTENT_MAX_WIDTH` and `CONTENT_HPAD` to the `max-width` and horizontal `padding` of
   the page's main centered content container, so the back-link and its rule align with the
   page content (the `border-top` lives on the inner `<div>`, inside the padding, so its length
   matches the main footer's rule). The script hides the footer when the page is embedded in a
   Canvas iframe.

3. **Index entry** — add a `<li>` to the appropriate `<section>` in [`index.html`](index.html),
   following the existing pattern (thumbnail + title + one-sentence description). Create
   a new `<section class="demo-section">` block if no suitable section exists yet.

4. **README entry** — add a row to the appropriate table under `## Contents`.

---

## See also

Other projects by the same author that visitors here may find complementary:

* [Research Sandbox](https://tpavlic.github.io/research_sandbox/) — work-in-progress interactive demonstrations meant for communication and exploration of ideas related to ongoing research projects.
* [Bio-Inspired AI & Optimization — Course Visualizations](https://tpavlic.github.io/asu-bioinspired-ai-and-optimization/) — supplemental interactive explorers for *IEE/CSE 598: Bio-Inspired AI and Optimization* at Arizona State University, spanning genetic algorithms, swarm intelligence, neural networks, and other bio-inspired methods.
* [Notes, Documents, & Guides](https://github.com/tpavlic/docs-and-guides) — Markdown-formatted notes and instructional guides on a variety of fundamental and applied science and engineering topics.
* [Lectures and short video tutorials](https://www.youtube.com/@TedPavlic) on YouTube, including the [Office Hours](https://www.youtube.com/playlist?list=PLXBbGVSkQJqEFKCGlTbzBnvf96DRJ6_gi) playlist.

## License

Released under the [MIT License](LICENSE).
Copyright &copy; 2026 Theodore P. Pavlic.
