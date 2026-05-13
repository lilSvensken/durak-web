import { useState, useEffect } from 'react';
import { socket } from './socket';
import { RoomView } from './types';
import Home from './pages/Home';
import Game from './pages/Game';

type Screen = 'home' | 'game';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [room, setRoom] = useState<RoomView | null>(null);
  const [myName, setMyName] = useState('');

  useEffect(() => {
    socket.on('room:updated', setRoom);
    return () => {
      socket.off('room:updated', setRoom);
    };
  }, []);

  function handleJoined(name: string) {
    setMyName(name);
    setScreen('game');
  }

  function handleLeave() {
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
