package io.quotawatch.data

import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * Built-in sample data for Demo mode — lets the full UI run with no daemon.
 * Port of DemoData.swift: same providers and percentages; reset times are
 * computed relative to now so countdowns look live. Demo data is never
 * written to the widget snapshot cache.
 */
object DemoData {
    fun providers(now: Instant = Instant.now()): List<QuotaProvider> {
        fun iso(seconds: Long): String =
            DateTimeFormatter.ISO_INSTANT.format(now.plusSeconds(seconds))

        fun win(name: String, kind: WindowKind, used: Double, resetIn: Long) = QuotaWindow(
            windowName = name, windowKind = kind,
            used = used, total = 100.0, unit = "percent",
            remainingPct = 100 - used, resetAt = iso(resetIn),
            timestamp = iso(0),
        )

        return listOf(
            QuotaProvider("demo-claude", "Claude Max", "claude", listOf(
                win("session (5h)", WindowKind.SESSION, 42.0, (3.5 * 3600).toLong()),
                win("weekly (7d)", WindowKind.WEEK, 63.0, (3.2 * 86400).toLong()),
            )),
            QuotaProvider("demo-codex", "Codex Business", "codex", listOf(
                win("session (5h)", WindowKind.SESSION, 18.0, (1.7 * 3600).toLong()),
                win("weekly (7d)", WindowKind.WEEK, 45.0, (4.4 * 86400).toLong()),
            )),
            QuotaProvider("demo-glm", "GLM CN", "glm-cn", listOf(
                win("session (5h)", WindowKind.SESSION, 8.0, (2.1 * 3600).toLong()),
                win("weekly (7d)", WindowKind.WEEK, 96.0, (3.1 * 86400).toLong()),
            )),
            QuotaProvider("demo-opencode", "OpenCode Go", "opencode-go", listOf(
                win("session (5h)", WindowKind.SESSION, 5.0, (4.9 * 3600).toLong()),
                win("weekly (7d)", WindowKind.WEEK, 37.0, (3.0 * 86400).toLong()),
                win("monthly (1mo)", WindowKind.MONTH, 18.0, (26.5 * 86400).toLong()),
            )),
            QuotaProvider("demo-kimi", "Kimi", "kimi", listOf(
                win("session (5h)", WindowKind.SESSION, 12.0, (2.4 * 3600).toLong()),
                win("weekly (7d)", WindowKind.WEEK, 24.0, (6.2 * 86400).toLong()),
            )),
            QuotaProvider("demo-antigravity", "Antigravity", "antigravity", listOf(
                win("Gemini (5h)", WindowKind.SESSION, 31.0, (4.0 * 3600).toLong()),
                win("Claude+GPT (5h)", WindowKind.SESSION, 74.0, (4.0 * 3600).toLong()),
            )),
        )
    }
}
