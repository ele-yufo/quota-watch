package io.quotawatch.data

import java.time.Instant

/**
 * Reset-countdown + relative-time formatting, matching the web dashboard and
 * the iOS `Formatting` enum output character-for-character.
 */
object Formatting {
    /** ms → "3d 04h" / "1h 30m" / "45m" / "<1m". */
    fun duration(ms: Double): String {
        if (ms < 60_000) return "<1m"
        val totalMin = (ms / 60_000).toInt()
        val d = totalMin / 1440
        val h = (totalMin % 1440) / 60
        val m = totalMin % 60
        if (d > 0) return "%dd %02dh".format(d, h)
        if (h > 0) return "%dh %02dm".format(h, m)
        return "${m}m"
    }

    /** A reset Instant → "3d 04h" / "now"; null when there's no reset time. */
    fun resetCountdown(date: Instant?, now: Instant = Instant.now()): String? {
        date ?: return null
        val ms = date.toEpochMilli() - now.toEpochMilli()
        if (ms <= 0) return "now"
        return duration(ms.toDouble())
    }

    /** A past Instant → "5s" / "3m" for "updated X ago". */
    fun ago(date: Instant, now: Instant = Instant.now()): String {
        val sec = maxOf(0, (now.epochSecond - date.epochSecond).toInt())
        if (sec < 60) return "${sec}s"
        return "${sec / 60}m"
    }

    private val parentheticalSuffix = Regex("""\s*\([^)]*\)\s*$""")

    /** "session (5h)" → "session" — strips a parenthetical suffix. */
    fun cleanWindowName(name: String): String =
        name.replace(parentheticalSuffix, "")
}
