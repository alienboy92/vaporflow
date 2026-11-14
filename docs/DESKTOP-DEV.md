# Desktop launch troubleshooting

Run all commands from `D:\Projects\VaporFlow` in PowerShell.

```powershell
pnpm install
pnpm dev:desktop
```

The runner logs the Electron executable, main entry, PID, stderr, loaded URL,
window visibility, and exit code/signal. Closing the window should report code 0
and stop Vite. An occupied port 5173 should fail with an error, not wait forever.
The runner removes `ELECTRON_RUN_AS_NODE` only from the Electron child's environment.

## Installation

The project pins pnpm 9.14.2 and `.npmrc` enables lifecycle scripts. A scoped
`extract-zip@2.0.1>yauzl` override selects 3.3.1: the older ZIP reader silently
abandons extraction on Node 24.17.0. No
`approve-builds` command is required in pnpm 9. If the global pnpm wrapper ignores
`.npmrc`, use the exact version explicitly:

```powershell
npm exec --yes --package=pnpm@9.14.2 -- pnpm config get ignore-scripts
npm exec --yes --package=pnpm@9.14.2 -- pnpm install
```

The first command should print `false`. To repair a missing Electron binary:

```powershell
Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue
npm exec --yes --package=pnpm@9.14.2 -- pnpm --filter @vaporflow/desktop exec node node_modules/electron/install.js
pnpm --filter @vaporflow/desktop exec electron --version
pnpm dev:desktop
```

Keep installer stderr if extraction fails. Antivirus interference was not established.
Do not manufacture `path.txt` for a partially extracted installation.

## Verification on 2026-11-14

- Before edits, the original runner launched Electron 33.4.11 and visibly rendered
  the Phase 0 shell. The reported missing window could not be reproduced.
- The original main/preload paths and localhost:5173 URL matched. Windows were
  visible by default. `ELECTRON_RUN_AS_NODE` was initially unset.
- Closing the original runner's window left its npx/Vite descendants listening
  on port 5173. A subsequent launch can fail before readiness; the old runner
  never rejected that wait. The new runner owns Vite in-process and closes it.
- The original sandboxed preload was incorrectly emitted as ESM. Both dev and
  production builds now emit a CommonJS `preload.cjs`, without a Node ESM banner.
  See [Electron's preload module rules](https://www.electronjs.org/docs/latest/tutorial/esm).
- The installed global pnpm package/config identified itself as 12.18.0 even
  though `pnpm --version` reported 9.14.2. Its config command ignored `.npmrc`.
  Explicit pnpm 9.14.2 correctly reported `ignore-scripts=false`.
- An isolated installation on Node 24.17.0 reproduced the original extraction
  problem despite `electron postinstall: Done`: only LICENSES.chromium.html was
  extracted, with no path.txt. Tracing stopped in the first ZIP entry. Applying
  only the scoped yauzl 3.3.1 override and rerunning install.js completed extraction;
  the resulting executable reported v33.4.11, with no manual archive extraction.
  This matches the [upstream stream bug](https://github.com/nodejs/node/issues/63487)
  and [yauzl fix](https://github.com/thejoshwolfe/yauzl/issues/169).
- A second clean isolated install with the override present from the start ran
  postinstall automatically and produced an executable reporting v33.4.11.
- Updated dev launch visibly rendered the styled shell. Normal window close
  logged code 0. Forced termination logged a nonzero code and failed the command.
  Inherited `ELECTRON_RUN_AS_NODE=1` was cleared and the window loaded successfully.
  An occupied Vite port reported an error and exited 1.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed, including runs through
  explicitly selected pnpm 9.14.2. Production main/preload compilation passed.

## Scope and remaining limits

No product features, database logic, or SPEC changes. The missing window after
manual extraction remains unreproduced. A full fresh monorepo clone, uncached binary
download, packaged Windows installer, and other operating systems were not tested.
The preload bridge was not directly evaluated in the renderer console; no preload
error was logged. Existing DevTools Autofill, React Router future-flag, and dev CSP
warnings remain outside this launch fix.
