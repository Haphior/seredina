package org.seredina.agent

import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.os.SystemClock
import android.provider.Settings
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.NetworkInterface
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * The phone's inventory in the server's schema 2
 * (apps/api/src/modules/devices/inventorySchema.ts), plus its `mobile`
 * section -- docs/adr/0078-mobile-inventory.md. Only what an ordinary app
 * may read: no IMEI or serial (Android 10+ keeps them for the device's MDM),
 * nothing personal (no photos, messages, contacts, location).
 */
object Inventory {
    private const val GB = 1024.0 * 1024.0 * 1024.0
    private const val MAX_APPS = 2000

    fun deviceName(ctx: Context): String {
        val named = Settings.Global.getString(ctx.contentResolver, Settings.Global.DEVICE_NAME)
        return named?.trim()?.ifEmpty { null } ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }

    /** sha256 of the app-scoped ANDROID_ID: the same phone re-enrolling keeps its record. */
    @SuppressLint("HardwareIds")
    fun fingerprint(ctx: Context): String? {
        val id = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: return null
        return sha256Hex("android:$id")
    }

    fun isTablet(ctx: Context): Boolean = ctx.resources.configuration.smallestScreenWidthDp >= 600

    /** The check-in body: the short summary columns and the full inventory. */
    fun checkInBody(ctx: Context): JSONObject {
        val storage = storage()
        val encrypted = encrypted(ctx)
        val memoryMb = memoryMb(ctx)
        val body = JSONObject()
            .put("osVersion", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            .put("inventory", collect(ctx, storage, encrypted, memoryMb))
        if (memoryMb > 0) body.put("memoryTotalMb", memoryMb)
        if (encrypted != null) body.put("diskEncrypted", encrypted)
        if (storage != null) {
            body.put("diskSummary", JSONArray().put(JSONObject().put("mount", "/data").put("totalGb", storage.first).put("freeGb", storage.second)))
        }
        return body
    }

    private fun collect(ctx: Context, storage: Pair<Double, Double>?, encrypted: Boolean?, memoryMb: Long): JSONObject {
        val inv = JSONObject()
            .put("schema", 2)
            .put("collectedAt", iso(System.currentTimeMillis()))
            .put(
                "system",
                JSONObject()
                    .put("manufacturer", Build.MANUFACTURER)
                    .put("model", Build.MODEL)
                    .put("formFactor", if (isTablet(ctx)) "tablet" else "phone")
                    .put("timezone", TimeZone.getDefault().id),
            )
            .put(
                "os",
                JSONObject()
                    .put("name", "Android")
                    .put("version", Build.VERSION.RELEASE)
                    .put("build", Build.DISPLAY.take(200))
                    .putOpt("arch", Build.SUPPORTED_ABIS.firstOrNull())
                    .putOpt("kernel", System.getProperty("os.version"))
                    .put("lastBoot", iso(System.currentTimeMillis() - SystemClock.elapsedRealtime())),
            )
            .put("cpu", JSONObject().put("model", cpuModel()).put("threads", Runtime.getRuntime().availableProcessors()))

        if (memoryMb > 0) inv.put("memory", JSONObject().put("totalMb", memoryMb))
        if (storage != null) {
            val volume = JSONObject().put("mount", "/data").put("totalGb", storage.first).put("freeGb", storage.second)
            if (encrypted != null) volume.put("encrypted", encrypted)
            inv.put("volumes", JSONArray().put(volume))
        }
        inv.put("network", network())
        inv.put("software", apps(ctx))
        val security = JSONObject()
        if (encrypted != null) security.put("systemDiskEncrypted", encrypted)
        inv.put("security", security)
        inv.put("mobile", mobile(ctx, storage))
        return inv
    }

    private fun mobile(ctx: Context, storage: Pair<Double, Double>?): JSONObject {
        val keyguard = ctx.getSystemService(KeyguardManager::class.java)
        val battery = ctx.getSystemService(BatteryManager::class.java)
        val m = JSONObject()
            .put("deviceName", deviceName(ctx).take(200))
            .put("brand", Build.BRAND)
            .put("securityPatch", Build.VERSION.SECURITY_PATCH)
            .put("apiLevel", Build.VERSION.SDK_INT)
            .put("sims", sims(ctx))
            .put("developerOptions", globalFlag(ctx, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED))
            .put("usbDebugging", globalFlag(ctx, Settings.Global.ADB_ENABLED))
            .put("rooted", rooted())
        if (keyguard != null) m.put("screenLockSecure", keyguard.isDeviceSecure)
        if (battery != null) {
            val percent = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            if (percent in 0..100) m.put("batteryPercent", percent)
            m.put("charging", battery.isCharging)
        }
        if (storage != null) m.put("storageTotalGb", storage.first).put("storageFreeGb", storage.second)
        return m
    }

    /** Each SIM's carrier and, when the SIM and permission allow, its number. */
    @SuppressLint("MissingPermission")
    private fun sims(ctx: Context): JSONArray {
        val sims = JSONArray()
        if (granted(ctx, Manifest.permission.READ_PHONE_STATE)) {
            val manager = ctx.getSystemService(SubscriptionManager::class.java)
            val subscriptions: List<SubscriptionInfo> = try {
                manager?.activeSubscriptionInfoList ?: emptyList()
            } catch (e: SecurityException) {
                emptyList()
            }
            for (info in subscriptions.take(4)) {
                val sim = JSONObject().put("slot", info.simSlotIndex.coerceAtLeast(0))
                val carrier = info.carrierName?.toString()?.trim()?.ifEmpty { null } ?: info.displayName?.toString()?.trim()
                sim.putOpt("carrier", carrier?.take(200))
                info.countryIso?.trim()?.ifEmpty { null }?.let { sim.put("countryIso", it.take(10)) }
                phoneNumber(ctx, manager, info)?.let { sim.put("phoneNumber", it.take(40)) }
                sims.put(sim)
            }
        }
        if (sims.length() == 0) {
            // Without the permission: at least the carrier of the default SIM.
            val tm = ctx.getSystemService(TelephonyManager::class.java)
            val name = tm?.simOperatorName?.trim()
            if (!name.isNullOrEmpty()) {
                sims.put(JSONObject().put("carrier", name.take(200)).putOpt("countryIso", tm.simCountryIso?.ifEmpty { null }))
            }
        }
        return sims
    }

    @SuppressLint("MissingPermission", "HardwareIds")
    @Suppress("DEPRECATION")
    private fun phoneNumber(ctx: Context, manager: SubscriptionManager?, info: SubscriptionInfo): String? {
        if (!granted(ctx, Manifest.permission.READ_PHONE_NUMBERS) && !granted(ctx, Manifest.permission.READ_PHONE_STATE)) return null
        val number = try {
            if (Build.VERSION.SDK_INT >= 33 && manager != null) manager.getPhoneNumber(info.subscriptionId) else info.number
        } catch (e: SecurityException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
        return number?.trim()?.ifEmpty { null }
    }

    /** Apps the user (or the company) installed -- not the system's own. */
    @Suppress("DEPRECATION")
    private fun apps(ctx: Context): JSONArray {
        val pm = ctx.packageManager
        val list = JSONArray()
        val packages = try {
            pm.getInstalledPackages(0)
        } catch (e: RuntimeException) {
            emptyList()
        }
        val user = packages.filter { p ->
            val flags = p.applicationInfo?.flags ?: 0
            flags and ApplicationInfo.FLAG_SYSTEM == 0 || flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP != 0
        }
        for (p in user.sortedBy { it.packageName }.take(MAX_APPS)) {
            val app = p.applicationInfo
            val label = app?.loadLabel(pm)?.toString()?.trim()?.ifEmpty { null } ?: p.packageName
            list.put(
                JSONObject()
                    .put("name", label.take(200))
                    .putOpt("version", p.versionName?.take(100))
                    .put("publisher", p.packageName.take(200))
                    .put("installDate", day(p.firstInstallTime))
                    .put("source", installSource(pm, p.packageName)),
            )
        }
        return list
    }

    @Suppress("DEPRECATION")
    private fun installSource(pm: PackageManager, pkg: String): String {
        val installer = try {
            if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(pkg).installingPackageName else pm.getInstallerPackageName(pkg)
        } catch (e: Exception) {
            null
        }
        return when (installer) {
            null -> "sideloaded"
            "com.android.vending" -> "play"
            else -> installer.take(30)
        }
    }

    private fun network(): JSONArray {
        val list = JSONArray()
        val interfaces = try {
            NetworkInterface.getNetworkInterfaces()?.toList() ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
        for (ni in interfaces.take(16)) {
            if (ni.isLoopback || !ni.isUp) continue
            val addresses = ni.inetAddresses.toList()
            val v4 = addresses.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
            val v6 = addresses.filterIsInstance<Inet6Address>().mapNotNull { it.hostAddress?.substringBefore('%') }
            if (v4.isEmpty() && v6.isEmpty()) continue
            list.put(
                JSONObject()
                    .put("name", ni.name.take(200))
                    .put("ipv4", JSONArray(v4.take(32)))
                    .put("ipv6", JSONArray(v6.take(32)))
                    .put("up", true),
            )
        }
        return list
    }

    private fun storage(): Pair<Double, Double>? = try {
        val stat = StatFs(Environment.getDataDirectory().path)
        round(stat.totalBytes / GB) to round(stat.availableBytes / GB)
    } catch (e: Exception) {
        null
    }

    private fun memoryMb(ctx: Context): Long {
        val am = ctx.getSystemService(ActivityManager::class.java) ?: return 0
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        return info.totalMem / (1024 * 1024)
    }

    @Suppress("DEPRECATION")
    private fun encrypted(ctx: Context): Boolean? {
        val dpm = ctx.getSystemService(DevicePolicyManager::class.java) ?: return null
        return when (dpm.storageEncryptionStatus) {
            DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE,
            DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_PER_USER,
            DevicePolicyManager.ENCRYPTION_STATUS_ACTIVE_DEFAULT_KEY,
            -> true
            DevicePolicyManager.ENCRYPTION_STATUS_INACTIVE -> false
            else -> null
        }
    }

    private fun cpuModel(): String =
        (if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL.takeIf { it != Build.UNKNOWN } else null) ?: Build.HARDWARE

    private fun globalFlag(ctx: Context, name: String): Boolean = Settings.Global.getInt(ctx.contentResolver, name, 0) == 1

    /** A heuristic: an `su` binary where rooting tools put one. */
    private fun rooted(): Boolean =
        listOf("/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/app/Superuser.apk", "/data/adb/magisk")
            .any { File(it).exists() }

    fun granted(ctx: Context, permission: String) = ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun round(v: Double) = Math.round(v * 10) / 10.0

    private fun iso(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(millis))

    private fun day(millis: Long): String = iso(millis).substring(0, 10)
}
