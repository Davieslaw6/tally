import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type MeResponse } from './api';
import { formatMoney } from '../../shared/money';
import type { Density, PublicUser, Settings, ThemeName } from '../../shared/types';

interface SessionValue {
  me: MeResponse | null;
  settings: Settings | null;
  user: PublicUser | null;
  loading: boolean;
  configured: boolean;
  theme: ThemeName;
  density: Density;
  adopt: (next: MeResponse) => void;
  refresh: () => Promise<MeResponse | null>;
  signOut: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings | null>;
  updateUser: (user: PublicUser, settings?: Settings) => void;
  previewTheme: (theme: ThemeName) => void;
  clear: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const THEME_COLOR: Record<ThemeName, string> = {
  light: '#f6f4ee',
  dark: '#141a17',
  contrast: '#000000',
};

function readInitialTheme(): ThemeName {
  const attribute = document.documentElement.dataset.theme;
  if (attribute === 'dark' || attribute === 'light' || attribute === 'contrast') return attribute;
  return 'light';
}

function readInitialDensity(): Density {
  return document.documentElement.dataset.density === 'compact' ? 'compact' : 'comfortable';
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<ThemeName>(readInitialTheme);
  const [density, setDensity] = useState<Density>(readInitialDensity);
  const meRef = useRef<MeResponse | null>(null);
  const queryClient = useQueryClient();
  meRef.current = me;

  const applyAppearance = useCallback((nextTheme: ThemeName, nextDensity: Density) => {
    setTheme(nextTheme);
    setDensity(nextDensity);
    document.documentElement.setAttribute('data-theme', nextTheme);
    document.documentElement.setAttribute('data-density', nextDensity);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[nextTheme]);
    try {
      localStorage.setItem('tally:theme', nextTheme);
      localStorage.setItem('tally:density', nextDensity);
    } catch {
      // Private browsing can reject storage; the in-memory theme still applies.
    }
  }, []);

  const clear = useCallback(() => {
    setMe(null);
    queryClient.clear();
  }, [queryClient]);

  const refresh = useCallback(async () => {
    try {
      const next = await api.me();
      setMe(next);
      setConfigured(true);
      applyAppearance(next.settings.theme, next.settings.density);
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setMe(null);
        return null;
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }, [applyAppearance]);

  useEffect(() => {
    let active = true;
    api
      .authStatus()
      .then(async (status) => {
        if (!active) return;
        setConfigured(status.configured);
        if (!status.authenticated) {
          setMe(null);
          return;
        }
        const next = await api.me();
        if (!active) return;
        setMe(next);
        applyAppearance(next.settings.theme, next.settings.density);
      })
      .catch(() => {
        if (active) setMe(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyAppearance]);

  useEffect(() => {
    const unauthorized = () => {
      if (meRef.current) clear();
    };
    window.addEventListener('tally:unauthorized', unauthorized);
    return () => window.removeEventListener('tally:unauthorized', unauthorized);
  }, [clear]);

  const adopt = useCallback(
    (next: MeResponse) => {
      queryClient.clear();
      setMe(next);
      setConfigured(true);
      setLoading(false);
      applyAppearance(next.settings.theme, next.settings.density);
    },
    [applyAppearance, queryClient],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    clear();
  }, [clear]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (patch.theme || patch.density) {
        applyAppearance(patch.theme ?? theme, patch.density ?? density);
      }
      try {
        const result = await api.updateSettings(patch);
        setMe((current) => (current ? { ...current, settings: result.settings } : current));
        if (result.settings.theme !== theme || result.settings.density !== density) {
          applyAppearance(result.settings.theme, result.settings.density);
        }
        return result.settings;
      } catch (error) {
        const previous = meRef.current?.settings;
        if (previous) applyAppearance(previous.theme, previous.density);
        throw error;
      }
    },
    [applyAppearance, density, theme],
  );

  const updateUser = useCallback((user: PublicUser, settings?: Settings) => {
    setMe((current) => (current ? { user, settings: settings ?? current.settings } : current));
  }, []);

  const previewTheme = useCallback(
    (next: ThemeName) => {
      applyAppearance(next, density);
    },
    [applyAppearance, density],
  );

  const value = useMemo<SessionValue>(
    () => ({
      me,
      settings: me?.settings ?? null,
      user: me?.user ?? null,
      loading,
      configured,
      theme,
      density,
      adopt,
      refresh,
      signOut,
      updateSettings,
      updateUser,
      previewTheme,
      clear,
    }),
    [me, loading, configured, theme, density, adopt, refresh, signOut, updateSettings, updateUser, previewTheme, clear],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function useMoney() {
  const { user } = useSession();
  return useCallback(
    (
      cents: number,
      options: { signed?: boolean; absolute?: boolean; compact?: boolean; maximumFractionDigits?: number } = {},
    ) => formatMoney(cents, user?.currency || 'USD', user?.locale || 'en-US', options),
    [user?.currency, user?.locale],
  );
}

export function useFormatDate() {
  const { user } = useSession();
  return useCallback(
    (value: string, style: 'short' | 'long' | 'month' = 'short') => {
      if (!value) return '';
      const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
      if (Number.isNaN(date.getTime())) return value;
      if (style === 'month') {
        return new Intl.DateTimeFormat(user?.locale || 'en-US', {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(date);
      }
      return new Intl.DateTimeFormat(user?.locale || 'en-US', {
        month: 'short',
        day: 'numeric',
        year: style === 'long' ? 'numeric' : undefined,
        timeZone: 'UTC',
      }).format(date);
    },
    [user?.locale],
  );
}
