package org.seredina.agent

import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

class ServerError(message: String, val status: Int = 0) : IOException(message)

/**
 * The few calls the agent makes. With a private CA, the connection trusts
 * exactly that CA (docs/adr/0054-server-address-and-tls.md); otherwise the
 * phone's own trusted certificates.
 */
class Server(private val baseUrl: String, caPem: String?) {
    private val socketFactory: SSLSocketFactory? = caPem?.let { socketFactoryFor(it) }

    fun post(path: String, body: JSONObject, credential: String? = null): JSONObject {
        val conn = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        if (conn is HttpsURLConnection && socketFactory != null) conn.sslSocketFactory = socketFactory
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Accept", "application/json")
            if (credential != null) conn.setRequestProperty("Authorization", "Bearer $credential")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val text = (if (status < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val json = try {
                if (text.isBlank()) JSONObject() else JSONObject(text)
            } catch (e: Exception) {
                JSONObject()
            }
            if (status >= 400) throw ServerError(errorMessage(json, status), status)
            return json
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        /** The server's error text, which may be a string or zod's flattened errors. */
        private fun errorMessage(json: JSONObject, status: Int): String {
            val error = json.opt("error")
            return when (error) {
                is String -> error
                null -> "HTTP $status"
                else -> "HTTP $status: ${error.toString().take(200)}"
            }
        }

        fun socketFactoryFor(pem: String): SSLSocketFactory {
            val certs = CertificateFactory.getInstance("X.509").generateCertificates(ByteArrayInputStream(pem.toByteArray(Charsets.US_ASCII)))
            if (certs.isEmpty()) throw ServerError("no certificate in the CA file")
            val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
            certs.forEachIndexed { i, c -> store.setCertificateEntry("ca$i", c) }
            val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
            return SSLContext.getInstance("TLS").apply { init(null, tmf.trustManagers, null) }.socketFactory
        }

        /**
         * Downloads the server's private CA and keeps it only if its sha256
         * matches the one in the enrollment QR. The download itself can't
         * verify the server yet (that's what the CA is for), so it trusts
         * any certificate -- for this one request, whose answer is then
         * checked against the hash the console showed.
         */
        fun fetchPinnedCa(baseUrl: String, expectedSha256: String): String {
            val conn = URL(baseUrl.trimEnd('/') + "/v1/devices/ca.pem").openConnection() as HttpURLConnection
            if (conn is HttpsURLConnection) {
                val acceptAny = object : X509TrustManager {
                    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
                    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
                }
                conn.sslSocketFactory = SSLContext.getInstance("TLS").apply { init(null, arrayOf(acceptAny), null) }.socketFactory
                conn.hostnameVerifier = javax.net.ssl.HostnameVerifier { _, _ -> true }
            }
            try {
                conn.connectTimeout = 15_000
                conn.readTimeout = 30_000
                if (conn.responseCode != 200) throw ServerError("the server has no private CA to download (HTTP ${conn.responseCode})", conn.responseCode)
                val pem = conn.inputStream.use { it.readBytes() }
                if (sha256Hex(pem) != expectedSha256) throw ServerError(Text.caMismatch)
                return String(pem, Charsets.US_ASCII)
            } finally {
                conn.disconnect()
            }
        }
    }
}
