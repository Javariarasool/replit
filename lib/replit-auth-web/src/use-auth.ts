import { useCallback, useEffect, useState } from 'react';
import { API_UNAUTHORIZED_EVENT, type AuthUser } from '@workspace/api-client-react';

export type { AuthUser };

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isSessionExpired: boolean;
  recoveredFromSessionExpiry: boolean;
  login: () => void;
  logout: () => void;
}

export const SESSION_EXPIRED_EVENT = API_UNAUTHORIZED_EVENT;
const SESSION_RECOVERY_STORAGE_KEY = 'tender-desk:session-expired';

export function notifySessionExpired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

function getBasePath() {
  return import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [recoveredFromSessionExpiry, setRecoveredFromSessionExpiry] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let sessionExpiredDuringLoad = false;
    const onSessionExpired = () => {
      sessionExpiredDuringLoad = true;
      try {
        window.sessionStorage.setItem(SESSION_RECOVERY_STORAGE_KEY, 'true');
      } catch {
        // Session storage can be unavailable in restricted browser contexts.
      }
      setIsSessionExpired(true);
      setUser(null);
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);

    fetch('/api/auth/user', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(sessionExpiredDuringLoad ? null : data.user ?? null);
          if (data.user && !sessionExpiredDuringLoad) {
            try {
              const recovering = window.sessionStorage.getItem(SESSION_RECOVERY_STORAGE_KEY) === 'true';
              setRecoveredFromSessionExpiry(recovering);
              if (recovering) window.sessionStorage.removeItem(SESSION_RECOVERY_STORAGE_KEY);
            } catch {
              setRecoveredFromSessionExpiry(false);
            }
          }
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    };
  }, []);

  const login = useCallback(() => {
    const currentRoute = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const returnTo = currentRoute.startsWith('/') && !currentRoute.startsWith('//') ? currentRoute : getBasePath();
    window.location.href = `/api/login?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  const logout = useCallback(() => {
    const base = getBasePath();
    window.location.href = `/api/logout?returnTo=${encodeURIComponent(base)}`;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isSessionExpired,
    recoveredFromSessionExpiry,
    login,
    logout,
  };
}
