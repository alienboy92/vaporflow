/**
 * App-lifetime owner of the cloud sync session.
 *
 * There is exactly ONE Supabase client and at most ONE SyncEngine for the
 * whole application: per-click clients break autoRefreshToken (access tokens
 * expire after ~1 hour) and orphan engines keep retrying with no UI. The
 * provider restores configuration, session, and enrollment from local
 * settings on mount, starts the engine automatically for an enrolled shop,
 * polls the sync status for the UI, and exposes the actions used by the
 * Settings screen and the Setup wizard.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useDb, usePlatform } from './DbProvider';
import {
  SettingsRepo,
  SYNC_TABLES,
  type SyncProblem,
  ShopRepo,
  createVaporFlowSupabaseClient,
  projectUrl,
  publicClientKey,
  claimShop,
  SupabaseSyncTransport,
  SyncEngine,
  probeShopExists,
  enrollExistingShop,
  enrollOwnerShop,
  restoreBackup,
  type VfBackup,
} from '@vaporflow/core';
import type { SyncState } from '@vaporflow/core';
import { globalErrorLogger } from '../utils/logger';

const OFFLINE_STATUS: SyncState = {
  status: 'offline',
  pendingCount: 0,
  lastSuccessAt: null,
  lastError: null,
  problems: [],
  isSyncing: false,
};

const STATUS_POLL_MS = 5000;

interface CloudSyncContextValue {
  /** Supabase URL + anon key are persisted in local settings. */
  configured: boolean;
  /** Signed-in cloud account email, or null. */
  email: string | null;
  /** Shop ID this device is enrolled to (claim or join), or null. */
  enrolledShopId: string | null;
  /** Live sync status, polled from the engine. */
  status: SyncState;
  /** True while an auth/claim/join/sync action is running. */
  busy: boolean;
  saveConfig(url: string, anonKey: string): Promise<void>;
  signUp(email: string, password: string): Promise<'signed-in' | 'confirmation-pending'>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** First device: claim the local shop and start syncing. */
  claimAndConnect(): Promise<void>;
  /** Second device on an empty device: join an existing cloud shop. */
  joinExistingShop(shopId: string, deviceName: string): Promise<{ deviceCode: string }>;
  syncNow(): Promise<void>;
  localCopy(problem: SyncProblem): Promise<unknown>;
  handleProblem(problem: SyncProblem, action: 'mine' | 'theirs' | 'retry'): Promise<void>;
  restore(backup: VfBackup): Promise<void>;
  /** Called by the sale screen after a sale; triggers the debounced sync. */
  saleCompleted(): void;
}

const CloudSyncContext = createContext<CloudSyncContextValue | null>(null);

