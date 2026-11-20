package org.seredina.agent

import android.content.Context
import android.content.SharedPreferences

/**
 * What enrollment leaves on the phone: the server, the device's own
 * credential, and the private CA it trusts (if any). App-private storage,
 * excluded from backups (allowBackup=false) so a credential never leaves
 * the phone.
 */
class Config(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("seredina-agent", Context.MODE_PRIVATE)

    var server: String?
        get() = prefs.getString("server", null)
        set(v) = prefs.edit().putString("server", v).apply()
    var credential: String?
        get() = prefs.getString("credential", null)
        set(v) = prefs.edit().putString("credential", v).apply()
    var caPem: String?
        get() = prefs.getString("caPem", null)
        set(v) = prefs.edit().putString("caPem", v).apply()
    var lastReportAt: Long
        get() = prefs.getLong("lastReportAt", 0L)
        set(v) = prefs.edit().putLong("lastReportAt", v).apply()
    var lastResult: String?
        get() = prefs.getString("lastResult", null)
        set(v) = prefs.edit().putString("lastResult", v).apply()
    var revoked: Boolean
        get() = prefs.getBoolean("revoked", false)
        set(v) = prefs.edit().putBoolean("revoked", v).apply()

    val enrolled: Boolean get() = server != null && credential != null

    fun clear() = prefs.edit().clear().apply()
}
