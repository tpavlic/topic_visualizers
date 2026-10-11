// A box that scrolls sideways or down gives no sign of what lies beyond
// its edges until the reader tries, and the scrollbar the system draws
// hides itself on most laptops and phones. This marks every `.scroll-box`
// with the edges that have more content past them (`data-more="right
// bottom"`), which the page's CSS shades, and draws its own rail under a
// box that scrolls sideways: a track with a thumb that follows the scroll
// position, drags, and jumps on a tap, kept current as the box scrolls,
// resizes, or is replaced.

/**
 * Watches `root` for scroll boxes, present and future, marks their edges,
 * and rails the ones that scroll sideways.
 * @param {HTMLElement} root
 */
export function installScrollHints(root) {
  const rails = new WeakMap();   // scroll box -> its rail's elements

  const rail = el => {
    if (rails.has(el)) return rails.get(el);
    const r = document.createElement('div');
    r.className = 'scroll-rail';
    r.setAttribute('aria-hidden', 'true');
    r.hidden = true;
    r.innerHTML = '<div class="scroll-rail-track"><div class="scroll-rail-thumb"></div></div>';
    el.insertAdjacentElement('afterend', r);
    const track = r.firstElementChild, thumb = track.firstElementChild;
    const o = { rail: r, track, thumb };
    rails.set(el, o);
    // Dragging the thumb scrolls the box; a press on the track jumps a page toward it.
    let drag = null;
    thumb.addEventListener('pointerdown', ev => {
      drag = { x: ev.clientX, left: el.scrollLeft };
      thumb.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    });
    thumb.addEventListener('pointermove', ev => {
      if (!drag) return;
      el.scrollLeft = drag.left + (ev.clientX - drag.x) * el.scrollWidth / track.clientWidth;
    });
    const end = () => { drag = null; };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    track.addEventListener('pointerdown', ev => {
      if (ev.target === thumb) return;
      const at = (ev.clientX - track.getBoundingClientRect().left) * el.scrollWidth / track.clientWidth;
      el.scrollBy({ left: at < el.scrollLeft ? -el.clientWidth : el.clientWidth, behavior: 'smooth' });
    });
    return o;
  };

  const update = el => {
    const more = [];
    const across = el.scrollWidth > el.clientWidth + 1;
    if (el.scrollLeft > 1) more.push('left');
    if (el.scrollLeft + el.clientWidth < el.scrollWidth - 1) more.push('right');
    if (el.scrollTop > 1) more.push('top');
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 1) more.push('bottom');
    if (more.length) el.setAttribute('data-more', more.join(' ')); else el.removeAttribute('data-more');
    const o = across || rails.has(el) ? rail(el) : null;
    if (!o) return;
    o.rail.hidden = !across;
    if (!across) return;
    const w = o.track.clientWidth;
    const tw = Math.max(24, w * el.clientWidth / el.scrollWidth);
    const left = (w - tw) * el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth);
    o.thumb.style.width = tw + 'px';
    o.thumb.style.left = left + 'px';
  };
  const seen = new WeakSet();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => { for (const e of entries) update(e.target.closest('.scroll-box') || e.target); }) : null;
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
