import { io, Socket } from 'socket.io-client';
import { Role, RoomView } from './types';

interface ServerToClientEvents {
  'room:updated': (room: RoomView) => void;
  'room:error': (message: string) => void;
  'game:role': (role: Role) => void;
}

interface ClientToServerEvents {
  'room:create': (name: string, cb: (code: string) => void) => void;
  'room:join': (payload: { code: string; name: string }, cb: (err: string | null) => void) => void;
  'room:start': (cb: (err: string | null) => void) => void;
  'room:leave': () => void;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(BACKEND_URL, {
  autoConnect: false,
});