export function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  const db = useDb();
  const platform = usePlatform();
  const [configured, setConfigured] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [enrolledShopId, setEnrolledShopId] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncState>(OFFLINE_STATUS);
  const [busy, setBusy] = useState(false);

  const clientRef = useRef<SupabaseClient | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const pollRef = useRef<number | null>(null);
  const enrolledShopRef = useRef<string | null>(null);
  const restoredRef = useRef(false);

  const stopEngine = useCallback(() => {
    // stop() also cancels any pending backoff retry or queued-sync callback,
    // so a replaced or disconnected engine cannot keep syncing in secret.
    engineRef.current?.stop();
    engineRef.current = null;
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setStatus(OFFLINE_STATUS);
  }, []);

  const adoptEngine = useCallback(
    async (engine: SyncEngine) => {
      stopEngine();
      engineRef.current = engine;
      pollRef.current = window.setInterval(() => {
        void engineRef.current
          ?.getStatus()
          .then(setStatus)
          .catch(() => {
            // polled again in 5s; nothing to propagate here
          });
      }, STATUS_POLL_MS);
      try {
        await engine.start();
      } catch (err) {
        // The engine stays started (interval + network hooks are live); the
        // failure is surfaced through status.lastError by the poll.
        globalErrorLogger.log(err);
      }
      try {
        setStatus(await engine.getStatus());
      } catch {
        // the poll updates it shortly
      }
    },
    [stopEngine],
  );

  const startEngineFor = useCallback(
    async (shopId: string) => {
      const client = clientRef.current;
      if (!client) throw new Error('Supabase is not configured yet.');
      await adoptEngine(
        new SyncEngine(db, new SupabaseSyncTransport(client), platform.network, shopId),
      );
    },
    [db, platform, adoptEngine],
  );

  // Restore configuration, session, and enrollment once on mount.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      const all = await new SettingsRepo(db).getAll();
      const url = all['supabase_url'];
      const anonKey = all['supabase_anon_key'];
      const enrolled = all['cloud_enrolled_shop_id'] ?? null;
      enrolledShopRef.current = enrolled;
      setEnrolledShopId(enrolled);
      if (!url || !anonKey) return;
      setConfigured(true);
      const client = createVaporFlowSupabaseClient(url, anonKey);
      clientRef.current = client;
      const { data } = await client.auth.getSession();
      const sessionEmail = data.session?.user?.email ?? null;
      setEmail(sessionEmail);
      // An enrolled device with a live session resumes syncing on app start —
      // the 8A app-start/network/interval/post-sale triggers take over here.
      if (all.cloud_join_shop && data.session && platform.network.isOnline()) {
        const result = await enrollExistingShop(db, new SupabaseSyncTransport(client), platform.network, all.cloud_join_shop, {
          identity: JSON.stringify([url, data.session.user.id]),
        });
        enrolledShopRef.current = all.cloud_join_shop;
        setEnrolledShopId(all.cloud_join_shop);
        await adoptEngine(result.engine);
        window.dispatchEvent(new Event('vf-enrolled'));
      } else if (all.cloud_claim_shop && data.session && platform.network.isOnline()) {
        await enrollOwnerShop(db, all.cloud_claim_shop, JSON.stringify([url, data.session.user.id]), id => claimShop(client, id));
        enrolledShopRef.current = all.cloud_claim_shop;
        setEnrolledShopId(all.cloud_claim_shop);
        await startEngineFor(all.cloud_claim_shop);
      } else if (sessionEmail && enrolled) {
        await startEngineFor(enrolled);
      }
    })().catch((err) => {
      globalErrorLogger.log(err);
    });
  }, [db, startEngineFor, adoptEngine, platform]);

  // App teardown: no orphaned timers or engines.
  useEffect(() => () => stopEngine(), [stopEngine]);

  const requireClient = useCallback((): SupabaseClient => {
    const client = clientRef.current;
    if (!client) {
      throw new Error('Configure your Supabase project URL and anon key first.');
    }
    return client;
  }, []);

  const saveConfig = useCallback(
    async (url: string, anonKey: string) => {
      const trimmedUrl = projectUrl(url);
      const trimmedKey = publicClientKey(anonKey);
      const settingsRepo = new SettingsRepo(db);
      await settingsRepo.setCloudConfig(trimmedUrl, trimmedKey);
      // A new URL/key means a new client: any running engine holds the old
      // transport and must be rebuilt.
      stopEngine();
      clientRef.current = createVaporFlowSupabaseClient(trimmedUrl, trimmedKey);
      setConfigured(true);
      if (enrolledShopRef.current) {
        await startEngineFor(enrolledShopRef.current);
      }
    },
    [db, stopEngine, startEngineFor],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<'signed-in' | 'confirmation-pending'> => {
      const client = requireClient();
      setBusy(true);
      try {
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) {
          setEmail(data.session.user.email ?? email);
          if (enrolledShopRef.current) {
            await startEngineFor(enrolledShopRef.current);
          }
          return 'signed-in';
        }
        return 'confirmation-pending';
      } finally {
        setBusy(false);
      }
    },
    [requireClient, startEngineFor],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const client = requireClient();
      setBusy(true);
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.session) {
          setEmail(data.session.user.email ?? email);
          if (enrolledShopRef.current) {
            await startEngineFor(enrolledShopRef.current);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [requireClient, startEngineFor],
  );

  const signOut = useCallback(async () => {
    const client = requireClient();
    setBusy(true);
    try {
      // Without a session every RPC gets a 401: stop the engine first.
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
      stopEngine();
      setEmail(null);
    } finally {
      setBusy(false);
    }
  }, [requireClient, stopEngine]);

  const claimAndConnect = useCallback(async () => {
    const client = requireClient();
    const shop = await new ShopRepo(db).getActiveShop();
    if (!shop) {
      throw new Error('Create your local shop first (complete the setup wizard).');
    }
    setBusy(true);
    try {
      const {data} = await client.auth.getSession();
      if (!data.session) throw new Error('Sign in to claim your shop.');
      const identity = JSON.stringify([await new SettingsRepo(db).get('supabase_url'), data.session.user.id]);
      await enrollOwnerShop(db, shop.id, identity, id => claimShop(client, id));
      enrolledShopRef.current = shop.id;
      setEnrolledShopId(shop.id);
      await startEngineFor(shop.id);
    } finally {
      setBusy(false);
    }
  }, [db, requireClient, startEngineFor]);

  const joinExistingShop = useCallback(
    async (shopIdInput: string, deviceName: string): Promise<{ deviceCode: string }> => {
      const client = requireClient();
      const shopId = shopIdInput.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shopId)) {
        throw new Error('Enter the Shop ID (a UUID) exactly as shown on the owner device.');
      }
      setBusy(true);
      try {
        const transport = new SupabaseSyncTransport(client);
        // Probe before claiming: claim_shop would CREATE a shop for an
        // unknown ID (and silently join it), so a typo must be caught with a
        // read-only pull first.
        if (!(await probeShopExists(transport, shopId))) {
          throw new Error(
            'No shop with this ID exists in the cloud. Copy the Shop ID from the owner device (Settings > Cloud Connection).',
          );
        }
        const claimed = await claimShop(client, shopId);
        if (!claimed) {
          throw new Error('Access denied: this cloud account is not a member of that shop.');
        }
        const {data: auth} = await client.auth.getSession();
        if (!auth.session) throw new Error('Sign in to resume enrollment.');
        const identity = JSON.stringify([await new SettingsRepo(db).get('supabase_url'), auth.session.user.id]);
        const result = await enrollExistingShop(db, transport, platform.network, shopId, {
          deviceName, identity,
        });

        enrolledShopRef.current = shopId;
        setEnrolledShopId(shopId);
        await adoptEngine(result.engine);
        return { deviceCode: result.deviceCode };
      } finally {
        setBusy(false);
      }
    },
    [db, platform, requireClient, adoptEngine],
  );

  const syncNow = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) {
      throw new Error('Not connected to the cloud yet. Connect first in Cloud Connection.');
    }
    setBusy(true);
    try {
      await engine.syncNow();
      const state = await engine.getStatus();
      setStatus(state);
      if (state.status === 'offline') throw new Error('Offline. Pending changes will retry when connected.');
      if (state.status === 'error') throw new Error(state.lastError ?? 'Review sync problems and retry.');
      if (state.isSyncing || state.pendingCount) throw new Error('Sync is pending. Check the status for progress.');
    } catch (err) {
      // Reflect the failure in the badge (lastError) before propagating.
      try {
        setStatus(await engine.getStatus());
      } catch {
        // already surfaced
      }
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const saleCompleted = useCallback(() => {
    engineRef.current?.saleCompleted();
  }, []);

  const value: CloudSyncContextValue = {
    configured,
    email,
    enrolledShopId,
    status,
    busy,
    saveConfig,
    signUp,
    signIn,
    signOut,
    claimAndConnect,
    joinExistingShop,
    syncNow,
    async localCopy(problem) {
      const table = SYNC_TABLES.find(name => name === problem.table);
      return table ? engineRef.current?.versioned?.localCopy(table,problem.id) : null;
    },
    async handleProblem(problem, action) {
      const engine = engineRef.current;
      const table = SYNC_TABLES.find(name => name === problem.table);
      if (!engine?.versioned || !table) throw new Error('Reconnect to review this record.');
      setBusy(true);
      try {
        await engine.stopAndDrain();
        if (action === 'retry') await engine.versioned.retry();
        else if (problem.version !== undefined) await engine.versioned.resolve(table, problem.id, problem.version, action === 'mine');
      } finally {
        await adoptEngine(engine);
        setBusy(false);
      }
    },
    async restore(backup) {
      const engine = engineRef.current;
      stopEngine();
      await engine?.stopAndDrain();
      try {
        await restoreBackup(db, backup);
      } catch (err) {
        if (engine) await adoptEngine(engine);
        throw err;
      }
    },
    saleCompleted,
  };

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}

export function useCloudSync(): CloudSyncContextValue {
  const ctx = useContext(CloudSyncContext);
  if (!ctx) {
    throw new Error('useCloudSync must be used inside <CloudSyncProvider>');
  }
  return ctx;
}
