// REST client + guest identity. The token is a bearer secret kept in localStorage so a refresh
// or a new tab restores the same player, bankrolls and seats.

export interface Me { id: string; name: string; avatar: string }

const TOKEN_KEY = 'uth.token';
const ME_KEY = 'uth.me';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get me(): Me | null { try { return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null'); } catch { return null; } },
  save(token: string, me: Me) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(ME_KEY, JSON.stringify(me)); },
  setMe(me: Me) { localStorage.setItem(ME_KEY, JSON.stringify(me)); },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(ME_KEY); },
};

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  const r = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as object) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error ?? `Request failed (${r.status})`), { status: r.status });
  return body as T;
}

export async function signIn(name: string): Promise<Me> {
  const r = await api<{ player: Me; token: string }>('/api/guest', { method: 'POST', body: JSON.stringify({ name }) });
  session.save(r.token, r.player);
  return r.player;
}

/** Confirms the stored token still works (e.g. after a database reset). */
export async function restore(): Promise<Me | null> {
  if (!session.token) return null;
  try {
    const r = await api<{ player: Me }>('/api/me');
    session.setMe(r.player);
    return r.player;
  } catch (e: any) {
    if (e.status === 401) session.clear();
    return session.me && session.token ? session.me : null;
  }
}
