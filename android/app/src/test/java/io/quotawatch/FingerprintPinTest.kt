package io.quotawatch

import io.quotawatch.net.FingerprintPin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FingerprintPinTest {
    private val fp = "2f12aa8076b79d153692c57b9d11abfa624f37b59f774600865daf316ed62ecd"

    @Test fun `accepts canonical lowercase`() = assertEquals(fp, FingerprintPin.normalize(fp))

    @Test fun `accepts uppercase and groups`() {
        val grouped = fp.uppercase().chunked(8).joinToString(" ")
        assertEquals(fp, FingerprintPin.normalize(grouped))
    }

    @Test fun `accepts colon-separated`() {
        val colons = fp.chunked(2).joinToString(":").uppercase()
        assertEquals(fp, FingerprintPin.normalize(colons))
    }

    @Test fun `rejects wrong length`() {
        assertNull(FingerprintPin.normalize(fp.dropLast(1)))
        assertNull(FingerprintPin.normalize(fp + "0"))
    }

    @Test fun `rejects non-hex`() = assertNull(FingerprintPin.normalize(fp.replace('a', 'z')))
    @Test fun `rejects null and blank`() {
        assertNull(FingerprintPin.normalize(null))
        assertNull(FingerprintPin.normalize("   "))
    }

    @Test fun `sha256Hex known vector`() {
        // SHA-256("") — the well-known empty-message digest.
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            FingerprintPin.sha256Hex(ByteArray(0)),
        )
    }
}
