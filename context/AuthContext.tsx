import React, { createContext, useContext, useEffect, useState } from 'react';
import { API, clearToken, getToken } from '../services/api';
import { disconnectSocket } from '../services/socket';

export interface User {
  id: string;
  name: string;
  rfid: string;
  contact: string;
  status: string;
  balance: number;
  totalRefills: number;
  lastActivity: string;
}

interface AuthCtx {
  user: User | null;
  setUser: (u: User | null) => void;
  setToken: (t: string | null) => void; // kept so login screen doesn't break
  logout: () => void;
}

const AuthContext = createContext<AuthCtx>({
  user: null,
  setUser: () => {},
  setToken: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // On app launch, if we have a saved session cookie try to restore the user
    getToken().then(async cookie => {
      if (!cookie) return;
      try {
        const res = await API.get('/api/me');
        if (res.ok) setUser(res.user);
        else await clearToken(); // session expired, clear it
      } catch {}
    });
  }, []);

  const logout = async () => {
    try {
      if (user) disconnectSocket(user.rfid);
      await API.post('/api/logout', {});
    } catch {}
    await clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      setUser,
      setToken: () => {}, // no-op — session is handled in api.ts automatically
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);