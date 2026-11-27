import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  APP_VERSION,
  checkForUpdate,
  DEFAULT_UPDATE_REPO,
  type UpdateCheckResult,
} from '@bali-hub-pos/core';
import { usePlatform } from './DbProvider';
import { globalErrorLogger } from '../utils/logger';

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'error';

/** Automatic checks run on launch and then every six hours. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DISMISSED_KEY = 'vf_update_dismissed_version';
const LAST_CHECKED_KEY = 'vf_update_last_checked';

const UPDATE_REPO =
  (import.meta.env.VITE_UPDATE_REPO as string | undefined)?.trim() || DEFAULT_UPDATE_REPO;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable (private mode, tests); the banner simply reappears.
  }
}

export interface UpdatesContextValue {
  downloadState: 'idle' | 'downloading' | 'ready';
  status: UpdateStatus;
  info: UpdateCheckResult | null;
  error: string;
  lastChecked: string | null;
  bannerVisible: boolean;
  /** Manual checks surface errors; automatic checks fail silently. */
  check: (manual?: boolean) => Promise<void>;
  dismiss: () => void;
  openDownload: () => Promise<void>;
}

const UpdatesContext = createContext<UpdatesContextValue | null>(null);

const fallback: UpdatesContextValue = {
  downloadState: 'idle',
  status: 'idle',
  info: null,
  error: '',
  lastChecked: null,
  bannerVisible: false,
  check: async () => {},
  dismiss: () => {},
  openDownload: async () => {},
};

/**
 * Safe outside the provider so screens remain renderable in isolated tests.
 * The real provider is mounted once in `App`.
 */
export function useUpdates(): UpdatesContextValue {
  return useContext(UpdatesContext) ?? fallback;
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [info, setInfo] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState('');
  const [lastChecked, setLastChecked] = useState<string | null>(() => readStorage(LAST_CHECKED_KEY));
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() =>
    readStorage(DISMISSED_KEY),
  );
  const [downloadState, setDownloadState] = useState<UpdatesContextValue['downloadState']>('idle');
  const inFlight = useRef(false);

  const check = useCallback(
    async (manual = false) => {
      if (downloadState !== 'idle' || inFlight.current) return;
      if (!platform.network.isOnline()) {
        if (manual) {
          setStatus('error');
          setError('You are offline. Connect to the internet and try again.');
        }
        return;
      }
      if (typeof fetch !== 'function') {
        if (manual) {
          setStatus('error');
          setError('Update checks are not available on this device.');
        }
        return;
      }

      inFlight.current = true;
      if (manual) setStatus('checking');
      if (manual) setError('');
      try {
        const result = await checkForUpdate(fetch, APP_VERSION, platform.platform, UPDATE_REPO);
        setInfo(result);
        setStatus(result.available ? 'available' : 'current');
        setError('');
        const now = new Date().toISOString();
        setLastChecked(now);
        writeStorage(LAST_CHECKED_KEY, now);
      } catch (err) {
        globalErrorLogger.log(err);
        if (manual) {
          setStatus('error');
          setError('Could not check for updates. Check your internet connection and try again.');
        }
      } finally {
        inFlight.current = false;
      }
    },
    [platform, downloadState],
  );

  useEffect(() => {
    // Tests run without network and with fake timers; never auto-fetch there.
    if (import.meta.env.MODE === 'test') return;
    void check(false);
    const timer = window.setInterval(() => void check(false), CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [check]);

  const dismiss = useCallback(() => {
    if (!info) return;
    setDismissedVersion(info.latestVersion);
    writeStorage(DISMISSED_KEY, info.latestVersion);
  }, [info]);

  const openDownload = useCallback(async () => {
    if (!info) return;
    const url = info.downloadUrl ?? info.releaseUrl;
    try {
      if (platform.platform === 'desktop') {
        if (downloadState === 'downloading') return;
        setError('');
        if (downloadState === 'ready') {
          if (!platform.app.restartToUpdate) throw new Error('Updater unavailable');
          await platform.app.restartToUpdate();
        } else {
          if (!platform.app.downloadUpdate) throw new Error('Updater unavailable');
          setDownloadState('downloading');
          await platform.app.downloadUpdate();
          setDownloadState('ready');
        }
        return;
      }
      if (platform.app) {
        await platform.app.openExternal(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      globalErrorLogger.log(err);
      if (platform.platform === 'desktop') {
        setDownloadState(downloadState === 'ready' ? 'ready' : 'idle');
        setError('The Windows update could not finish. Please try again.');
        return;
      }
      setStatus('error');
      setError('Could not open the download link. Open the release page manually.');
    }
  }, [info, platform, downloadState]);

  const value = useMemo<UpdatesContextValue>(
    () => ({
      downloadState,
      status,
      info,
      error,
      lastChecked,
      bannerVisible:
        status === 'available' && info?.available === true && dismissedVersion !== info.latestVersion,
      check,
      dismiss,
      openDownload,
    }),
    [downloadState, status, info, error, lastChecked, dismissedVersion, check, dismiss, openDownload],
  );

  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}
