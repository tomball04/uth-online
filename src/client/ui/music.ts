// §40 Table music — Spotify "listen along".
//
// The host's browser reads what the host's own Spotify is playing and shares only the track and position with the
// table. Every listener plays that track on THEIR OWN Spotify account (in this tab through the Web Playback SDK, or
// on their Spotify app), kept in step with the host. No audio ever passes through this server: Spotify does not
// allow rebroadcasting, and each person streams under their own (Premium) account.
//
// Auth is OAuth Authorization Code + PKCE entirely in the browser: a public Client ID, no secret, tokens kept on
// this device only (never sent to our server).
import { musicPosition, type MusicNow, type MusicState } from '../../shared/protocol.js';
import { h, modal, toast } from '../dom.js';
import { call, getSocket } from '../net.js';

const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing';
const TOKENS = 'uth.spotify';
const PKCE = 'uth.spotify.pkce';
const VOL = 'uth.spotify.vol';
const redirectUri = () => `${location.origin}/spotify-callback`;

// ---------------------------------------------------------------- config + tokens
let configP: Promise<string> | null = null;
export function spotifyClientId(): Promise<string> {
  configP ??= fetch('/api/music/config').then((r) => r.json()).then((j) => String(j.spotifyClientId ?? '')).catch(() => '');
  return configP;
}

interface Tokens { access: string; refresh: string; expiresAt: number }
const load = (): Tokens | null => { try { return JSON.parse(localStorage.getItem(TOKENS) ?? 'null'); } catch { return null; } };
const save = (t: Tokens | null) => { try { t ? localStorage.setItem(TOKENS, JSON.stringify(t)) : localStorage.removeItem(TOKENS); } catch { /* private mode */ } };
export const spotifyLinked = () => !!load();
export function spotifyUnlink() { save(null); }

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** Send the browser to Spotify's consent page; it comes back to /spotify-callback, then to `returnTo`. */
export async function spotifyLogin(returnTo = location.pathname + location.search) {
  const clientId = await spotifyClientId();
  if (!clientId) { toast('Spotify is not set up on this server.', 'error'); return; }
  const verifier = rand(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = rand(16);
  sessionStorage.setItem(PKCE, JSON.stringify({ verifier, state, returnTo }));
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirectUri(),
    code_challenge_method: 'S256', code_challenge: challenge, state });
  location.assign(`https://accounts.spotify.com/authorize?${q}`);
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `Spotify sign-in failed (${r.status}).`);
  const t = { access: j.access_token, refresh: j.refresh_token ?? load()?.refresh ?? '', expiresAt: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  save(t);
  return t;
}

/** Handles /spotify-callback. Returns where to go next (the table the person came from). */
export async function finishSpotifyLogin(): Promise<string> {
  const q = new URLSearchParams(location.search);
  let saved: { verifier: string; state: string; returnTo: string } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem(PKCE) ?? 'null'); } catch { /* ignore */ }
  sessionStorage.removeItem(PKCE);
  const back = saved?.returnTo?.startsWith('/') && !saved.returnTo.startsWith('//') ? saved.returnTo : '/';
  try {
    if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : `Spotify: ${q.get('error')}`);
    if (!saved || !q.get('code') || q.get('state') !== saved.state) throw new Error('Spotify sign-in expired. Please try again.');
    await tokenRequest({ grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: redirectUri(),
      client_id: await spotifyClientId(), code_verifier: saved.verifier });
    toast('Spotify connected.', 'success');
  } catch (e) { toast((e as Error).message, 'error', 6000); }
  return back;
}

let refreshing: Promise<Tokens> | null = null;
async function accessToken(): Promise<string> {
  const t = load();
  if (!t) throw new SpotifyError(401, 'Connect Spotify first.');
  if (t.expiresAt - Date.now() > 60_000) return t.access;
  refreshing ??= (async () => tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: await spotifyClientId() }))()
    .catch((e) => { save(null); throw new SpotifyError(401, `Spotify sign-in expired — connect again. (${(e as Error).message})`); })
    .finally(() => { refreshing = null; });
  return (await refreshing).access;
}

