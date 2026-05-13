import { useState, FormEvent } from 'react';
import { socket } from '../socket';
import styles from './Home.module.css';

interface Props {
  onJoined: (name: string) => void;
}

export default function Home({ onJoined }: Props) {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function connect() {
    if (!socket.connected) socket.connect();
  }

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError('');
    connect();
    socket.emit('room:create', name.trim(), () => {
      setLoading(false);
      onJoined(name.trim());
    });
  }

  function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setLoading(true);
    setError('');
    connect();
    socket.emit('room:join', { code: code.trim().toUpperCase(), name: name.trim() }, (err) => {
      setLoading(false);
      if (err) return setError(err);
      onJoined(name.trim());
    });
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>🃏 Дурак</h1>

      <div className={styles.tabs}>
        <button
          className={tab === 'create' ? styles.tabActive : styles.tab}
          onClick={() => setTab('create')}
        >
          Создать комнату
        </button>
        <button
          className={tab === 'join' ? styles.tabActive : styles.tab}
          onClick={() => setTab('join')}
        >
          Войти в комнату
        </button>
      </div>

      <form onSubmit={tab === 'create' ? handleCreate : handleJoin} className={styles.form}>
        <input
          placeholder="Ваше имя"
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={20}
          required
        />
        {tab === 'join' && (
          <input
            placeholder="Код комнаты (4 символа)"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            maxLength={4}
            required
          />
        )}
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? 'Подключение...' : tab === 'create' ? 'Создать' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
