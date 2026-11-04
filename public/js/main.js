// DXB MUN – menu, committee explorer, schedule, and lively effects

document.documentElement.classList.add('js');
var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var fine = window.matchMedia('(pointer: fine)').matches;
function $(id) { return document.getElementById(id); }

// ---------- Mobile menu ----------
var burger = $('burger');
var links = $('links');
burger.addEventListener('click', function () {
  var open = links.classList.toggle('open');
  burger.setAttribute('aria-expanded', open);
});
links.addEventListener('click', function (e) {
  if (e.target.tagName === 'A') {
    links.classList.remove('open');
    burger.setAttribute('aria-expanded', false);
  }
});

// ---------- Highlight the nav link of the section on screen ----------
var anchors = [].slice.call(links.querySelectorAll('a'));
if ('IntersectionObserver' in window) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        anchors.forEach(function (a) {
          a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id);
        });
      }
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('main section').forEach(function (s) { io.observe(s); });
}

// ---------- Confetti burst ----------
var COLORS = ['#F2B705', '#FF5A36', '#FFF1D0', '#7A1425', '#FFFFFF'];
function burst(x, y, n) {
  if (reduce || !document.body.animate) return;
  for (var i = 0; i < n; i++) {
    var p = document.createElement('i');
    p.className = 'pt';
    p.style.background = COLORS[i % COLORS.length];
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    document.body.appendChild(p);
    var a = Math.random() * Math.PI * 2;
    var d = 60 + Math.random() * 120;
    var dx = Math.cos(a) * d;
    var dy = Math.sin(a) * d - 40;
    var an = p.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: 'translate(' + dx + 'px,' + (dy + 90) + 'px) rotate(' + (Math.random() * 540 - 270) + 'deg)', opacity: 0 }
    ], { duration: 800 + Math.random() * 500, easing: 'cubic-bezier(.15,.7,.3,1)' });
    an.onfinish = (function (el) { return function () { el.remove(); }; })(p);
  }
}
function burstAt(el, n) {
  var r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, n);
}

// ---------- Committee explorer: cards, arrows, shuffle, search, keyboard, swipe ----------
var rail = $('rail');
var btns = [].slice.call(rail.querySelectorAll('button'));
var cur = 0;
var swapEls = ['cm-idx', 'cm-a', 'cm-n'].map($);
var spot = $('spot');

function show(i, animate, fromWheel) {
  cur = (i + btns.length) % btns.length;
  var b = btns[cur];
  btns.forEach(function (x) { x.removeAttribute('aria-current'); });
  b.setAttribute('aria-current', 'true');
  if (!fromWheel && wheelReady && mod(Math.round(target)) !== cur) spinTo(cur);
  $('cm-a').textContent = b.dataset.a;
  $('cm-n').textContent = b.dataset.n;
  $('cm-idx').textContent = ('0' + (cur + 1)).slice(-2) + ' / ' + btns.length;
  if (animate !== false && !reduce) {
    swapEls.forEach(function (el, k) {
      el.classList.remove('swap');
      void el.offsetWidth;
      el.style.animationDelay = (k * 60) + 'ms';
      el.classList.add('swap');
    });
  }
}

// next / previous committee that is not hidden by the search
function step(dir) {
  var n = btns.length, i = cur;
  for (var k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    if (!btns[i].hidden) { show(i); return; }
  }
}