export class SpotifyError extends Error { constructor(public status: number, msg: string, public reason = '') { super(msg); } }

/** Spotify Web API call. 204 → null. Explains the usual 403/404s in plain words. */
async function sp<T = any>(path: string, init: RequestInit = {}, retry = true): Promise<T | null> {
  const r = await fetch(`https://api.spotify.com/v1${path}`, { ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (r.status === 401 && retry) { const t = load(); if (t) save({ ...t, expiresAt: 0 }); return sp(path, init, false); }
  if (r.status === 204 || r.status === 202) return null;
  const j = await r.json().catch(() => null);
  if (r.ok) return j as T;
  const reason = j?.error?.reason ?? '';
  const msg = reason === 'PREMIUM_REQUIRED' ? 'Spotify only lets Premium accounts control playback.'
    : reason === 'NO_ACTIVE_DEVICE' || r.status === 404 ? 'No active Spotify device. Open Spotify on this device, start any song, then try again.'
    : r.status === 403 ? 'Spotify refused. You need Premium, and the host’s Spotify app must have your account on its user list.'
    : r.status === 429 ? 'Spotify is rate-limiting — try again in a moment.'
    : j?.error?.message ?? `Spotify error ${r.status}.`;
  throw new SpotifyError(r.status, msg, reason);
}

// ---------------------------------------------------------------- Web Playback SDK (desktop browsers)
declare global { interface Window { Spotify?: any; onSpotifyWebPlaybackSDKReady?: () => void } }
let sdkP: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdkP ??= new Promise((res, rej) => {
    if (window.Spotify) return res();
    window.onSpotifyWebPlaybackSDKReady = () => res();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => { sdkP = null; rej(new Error('Could not load the Spotify player.')); };
    document.head.append(s);
    setTimeout(() => rej(new Error('The Spotify player took too long to load.')), 15000);
  });
  return sdkP;
}
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const trackId = (uri: string) => uri.split(':')[2] ?? '';
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- the table's music controller
export interface MusicDeps { code: string; isHost: () => boolean; solo: () => boolean }
const SHARE = 'uth.music.share';

export function mountMusic(deps: MusicDeps) {
  const sock = getSocket();
  let music: MusicState | null = null;
  let offset = 0;                       // serverNow - Date.now()
  let enabled = false;                  // a Client ID is configured on this server
  let sharing = false;                  // I'm the host and sharing my Spotify
  let lastSent: (MusicNow & { at: number }) | null = null;
  let mode: 'off' | 'browser' | 'app' = 'off';
  let player: any = null;
  let deviceId = '';
  let busy = false;
  let status = '';
  let open: { close(): void; panel: HTMLElement } | null = null;
  let disposed = false;

  const label = h('span', { class: 'mu-label hide-m' });
  const button = h('button', { class: 'ghost music-btn', hidden: true, title: 'Table music (Spotify)', 'aria-label': 'Table music', onclick: () => openPanel() },
    h('span', { class: 'mu-note', 'aria-hidden': 'true' }, '♫'), label);

  void spotifyClientId().then((id) => { enabled = !!id; render(); });
  // A host who refreshes (or comes back from Spotify sign-in) keeps sharing at the same table.
  let resume = false;
  try { resume = sessionStorage.getItem(SHARE) === deps.code; } catch { /* */ }

  const onState = (p: { music: MusicState | null; serverNow: number }) => {
    offset = p.serverNow - Date.now();
    const was = music;
    music = p.music;
    if (!music && was && mode !== 'off') { status = 'The host stopped sharing.'; void pauseMine(); }
    if (music && mode !== 'off') void sync(was?.uri !== music.uri || was?.isPlaying !== music.isPlaying);
    render();
  };
  sock.on('music:state', onState);
  const hostPoll = window.setInterval(() => {
    if (resume && enabled && deps.isHost() && spotifyLinked()) { resume = false; sharing = true; }
    if (sharing) void pollHost();
  }, 4000);
  // The in-tab player is checked every 3s (local, free); the Spotify app every 6s (a Web API call each time).
  let ticks = 0;
  const listenPoll = window.setInterval(() => { if (mode !== 'off' && music && (mode === 'browser' || ++ticks % 2 === 0)) void sync(false); }, 3000);
  const paint = window.setInterval(() => { if (open && music) renderPanel(); }, 1000);

  // ---- host side
  async function startSharing() {
    if (!spotifyLinked()) return spotifyLogin();
    sharing = true; lastSent = null; try { sessionStorage.setItem(SHARE, deps.code); } catch { /* */ } status = 'Sharing — play something on Spotify (phone, desktop app or web player).';
    await pollHost(); render();
  }
  async function stopSharing() {
    sharing = false; lastSent = null; try { sessionStorage.removeItem(SHARE); } catch { /* */ }
    await call('music:stop'); render();
  }
  async function pollHost() {
    if (!deps.isHost()) { if (sharing) { sharing = false; status = 'You are no longer the host.'; render(); } return; }
    try {
      const r = await sp<any>('/me/player/currently-playing?additional_types=track');
      const item = r?.item;
      if (!item || item.type !== 'track' || !item.uri || item.is_local) {
        if (music) await call('music:stop');
        lastSent = null; status = r?.currently_playing_type === 'episode' ? 'Podcasts can’t be shared — play a song.' : 'Nothing playing on your Spotify yet.';
        render(); return;
      }
      const now: MusicNow = { uri: item.linked_from?.uri ?? item.uri, name: item.name, artist: (item.artists ?? []).map((a: any) => a.name).join(', '),
        art: (item.album?.images ?? []).slice(-2)[0]?.url ?? null, durationMs: item.duration_ms, progressMs: r.progress_ms ?? 0, isPlaying: !!r.is_playing };
      // Only tell the table about real changes (track, play/pause, a seek), plus a heartbeat every 20s.
      const t = Date.now();
      const expected = lastSent ? (lastSent.isPlaying ? lastSent.progressMs + (t - lastSent.at) : lastSent.progressMs) : -1;
      const changed = !lastSent || lastSent.uri !== now.uri || lastSent.isPlaying !== now.isPlaying || Math.abs(expected - now.progressMs) > 2000 || t - lastSent.at > 20000;
      if (changed) {
        const a = await call('music:now', now);
        if (!a.ok) { status = a.error; if (/host/.test(a.error)) sharing = false; }
        else { lastSent = { ...now, at: t }; status = 'Sharing with the table.'; }
      }
    } catch (e) {
      status = (e as Error).message;
      if (e instanceof SpotifyError && e.status === 401) sharing = false;
    }
    render();
  }

  // ---- listener side
  async function listen(how: 'browser' | 'app') {
    if (!spotifyLinked()) return spotifyLogin();
    if (busy) return;
    busy = true; status = how === 'browser' ? 'Starting the Spotify player in this tab…' : 'Connecting to your Spotify app…'; render();
    try {
      if (how === 'browser') await startBrowserPlayer();
      mode = how;
      await sync(true);
      status = how === 'browser' ? 'Listening along in this tab.' : 'Listening along on your Spotify app.';
    } catch (e) {
      mode = 'off';
      status = (e as Error).message;
      if (how === 'browser') status += ' You can still use “Play on my Spotify app”.';
    } finally { busy = false; render(); }
  }

  async function startBrowserPlayer() {
    if (player && deviceId) return;
    await loadSdk();
    await new Promise<void>((res, rej) => {
      const vol = Number(localStorage.getItem(VOL) ?? 0.6);
      player = new window.Spotify.Player({ name: 'UTH Table', volume: vol, getOAuthToken: (cb: (t: string) => void) => { accessToken().then(cb).catch(() => {}); } });
      const fail = (m: string) => (e: { message: string }) => { rej(new Error(`${m}${e?.message ? ` (${e.message})` : ''}`)); };
      player.addListener('ready', ({ device_id }: { device_id: string }) => { deviceId = device_id; res(); });
      player.addListener('not_ready', () => { deviceId = ''; });
      player.addListener('initialization_error', fail('This browser can’t play Spotify here.'));
      player.addListener('authentication_error', fail('Spotify sign-in problem — connect again.'));
      player.addListener('account_error', fail('Listening in the browser needs Spotify Premium.'));
      player.addListener('autoplay_failed', () => { status = 'Your browser blocked autoplay — tap Listen again.'; render(); });
      player.activateElement?.();   // must run inside the click for Safari/mobile autoplay
      player.connect().then((ok: boolean) => { if (!ok) rej(new Error('Could not connect the Spotify player.')); });
      setTimeout(() => rej(new Error('The Spotify player did not start.')), 15000);
    });
  }

  async function pauseMine() {
    try {
      if (mode === 'browser') await player?.pause();
      else if (mode === 'app') await sp('/me/player/pause', { method: 'PUT' });
    } catch { /* already paused / no device */ }
  }

  async function stopListening() {
    await pauseMine();
    if (player) { player.disconnect(); player = null; deviceId = ''; }
    mode = 'off'; status = ''; render();
  }

  let syncing = false;
  /** Bring my player in line with the host: same track, same play/pause, within ~2.5s. */
  async function sync(force: boolean) {
    if (syncing || mode === 'off' || !music) return;
    syncing = true;
    const m = music;
    try {
      const want = musicPosition(m, Date.now() + offset);
      let cur: { uri: string; pos: number; paused: boolean } | null = null;
      if (mode === 'browser') {
        const st = await player?.getCurrentState();
        const t = st?.track_window?.current_track;
        if (st && t) cur = { uri: t.linked_from?.uri ?? t.uri, pos: st.position, paused: st.paused };
      } else {
        const r = await sp<any>('/me/player');
        if (r?.item) cur = { uri: r.item.linked_from?.uri ?? r.item.uri, pos: r.progress_ms ?? 0, paused: !r.is_playing };
      }
      const same = cur && trackId(cur.uri) === trackId(m.uri);
      if (!same || (force && m.isPlaying && cur!.paused)) {
        if (!m.isPlaying && !same && !force) return;
        const q = mode === 'browser' ? `?device_id=${encodeURIComponent(deviceId)}` : '';
        await sp(`/me/player/play${q}`, { method: 'PUT', body: JSON.stringify({ uris: [m.uri], position_ms: Math.floor(want) }) });
        if (!m.isPlaying) await pauseMine();
        return;
      }
      if (!m.isPlaying && !cur!.paused) return void (await pauseMine());
      if (m.isPlaying && cur!.paused) {
        if (mode === 'browser') { await player.seek(Math.floor(want)); await player.resume(); }
        else await sp(`/me/player/play`, { method: 'PUT', body: JSON.stringify({ uris: [m.uri], position_ms: Math.floor(want) }) });
        return;
      }
      if (m.isPlaying && Math.abs(cur!.pos - want) > 2500) {
        if (mode === 'browser') await player.seek(Math.floor(want));
        else await sp(`/me/player/seek?position_ms=${Math.floor(want)}`, { method: 'PUT' });
      }
    } catch (e) {
      status = (e as Error).message;
      if (e instanceof SpotifyError && (e.status === 401 || e.status === 403)) { mode = 'off'; if (player) { player.disconnect(); player = null; deviceId = ''; } }
      render();
    } finally { syncing = false; }
  }

  // ---- UI
  function render() {
    if (disposed) return;
    const visible = !deps.solo() && (enabled || !!music);
    button.hidden = !visible;
    button.classList.toggle('on', !!music);
    button.classList.toggle('live', mode !== 'off' || sharing);
    label.textContent = music ? ` ${music.name}` : ' Music';
    button.title = music ? `${music.name}${music.artist ? ` — ${music.artist}` : ''} · shared by ${music.hostName}` : 'Table music (Spotify)';
    if (open) renderPanel();
  }

  const body = h('div', { class: 'music-panel' });
  function openPanel() {
    open = modal('Table music', body, { onClose: () => { open = null; } });
    renderPanel();
  }

  function renderPanel() {
    const m = music;
    const host = deps.isHost();
    const btn = (text: string, fn: () => void, cls = 'btn') => h('button', { class: cls, disabled: busy, onclick: fn }, text);
    const now = m
      ? h('div', { class: 'mu-now' },
          m.art ? h('img', { class: 'mu-art', src: m.art, alt: '', width: 64, height: 64 }) : h('div', { class: 'mu-art mu-art-empty' }, '♫'),
          h('div', { class: 'mu-meta' },
            h('b', {}, m.name), h('span', {}, m.artist),
            h('small', {}, `${m.isPlaying ? 'Playing' : 'Paused'} · ${fmt(musicPosition(m, Date.now() + offset))} / ${fmt(m.durationMs)} · shared by ${m.hostName}`),
            h('a', { class: 'link', href: `https://open.spotify.com/track/${trackId(m.uri)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Open in Spotify ↗')))
      : h('p', { class: 'muted' }, host ? 'Share what you’re playing on Spotify and everyone at the table can listen along on their own Spotify.'
          : 'The host isn’t sharing music right now.');

    const hostRow = host && enabled
      ? h('div', { class: 'mu-section' }, h('h3', {}, 'Host'),
          sharing ? btn('Stop sharing', () => void stopSharing())
            : btn(spotifyLinked() ? 'Share what I’m playing' : 'Connect Spotify to share', () => void startSharing(), 'btn primary'))
      : null;

    let vol: HTMLInputElement | null = null;
    const listenRow = m && enabled && !(host && sharing)
      ? h('div', { class: 'mu-section' }, h('h3', {}, 'Listen along'),
          mode === 'off'
            ? h('div', { class: 'row' },
                !isMobile() ? btn(spotifyLinked() ? 'Listen here' : 'Connect Spotify to listen', () => void listen('browser'), 'btn primary') : null,
                spotifyLinked() ? btn('Play on my Spotify app', () => void listen('app'), isMobile() ? 'btn primary' : 'btn')
                  : isMobile() ? btn('Connect Spotify to listen', () => void spotifyLogin(), 'btn primary') : null)
            : h('div', { class: 'row' }, btn('Stop listening', () => void stopListening()), btn('Re-sync', () => void sync(true))),
          mode === 'browser' ? (vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, class: 'mu-vol', 'aria-label': 'Music volume',
            value: localStorage.getItem(VOL) ?? '0.6' }) as HTMLInputElement) : null)
      : null;
    vol?.addEventListener('input', () => { const v = Number(vol!.value); try { localStorage.setItem(VOL, String(v)); } catch { /* */ } player?.setVolume(v); });

    const foot = h('div', { class: 'mu-foot' },
      status ? h('p', { class: 'mu-status', role: 'status' }, status) : null,
      !enabled ? h('p', { class: 'muted' }, 'Spotify isn’t set up on this server (SPOTIFY_CLIENT_ID).') : null,
      h('p', { class: 'muted small' }, 'Each person plays the song on their own Spotify account — audio isn’t streamed through the table. Spotify requires Premium to control playback, and while the app is in Development Mode only accounts the host adds to the app (up to 5) can sign in.'),
      spotifyLinked() ? h('button', { class: 'link', onclick: () => { void stopListening(); if (sharing) void stopSharing(); spotifyUnlink(); toast('Spotify disconnected from this device.'); renderPanel(); } }, 'Disconnect Spotify on this device') : null);

    body.replaceChildren(now, hostRow ?? '', listenRow ?? '', foot);
  }

  return {
    button,
    /** For the phone menu. */
    openPanel,
    render,
    dispose() {
      disposed = true;
      clearInterval(hostPoll); clearInterval(listenPoll); clearInterval(paint);
      sock.off('music:state', onState);
      if (sharing) void call('music:stop');
      try { sessionStorage.removeItem(SHARE); } catch { /* */ }
      if (player) { player.disconnect(); player = null; }
      open?.close();
    },
  };
}
