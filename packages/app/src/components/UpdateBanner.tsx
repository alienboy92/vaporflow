import { useUpdates } from '../context/UpdateProvider';

/** Non-blocking update notice shown above the workspace on every screen. */
export function UpdateBanner() {
  const updates = useUpdates();
  if (!updates.bannerVisible || !updates.info) return null;

  return (
    <div className="update-banner" role="status">
      <div className="min-w-0">
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
          onClick={() => void updates.openDownload()}
        >
          Download update
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
