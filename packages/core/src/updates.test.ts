import { describe, expect, it } from 'vitest';
import {
  checkForUpdate,
  compareVersions,
  githubReleaseApiUrl,
  isAllowedExternalUrl,
  isNewerVersion,
  parseVersion,
  pickDownloadUrl,
  type GithubRelease,
} from './updates.js';

const release: GithubRelease = {
  tag_name: 'v1.1.0',
  html_url: 'https://github.com/alienboy92/vaporflow/releases/tag/v1.1.0',
  body: '  Fixes returns and adds update checks.  ',
  published_at: '2026-11-22T10:00:00.000Z',
  assets: [
    {
      name: 'VaporFlow Setup 1.1.0.exe',
      browser_download_url:
        'https://github.com/alienboy92/vaporflow/releases/download/v1.1.0/VaporFlow-Setup-1.1.0.exe',
    },
    {
      name: 'VaporFlow-1.1.0.apk',
      browser_download_url:
        'https://github.com/alienboy92/vaporflow/releases/download/v1.1.0/VaporFlow-1.1.0.apk',
    },
  ],
};

function responding(payload: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe('update version comparison', () => {
  it('compares dotted versions numerically with optional v prefix and short forms', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.3')).toBe(-1);
    expect(parseVersion('v2.0.0+build.7')).toEqual({ core: [2, 0, 0], prerelease: [] });
  });

  it('treats prereleases as lower than the final release', () => {
    expect(compareVersions('1.1.0-beta.1', '1.1.0')).toBe(-1);
    expect(compareVersions('1.1.0', '1.1.0-rc.1')).toBe(1);
    expect(compareVersions('1.1.0-beta.2', '1.1.0-beta.1')).toBe(1);
    expect(compareVersions('1.1.0-beta', '1.1.0-beta.1')).toBe(-1);
  });

  it('refuses to advertise updates when a version is unparseable', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull();
    expect(isNewerVersion('latest', '1.0.0')).toBe(false);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });
});

describe('checkForUpdate', () => {
  it('reports a newer release and picks the desktop installer asset', async () => {
    const result = await checkForUpdate(responding(release), '1.0.0', 'desktop');
    expect(result.available).toBe(true);
    expect(result.latestVersion).toBe('1.1.0');
    expect(result.currentVersion).toBe('1.0.0');
    expect(result.releaseUrl).toBe(release.html_url);
    expect(result.downloadUrl).toContain('VaporFlow-Setup-1.1.0.exe');
    expect(result.notes).toBe('Fixes returns and adds update checks.');
    expect(result.publishedAt).toBe('2026-11-22T10:00:00.000Z');
  });

  it('selects the APK for Android', async () => {
    const result = await checkForUpdate(responding(release), '1.0.0', 'android');
    expect(result.downloadUrl).toContain('VaporFlow-1.1.0.apk');
  });

  it('reports no update when the running version is equal or newer', async () => {
    expect((await checkForUpdate(responding(release), '1.1.0', 'desktop')).available).toBe(false);
    expect((await checkForUpdate(responding(release), '1.2.0', 'desktop')).available).toBe(false);
  });

  it('rejects invalid tags, malformed payloads and HTTP errors', async () => {
    await expect(
      checkForUpdate(responding({ ...release, tag_name: 'latest' }), '1.0.0', 'desktop'),
    ).rejects.toThrow(/invalid version/i);
    await expect(
      checkForUpdate(responding({ tag_name: 'v1.1.0' }), '1.0.0', 'desktop'),
    ).rejects.toThrow();
    await expect(
      checkForUpdate(responding({ message: 'rate limited' }, 403), '1.0.0', 'desktop'),
    ).rejects.toThrow(/HTTP 403/);
  });

  it('returns null when the release has no asset for the platform', () => {
    const onlyApk = { ...release, assets: release.assets.slice(1) };
    expect(pickDownloadUrl(onlyApk, 'desktop')).toBeNull();
    expect(pickDownloadUrl(release, 'desktop')).toContain('.exe');
    expect(pickDownloadUrl(release, 'android')).toContain('.apk');
  });

  it('builds a validated GitHub API URL', () => {
    expect(githubReleaseApiUrl()).toBe(
      'https://api.github.com/repos/alienboy92/vaporflow/releases/latest',
    );
    expect(() => githubReleaseApiUrl('not a repo')).toThrow(/invalid update repository/i);
  });
});

describe('external URL allow-list', () => {
  it('only allows GitHub over HTTPS', () => {
    expect(isAllowedExternalUrl('https://github.com/alienboy92/vaporflow/releases')).toBe(true);
    expect(isAllowedExternalUrl('http://github.com/alienboy92/vaporflow/releases')).toBe(false);
    expect(isAllowedExternalUrl('https://evil.example/github.com')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });
});
