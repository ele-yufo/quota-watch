package io.quotawatch.net

import java.security.MessageDigest

/** CA fingerprint helpers — the daemon pins are 64 lowercase hex chars, no
 *  separators (certs.ts). Manual entry may carry spaces/uppercase/colons. */
object FingerprintPin {
    private val hex64 = Regex("[0-9a-f]{64}")

    /** Normalize user/QR input to canonical form; null when not a 64-hex value. */
    fun normalize(raw: String?): String? {
        if (raw == null) return null
        val cleaned = raw.trim().lowercase().replace(Regex("[\\s:]"), "")
        return if (hex64.matches(cleaned)) cleaned else null
    }

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
}
