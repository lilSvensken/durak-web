import { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';
import { RoomView, Card, Suit } from '../types';
import styles from './Game.module.css';

const SUIT_SYMBOL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const SUIT_RED: Record<Suit, boolean> = {
  spades: false,
  hearts: true,
  diamonds: true,
  clubs: false,
};

const RANK_ORDER: Record<string, number> = {
  '6': 0, '7': 1, '8': 2, '9': 3, '10': 4,
  'J': 5, 'Q': 6, 'K': 7, 'A': 8,
};

function beats(attack: Card, defense: Card, trump: Suit): boolean {
  if (attack.suit === trump) {
    return defense.suit === trump && RANK_ORDER[defense.rank] > RANK_ORDER[attack.rank];
  }
  if (defense.suit === trump) return true;
  if (defense.suit !== attack.suit) return false;
  return RANK_ORDER[defense.rank] > RANK_ORDER[attack.rank];
}

function playTurnSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // AudioContext not available
  }
}

function cardKey(card: Card) {
  return `${card.rank}-${card.suit}`;
}

function CardView({
  card,
  onClick,
  disabled,
  dimmed,
  valid,
}: {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  dimmed?: boolean;
  valid?: boolean;
}) {
  const red = SUIT_RED[card.suit];
  return (
    <button
      className={[
        styles.card,
        red ? styles.cardRed : '',
        dimmed ? styles.cardDimmed : '',
        valid ? styles.cardValid : '',
      ].join(' ')}
      onClick={onClick}
      disabled={disabled}
    >
      <span className={styles.cardRank}>{card.rank}</span>
      <span className={styles.cardSuit}>{SUIT_SYMBOL[card.suit]}</span>
      <span className={styles.cardRankBottom}>{card.rank}</span>
    </button>
  );
}

interface Props {
  room: RoomView;
  myId: string;
  myName: string;
  onLeave: () => void;
}

