export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
export type Phase = 'lobby' | 'playing' | 'ended';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface AttackSlot {
  attack: Card;
  defense: Card | null;
}

export interface Player {
  id: string;
  name: string;
  cardCount: number;
  isHost: boolean;
  isDone: boolean;
}

export interface RoomView {
  code: string;
  phase: Phase;
  players: Player[];
  hostId: string;
  trumpSuit: Suit | null;
  deckCount: number;
  table: AttackSlot[];
  myCards: Card[];
  attackerId: string;
  defenderId: string;
  canThrow: boolean;
  fool: string | null;
  defenderTaking: boolean;
}
