package io.quotawatch

import io.quotawatch.net.PairingPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingPayloadTest {
    private val fp = "2f12aa8076b79d153692c57b9d11abfa624f37b59f774600865daf316ed62ecd"

    @Test fun `code payload`() {
        val p = PairingPayload.parse("qw://pair?host=192.168.1.5&port=3737&code=004751&fp=$fp")
        assertEquals("192.168.1.5", p!!.host)
        assertEquals(3737, p.port)
        assertEquals("004751", p.code) // leading zeros preserved
        assertNull(p.token)
        assertEquals(fp, p.caFingerprint)
    }

    @Test fun `legacy token payload`() {
        val p = PairingPayload.parse("qw://pair?host=mac.local&port=3737&token=deadbeef")
        assertEquals("deadbeef", p!!.token)
        assertNull(p.code)
        assertNull(p.caFingerprint)
    }

    @Test fun `payload without code or token is rejected`() {
        assertNull(PairingPayload.parse("qw://pair?host=192.168.1.5&port=3737"))
    }

    @Test fun `wrong scheme rejected`() {
        assertNull(PairingPayload.parse("https://pair?host=x&port=3737&code=123456"))
        assertNull(PairingPayload.parse("qw://other?host=x&port=3737&code=123456"))
    }

    @Test fun `empty host rejected`() {
        assertNull(PairingPayload.parse("qw://pair?host=&port=3737&code=123456"))
    }

    @Test fun `non-numeric or non-positive port rejected`() {
        assertNull(PairingPayload.parse("qw://pair?host=x&port=abc&code=123456"))
        assertNull(PairingPayload.parse("qw://pair?host=x&port=0&code=123456"))
    }

    @Test fun `url-encoded host decoded`() {
        val p = PairingPayload.parse("qw://pair?host=my%20mac.local&port=3737&code=123456")
        assertEquals("my mac.local", p!!.host)
    }

    @Test fun `garbage fp normalizes to null not crash`() {
        val p = PairingPayload.parse("qw://pair?host=x&port=3737&code=123456&fp=zzz")
        assertNull(p!!.caFingerprint)
    }
}
