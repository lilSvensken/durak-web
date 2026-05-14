import { useState, useEffect, useRef } from 'react';
import { socket } from './socket';
import { RoomView } from './types';
import Home from './pages/Home';
import Game from './pages/Game';

type Screen = 'home' | 'game';

const SESSION_KEY = 'durak_session';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [myName, setMyName] = useState('');
  const screenRef = useRef<Screen>('home');

  useEffect(() => { screenRef.current = screen; }, [screen]);

  // Persist session so reconnect/refresh can rejoin
  useEffect(() => {
    if (room && myName) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ code: room.code, name: myName }));
    }
  }, [room?.code, myName]);

  useEffect(() => {
    function onConnect() {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const { code, name } = JSON.parse(raw) as { code: string; name: string };
      socket.emit('room:join', { code, name }, (err) => {
        if (err) {
          localStorage.removeItem(SESSION_KEY);
          if (screenRef.current === 'game') {
            setRoom(null);
            setMyName('');
            setScreen('home');
          }
        } else {
          setMyName(name);
          setScreen('game');
        }
      });
    }

    socket.on('connect', onConnect);
    socket.on('room:updated', setRoom);

    // Auto-restore session on page load
    if (localStorage.getItem(SESSION_KEY)) {
      socket.connect();
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('room:updated', setRoom);
    };
  }, []);

  function handleJoined(name: string) {
    setMyName(name);
    setScreen('game');
  }

  function handleLeave() {
    localStorage.removeItem(SESSION_KEY);
    socket.emit('room:leave');
    socket.disconnect();
    setRoom(null);
    setMyName('');
    setScreen('home');
  }

  if (screen === 'game' && room) {
    return <Game room={room} myId={socket.id ?? ''} myName={myName} onLeave={handleLeave} />;
  }

  return <Home onJoined={handleJoined} />;
}
