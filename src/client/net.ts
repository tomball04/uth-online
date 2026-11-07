import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServer, ServerToClient } from '../shared/protocol.js';
import { session } from './api.js';
import { earnedToast, setBalance } from './cosmetics.js';

export type GameSocket = Socket<ServerToClient, ClientToServer>;

let socket: GameSocket | null = null;
let currentCode: string | null = null;
const statusListeners = new Set<(s: 'connected' | 'reconnecting' | 'offline') => void>();

export function getSocket(): GameSocket {
  if (socket) return socket;
  socket = io({ auth: { token: session.token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 4000 });
  socket.on('connect', () => {
    statusListeners.forEach((l) => l('connected'));
    // After any reconnect (network blip, laptop sleep, server restart) re-enter the table.
    // asSpectator: a seated player keeps their seat; a spectator is never auto-seated on reconnect.
    if (currentCode) socket!.emit('table:join', { code: currentCode, asSpectator: true }, () => {});
  });
  socket.on('disconnect', () => statusListeners.forEach((l) => l('reconnecting')));
  socket.on('style:earned', (p) => { setBalance(p.balance); earnedToast(p.rewards); });
  socket.io.on('reconnect_failed', () => statusListeners.forEach((l) => l('offline')));
  return socket;
}

export function onStatus(fn: (s: 'connected' | 'reconnecting' | 'offline') => void) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function setCurrentTable(code: string | null) { currentCode = code; }

export function resetSocket() { socket?.disconnect(); socket = null; }

/** Emit with acknowledgement, resolving to the server's Ack. Times out after 8s. */
export function call<T = object>(ev: keyof ClientToServer, payload?: unknown): Promise<Ack<T>> {
  const s = getSocket();
  return new Promise((res) => {
    const timer = setTimeout(() => res({ ok: false, error: 'The server did not respond. Check your connection.' }), 8000);
    const cb = (r: Ack<T>) => { clearTimeout(timer); res(r); };
    if (payload === undefined) (s.emit as any)(ev, cb);
    else (s.emit as any)(ev, payload, cb);
  });
}

export const actionId = () => crypto.randomUUID();
