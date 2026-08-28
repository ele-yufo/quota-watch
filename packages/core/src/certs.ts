/**
 * certs.ts — TLS material for the daemon's embedded API.
 *
 * On first boot the daemon generates a local CA (EC P-256, 10 years) and a
 * server certificate (EC P-256, 3 years) with macOS's bundled /usr/bin/openssl
 * into ~/.quota-watch/certs/. Clients pin the CA's SHA-256 fingerprint (never
 * a CA bundle, never CN/SAN trust) — the fingerprint is handed out by the
 * daemon itself via POST /pair/claim, the only channel a pairing device talks
 * to before it has any trust anchor.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface TlsConfig {
  /** PEM CA certificate (what clients pin against). */
  caPath: string;
  /** PEM server certificate. */
  certPath: string;
  /** PEM server private key (0600). */
  keyPath: string;
  /** SHA-256 hex fingerprint of the CA's DER — the client pin. */
  caFingerprint: string;
}

const OPENSSL = "/usr/bin/openssl";

/** Days: CA 10y, server cert 3y. */
const CA_DAYS = 3650;
const CERT_DAYS = 1095;

function run(args: string[]): void {
  execFileSync(OPENSSL, args, { stdio: "pipe" });
}

/**
 * Generate (or reuse) the daemon's TLS material in `certsDir`. Idempotent —
 * existing files are never regenerated, so the fingerprint stays stable across
 * restarts. To rotate, delete the directory and restart the daemon.
 */
export function ensureTlsConfig(certsDir: string): TlsConfig {
  mkdirSync(certsDir, { recursive: true });
  const caKey = join(certsDir, "ca.key");
  const caCert = join(certsDir, "ca.crt");
  const serverKey = join(certsDir, "server.key");
  const serverCert = join(certsDir, "server.crt");
  const serverCsr = join(certsDir, "server.csr");
  const sanFile = join(certsDir, "server-san.cnf");

  if (!existsSync(caKey) || !existsSync(caCert)) {
    run(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", caKey]);
    // basicConstraints=CA:TRUE is REQUIRED — without it Node's TLS stack may
    // reject the CA as a trust anchor (RFC 5280). LibreSSL's req takes -addext.
    run([
      "req", "-new", "-x509", "-key", caKey, "-out", caCert,
      "-days", String(CA_DAYS), "-sha256", "-subj", "/CN=quota-watch local CA",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign",
    ]);
  }

  if (!existsSync(serverKey) || !existsSync(serverCert)) {
    // Clients only pin the CA fingerprint, but the server cert still needs a
    // SAN covering 127.0.0.1 — Node's built-in hostname verification on the
    // CLI/web side checks it. LAN IPs are covered by the pin, not the SAN.
    // Remote MCP clients reach the daemon through the frp tunnel's public
    // IP, so deploy-specific SANs come from QUOTA_WATCH_CERT_EXTRA_SANS
    // (comma-separated, openssl syntax: "IP:1.2.3.4,DNS:example.com").
    // Changing it only takes effect after deleting server.crt/server.key —
    // the CA (and thus the client pin) is untouched.
    const extraSans = (process.env.QUOTA_WATCH_CERT_EXTRA_SANS ?? "").trim();
    const sans = "IP:127.0.0.1,DNS:localhost" + (extraSans ? `,${extraSans}` : "");
    writeFileSync(sanFile, `subjectAltName=${sans}\nextendedKeyUsage=serverAuth\n`);
    run(["ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", serverKey]);
    run(["req", "-new", "-key", serverKey, "-out", serverCsr, "-sha256", "-subj", "/CN=quota-watch local"]);
    run([
      "x509", "-req", "-in", serverCsr, "-CA", caCert, "-CAkey", caKey,
      "-CAcreateserial", "-out", serverCert, "-days", String(CERT_DAYS),
      "-sha256", "-extfile", sanFile,
    ]);
    // Keep the CSR/SAN file? No — scratch material, never reused.
    try { unlinkSync(serverCsr); unlinkSync(sanFile); } catch { /* best effort */ }
  }

  const der = execFileSync(OPENSSL, ["x509", "-in", caCert, "-outform", "DER"]);
  const caFingerprint = createHash("sha256").update(der).digest("hex");

  return { caPath: caCert, certPath: serverCert, keyPath: serverKey, caFingerprint };
}

/** Read the CA PEM for clients that pass it to TLS stacks. */
export function readCaPem(caPath: string): string {
  return readFileSync(caPath, "utf-8");
}
