import { z } from 'zod';

/**
 * Update checking against GitHub Releases.
 *
 * The app never downloads or installs anything itself. It only compares its
 * own version with the latest published release and opens the matching
 * installer/APK link in the system browser.
 */

/** Repository that publishes Bali Hub POS releases. Override with VITE_UPDATE_REPO. */
export const DEFAULT_UPDATE_REPO = 'alienboy92/vaporflow';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const GithubReleaseAssetSchema = z.object({
  name: z.string().min(1),
  browser_download_url: z.string().url().refine(isAllowedExternalUrl),
  digest: z.string().nullable().optional(),
});

export const GithubReleaseSchema = z.object({
  tag_name: z.string().min(1),
  html_url: z.string().url().refine(isAllowedExternalUrl),
  body: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(GithubReleaseAssetSchema).default([]),
});

export type GithubRelease = z.infer<typeof GithubReleaseSchema>;

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  /** Platform installer/APK asset, or null when the release has no matching file. */
  downloadUrl: string | null;
  sha256: string | null;
  notes: string;
  publishedAt: string | null;
}

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

/**
 * Parses `v1.2.3`, `1.2`, `1.2.3-beta.1` and ignores build metadata (`+...`).
 * Returns null for anything that is not a dotted numeric version.
 */
export function parseVersion(input: string): ParsedVersion | null {
  const withoutPrefix = input.trim().replace(/^v/i, '');
  if (!/^(0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){1,2}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(withoutPrefix)) return null;
  const withoutBuild = withoutPrefix.split('+')[0] ?? '';
  const dashIndex = withoutBuild.indexOf('-');
  const main = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prereleaseText = dashIndex === -1 ? '' : withoutBuild.slice(dashIndex + 1);
  const parts = main.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const core: number[] = [];
  for (const part of parts) {
    if (!Number.isSafeInteger(Number(part))) return null;
    core.push(Number(part));
  }
  while (core.length < 3) core.push(0);
  if (prereleaseText.split('.').some(part => /^0\d+$/.test(part))) return null;
  return { core, prerelease: prereleaseText.split('.').filter(Boolean) };
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = BigInt(left) - BigInt(right);
      if (diff !== 0n) return diff < 0n ? -1 : 1;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Semver-style comparison. Returns -1, 0 or 1, or null when either version is
 * not parseable (callers should treat that as "unknown", never as "newer").
 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  const length = Math.max(a.core.length, b.core.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

/** Picks the release asset that matches the current platform. */
export function pickDownloadUrl(
  release: GithubRelease,
  platform: 'desktop' | 'android',
): string | null {
  const suffix = platform === 'android' ? '.apk' : '.exe';
  const match = release.assets.find((asset) => asset.name.toLowerCase().endsWith(suffix));
  return match?.browser_download_url ?? null;
}

export function githubReleaseApiUrl(repo = DEFAULT_UPDATE_REPO): string {
  if (!REPO_PATTERN.test(repo)) throw new Error('Invalid update repository');
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

export async function fetchLatestRelease(
  fetchImpl: typeof fetch,
  repo = DEFAULT_UPDATE_REPO,
): Promise<GithubRelease | null> {
  const response = await fetchImpl(githubReleaseApiUrl(repo), {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status})`);
  return GithubReleaseSchema.parse(await response.json());
}

/**
 * Fetches the latest release and compares it with the running version.
 * Network/shape errors are thrown; callers decide whether to show them.
 */
export async function checkForUpdate(
  fetchImpl: typeof fetch,
  currentVersion: string,
  platform: 'desktop' | 'android',
  repo = DEFAULT_UPDATE_REPO,
): Promise<UpdateCheckResult> {
  const release = await fetchLatestRelease(fetchImpl, repo);
  if (!release) return {
    available: false, currentVersion, latestVersion: currentVersion,
    releaseUrl: 'https://github.com/' + repo + '/releases', downloadUrl: null,
    sha256: null, notes: '', publishedAt: null,
  };
  const latestVersion = release.tag_name.trim().replace(/^v/i, '');
  const comparison = compareVersions(latestVersion, currentVersion);
  if (comparison === null) throw new Error('The latest release has an invalid version tag.');
  const downloadUrl = pickDownloadUrl(release, platform);
  const digest = release.assets.find(asset => asset.browser_download_url === downloadUrl)?.digest;
  return {
    available: comparison === 1,
    currentVersion,
    latestVersion,
    releaseUrl: release.html_url,
    downloadUrl,
    sha256: digest && /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest.slice(7) : null,
    notes: (release.body ?? '').trim().slice(0, 2000),
    publishedAt: release.published_at ?? null,
  };
}

/** Only GitHub HTTPS links may be opened by the app. */
export function isAllowedExternalUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && url.host.toLowerCase() === 'github.com' && !url.username && !url.password;
  } catch {
    return false;
  }
}
