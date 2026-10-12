// ไอคอน SVG
import { html, raw } from "./html.js";

export const svg = (d, s = 20) => raw(`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);

export const ICON = {
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2"/>',
  my: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  queue: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  report: '<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M8 3v3M16 3v3M8 14h3M8 17h6"/>',
  users: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c.6-3.6 3.2-5.5 6.5-5.5 1.5 0 2.8.4 3.9 1.1"/><circle cx="18" cy="17" r="2.2"/><path d="M18 13v1.6M18 19.4V21M21.5 17h-1.3M15.8 17h-1.3"/>',
  lines: '<path d="M6 3v18M6 8c0 3 3 4 6 4s6 1 6 4v5"/><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l3 3M14.5 8.5l2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  mark: '<path d="M4 7h16v12H4z" stroke="none" fill="none"/><path d="M5 9.5 12 5l7 4.5M6 10v7M10 10v7M14 10v7M18 10v7M4 19h16"/>',
};

export const BRAND = html`<span class="brand-mark">${svg(ICON.mark, 20)}</span>`;
