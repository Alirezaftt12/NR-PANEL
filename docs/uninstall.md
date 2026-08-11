# Uninstall

Run `sudo nr-panel uninstall`. The first explicit phrase removes application services and the host Agent while preserving PostgreSQL/Redis data and backups. A second stronger phrase is required before deleting `/var/lib/nr-panel`.

Backups under `/var/backups/nr-panel` are preserved even when persistent runtime data is removed. Existing firewall policies are never flushed or disabled. Review and remove only the port recorded in `/etc/nr-panel/firewall-managed` if it is no longer needed.
