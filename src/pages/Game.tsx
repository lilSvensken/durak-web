import { useState } from 'react';
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

function cardKey(card: Card) {
  return `${card.rank}-${card.suit}`;
}

function CardView({
  card,
  selected,
  onClick,
  disabled,
  dimmed,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  dimmed?: boolean;
}) {
  const red = SUIT_RED[card.suit];
  return (
    <button
      className={[
        styles.card,
        red ? styles.cardRed : '',
        selected ? styles.cardSelected : '',
        dimmed ? styles.cardDimmed : '',
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
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [error, setError] = useState('');
  const [startError, setStartError] = useState('');

  const isHost = room.hostId === myId;
  const isAttacker = room.attackerId === myId;
  const isDefender = room.defenderId === myId;
  const canAct = isAttacker || isDefender || room.canThrow;

  function handleStart() {
    setStartError('');
    socket.emit('room:start', (err) => {
      if (err) setStartError(err);
    });
  }

  function handleCardClick(card: Card) {
    setError('');

    if (isDefender) {
      const alreadySelected =
        selectedCard?.suit === card.suit && selectedCard?.rank === card.rank;
      setSelectedCard(alreadySelected ? null : card);
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

  function handleSlotClick(attackCard: Card) {
    if (!isDefender || !selectedCard) return;
    setError('');
    socket.emit('game:defend', { attack: attackCard, defense: selectedCard }, (err) => {
      if (err) {
        setError(err);
      } else {
        setSelectedCard(null);
      }
    });
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
  else if (isDefender) phaseLabel = selectedCard ? 'Выберите карту для прикрытия' : 'Защищайтесь';
  else if (room.canThrow) phaseLabel = 'Можно подкинуть';

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
                <CardView
                  card={slot.attack}
                  onClick={() => handleSlotClick(slot.attack)}
                  disabled={!isDefender || !selectedCard || slot.defense !== null}
                  dimmed={slot.defense !== null}
                />
                {slot.defense ? (
                  <CardView card={slot.defense} />
                ) : (
                  <div
                    className={[
                      styles.emptySlot,
                      isDefender && selectedCard ? styles.emptySlotActive : '',
                    ].join(' ')}
                  />
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
          {isDefender && selectedCard && (
            <span className={styles.handHint}> — теперь нажмите на карту атаки</span>
          )}
        </h3>
        <div className={styles.handCards}>
          {room.myCards.map((card) => (
            <CardView
              key={cardKey(card)}
              card={card}
              selected={
                selectedCard?.suit === card.suit && selectedCard?.rank === card.rank
              }
              onClick={() => handleCardClick(card)}
              disabled={!canAct}
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
