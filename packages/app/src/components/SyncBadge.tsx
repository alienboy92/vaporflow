import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCloudSync } from '../context/CloudSyncProvider';

export function SyncBadge() {
  const sync = useCloudSync();
  const { status, pendingCount, lastSuccessAt, lastError, isSyncing } = sync.status;
  const [error, setError] = useState('');
  const labels = { offline: 'Offline', pending: 'Pending', synced: 'Synced', error: 'Sync error' };
  return (
    <details className="sync-badge">
      <summary className={status}>
        {isSyncing ? 'Syncing…' : labels[status]}
        {status === 'pending' && ` (${pendingCount})`}
        {sync.status.problems.length > 0 && ` | ${sync.status.problems.length} records need attention`}
      </summary>
      <div className="sync-panel">
        <strong>Sync status</strong>
        {sync.status.problems.length > 0 && <Link to="/settings">Review records in Settings</Link>}
        <p>Last sync · {lastSuccessAt ? new Date(lastSuccessAt).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }) : 'Never'}</p>
        <p>Pending changes · {pendingCount}</p>
        {(error || lastError) && <p role="alert">{error || lastError}</p>}
        {sync.enrolledShopId ? (
          <button
            disabled={sync.busy || isSyncing}
            onClick={async () => {
              setError('');
              try {
                await sync.syncNow();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Sync failed');
              }
            }}
          >
            Sync now
          </button>
        ) : (
          <Link
            to="/settings"
            onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}
          >
            Connection settings
          </Link>
        )}
      </div>
    </details>
  );
}
