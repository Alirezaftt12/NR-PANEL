import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("production installer contract", () => {
  it("ships every direct-install and management entrypoint", () => {
    for (const path of ["install.sh", "node-install.sh", "deployment/installer/install.sh", "deployment/installer/node-install.sh", "deployment/installer/lib.sh", "deployment/installer/nr-panel"]) {
      expect(existsSync(resolve(root, path)), path).toBe(true);
      expect(read(path)).toContain("set -Eeuo pipefail");
    }
  });

  it("validates ports, paths, hosts, and IPv6 URL composition", () => {
    const library = read("deployment/installer/lib.sh");
    expect(library).toContain("10#$1 >= 1024");
    expect(library).toContain("10#$1 <= 65535");
    expect(library).toContain("{18,64}");
    expect(library).toContain("nr_valid_host");
    expect(library).toContain("printf '[%s]' \"$host\"");
    expect(library).toContain("ss -H -ltn");
  });

  it("generates production-only environment and secure initial values", () => {
    const installer = read("deployment/installer/install.sh");
    expect(installer).toContain("DEMO_MODE=false");
    expect(installer).toContain("openssl rand -hex 24");
    expect(installer).toContain("nr_random_secret 48");
    expect(installer).toContain("chmod 600 /etc/nr-panel/production.env /etc/nr-panel/compose.env");
    expect(installer).not.toMatch(/OWNER_PASSWORD=(admin|admin123|root|123456|nrpanel)(\s|$)/);
  });

  it("orders database health, migrations, OWNER bootstrap, and application health", () => {
    const installer = read("deployment/installer/install.sh");
    const database = installer.indexOf("pg_isready");
    const migration = installer.indexOf("dist/scripts/migrate.js");
    const bootstrap = installer.indexOf("dist/scripts/bootstrap-owner.js");
    const application = installer.lastIndexOf('"${COMPOSE[@]}" up -d api web proxy');
    const health = installer.lastIndexOf('/healthz');
    expect(database).toBeGreaterThan(-1);
    expect(migration).toBeGreaterThan(database);
    expect(bootstrap).toBeGreaterThan(migration);
    expect(application).toBeGreaterThan(bootstrap);
    expect(health).toBeGreaterThan(application);
  });

  it("uses real stateful services and verified versioned release artifacts", () => {
    const compose = read("deployment/compose/compose.production.yml");
    const installer = read("install.sh");
    const release = read(".github/workflows/release.yml");
    expect(compose).toContain("postgres:16.9-alpine");
    expect(compose).toContain("redis:7.4.5-alpine");
    expect(compose).not.toContain("DEMO_MODE=true");
    expect(installer).toContain("sha256sum -c");
    expect(release).toContain("linux/amd64,linux/arm64");
    expect(release).toContain("SHA256SUMS");
  });
});
