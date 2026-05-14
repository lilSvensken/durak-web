import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

const EMOJIS = ['👍', '😂', '🤔', '😱', '🤦'];

const PHRASES = {
  attackerTurn:    ['Твой ход 👀', 'Нападай!', 'Ходи давай', 'Ну, удиви меня'],
  defenderFirst:   ['Отбивайся!', 'Попробуй-ка', 'Держи 🃏', 'Лови!'],
  defenderMore:    ['Ещё!', 'Ещё одну', 'И вот эту', 'У меня ещё есть 😏'],
  inactivity:      ['Я жду 🥱', 'Заснул?', 'Ну чего ты…', 'Тук-тук, твой ход'],
  opponentTake:    ['Эх, заберу…', 'Ладно, мои будут', 'Ну вы, блин, даёте 😤', 'Беру, беру'],
  bito:            ['Отбито 😎', 'Не на того напал', 'Изи', 'Дальше!'],
  lastCard:        ['Последняя!', 'Почти всё…', 'Ещё чуть-чуть', 'Я близко 🔥'],
} as const;

function pickPhrase(bucket: readonly string[], lastPhrase?: string): string {
  const choices = lastPhrase ? bucket.filter(p => p !== lastPhrase) : [...bucket];
  const pool = choices.length > 0 ? choices : [...bucket];
  return pool[Math.floor(Math.random() * pool.length)];
}

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

function SpeechBubble({ text }: { text: string }) {
  return (
    <motion.div
      className={styles.speechBubble}
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.7 }}
      transition={{ type: 'spring', stiffness: 450, damping: 22 }}
    >
      {text}
    </motion.div>
  );
}

