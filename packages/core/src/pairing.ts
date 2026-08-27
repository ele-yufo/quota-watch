/**
 * pairing.ts — short-lived pairing-code sessions (AirPlay-style).
 *
 * The token stays invisible to the user: the menu bar starts a session and
 * shows a 6-digit code (+ QR); the phone claims the code and receives the token
 * in exchange. A session is single-use, expires quickly, and is attempt-capped,
 * so exposing `/pair/claim` unauthenticated (the code IS the credential) is safe
 * even when the daemon is reachable over the public internet.
 */
import { randomInt } from "node:crypto";

export interface PairingSessionInfo {
  /** 6-digit pairing code the user reads / the QR embeds. */
  code: string;
  /** epoch ms when the code stops working. */
  expiresAt: number;
}

export type ClaimResult =
  | { ok: true; token: string | null }
  | { ok: false; reason: string };

/** How long a code stays valid, and how many wrong guesses kill the session. */
const CODE_TTL_MS = 5 * 60_000;
/** Wrong guesses allowed before the session is killed (the 9th guess is rejected). */
const MAX_WRONG_ATTEMPTS = 8;

let current: { code: string; expiresAt: number; attempts: number } | null = null;

/** Start (or replace) the active pairing session and return its code. */
export function startPairingSession(now: number = Date.now()): PairingSessionInfo {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  current = { code, expiresAt: now + CODE_TTL_MS, attempts: 0 };
  return { code, expiresAt: current.expiresAt };
}

/** The active session if one is live, else null. Pure read — expiry is
 *  enforced by claimPairingCode (which clears the session), not by reading. */
export function activePairingSession(now: number = Date.now()): PairingSessionInfo | null {
  if (!current || now > current.expiresAt) return null;
  return { code: current.code, expiresAt: current.expiresAt };
}

/** Cancel any active session (e.g. when the pairing sheet closes). */
export function cancelPairingSession(): void {
  current = null;
}

/**
 * Exchange a pairing code for the API token. Consumes the session on success
 * (single-use); counts wrong guesses and kills the session past the cap.
 */
export function claimPairingCode(
  code: string,
  token: string | null,
  now: number = Date.now(),
): ClaimResult {
  if (!current) return { ok: false, reason: "no active pairing session" };
  if (now > current.expiresAt) {
    current = null;
    return { ok: false, reason: "code expired" };
  }
  if (current.attempts >= MAX_WRONG_ATTEMPTS) {
    current = null;
    return { ok: false, reason: "too many attempts" };
  }
  if (typeof code !== "string" || code !== current.code) {
    current.attempts += 1;
    return { ok: false, reason: "invalid code" };
  }
  current = null; // single-use
  return { ok: true, token };
}
