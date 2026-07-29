import { useCallback, useEffect, useState } from 'react';

/**
 * Client-side catalog personalization (favorites, recently-viewed, recent
 * searches), persisted to localStorage. No backend/entity needed — this is
 * per-browser discovery state, mirroring how Databricks/Purview surface
 * "recents" and "favorites" on the catalog home.
 */
const FAV_KEY = 'onelens.favorites.v1';
const RECENT_KEY = 'onelens.recents.v1';
const SEARCH_KEY = 'onelens.recentSearches.v1';
const MAX_RECENTS = 12;
const MAX_SEARCHES = 8;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function useCatalogPrefs() {
  const [favorites, setFavorites] = useState<string[]>(() => load(FAV_KEY, []));
  const [recents, setRecents] = useState<string[]>(() => load(RECENT_KEY, []));
  const [recentSearches, setRecentSearches] = useState<string[]>(() => load(SEARCH_KEY, []));

  useEffect(() => save(FAV_KEY, favorites), [favorites]);
  useEffect(() => save(RECENT_KEY, recents), [recents]);
  useEffect(() => save(SEARCH_KEY, recentSearches), [recentSearches]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]));
  }, []);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  const recordView = useCallback((id: string) => {
    setRecents((r) => [id, ...r.filter((x) => x !== id)].slice(0, MAX_RECENTS));
  }, []);

  const recordSearch = useCallback((q: string) => {
    const term = q.trim();
    if (!term) return;
    setRecentSearches((s) => [term, ...s.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, MAX_SEARCHES));
  }, []);

  const clearSearches = useCallback(() => setRecentSearches([]), []);

  return {
    favorites,
    toggleFavorite,
    isFavorite,
    recents,
    recordView,
    recentSearches,
    recordSearch,
    clearSearches,
  };
}