btns.forEach(function (b, i) {
  b.addEventListener('click', function () {
    show(i);
    burstAt(b, 14);
    // if the big panel is scrolled out of view, bring it back
    if (spot.getBoundingClientRect().bottom < 60) {
      spot.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  });
});
$('prev').addEventListener('click', function () { step(-1); });
$('next').addEventListener('click', function () { step(1); });

$('shuffle').addEventListener('click', function (e) {
  var pool = btns.map(function (b, i) { return i; }).filter(function (i) { return !btns[i].hidden && i !== cur; });
  if (pool.length) show(pool[Math.floor(Math.random() * pool.length)]);
  burstAt(e.currentTarget, 22);
});

var search = $('cm-search');
var none = $('cm-none');
search.addEventListener('input', function () {
  var q = search.value.trim().toLowerCase();
  var first = -1;
  btns.forEach(function (b, i) {
    var ok = !q || b.dataset.a.toLowerCase().indexOf(q) > -1 || b.dataset.n.toLowerCase().indexOf(q) > -1;
    b.hidden = !ok;
    if (ok && first < 0) first = i;
  });
  none.hidden = first > -1;
  if (first > -1 && btns[cur].hidden) show(first);
});

// left / right arrow keys change the committee while that section is on screen
var cmSec = $('committees');
document.addEventListener('keydown', function (e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  var r = cmSec.getBoundingClientRect();
  if (!(r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.5)) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
});

// swipe the big panel on a phone
var sx = null;
spot.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
spot.addEventListener('touchend', function (e) {
  if (sx === null) return;
  var dx = e.changedTouches[0].clientX - sx;
  sx = null;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
}, { passive: true });

// scrolling strip of committee names
var track = $('track');
var names = btns.map(function (b) { return b.dataset.a; });
names.concat(names).forEach(function (n) {
  var s = document.createElement('span');
  s.textContent = n;
  track.appendChild(s);
});

// ---------- Schedule: day tabs (click or arrow keys) and pin-able rows ----------
var tabs = [].slice.call(document.querySelectorAll('.tabs button'));
function pick(t) {
  tabs.forEach(function (x) {
    var on = x === t;
    x.setAttribute('aria-selected', on);
    x.tabIndex = on ? 0 : -1;
    $('day-' + x.dataset.day).hidden = !on;
  });
}
tabs.forEach(function (t, i) {
  t.tabIndex = i === 0 ? 0 : -1;
  t.addEventListener('click', function () { pick(t); });
  t.addEventListener('keydown', function (e) {
    var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    var n = tabs[(i + d + tabs.length) % tabs.length];
    pick(n);
    n.focus();
  });
});
document.querySelectorAll('.tl li').forEach(function (li) {
  li.tabIndex = 0;
  li.addEventListener('click', function () { li.classList.toggle('pin'); });
  li.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.classList.toggle('pin'); }
  });
});

// ---------- Scroll progress bar and back-to-top button ----------
var bar = document.createElement('div');
bar.className = 'progress';
bar.setAttribute('aria-hidden', 'true');
document.body.appendChild(bar);

var toTop = document.createElement('a');
toTop.className = 'totop';
toTop.href = '#home';
toTop.setAttribute('aria-label', 'Back to top');
toTop.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
document.body.appendChild(toTop);

var ticking = false;
function onScroll() {
  var h = document.documentElement.scrollHeight - window.innerHeight;
  bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, window.scrollY / h) : 0) + ')';
  toTop.classList.toggle('show', window.scrollY > window.innerHeight * 0.6);
  ticking = false;
}
window.addEventListener('scroll', function () {
  if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
}, { passive: true });
onScroll();

// ---------- Things fade up as you scroll to them ----------
if ('IntersectionObserver' in window && !reduce) {
  var ro = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.head, .cards, .sticker, .spot, .toolbar, .grid, .tabs, .rowwrap, .foot-row, .stats div').forEach(function (el, i) {
    el.classList.add('rv');
    ro.observe(el);
  });
}

// ---------- Numbers count up when they come into view ----------
var nums = [].slice.call(document.querySelectorAll('[data-count]'));
if ('IntersectionObserver' in window && !reduce) {
  var co = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      co.unobserve(e.target);
      var el = e.target, end = +el.dataset.count, t0 = null;
      function tick(t) {
        if (t0 === null) t0 = t;
        var p = Math.min(1, (t - t0) / 1200);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.6 });
  nums.forEach(function (n) { co.observe(n); });
}

// ---------- Hero title: letters pop in and lift when you hover them ----------
var h1 = document.querySelector('.hero h1');
if (h1 && !reduce) {
  var text = h1.textContent.trim();
  var idx = 0;
  h1.setAttribute('aria-label', text);
  h1.textContent = '';
  text.split(' ').forEach(function (word, wi) {
    var w = document.createElement('span');
    w.className = 'w' + (wi === 1 ? ' w2' : '');
    w.setAttribute('aria-hidden', 'true');
    word.split('').forEach(function (ch) {
      var s = document.createElement('span');
      s.className = 'ch';
      s.style.setProperty('--i', idx++);
      s.textContent = ch;
      w.appendChild(s);
    });
    h1.appendChild(w);
  });
}

// ---------- Mouse effects (mouse users only): glow and 3D tilt ----------
if (fine && !reduce) {
  var glow = document.createElement('div');
  glow.className = 'glow';
  glow.setAttribute('aria-hidden', 'true');
  document.body.appendChild(glow);
  var mx = 0, my = 0, raf = 0;
  window.addEventListener('mousemove', function (e) {
    mx = e.clientX; my = e.clientY;
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      glow.style.transform = 'translate(' + (mx - 260) + 'px,' + (my - 260) + 'px)';
    });
  });

  var tilt = function (el, base, lift) {
    el.addEventListener('mousemove', function (e) {
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = base + ' perspective(700px) rotateX(' + (-py * 12) + 'deg) rotateY(' + (px * 14) + 'deg) translateY(' + lift + 'px)';
    });
    el.addEventListener('mouseleave', function () { el.style.transform = ''; });
  };
  btns.forEach(function (b) { tilt(b, '', -4); });
  var frame = document.querySelector('.frame');
  var sticker = document.querySelector('.sticker');
  if (frame) tilt(frame, 'rotate(3deg)', 0);
  if (sticker) tilt(sticker, 'rotate(-4deg)', 0);
}


