package io.quotawatch

import io.quotawatch.data.Formatting
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** Output parity with iOS Formatting.swift. */
class FormattingTest {
    @Test fun `duration under a minute`() = assertEquals("<1m", Formatting.duration(59_999.0))
    @Test fun `duration minutes only`() = assertEquals("45m", Formatting.duration(45.0 * 60_000))
    @Test fun `duration hours zero-padded minutes`() = assertEquals("1h 30m", Formatting.duration(90.0 * 60_000))
    @Test fun `duration hours small minutes`() = assertEquals("2h 05m", Formatting.duration(125.0 * 60_000))
    @Test fun `duration days zero-padded hours`() = assertEquals("3d 04h", Formatting.duration((3 * 1440 + 250.0) * 60_000))
    @Test fun `duration exactly one day`() = assertEquals("1d 00h", Formatting.duration(1440.0 * 60_000))

    @Test fun `resetCountdown null is null`() = assertNull(Formatting.resetCountdown(null))
    @Test fun `resetCountdown past is now`() {
        val now = Instant.parse("2026-08-28T10:00:00Z")
        assertEquals("now", Formatting.resetCountdown(now.minusSeconds(1), now))
    }
    @Test fun `resetCountdown future`() {
        val now = Instant.parse("2026-08-28T10:00:00Z")
        assertEquals("45m", Formatting.resetCountdown(now.plusSeconds(45 * 60), now))
    }

    @Test fun `ago seconds`() {
        val now = Instant.parse("2026-08-28T10:00:00Z")
        assertEquals("5s", Formatting.ago(now.minusSeconds(5), now))
    }
    @Test fun `ago minutes`() {
        val now = Instant.parse("2026-08-28T10:00:00Z")
        assertEquals("3m", Formatting.ago(now.minusSeconds(200), now))
    }

    @Test fun `cleanWindowName strips parenthetical`() =
        assertEquals("session", Formatting.cleanWindowName("session (5h)"))
    @Test fun `cleanWindowName keeps plain names`() =
        assertEquals("Claude+GPT", Formatting.cleanWindowName("Claude+GPT"))
    @Test fun `cleanWindowName strips only the suffix`() =
        assertEquals("Gemini", Formatting.cleanWindowName("Gemini (5h)"))
}
