# Updates and rollback

`sudo nr-panel update` resolves the latest stable release unless a version is pinned, creates a database backup, downloads SHA-256-verified release material, pulls versioned GHCR images, runs checksum-tracked migrations, deploys, and performs health checks. Master updates are never automatic.

Releases live under `/opt/nr-panel/releases/VERSION`; `/opt/nr-panel/current` points to the active version. The previous release is retained. If application health fails, the installer restores the previous release pointer and does not report success. Database migrations should remain backward compatible; restoration of a database backup is an explicit recovery operation.

GitHub Actions validates lint, types, tests, production builds, shell syntax/ShellCheck, migrations, Compose, and container builds before tagged artifacts are published. Images are repository-derived and version tagged.
