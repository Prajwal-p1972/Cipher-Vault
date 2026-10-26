import { useState, useEffect, useCallback, useRef } from 'react';
import { request, ApiError } from '../api/http.js';

/**
 * Calculates YYYY-MM-DD ISO date strings for a given number of days back from today.
 *
 * @param {number} days
 * @returns {{ from: string, to: string }}
 */
export function getDateRange(days = 30) {
  const toDate = new Date();
  const fromDate = new Date(Date.now() - days * 86400000);
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10)
  };
}

/**
 * Hook fetching user-scoped analytics: overview metrics and paginated audit events.
 *
 * @param {number} [initialDays=30]
 * @returns {{
 *   days: number,
 *   setDays: (days: number) => void,
 *   overview: object | null,
 *   events: Array<object>,
 *   nextCursor: number | null,
 *   loading: boolean,
 *   eventsLoading: boolean,
 *   error: string | null,
 *   loadMoreEvents: () => Promise<void>,
 *   refetch: () => Promise<void>
 * }}
 */
export function useMyAnalytics(initialDays = 30) {
  const [days, setDays] = useState(initialDays);
  const [overview, setOverview] = useState(null);
  const [events, setEvents] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState(null);

  const isMountedRef = useRef(true);

  const fetchOverview = useCallback(async (selectedDays) => {
    const { from, to } = getDateRange(selectedDays);
    const data = await request(`/api/analytics/me/overview?from=${from}&to=${to}`);
    return data;
  }, []);

  const fetchInitialEvents = useCallback(async () => {
    const data = await request('/api/analytics/me/events?limit=25');
    return data;
  }, []);

  const refetch = useCallback(async () => {
    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const [overviewData, eventsData] = await Promise.all([
        fetchOverview(days),
        fetchInitialEvents()
      ]);

      if (!isMountedRef.current) return;

      setOverview(overviewData);
      setEvents(eventsData?.events || []);
      setNextCursor(eventsData?.nextCursor ?? null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err?.message || 'Failed to load analytics data.');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [days, fetchOverview, fetchInitialEvents]);

  const loadMoreEvents = useCallback(async () => {
    if (nextCursor === null || eventsLoading) return;

    setEventsLoading(true);
    try {
      const data = await request(`/api/analytics/me/events?limit=25&cursor=${nextCursor}`);
      if (!isMountedRef.current) return;

      setEvents((prev) => [...prev, ...(data?.events || [])]);
      setNextCursor(data?.nextCursor ?? null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err?.message || 'Failed to load additional events.');
    } finally {
      if (isMountedRef.current) {
        setEventsLoading(false);
      }
    }
  }, [nextCursor, eventsLoading]);

  useEffect(() => {
    isMountedRef.current = true;
    refetch();
    return () => {
      isMountedRef.current = false;
    };
  }, [refetch]);

  return {
    days,
    setDays,
    overview,
    events,
    nextCursor,
    loading,
    eventsLoading,
    error,
    loadMoreEvents,
    refetch
  };
}

/**
 * Hook fetching admin-scoped aggregate metrics and on-demand chain integrity verification.
 *
 * @param {number} [initialDays=30]
 * @returns {{
 *   days: number,
 *   setDays: (days: number) => void,
 *   systemOverview: object | null,
 *   chainHealth: object | null,
 *   loading: boolean,
 *   chainLoading: boolean,
 *   error: string | null,
 *   isForbidden: boolean,
 *   verifyChainNow: () => Promise<void>,
 *   refetch: () => Promise<void>
 * }}
 */
export function useAdminAnalytics(initialDays = 30) {
  const [days, setDays] = useState(initialDays);
  const [systemOverview, setSystemOverview] = useState(null);
  const [chainHealth, setChainHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chainLoading, setChainLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isForbidden, setIsForbidden] = useState(false);

  const isMountedRef = useRef(true);

  const refetch = useCallback(async () => {
    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
      setIsForbidden(false);
    }

    const { from, to } = getDateRange(days);

    try {
      const [overviewData, chainData] = await Promise.all([
        request(`/api/analytics/system/overview?from=${from}&to=${to}`),
        request('/api/analytics/system/chain')
      ]);

      if (!isMountedRef.current) return;

      setSystemOverview(overviewData);
      setChainHealth(chainData);
    } catch (err) {
      if (!isMountedRef.current) return;
      if (err instanceof ApiError && err.status === 403) {
        setIsForbidden(true);
        setError('Admin access required. You do not have permission to view system analytics.');
      } else {
        setError(err?.message || 'Failed to load system analytics.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [days]);

  const verifyChainNow = useCallback(async () => {
    if (chainLoading) return;
    setChainLoading(true);
    try {
      const freshChain = await request('/api/analytics/system/chain');
      if (isMountedRef.current) {
        setChainHealth(freshChain);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err?.message || 'Failed to verify audit chain.');
      }
    } finally {
      if (isMountedRef.current) {
        setChainLoading(false);
      }
    }
  }, [chainLoading]);

  useEffect(() => {
    isMountedRef.current = true;
    refetch();
    return () => {
      isMountedRef.current = false;
    };
  }, [refetch]);

  return {
    days,
    setDays,
    systemOverview,
    chainHealth,
    loading,
    chainLoading,
    error,
    isForbidden,
    verifyChainNow,
    refetch
  };
}
