package org.seredina.agent

import java.security.MessageDigest

/** Lowercase hex sha256, the same shape as the server's sha256Hex. */
fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

fun sha256Hex(text: String): String = sha256Hex(text.toByteArray(Charsets.UTF_8))