export default function Game({ room, myId, myName: _myName, onLeave }: Props) {
  const [error, setError] = useState('');
  const [startError, setStartError] = useState('');
  const [copied, setCopied] = useState(false);
  const wasMyTurn = useRef(false);

  const isHost = room.hostId === myId;
  const isAttacker = room.attackerId === myId;
  const isDefender = room.defenderId === myId;
  const canAct = isAttacker || isDefender || room.canThrow;
  const isMyTurn = isAttacker || isDefender;

  // Sound + vibrate when turn starts
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) {
      playTurnSound();
      navigator.vibrate?.(50);
    }
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  // Compute which hand cards can beat the first open attack slot
  const firstOpenSlot = isDefender ? room.table.find(s => s.defense === null) : null;
  const validDefenseKeys = firstOpenSlot && room.trumpSuit
    ? new Set(room.myCards.filter(c => beats(firstOpenSlot.attack, c, room.trumpSuit!)).map(cardKey))
    : null;

  function handleCopyLink() {
    const url = `${window.location.origin}?code=${room.code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleStart() {
    setStartError('');
    socket.emit('room:start', (err) => {
      if (err) setStartError(err);
    });
  }

  function handleCardClick(card: Card) {
    setError('');

    if (isDefender) {
      const openSlot = room.table.find(slot => slot.defense === null);
      if (!openSlot) return;
      socket.emit('game:defend', { attack: openSlot.attack, defense: card }, (err) => {
        if (err) setError(err);
      });
      return;
    }

    if (isAttacker) {
      socket.emit('game:attack', card, (err) => {
        if (err) setError(err);
      });
      return;
    }

    if (room.canThrow) {
      socket.emit('game:throw', card, (err) => {
        if (err) setError(err);
      });
    }
  }

  function handleTake() {
    setError('');
    socket.emit('game:take', (err) => {
      if (err) setError(err);
    });
  }

  function handleDone() {
    setError('');
    socket.emit('game:done', (err) => {
      if (err) setError(err);
    });
  }

  const otherPlayers = room.players.filter(p => p.id !== myId);

  // ── Лобби ──────────────────────────────────────────────────────────────────
  if (room.phase === 'lobby') {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.titleSmall}>🃏 Дурак</span>
            <span className={styles.code}>#{room.code}</span>
          </div>
          <button className={styles.leaveBtn} onClick={onLeave}>Выйти</button>
        </header>

        <section className={styles.playersList}>
          <h2>Игроки ({room.players.length} / 6)</h2>
          <ul>
            {room.players.map(p => (
              <li key={p.id} className={styles.playerRow}>
                <span>{p.name}{p.id === myId ? ' (вы)' : ''}</span>
                {p.isHost && <span className={styles.hostBadge}>хост</span>}
              </li>
            ))}
          </ul>
        </section>

        <button className={styles.copyBtn} onClick={handleCopyLink}>
          {copied ? '✓ Ссылка скопирована' : 'Скопировать ссылку на комнату'}
        </button>

        {isHost ? (
          <div className={styles.lobbyActions}>
            {startError && <p className={styles.error}>{startError}</p>}
            <button className={styles.startBtn} onClick={handleStart}>
              Начать игру
            </button>
            <p className={styles.hint}>Минимум 2 игрока</p>
          </div>
        ) : (
          <p className={styles.waiting}>Ждём, пока хост начнёт игру…</p>
        )}
      </div>
    );
  }

  // ── Конец игры ─────────────────────────────────────────────────────────────
  if (room.phase === 'ended') {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <span className={styles.titleSmall}>🃏 Дурак</span>
          <button className={styles.leaveBtn} onClick={onLeave}>Выйти</button>
        </header>
        <div className={styles.endScreen}>
          <p className={styles.endEmoji}>🃏</p>
          <p className={styles.endLabel}>Дурак</p>
          <p className={styles.endName}>{room.fool ?? '—'}</p>
          <button className={styles.startBtn} onClick={onLeave}>
            В главное меню
          </button>
        </div>
      </div>
    );
  }

  // ── Игра ───────────────────────────────────────────────────────────────────
  let phaseLabel = 'Ожидание';
  if (isAttacker) phaseLabel = 'Ваш ход — атакуйте';
  else if (isDefender) phaseLabel = 'Защищайтесь';
  else if (room.canThrow) phaseLabel = 'Можно подкинуть';

  const sortedCards = [...room.myCards].sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.phase}>{phaseLabel}</span>
          <span className={styles.code}>#{room.code}</span>
        </div>
        <button className={styles.leaveBtn} onClick={onLeave}>Выйти</button>
      </header>

      {/* Козырь + колода */}
      <div className={styles.infoBar}>
        <div className={styles.trumpInfo}>
          <span className={styles.infoLabel}>Козырь</span>
          <span
            className={[
              styles.trumpSuit,
              room.trumpSuit && SUIT_RED[room.trumpSuit] ? styles.red : '',
            ].join(' ')}
          >
            {room.trumpSuit ? SUIT_SYMBOL[room.trumpSuit] : '—'}
          </span>
        </div>
        <div className={styles.deckInfo}>
          <span className={styles.infoLabel}>Колода</span>
          <span className={styles.deckCount}>{room.deckCount}</span>
        </div>
      </div>

      {/* Противники */}
      {otherPlayers.length > 0 && (
        <div className={styles.opponents}>
          {otherPlayers.map(p => (
            <div
              key={p.id}
              className={[
                styles.opponent,
                p.id === room.attackerId ? styles.opponentAttacker : '',
                p.id === room.defenderId ? styles.opponentDefender : '',
                p.isDone ? styles.opponentDone : '',
              ].join(' ')}
            >
              <span className={styles.opponentName}>{p.name}</span>
              <span className={styles.opponentCardCount}>{p.cardCount} 🃏</span>
              {p.id === room.attackerId && <span className={styles.roleBadge}>атака</span>}
              {p.id === room.defenderId && <span className={styles.roleBadge}>защита</span>}
              {p.isDone && <span className={styles.doneBadge}>вышел</span>}
            </div>
          ))}
        </div>
      )}

      {/* Стол */}
      <div className={styles.tableArea}>
        <h3 className={styles.sectionLabel}>Стол</h3>
        {room.table.length === 0 ? (
          <p className={styles.emptyTable}>Стол пуст</p>
        ) : (
          <div className={styles.tableSlots}>
            {room.table.map((slot, i) => (
              <div key={i} className={styles.slot}>
                <CardView card={slot.attack} dimmed={slot.defense !== null} />
                {slot.defense ? (
                  <CardView card={slot.defense} />
                ) : (
                  <div className={styles.emptySlot} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ошибка + кнопки действий */}
      {error && <p className={styles.error}>{error}</p>}

      {canAct && (
        <div className={styles.actionButtons}>
          {isDefender && (
            <button className={styles.takeBtn} onClick={handleTake}>
              Взять карты
            </button>
          )}
          {(isAttacker || room.canThrow) && (
            <button className={styles.doneBtn} onClick={handleDone}>
              Готово
            </button>
          )}
        </div>
      )}

      {/* Рука */}
      <div className={styles.hand}>
        <h3 className={styles.sectionLabel}>
          Моя рука ({room.myCards.length})
        </h3>
        <div className={styles.handCards}>
          {sortedCards.map((card) => (
            <CardView
              key={cardKey(card)}
              card={card}
              onClick={() => handleCardClick(card)}
              disabled={!canAct}
              dimmed={validDefenseKeys !== null && !validDefenseKeys.has(cardKey(card))}
              valid={validDefenseKeys !== null && validDefenseKeys.has(cardKey(card))}
            />
          ))}
          {room.myCards.length === 0 && (
            <p className={styles.emptyHand}>Карт нет — вы выбыли из игры 🎉</p>
          )}
        </div>
      </div>
    </div>
  );
}