function CardView({
  card,
  onClick,
  disabled,
  dimmed,
  hint,
  small,
}: {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  dimmed?: boolean;
  hint?: boolean;
  small?: boolean;
}) {
  const red = SUIT_RED[card.suit];
  return (
    <button
      className={[
        styles.card,
        red ? styles.cardRed : '',
        dimmed ? styles.cardDimmed : '',
        hint ? styles.cardHint : '',
      ].join(' ')}
      onClick={onClick}
      disabled={disabled}
      style={small ? { width: 44, height: 64, fontSize: '0.7rem' } : undefined}
    >
      <span className={styles.cardRank}>{card.rank}</span>
      <span className={styles.cardSuit} style={small ? { fontSize: '1.1rem' } : undefined}>
        {SUIT_SYMBOL[card.suit]}
      </span>
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
  const [codeCopied, setCodeCopied] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // Own emoji reaction (shown near my hand area)
  const [myReaction, setMyReaction] = useState('');
  // Card selected by defender waiting for slot choice
  const [selectedDefenseCard, setSelectedDefenseCard] = useState<Card | null>(null);
  const [opponentBubble, setOpponentBubble] = useState<{ text: string; key: number; targetId: string } | null>(null);
  const [lastActionAt, setLastActionAt] = useState(0);

  const wasMyTurn = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Speech bubble refs
  const bubbleKeyRef = useRef(0);
  const lastBubbleTextRef = useRef('');
  const bubbleHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Previous-state refs for detecting game events
  const prevTableLengthRef = useRef(-1);
  const prevDefenderIdRef = useRef('');
  const prevDefenderTakingRef = useRef(false);
  const prevOpponentCardCountsRef = useRef<Record<string, number>>({});

  const isHost = room.hostId === myId;
  const isAttacker = room.attackerId === myId;
  const isDefender = room.defenderId === myId;
  const isMyTurn = isAttacker || isDefender;

  // Open (uncovered) slots on the table
  const openSlots = room.table.filter(s => s.defense === null);
  const hasOpenSlots = openSlots.length > 0;
  const allCovered = room.table.length > 0 && !hasOpenSlots;

  // Cards valid for defense against the first open slot (for wiggle hint)
  const firstOpenSlot = isDefender ? openSlots[0] ?? null : null;
  const validDefenseKeys = firstOpenSlot && room.trumpSuit
    ? new Set(room.myCards.filter(c => beats(firstOpenSlot.attack, c, room.trumpSuit!)).map(cardKey))
    : null;

  // Sort: non-trumps by rank, then trumps by rank
  const sortedCards = [...room.myCards].sort((a, b) => {
    const aTrump = a.suit === room.trumpSuit ? 1 : 0;
    const bTrump = b.suit === room.trumpSuit ? 1 : 0;
    if (aTrump !== bTrump) return aTrump - bTrump;
    return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
  });

  // The single card to wiggle as hint
  let hintCardKey: string | null = null;
  if (showHint) {
    if (isDefender && validDefenseKeys) {
      const hintCard = sortedCards.find(c => validDefenseKeys.has(cardKey(c)));
      if (hintCard) hintCardKey = cardKey(hintCard);
    } else if (isAttacker && sortedCards.length > 0) {
      hintCardKey = cardKey(sortedCards[0]);
    }
  }

  // Slot indices the selected defense card can cover
  const validSlotIndicesForSelected = selectedDefenseCard && room.trumpSuit
    ? room.table.reduce<number[]>((acc, slot, i) => {
        if (slot.defense === null && beats(slot.attack, selectedDefenseCard, room.trumpSuit!)) {
          acc.push(i);
        }
        return acc;
      }, [])
    : [];

  // Clear selected defense card when table changes (slot covered or new card added)
  const tableFingerprint = room.table.map(s => s.defense ? '1' : '0').join('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectedDefenseCard(null); }, [tableFingerprint]);

  const otherPlayers = room.players.filter(p => p.id !== myId);

  function showBubble(text: string, targetId: string) {
    if (bubbleHideTimerRef.current) clearTimeout(bubbleHideTimerRef.current);
    bubbleKeyRef.current += 1;
    lastBubbleTextRef.current = text;
    setOpponentBubble({ text, key: bubbleKeyRef.current, targetId });
    bubbleHideTimerRef.current = setTimeout(() => setOpponentBubble(null), 3000);
  }

  // Sound + vibrate + "your turn" bubble when turn starts.
  // Defined first so context bubbles (room effect below) override via React batching.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isMyTurn && !wasMyTurn.current) {
      playTurnSound();
      navigator.vibrate?.(50);
      if (otherPlayers.length > 0) {
        const speaker = (isAttacker
          ? otherPlayers.find(p => p.id === room.defenderId)
          : otherPlayers.find(p => p.id === room.attackerId))
          ?? otherPlayers[0];
        const bucket = isAttacker ? PHRASES.attackerTurn : PHRASES.defenderFirst;
        showBubble(pickPhrase(bucket, lastBubbleTextRef.current), speaker.id);
      }
    }
    wasMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  // Detect game events from room state changes and show context bubbles.
  // Runs after the turn-start effect so its setState wins via React 18 batching
  // when both fire in the same flush (e.g. bito + my new turn).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tableLen = room.table.length;
    const prevTableLen = prevTableLengthRef.current;

    // Skip first mount — just initialize refs
    if (prevTableLen === -1) {
      prevTableLengthRef.current = tableLen;
      prevDefenderIdRef.current = room.defenderId;
      prevDefenderTakingRef.current = room.defenderTaking;
      for (const p of otherPlayers) prevOpponentCardCountsRef.current[p.id] = p.cardCount;
      return;
    }

    // Opponent reached their last card
    for (const p of otherPlayers) {
      const prev = prevOpponentCardCountsRef.current[p.id] ?? p.cardCount;
      if (p.cardCount === 1 && prev > 1) {
        showBubble(pickPhrase(PHRASES.lastCard, lastBubbleTextRef.current), p.id);
      }
    }

    // Table just cleared — bito or take?
    if (prevTableLen > 0 && tableLen === 0) {
      const prevDefId = prevDefenderIdRef.current;
      const wasOpponentDefender = prevDefId !== '' && prevDefId !== myId;
      if (wasOpponentDefender) {
        if (prevDefenderTakingRef.current) {
          showBubble(pickPhrase(PHRASES.opponentTake, lastBubbleTextRef.current), prevDefId);
        } else {
          showBubble(pickPhrase(PHRASES.bito, lastBubbleTextRef.current), prevDefId);
        }
      }
    }

    // Opponent threw an extra card while I'm defending (2nd, 3rd, … card)
    if (isDefender && tableLen > prevTableLen && prevTableLen > 0) {
      const thrower = otherPlayers.find(p => p.id === room.attackerId) ?? otherPlayers[0];
      if (thrower) {
        showBubble(pickPhrase(PHRASES.defenderMore, lastBubbleTextRef.current), thrower.id);
      }
    }

    // Update prev refs
    prevTableLengthRef.current = tableLen;
    prevDefenderIdRef.current = room.defenderId;
    prevDefenderTakingRef.current = room.defenderTaking;
    for (const p of otherPlayers) prevOpponentCardCountsRef.current[p.id] = p.cardCount;
  }, [room]);

  // True only when this player is actually blocking the game and must act.
  // Excludes "waiting" states: attacker who attacked but defender hasn't responded yet,
  // defender who covered all cards but attacker hasn't clicked бито.
  const waitingForMyAction =
    (isAttacker && room.table.length === 0) ||           // must attack
    (isAttacker && allCovered && !room.defenderTaking) || // must click бито
    (isAttacker && room.defenderTaking) ||                // must confirm or throw more
    (isDefender && hasOpenSlots && !room.defenderTaking); // must beat uncovered cards

  // Inactivity nudge: 15 s → bubble, repeats every 20 s. Resets on any action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!waitingForMyAction || otherPlayers.length === 0) return;
    const targetId = otherPlayers[0].id;
    const first = setTimeout(() => {
      showBubble(pickPhrase(PHRASES.inactivity, lastBubbleTextRef.current), targetId);
      nudgeTimerRef.current = setTimeout(() => {
        showBubble(pickPhrase(PHRASES.inactivity, lastBubbleTextRef.current), targetId);
      }, 20_000);
    }, 15_000);
    return () => {
      clearTimeout(first);
      if (nudgeTimerRef.current) { clearTimeout(nudgeTimerRef.current); nudgeTimerRef.current = null; }
    };
  }, [waitingForMyAction, lastActionAt]);

  // Wiggle hint: 30s inactivity when it's your turn (attack or defend)
  const shouldHint = (isDefender && hasOpenSlots) || (isAttacker && room.table.length === 0);
  useEffect(() => {
    setShowHint(false);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    if (shouldHint) {
      hintTimer.current = setTimeout(() => setShowHint(true), 30_000);
    }
    return () => { if (hintTimer.current) clearTimeout(hintTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldHint, room.table.length]);

  function resetHintTimer() {
    setShowHint(false);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    if (shouldHint) {
      hintTimer.current = setTimeout(() => setShowHint(true), 30_000);
    }
  }

  // Emoji reactions — opponent reactions go to speech bubble, own reaction shown near hand
  useEffect(() => {
    function onReact({ playerId, emoji }: { playerId: string; emoji: string }) {
      if (playerId === myId) {
        setMyReaction(emoji);
        setTimeout(() => setMyReaction(''), 2500);
      } else {
        showBubble(emoji, playerId);
      }
    }
    socket.on('react:received', onReact);
    return () => { socket.off('react:received', onReact); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  function handleCopyCode() {
    const url = `${window.location.origin}?code=${room.code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    });
  }

  function handleReact(emoji: string) {
    socket.emit('game:react', emoji);
  }

  function handleStart() {
    setStartError('');
    socket.emit('room:start', (err) => {
      if (err) setStartError(err);
    });
  }

  function handleCardClick(card: Card) {
    setLastActionAt(Date.now());
    setError('');
    resetHintTimer();

    if (isDefender && !room.defenderTaking) {
      if (!room.trumpSuit) return;
      // Find which open slots this card can cover
      const validIndices = room.table.reduce<number[]>((acc, slot, i) => {
        if (slot.defense === null && beats(slot.attack, card, room.trumpSuit!)) acc.push(i);
        return acc;
      }, []);
      if (validIndices.length === 0) {
        setSelectedDefenseCard(null);
        return;
      }
      if (validIndices.length === 1) {
        // Auto-cover the only valid slot
        setSelectedDefenseCard(null);
        socket.emit('game:defend', { attack: room.table[validIndices[0]].attack, defense: card }, (err) => {
          if (err) setError(err);
        });
        return;
      }
      // Multiple valid slots — let player pick by clicking a slot
      setSelectedDefenseCard(
        selectedDefenseCard && cardKey(selectedDefenseCard) === cardKey(card) ? null : card
      );
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

  function handleSlotClick(slotIndex: number) {
    if (!selectedDefenseCard) return;
    setLastActionAt(Date.now());
    const slot = room.table[slotIndex];
    setSelectedDefenseCard(null);
    socket.emit('game:defend', { attack: slot.attack, defense: selectedDefenseCard }, (err) => {
      if (err) setError(err);
    });
  }

  function handleTake() {
    setLastActionAt(Date.now());
    setError('');
    socket.emit('game:take', (err) => {
      if (err) setError(err);
    });
  }

  function handleConfirmTake() {
    setError('');
    socket.emit('game:confirm_take', (err) => {
      if (err) setError(err);
    });
  }

  function handleDone() {
    setLastActionAt(Date.now());
    setError('');
    resetHintTimer();
    socket.emit('game:done', (err) => {
      if (err) setError(err);
    });
  }

  // ── Лобби ──────────────────────────────────────────────────────────────────
  if (room.phase === 'lobby') {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.titleSmall}>🃏 Дурак</span>
            <span
              className={[styles.code, codeCopied ? styles.codeCopied : ''].join(' ')}
              onClick={handleCopyCode}
              title="Скопировать ссылку"
            >
              {codeCopied ? '✓ скопировано' : `#${room.code}`}
            </span>
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
  if (isAttacker) phaseLabel = room.defenderTaking ? 'Подкиньте карты или подтвердите' : 'Ваш ход — атакуйте';
  else if (isDefender) phaseLabel = room.defenderTaking ? 'Ждёте подтверждения атакующего' : 'Защищайтесь';
  else if (room.canThrow) phaseLabel = 'Можно подкинуть';

  // Button visibility rules:
  // "Взять карты" — defender only when there are uncovered slots
  const showTakeBtn = isDefender && !room.defenderTaking && hasOpenSlots;
  // "Бито" — attacker only when all cards on table are covered
  const showBitoBtn = isAttacker && !room.defenderTaking && allCovered;
  // "Подтвердить" — attacker when defender is taking
  const showConfirmBtn = isAttacker && room.defenderTaking;

  // Defender card interactivity: only when there are open slots and not waiting
  const defenderCanClick = isDefender && !room.defenderTaking && hasOpenSlots;
  const canAct = isAttacker || defenderCanClick || room.canThrow;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.phase}>{phaseLabel}</span>
          <span
            className={[styles.code, codeCopied ? styles.codeCopied : ''].join(' ')}
            onClick={handleCopyCode}
            title="Скопировать ссылку"
          >
            {codeCopied ? '✓' : `#${room.code}`}
          </span>
        </div>
        <button className={styles.leaveBtn} onClick={onLeave}>Выйти</button>
      </header>

      {/* Козырь + колода */}
      <div className={styles.infoBar}>
        <div className={styles.trumpInfo}>
          <span className={styles.infoLabel}>Козырь</span>
          <span className={[styles.trumpSuit, room.trumpSuit && SUIT_RED[room.trumpSuit] ? styles.red : ''].join(' ')}>
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
              {/* Speech bubble: handles both chat phrases and emoji reactions */}
              <div className={styles.speechBubbleWrapper}>
                <AnimatePresence>
                  {opponentBubble?.targetId === p.id && (
                    <SpeechBubble key={opponentBubble.key} text={opponentBubble.text} />
                  )}
                </AnimatePresence>
              </div>

              <span className={styles.opponentName}>{p.name}</span>
              <span className={styles.opponentCardCount}>{p.cardCount} 🃏</span>
              {p.id === room.attackerId && <span className={styles.roleBadge}>атака</span>}
              {p.id === room.defenderId && (
                <span className={styles.roleBadge}>
                  {room.defenderTaking ? 'берёт' : 'защита'}
                </span>
              )}
              {p.isDone && <span className={styles.doneBadge}>вышел</span>}
            </div>
          ))}
        </div>
      )}

      {/* Стол */}
      <div className={styles.tableArea}>
        <h3 className={styles.sectionLabel}>
          Стол
          {selectedDefenseCard && (
            <span className={styles.slotPrompt}> — выберите карту для прикрытия</span>
          )}
        </h3>
        {room.table.length === 0 ? (
          <p className={styles.emptyTable}>Стол пуст</p>
        ) : (
          <div className={styles.tableSlots}>
            <AnimatePresence>
              {room.table.map((slot, i) => {
                const isTarget = validSlotIndicesForSelected.includes(i);
                return (
                  <motion.div
                    key={i}
                    className={[styles.slot, isTarget ? styles.slotTarget : ''].join(' ')}
                    layout
                    initial={{ opacity: 0, y: -16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.2 }}
                    onClick={isTarget ? () => handleSlotClick(i) : undefined}
                  >
                    <CardView card={slot.attack} dimmed={slot.defense !== null} />
                    {slot.defense ? (
                      <motion.div
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <CardView card={slot.defense} />
                      </motion.div>
                    ) : (
                      <div className={[styles.emptySlot, isTarget ? styles.emptySlotTarget : ''].join(' ')} />
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Ошибка */}
      {error && <p className={styles.error}>{error}</p>}

      {/* Кнопки действий — строго по правилам */}
      <div className={styles.actionButtons}>
        {showTakeBtn && (
          <button className={styles.takeBtn} onClick={handleTake}>
            Взять карты
          </button>
        )}
        {showConfirmBtn && (
          <button className={styles.confirmBtn} onClick={handleConfirmTake}>
            Подтвердить
          </button>
        )}
        {showBitoBtn && (
          <button className={styles.doneBtn} onClick={handleDone}>
            Бито
          </button>
        )}
      </div>

      {/* Быстрые реакции */}
      <div className={styles.emojiBar}>
        {EMOJIS.map(e => (
          <button key={e} className={styles.emojiBtn} onClick={() => handleReact(e)}>
            {e}
          </button>
        ))}
      </div>
      {myReaction && (
        <div className={styles.myReaction}>{myReaction}</div>
      )}

      {/* Рука */}
      <div className={styles.hand}>
        <h3 className={styles.sectionLabel}>Моя рука ({room.myCards.length})</h3>
        <motion.div layout className={styles.handCards}>
          <AnimatePresence>
            {sortedCards.map((card) => {
              const isSelected = selectedDefenseCard !== null && cardKey(selectedDefenseCard) === cardKey(card);
              return (
                <motion.div
                  key={cardKey(card)}
                  layout
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.18 }}
                >
                  <CardView
                    card={card}
                    onClick={() => handleCardClick(card)}
                    disabled={!canAct}
                    hint={!isSelected && hintCardKey === cardKey(card)}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
        {room.myCards.length === 0 && (
          <p className={styles.emptyHand}>Карт нет — вы выбыли из игры 🎉</p>
        )}
      </div>
    </div>
  );
}
