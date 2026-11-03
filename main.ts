import '@fontsource/marcellus/400.css';
import '@fontsource/barlow-semi-condensed/400.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import './styles.css';
import { restore, session } from './api.js';
import { mountHome } from './ui/home.js';
import { mountStats } from './ui/stats.js';
import { mountTable } from './ui/table.js';
import { toast } from './dom.js';

const root = document.getElementById('app')!;
let current: { dispose(): void } | null = null;

function nav(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  route();
}

async function route(message?: string) {
  current?.dispose();
  current = null;
  const path = location.pathname;
  const tableMatch = path.match(/^\/table\/([A-Za-z0-9]{6,8})\/?$/);
  const me = session.me ? await restore() : null;

  if (tableMatch) {
    const code = tableMatch[1].toUpperCase();
    if (!me) return mountHome(root, nav, { joinCode: code });
    document.title = `Table ${code} · Ultimate Texas Hold’em`;
    current = mountTable(root, code, (msg) => { history.pushState(null, '', '/'); route(msg); });
    return;
  }
  document.title = 'Ultimate Texas Hold’em';
  if (path === '/stats' && me) return mountStats(root, nav);
  if (path !== '/') history.replaceState(null, '', '/');
  mountHome(root, nav, { message });
}

window.addEventListener('popstate', () => route());
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('Something went wrong. Please try again.', 'error'); });
route();
