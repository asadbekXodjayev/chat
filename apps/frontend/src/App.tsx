import { useEffect, useState } from 'react';
import { getUser } from './lib/session';
import { setOnUnauthorized } from './lib/apiClient';
import { LoginScreen } from './components/LoginScreen';
import { ChatPage } from './pages/chat/ChatPage';

export function App() {
  const [user, setUser] = useState(getUser());

  useEffect(() => {
    // On definitive auth loss, bounce back to the login screen (§7.3 / NFR-2).
    setOnUnauthorized(() => setUser(null));
  }, []);

  if (!user) return <LoginScreen onLoggedIn={setUser} />;
  return <ChatPage me={user} onLogout={() => setUser(null)} />;
}
