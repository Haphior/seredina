package org.seredina.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EnrollLinkTest {
    private val token = "ent_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v"
    private val pin = "3f".repeat(32)

    @Test
    fun readsWhatTheConsoleEncodes() {
        // Built the way the Devices page builds it: URLSearchParams.
        val link = EnrollLink.parse("seredina://enroll?s=https%3A%2F%2Fhelpdesk.empresa.cl%2Fapi&t=$token&p=$pin")
        assertEquals(EnrollLink("https://helpdesk.empresa.cl/api", token, pin), link)
    }

    @Test
    fun pinIsOptionalAndCaseInsensitive() {
        assertEquals(null, EnrollLink.parse("seredina://enroll?s=http%3A%2F%2F10.0.0.5%3A3000&t=$token")?.caSha256)
        assertEquals(pin, EnrollLink.parse("SEREDINA://enroll?s=https%3A%2F%2Fa.b&t=$token&p=${pin.uppercase()}")?.caSha256)
    }

    @Test
    fun dropsATrailingSlash() {
        assertEquals("https://a.b/api", EnrollLink.parse("seredina://enroll?s=https%3A%2F%2Fa.b%2Fapi%2F&t=$token")?.server)
    }

    @Test
    fun refusesWhatIsNotAnEnrollmentCode() {
        assertNull(EnrollLink.parse("https://example.com"))
        assertNull(EnrollLink.parse("seredina://other?s=https%3A%2F%2Fa.b&t=$token"))
        assertNull(EnrollLink.parse("seredina://enroll?t=$token"))
        assertNull(EnrollLink.parse("seredina://enroll?s=https%3A%2F%2Fa.b"))
        assertNull(EnrollLink.parse("seredina://enroll?s=ftp%3A%2F%2Fa.b&t=$token"))
        assertNull(EnrollLink.parse("seredina://enroll?s=https%3A%2F%2Fa.b&t=dev_secret"))
        assertNull(EnrollLink.parse("seredina://enroll?s=https%3A%2F%2Fa.b&t=$token&p=abc"))
        assertNull(EnrollLink.parse("not a uri at all %%"))
    }

    @Test
    fun hashesLikeTheServer() {
        // sha256("abc"), the same digest packages/shared's sha256Hex gives.
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", sha256Hex("abc"))
    }
}