// ---------- Committee wheel: scroll, drag, flick or tap to spin ----------
var wheel = $('wheel');
var wheelIn = $('wheel-in');
var wItems = [];
var wheelReady = false;
var pos = 0, target = 0, follow = false, wDirty = false, wRaf = 0, wIdle = 0;
var STEP = 22, RAD = 150, PX = 40;

function mod(a) { var n = btns.length; return ((a % n) + n) % n; }

btns.forEach(function (b) {
  var el = document.createElement('div');
  el.className = 'wi';
  el.id = 'wheel-option-' + wItems.length;
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', 'false');
  el.textContent = b.dataset.a;
  wheelIn.appendChild(el);
  wItems.push(el);
});

function renderWheel() {
  var n = btns.length;
  wItems.forEach(function (el, i) {
    var d = mod(i - pos);
    if (d > n / 2) d -= n;
    el.setAttribute('aria-selected', String(Math.abs(d) < 0.5));
    if (Math.abs(d) > 5) { el.style.visibility = 'hidden'; return; }
    el.style.visibility = 'visible';
    el.style.transform = 'rotateX(' + (-d * STEP) + 'deg) translateZ(' + RAD + 'px)';
    el.style.opacity = Math.max(0, 1 - Math.abs(d) * 0.18);
    el.classList.toggle('on', Math.abs(d) < 0.5);
  });
  wheel.setAttribute('aria-activedescendant', 'wheel-option-' + mod(Math.round(pos)));
}

wheel.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    step(1);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    e.stopPropagation();
    step(-1);
  }
});

function wheelFrame() {
  wRaf = 0;
  if (reduce) pos = target; else pos += (target - pos) * 0.2;
  var settled = Math.abs(target - pos) < 0.002;
  if (settled) pos = target;
  renderWheel();
  if (follow) {
    var idx = mod(Math.round(pos));
    if (idx !== cur) show(idx, false, true);
  }
  if (settled) {
    if (wDirty) { wDirty = false; show(mod(Math.round(pos)), true, true); }
    follow = false;
  } else {
    wRaf = requestAnimationFrame(wheelFrame);
  }
}
function kick() { if (!wRaf) wRaf = requestAnimationFrame(wheelFrame); }

// turn the wheel the short way round to committee i
function spinTo(i) {
  var n = btns.length;
  var d = mod(i - Math.round(pos));
  if (d > n / 2) d -= n;
  target = Math.round(pos) + d;
  kick();
}

// mouse wheel / trackpad over the wheel (the page does not scroll while you are over it)
wheel.addEventListener('wheel', function (e) {
  e.preventDefault();
  var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  target += Math.max(-1.5, Math.min(1.5, dy / 110));
  follow = true;
  wDirty = true;
  clearTimeout(wIdle);
  wIdle = setTimeout(function () { target = Math.round(target); kick(); }, 140);
  kick();
}, { passive: false });

// drag or flick; a short tap on a name spins to it
var drag = null;
wheel.addEventListener('pointerdown', function (e) {
  if (e.button !== undefined && e.button !== 0) return;
  var it = e.target.closest ? e.target.closest('.wi') : null;
  drag = { y: e.clientY, t: target, id: e.pointerId, moved: false, item: it ? wItems.indexOf(it) : -1, ly: e.clientY, lt: e.timeStamp, vy: 0 };
});
wheel.addEventListener('pointermove', function (e) {
  if (!drag) return;
  var dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dy) > 6) {
    drag.moved = true;
    try { wheel.setPointerCapture(drag.id); } catch (x) {}
    wheel.classList.add('drag');
  }
  if (!drag.moved) return;
  var dt = e.timeStamp - drag.lt;
  if (dt > 0) drag.vy = (e.clientY - drag.ly) / dt;
  drag.ly = e.clientY;
  drag.lt = e.timeStamp;
  target = drag.t - dy / PX;
  follow = true;
  wDirty = true;
  kick();
});
function endDrag() {
  if (!drag) return;
  var d = drag;
  drag = null;
  wheel.classList.remove('drag');
  if (d.moved) {
    var fling = Math.max(-8, Math.min(8, -d.vy * 220 / PX));
    target = Math.round(target + fling);
    kick();
  } else if (d.item > -1) {
    spinTo(d.item);
    show(d.item);
    burstAt(wheel, 16);
  }
}
wheel.addEventListener('pointerup', endDrag);
wheel.addEventListener('pointercancel', endDrag);

renderWheel();
wheelReady = true;
