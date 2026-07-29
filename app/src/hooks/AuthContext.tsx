import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { type AuthUser, type IAuthService } from '@/services/IAuthService';
import { clearQueryCache } from '@/services/queryCache';
import { AuthContext, type AuthContextValue } from '@/hooks/useAuth';

interface AuthProviderProps {
  children: ReactNode;
  authService: IAuthService;
}

export function AuthProvider({ children, authService }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authService
      .initEmbeddedAuth()
      .then((embedded) => embedded ?? authService.getCurrentUser())
      .then((current) => {
        if (!cancelled && current) setUser(current);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authService]);

  const signIn = useCallback(async () => {
    clearQueryCache();
    setError(null);
    setLoading(true);
    try {
      const loggedInUser = await authService.signIn();
      setUser(loggedInUser);
      return loggedInUser;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [authService]);

  const signOut = useCallback(async () => {
    try {
      await authService.signOut();
      clearQueryCache();
      setUser(null);
      setError(null);
    } catch {
      setError('Sign out failed. Please try again.');
    }
  }, [authService]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      signIn,
      signOut,
      isAuthenticated: !!user,
      fabricAuthEnabled: authService.fabricAuthEnabled,
    }),
    [user, loading, error, signIn, signOut, authService]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
