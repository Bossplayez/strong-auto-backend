'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { User } from '@/lib/types';
import {
  getAccessToken,
  clearTokens,
  setTokens,
  isAuthenticated as checkAuth,
  parseJwt,
  isTokenExpired,
} from '@/lib/auth';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, phone?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isLoading: true,
  login: async () => {},
  register: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    try {
      const { me } = await import('@/lib/api');
      const profile = await me.getProfile();
      setUser(profile);
    } catch {
      // Fallback: parse user from JWT
      const token = getAccessToken();
      if (token && !isTokenExpired(token)) {
        const payload = parseJwt(token);
        if (payload) {
          setUser({
            id: payload.sub,
            email: payload.email,
            userType: payload.userType as User['userType'],
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
          });
          return;
        }
      }
      setUser(null);
      clearTokens();
    }
  }, []);

  useEffect(() => {
    if (checkAuth()) {
      fetchProfile().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [fetchProfile]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { auth } = await import('@/lib/api');
      await auth.login(email, password);
      await fetchProfile();
    },
    [fetchProfile],
  );

  const register = useCallback(
    async (email: string, password: string, phone?: string) => {
      const { auth } = await import('@/lib/api');
      await auth.register(email, password, phone);
      await fetchProfile();
    },
    [fetchProfile],
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const isAuthenticated = !!user;
  const isAdmin = user?.userType === 'ADMIN';

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated, isAdmin, isLoading, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
