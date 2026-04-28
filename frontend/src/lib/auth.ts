import Cookies from 'js-cookie';
import type { AuthTokens } from './types';

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

const TOKEN_OPTIONS: Cookies.CookieAttributes = {
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
};

export function getAccessToken(): string | undefined {
  return Cookies.get(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | undefined {
  return Cookies.get(REFRESH_TOKEN_KEY);
}

export function setTokens(tokens: AuthTokens): void {
  Cookies.set(ACCESS_TOKEN_KEY, tokens.accessToken, {
    ...TOKEN_OPTIONS,
    expires: 1, // 1 day
  });
  Cookies.set(REFRESH_TOKEN_KEY, tokens.refreshToken, {
    ...TOKEN_OPTIONS,
    expires: 30, // 30 days
  });
}

export function clearTokens(): void {
  Cookies.remove(ACCESS_TOKEN_KEY, { path: '/' });
  Cookies.remove(REFRESH_TOKEN_KEY, { path: '/' });
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

export interface JwtPayload {
  sub: string;
  email: string;
  userType: string;
  iat: number;
  exp: number;
}

export function parseJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as JwtPayload;
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = parseJwt(token);
  if (!payload) return true;
  return Date.now() >= payload.exp * 1000;
}
