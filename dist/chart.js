const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n * 100) / 100));
/** Render a dependency-free SVG bar or line chart. */
export function renderSvg(type, points, opts = {}) {
    const W = 900, H = 520, m = { t: 60, r: 30, b: 110, l: 80 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = Math.max(0, ...points.map((p) => p.value));
    const min = Math.min(0, ...points.map((p) => p.value));
    const span = max - min || 1;
    const y = (v) => m.t + ih - ((v - min) / span) * ih;
    const step = iw / Math.max(1, points.length);
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter,Helvetica,Arial,sans-serif">`);
    parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
    if (opts.title)
        parts.push(`<text x="${W / 2}" y="34" text-anchor="middle" font-size="20" font-weight="600" fill="#111827">${esc(opts.title)}</text>`);
    for (let i = 0; i <= 5; i++) {
        const v = min + (span * i) / 5;
        const yy = y(v);
        parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="#e5e7eb"/>`);
        parts.push(`<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end" font-size="12" fill="#6b7280">${fmt(v)}</text>`);
    }
    parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}" stroke="#9ca3af"/>`);
    const labelEvery = Math.ceil(points.length / 30);
    points.forEach((p, i) => {
        const cx = m.l + step * i + step / 2;
        if (i % labelEvery === 0) {
            const lbl = p.label.length > 16 ? p.label.slice(0, 15) + "…" : p.label;
            parts.push(`<text transform="translate(${cx},${m.t + ih + 14}) rotate(40)" font-size="11" fill="#374151">${esc(lbl)}</text>`);
        }
    });
    if (type === "bar") {
        points.forEach((p, i) => {
            const bw = Math.max(1, step * 0.7);
            const x = m.l + step * i + (step - bw) / 2;
            const top = Math.min(y(p.value), y(0));
            parts.push(`<rect x="${x}" y="${top}" width="${bw}" height="${Math.abs(y(p.value) - y(0))}" fill="#4f46e5" rx="2"><title>${esc(p.label)}: ${p.value}</title></rect>`);
        });
    }
    else {
        const d = points.map((p, i) => `${i ? "L" : "M"}${m.l + step * i + step / 2},${y(p.value)}`).join(" ");
        parts.push(`<path d="${d}" fill="none" stroke="#4f46e5" stroke-width="2.5"/>`);
        points.forEach((p, i) => parts.push(`<circle cx="${m.l + step * i + step / 2}" cy="${y(p.value)}" r="3" fill="#4f46e5"><title>${esc(p.label)}: ${p.value}</title></circle>`));
    }
    if (opts.yLabel)
        parts.push(`<text transform="translate(18,${m.t + ih / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#374151">${esc(opts.yLabel)}</text>`);
    if (opts.xLabel)
        parts.push(`<text x="${m.l + iw / 2}" y="${H - 12}" text-anchor="middle" font-size="13" fill="#374151">${esc(opts.xLabel)}</text>`);
    parts.push(`</svg>`);
    return parts.join("\n");
}
