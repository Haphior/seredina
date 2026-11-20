package org.seredina.agent

import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder

/**
 * What the Devices page's enrollment QR carries
 * (docs/adr/0078-mobile-inventory.md):
 * `seredina://enroll?s=<server>&t=<one-time token>&p=<CA sha256>`.
 * `p` is there only when the server's certificate comes from a private CA:
 * the app downloads that CA and trusts it only if its hash matches.
 */
data class EnrollLink(val server: String, val token: String, val caSha256: String?) {
    companion object {
        private val SERVER = Regex("^https?://[^\\s/]+\\S*$", RegexOption.IGNORE_CASE)
        private val TOKEN = Regex("^ent_[A-Za-z0-9_-]{20,}$")
        private val SHA256 = Regex("^[0-9a-f]{64}$")

        /** The link, or null when the text isn't one (another QR code, a typo). */
        fun parse(text: String): EnrollLink? {
            val uri = try {
                URI(text.trim())
            } catch (e: URISyntaxException) {
                return null
            }
            if (!uri.scheme.equals("seredina", ignoreCase = true) || !uri.host.equals("enroll", ignoreCase = true)) return null
            val query = parseQuery(uri.rawQuery ?: return null)
            val server = query["s"]?.trim()?.trimEnd('/') ?: return null
            val token = query["t"]?.trim() ?: return null
            val pin = query["p"]?.trim()?.lowercase()?.ifEmpty { null }
            if (!SERVER.matches(server) || !TOKEN.matches(token)) return null
            if (pin != null && !SHA256.matches(pin)) return null
            return EnrollLink(server, token, pin)
        }

        private fun parseQuery(raw: String): Map<String, String> =
            raw.split('&').mapNotNull { part ->
                val i = part.indexOf('=')
                if (i <= 0) null else decode(part.substring(0, i)) to decode(part.substring(i + 1))
            }.toMap()

        private fun decode(s: String): String = URLDecoder.decode(s, "UTF-8")
    }
}
