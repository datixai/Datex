// Twinkling starfield with the odd shooting star, drawn on a canvas that fills its parent.
export function starfield(canvas, { density = 0.00018, shooting = true } = {}) {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, stars = [], shot = null, raf = 0, last = 0;
  const color = () => getComputedStyle(document.body).getPropertyValue('--star').trim() || '#fff';

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(w * h * density);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() < 0.08 ? 1.6 : Math.random() * 1.1 + 0.3,
      a: Math.random(), s: 0.4 + Math.random() * 1.6, p: Math.random() * Math.PI * 2, dx: (Math.random() - 0.5) * 0.02
    }));
  }

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 33) return; // about 30 fps is plenty
    const dt = last ? (t - last) / 1000 : 0; last = t;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color();
    for (const s of stars) {
      s.x += s.dx; if (s.x < 0) s.x = w; if (s.x > w) s.x = 0;
      ctx.globalAlpha = reduce ? s.a * 0.8 + 0.2 : 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t / 1000 * s.s + s.p)) * s.a;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      if (s.r > 1.5) { ctx.globalAlpha *= 0.35; ctx.fillRect(s.x - 4, s.y - 0.3, 8, 0.6); ctx.fillRect(s.x - 0.3, s.y - 4, 0.6, 8); }
    }
    if (shooting && !reduce) {
      if (!shot && Math.random() < dt * 0.12) shot = { x: Math.random() * w * 0.7 + w * 0.2, y: Math.random() * h * 0.4, life: 0 };
      if (shot) {
        shot.life += dt;
        const k = shot.life / 0.9, x = shot.x - k * 260, y = shot.y + k * 130;
        const g = ctx.createLinearGradient(x, y, x + 90, y - 45);
        g.addColorStop(0, color()); g.addColorStop(1, 'transparent');
        ctx.globalAlpha = Math.max(0, 1 - k); ctx.strokeStyle = g; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 90, y - 45); ctx.stroke();
        if (k >= 1) shot = null;
      }
    }
    ctx.globalAlpha = 1;
  }

  const ro = new ResizeObserver(resize); ro.observe(canvas);
  resize(); raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
