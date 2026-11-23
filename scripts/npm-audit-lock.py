"""Project exact pnpm package versions and production reachability into an npm audit inventory."""
import json
import tempfile
from collections import deque
from pathlib import Path

import yaml  # PyYAML 6

root = Path(__file__).resolve().parent.parent
lock = yaml.safe_load((root / "pnpm-lock.yaml").read_text(encoding="utf-8"))
snapshots = lock["snapshots"]
pending = deque(
    f"{name}@{entry['version']}"
    for importer in lock["importers"].values()
    for group in ("dependencies", "optionalDependencies")
    for name, entry in importer.get(group, {}).items()
)
runtime = set()
while pending:
    key = pending.popleft()
    if key in runtime or key not in snapshots:
        continue
    runtime.add(key)
    for group in ("dependencies", "optionalDependencies"):
        pending.extend(f"{name}@{version}" for name, version in snapshots[key].get(group, {}).items())

# Each installed version gets its own npm alias. Keep npm from resolving fresh versions.
manifest = {"name": "vaporflow-audit", "version": "1.0.0", "private": True,
            "dependencies": {}, "devDependencies": {}}
packages = {"": manifest}
for index, key in enumerate(lock["packages"]):
    name, version = key.rsplit("@", 1)
    shipped = any(s == key or s.startswith(key + "(") for s in runtime)
    alias = f"vf-pkg-{index}"
    manifest["dependencies" if shipped else "devDependencies"][alias] = "npm:" + key
    packages["node_modules/" + alias] = {"name": name, "version": version, "dev": not shipped}

directory = Path(tempfile.mkdtemp(prefix="vf-npm-audit-"))
(directory / "package.json").write_text(json.dumps(manifest), encoding="utf-8")
(directory / "package-lock.json").write_text(json.dumps({
    "name": manifest["name"], "version": manifest["version"], "lockfileVersion": 3,
    "requires": True, "packages": packages,
}), encoding="utf-8")
print(directory)
