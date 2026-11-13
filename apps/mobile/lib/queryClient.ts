import { QueryClient } from '@tanstack/react-query';

/**
 * Shared query cache.
 *
 * Lives in its own module (not inside the root layout) so that signing out can
 * clear it from anywhere. TanStack Query is configured for a network that is
 * usually bad and sometimes absent: data stays fresh for a minute, failed reads
 * retry twice with backoff, and a remount never triggers a refetch storm on a
 * 2G link.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
      retryDelay: (attempt) => Math.min(8000, 1000 * 2 ** attempt),
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
  },
});
