package io.quotawatch.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

/**
 * Time-class of a quota window — mirrors core `WindowKind`. Unknown values
 * from a newer server decode to [UNKNOWN] rather than failing the whole row
 * (port of Models.swift's lenient decoder).
 */
@Serializable(with = WindowKindSerializer::class)
enum class WindowKind(val order: Int, val label: String, val displayName: String) {
    SESSION(0, "5h", "会话"),
    DAY(1, "24h", "日"),
    WEEK(2, "7d", "周"),
    MONTH(3, "1mo", "月"),
    BALANCE(4, "bal", "余额"),
    UNKNOWN(5, "—", "窗口");

    val wire: String get() = name.lowercase()
}

object WindowKindSerializer : KSerializer<WindowKind> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("WindowKind", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): WindowKind {
        val raw = decoder.decodeString()
        return WindowKind.entries.firstOrNull { it.wire == raw } ?: WindowKind.UNKNOWN
    }

    override fun serialize(encoder: Encoder, value: WindowKind) {
        encoder.encodeString(value.wire)
    }
}

/** One quota window — matches a row of `GET /quota` → provider.windows[]. */
@Serializable
data class QuotaWindow(
    val windowName: String,
    val windowKind: WindowKind,
    val used: Double,
    val total: Double,
    val unit: String,
    val remainingPct: Double,
    val resetAt: String? = null,
    val timestamp: String,
) {
    /** Consumed percentage — the headline number. */
    val usedPct: Double get() = (100 - remainingPct).coerceIn(0.0, 100.0)

    /** Clamped remaining percentage. */
    val remaining: Double get() = remainingPct.coerceIn(0.0, 100.0)

    /** The number to show under the current display mode (已用 vs 剩余). */
    fun displayPct(mode: QuotaDisplayMode): Double =
        if (mode == QuotaDisplayMode.REMAINING) remaining else usedPct

    /** Bar fill fraction under the current mode (0–1). */
    fun displayFraction(mode: QuotaDisplayMode): Double = displayPct(mode) / 100

    /** resetAt parsed to an Instant (ISO-8601), null if absent/unparseable. */
    val resetInstant: Instant?
        get() = resetAt?.let {
            try { Instant.parse(it) } catch (_: Exception) { null }
        }
}

/** Global display preference — used vs remaining. Persisted so app + widgets agree. */
enum class QuotaDisplayMode(val wire: String, val label: String) {
    USED("used", "已用"),
    REMAINING("remaining", "剩余");

    val next: QuotaDisplayMode get() = if (this == USED) REMAINING else USED

    companion object {
        fun fromWire(raw: String?): QuotaDisplayMode =
            entries.firstOrNull { it.wire == raw } ?: USED
    }
}

/** One provider — matches a top-level element of `GET /quota`. */
@Serializable
data class QuotaProvider(
    val providerId: String,
    val displayName: String,
    val providerType: String,
    val windows: List<QuotaWindow>,
) {
    /** Windows sorted by kind (server already sorts; re-sort defensively). */
    val sortedWindows: List<QuotaWindow> get() = windows.sortedBy { it.windowKind.order }

    /** The most-at-risk window (lowest remaining), null when no snapshot yet. */
    val primary: QuotaWindow? get() = windows.minByOrNull { it.remainingPct }
}

/** `GET /health` response — daemon liveness for the "test connection" flow. */
@Serializable
data class HealthResponse(
    val status: String,
    val pid: Int,
    val version: String = "dev",
    val uptimeSec: Int,
    val providers: List<HealthProvider> = emptyList(),
) {
    @Serializable
    data class HealthProvider(
        val id: String,
        val provider: String,
        val displayName: String,
        val pollIntervalMs: Int,
    )
}
