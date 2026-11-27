import { useUpdates } from '../context/UpdateProvider';

/** Non-blocking update notice deferred while the cashier is selling. */
export function UpdateBanner({ duringSale }: { duringSale: boolean }) {
  const updates = useUpdates();
  if (duringSale || !updates.bannerVisible || !updates.info) return null;

  return (
    <div className="update-banner" role="status">
      <div className="min-w-0">
        {updates.error && <p role="alert">{updates.error}</p>}
        <strong>Update available: v{updates.info.latestVersion}</strong>
        <span className="hidden sm:inline">
          {' '}
          · You are on v{updates.info.currentVersion}.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="vf-btn-primary min-h-9 px-3 text-xs"
          disabled={updates.downloadState === 'downloading'}
          onClick={() => void updates.openDownload()}
        >
          {updates.downloadState === 'ready' ? 'Restart to update' : updates.downloadState === 'downloading' ? 'Downloading…' : 'Download update'}
        </button>
        <button
          type="button"
          className="vf-btn-ghost min-h-9 px-3 text-xs"
          onClick={updates.dismiss}
        >
          Later
        </button>
      </div>
    </div>
  );
}
