// A box that scrolls sideways or down gives no sign of what lies beyond
// its edges until the reader tries. This marks every `.scroll-box` with the
// edges that have more content past them (`data-more="right bottom"`), kept
// current as the box scrolls, resizes, or is replaced, and the page's CSS
// shades those edges.

/**
 * Watches `root` for scroll boxes, present and future, and marks their edges.
 * @param {HTMLElement} root
 */
export function installScrollHints(root) {
  const update = el => {
    const more = [];
    if (el.scrollLeft > 1) more.push('left');
    if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) more.push('right');
    if (el.scrollTop > 1) more.push('top');
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) more.push('bottom');
    if (more.length) el.setAttribute('data-more', more.join(' ')); else el.removeAttribute('data-more');
  };
  const seen = new WeakSet();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => { for (const e of entries) update(e.target); }) : null;
  const attach = el => {
    if (seen.has(el)) return;
    seen.add(el);
    el.addEventListener('scroll', () => update(el), { passive: true });
    if (ro) ro.observe(el);
    // The content inside may change size without the box changing its own.
    if (ro && el.firstElementChild) ro.observe(el.firstElementChild);
    update(el);
  };
  const scan = node => {
    if (!node || node.nodeType !== 1) return;
    if (node.matches('.scroll-box')) attach(node);
    node.querySelectorAll('.scroll-box').forEach(attach);
  };
  scan(root);
  new MutationObserver(muts => { for (const m of muts) m.addedNodes.forEach(scan); }).observe(root, { childList: true, subtree: true });
  const all = () => root.querySelectorAll('.scroll-box').forEach(update);
  window.addEventListener('resize', all);
  window.addEventListener('hashchange', () => setTimeout(all, 50));
}
