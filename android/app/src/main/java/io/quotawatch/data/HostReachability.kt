package io.quotawatch.data

/** RFC1918 private / loopback / .local classifier — port of HostReachability
 *  in PairingPayload.swift. Everything else (incl. any bare hostname) = public. */
object HostReachability {
    fun isPrivate(host: String): Boolean {
        val h = host.trim().lowercase()
        if (h == "localhost" || h == "127.0.0.1" || h == "::1") return true
        if (h.endsWith(".local")) return true
        val parts = h.split(".")
        if (parts.size != 4) return false // hostname/domain → assume public
        val nums = parts.map { it.toIntOrNull() ?: return false }
        if (nums.any { it !in 0..255 }) return false
        val (a, b) = nums[0] to nums[1]
        if (a == 10) return true
        if (a == 192 && b == 168) return true
        if (a == 172 && b in 16..31) return true
        if (a == 127) return true
        return false
    }
}
