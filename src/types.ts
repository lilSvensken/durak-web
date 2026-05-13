export type Role = 'mafia' | 'citizen' | 'sheriff' | 'doctor';
export type Phase = 'lobby' | 'night' | 'day' | 'vote' | 'ended';

export interface Player {
  id: string;
  name: string;
  isAlive: boolean;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  phase: Phase;
  players: Player[];
  hostId: string;
}
