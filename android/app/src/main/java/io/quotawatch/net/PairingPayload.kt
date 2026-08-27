package io.quotawatch.net

/**
 * Parser for the pairing QR payload: `qw://pair?host=..&port=..&[code=..|token=..][&fp=..]`
 * — pure Kotlin (no android.net.Uri) so it runs in JVM unit tests.
 * Port of PairingPayload.swift: legacy `token=` payloads are still accepted;
 * the 6-digit code keeps leading zeros (it is a string, never an int).
 */
data class PairingPayload(
    val host: String,
    val port: Int,
    val code: String? = null,
    val token: String? = null,
    val caFingerprint: String? = null,
) {
    companion object {
        fun parse(raw: String): PairingPayload? {
            val text = raw.trim()
            if (!text.startsWith("qw://pair")) return null
            val queryStart = text.indexOf('?')
            if (queryStart < 0) return null
            val params = mutableMapOf<String, String>()
            for (pair in text.substring(queryStart + 1).split('&')) {
                val eq = pair.indexOf('=')
                if (eq <= 0) continue
                val key = urlDecode(pair.substring(0, eq))
                val value = urlDecode(pair.substring(eq + 1))
                params[key] = value
            }
            val host = params["host"]?.trim().orEmpty()
            if (host.isEmpty()) return null
            val port = params["port"]?.toIntOrNull()?.takeIf { it > 0 } ?: return null
            val code = params["code"]?.takeIf { it.isNotEmpty() }
            val token = params["token"]?.takeIf { it.isNotEmpty() }
            if (code == null && token == null) return null
            val fp = FingerprintPin.normalize(params["fp"])
            return PairingPayload(host, port, code, token, fp)
        }

        private fun urlDecode(s: String): String = try {
            java.net.URLDecoder.decode(s, "UTF-8")
        } catch (_: Exception) {
            s
        }
    }
}
