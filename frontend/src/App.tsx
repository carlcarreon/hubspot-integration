import { useEffect, useState } from 'react';

type HealthResponse = {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
};

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function checkApi(): Promise<void> {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });
        const result = (await response.json()) as HealthResponse;
        setHealth(result);
        setError(response.ok ? null : 'The API is reachable, but the database is not ready.');
      } catch (caughtError) {
        if ((caughtError as Error).name !== 'AbortError') {
          setError('The dashboard could not reach the API.');
        }
      }
    }

    void checkApi();
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center p-6">
      <section className="w-full rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Phase 1</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">HubSpot Order Sync</h1>
        <p className="mt-3 text-slate-600">
          The operations dashboard foundation is running. Sync views and retry controls arrive in later phases.
        </p>
        <div className="mt-6 rounded-lg bg-slate-50 p-4" aria-live="polite">
          <p className="font-medium text-slate-900">Backend health</p>
          {health && <p className="mt-1 text-emerald-700">API {health.status}; PostgreSQL is {health.database}.</p>}
          {!health && !error && <p className="mt-1 text-slate-600">Checking API…</p>}
          {error && <p className="mt-1 text-amber-700">{error}</p>}
        </div>
      </section>
    </main>
  );
}
