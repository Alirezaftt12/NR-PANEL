# Recovery

Use `sudo nr-panel show-access` to display the current URL, port, path, and OWNER username. It intentionally cannot recover the original plaintext password because authentication stores only Argon2id hashes.

Use `sudo nr-panel reset-password` or `sudo nr-panel reset-username`. Press Enter to generate a high-entropy value or pass a compliant value as the next argument. New values are printed once, active sessions are revoked, and the recovery is audited.

Other commands include `status`, `restart`, `logs`, `diagnostics`, `change-port`, `change-path`, `backup`, and `update`. Port/path changes validate input, update managed configuration, restart only required services, run a local health check, and restore the previous value on failure.

Backups are written to `/var/backups/nr-panel` with SHA-256 sidecars and mode `0600`. Configuration and Agent credentials under `/etc/nr-panel` are sensitive and must never be copied into public issue reports.
