// Tiny DOM helpers. All user-provided text goes through textContent — never innerHTML.

type Attrs = Record<string, string | number | boolean | undefined | null | ((e: any) => void)>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(markup: string): SVGElement {
  // Only used with static, developer-authored markup.
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as SVGElement;
}

export function toast(msg: string, kind: 'info' | 'error' | 'success' = 'info', ms = 3800) {
  const box = document.getElementById('toasts')!;
  const t = h('div', { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

export function modal(title: string, body: Node, opts: { wide?: boolean; onClose?: () => void } = {}) {
  const close = () => { wrap.remove(); document.removeEventListener('keydown', esc); opts.onClose?.(); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const panel = h('div', { class: `modal ${opts.wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, body));
  const wrap = h('div', { class: 'modal-wrap', onclick: (e: MouseEvent) => { if (e.target === wrap) close(); } }, panel);
  document.body.append(wrap);
  document.addEventListener('keydown', esc);
  (panel.querySelector('input,button:not(.icon-btn),select') as HTMLElement | null)?.focus();
  return { close, panel };
}

/** Compact money for tight spaces (seat plates): $1.25M, $3.4B. Exact amounts stay in tooltips and breakdowns. */
export const moneyShort = (cents: number) => {
  const a = Math.abs(cents) / 100;
  if (a < 1_000_000) return money(cents);
  const [v, u] = a >= 1e12 ? [a / 1e12, 'T'] : a >= 1e9 ? [a / 1e9, 'B'] : [a / 1e6, 'M'];
  return `${cents < 0 ? '−' : ''}$${(Math.floor(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}${u}`;
};
export const money = (cents: number, sign = false) => {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const s = '$' + Math.floor(a / 100).toLocaleString('en-US') + (a % 100 ? '.' + String(a % 100).padStart(2, '0') : '');
  return neg ? '−' + s : sign && cents > 0 ? '+' + s : s;
};

export const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
