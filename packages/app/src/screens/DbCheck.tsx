import { useEffect, useState } from 'react';
import type { DbCheckResult } from '@vaporflow/core';
import { usePlatform } from '../context/DbProvider';

export function DbCheck() {
  const { diagnostics, platform } = usePlatform();
  const [result, setResult] = useState<DbCheckResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contract, setContract] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    diagnostics?.read().then(
      (value) => {
        if (active) setResult(value);
      },
      (error) => {
        if (active) setError(String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [diagnostics]);
  if (!diagnostics) return null;
  async function run(create: boolean) {
    setBusy(true);
    setError('');
    try {
      setResult(await (create ? diagnostics!.createFixture() : diagnostics!.read()));
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function checkContract() {
    setBusy(true);
    setError('');
    setContract([]);
    try {
      setContract(await diagnostics!.runContract!());
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto mt-6 max-w-xl rounded border bg-white p-5 text-left">
      <h2 className="text-xl font-bold">Development DB check — {platform}</h2>
      <p className="mt-2">
        This uses a separate diagnostics database. It does not change shop data.
      </p>
      <p className="mt-2">
        Create the fixture once, close the app completely, reopen it, and refresh. The same IDs and
        counts should remain.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          disabled={busy}
          onClick={() => void run(true)}
          className="min-h-11 rounded bg-emerald-700 px-4 text-white disabled:opacity-50"
        >
          Create fixture
        </button>
        <button
          disabled={busy}
          onClick={() => void run(false)}
          className="min-h-11 rounded border px-4 disabled:opacity-50"
        >
          Refresh saved data
        </button>
        {diagnostics.runContract && (
          <button
            disabled={busy}
            onClick={() => void checkContract()}
            className="min-h-11 rounded border px-4 disabled:opacity-50"
          >
            Run adapter checks
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-red-700">
          {error}
        </p>
      )}
      {contract.length > 0 && (
        <p role="status" className="mt-3">
          Passed {contract.length} adapter checks: {contract.join('; ')}.
        </p>
      )}
      {result && (
        <dl className="mt-4 break-all text-sm" aria-live="polite">
          <dt>Saved fixture</dt>
          <dd>{result.exists ? 'Found' : 'Not created'}</dd>
          <dt>Products / variants</dt>
          <dd>
            {result.productCount} / {result.variantCount}
          </dd>
          <dt>Read-back name</dt>
          <dd>{result.readBackName || '—'}</dd>
          <dt>Shop ID</dt>
          <dd>{result.shopId}</dd>
          <dt>Variant ID</dt>
          <dd>{result.variantId}</dd>
        </dl>
      )}
    </section>
  );
}
