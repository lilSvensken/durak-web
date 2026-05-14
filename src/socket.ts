import { io, Socket } from 'socket.io-client';
import { Card, RoomView } from './types';

interface ServerToClientEvents {
  'room:updated': (room: RoomView) => void;
  'room:error': (message: string) => void;
  'react:received': (payload: { playerId: string; emoji: string }) => void;
}

interface ClientToServerEvents {
  'room:create': (name: string, cb: (code: string) => void) => void;
  'room:join': (payload: { code: string; name: string }, cb: (err: string | null) => void) => void;
  'room:start': (cb: (err: string | null) => void) => void;
  'room:leave': () => void;
  'game:attack': (card: Card, cb: (err: string | null) => void) => void;
  'game:defend': (payload: { attack: Card; defense: Card }, cb: (err: string | null) => void) => void;
  'game:throw': (card: Card, cb: (err: string | null) => void) => void;
  'game:take': (cb: (err: string | null) => void) => void;
  'game:done': (cb: (err: string | null) => void) => void;
  'game:confirm_take': (cb: (err: string | null) => void) => void;
  'game:react': (emoji: string) => void;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL, {
  autoConnect: false,
});
