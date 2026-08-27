package io.quotawatch

import io.quotawatch.data.QuotaDisplayMode
import io.quotawatch.data.QuotaProvider
import io.quotawatch.data.QuotaWindow
import io.quotawatch.data.WindowKind
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelsTest {
    private fun win(kind: WindowKind, remainingPct: Double, name: String = kind.wire) =
        QuotaWindow(name, kind, used = 100 - remainingPct, total = 100.0, unit = "percent",
            remainingPct = remainingPct, resetAt = null, timestamp = "2026-08-28T00:00:00.000Z")

    @Test fun `sortedWindows by kind order`() {
        val p = QuotaProvider("id", "Name", "type", listOf(
            win(WindowKind.MONTH, 50.0), win(WindowKind.SESSION, 50.0), win(WindowKind.WEEK, 50.0)))
        assertEquals(listOf(WindowKind.SESSION, WindowKind.WEEK, WindowKind.MONTH),
            p.sortedWindows.map { it.windowKind })
    }

    @Test fun `primary picks lowest remaining`() {
        val p = QuotaProvider("id", "Name", "type", listOf(
            win(WindowKind.SESSION, 80.0), win(WindowKind.WEEK, 12.0)))
        assertEquals(12.0, p.primary!!.remainingPct, 0.001)
    }

    @Test fun `usedPct clamps out-of-range remaining`() {
        assertEquals(0.0, win(WindowKind.SESSION, 140.0).usedPct, 0.001)
        assertEquals(100.0, win(WindowKind.SESSION, -20.0).usedPct, 0.001)
    }

    @Test fun `displayPct respects mode`() {
        val w = win(WindowKind.SESSION, 30.0)
        assertEquals(70.0, w.displayPct(QuotaDisplayMode.USED), 0.001)
        assertEquals(30.0, w.displayPct(QuotaDisplayMode.REMAINING), 0.001)
    }

    @Test fun `unknown windowKind decodes leniently`() {
        val raw = """[{"providerId":"a","displayName":"A","providerType":"t","windows":[{
            "windowName":"x","windowKind":"fortnight","used":1,"total":2,"unit":"tokens",
            "remainingPct":50,"resetAt":null,"timestamp":"2026-08-28T00:00:00.000Z"}]}]"""
        val providers = Json { ignoreUnknownKeys = true }.decodeFromString<List<QuotaProvider>>(raw)
        assertEquals(WindowKind.UNKNOWN, providers[0].windows[0].windowKind)
        assertEquals("—", providers[0].windows[0].windowKind.label)
        assertEquals("窗口", providers[0].windows[0].windowKind.displayName)
    }

    @Test fun `resetInstant parses millis ISO and rejects junk`() {
        val w = QuotaWindow("n", WindowKind.SESSION, 0.0, 100.0, "percent", 50.0,
            "2026-08-28T08:00:00.000Z", "2026-08-28T00:00:00.000Z")
        assertEquals("2026-08-28T08:00:00Z", w.resetInstant.toString())
        val bad = w.copy(resetAt = "not-a-date")
        assertEquals(null, bad.resetInstant)
    }
}
