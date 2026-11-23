package org.seredina.agent

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Enrollment and check-in, the same two calls the desktop agent makes. Never on the main thread. */
object Agent {
    private const val JOB_ID = 1
    private val INTERVAL_MS = TimeUnit.HOURS.toMillis(6)

    fun version(ctx: Context): String = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0.0.0"
    } catch (e: Exception) {
        "0.0.0"
    }

    /** Redeems the QR's one-time token for this phone's own credential, then reports once. */
    fun enroll(ctx: Context, link: EnrollLink) {
        val caPem = link.caSha256?.let { Server.fetchPinnedCa(link.server, it) }
        val body = JSONObject()
            .put("enrollmentToken", link.token)
            .put("hostname", Inventory.deviceName(ctx).take(200))
            .put("platform", "android")
            .put("agentVersion", version(ctx))
            .putOpt("machineFingerprint", Inventory.fingerprint(ctx))
        val result = Server(link.server, caPem).post("/v1/devices/enroll", body)
        val credential = result.optString("credential").ifEmpty { throw ServerError("the server sent no credential") }

        val config = Config(ctx)
        config.clear()
        config.server = link.server
        config.caPem = caPem
        config.credential = credential
        schedule(ctx)
        checkIn(ctx)
    }

    /** Sends the inventory. Returns normally on success; the outcome is also kept for the screen. */
    fun checkIn(ctx: Context) {
        val config = Config(ctx)
        val server = config.server ?: return
        val credential = config.credential ?: return
        try {
            Server(server, config.caPem).post("/v1/devices/checkin", Inventory.checkInBody(ctx), credential)
            config.lastReportAt = System.currentTimeMillis()
            config.lastResult = null
            config.revoked = false
        } catch (e: ServerError) {
            config.lastResult = e.message
            // The server refuses a revoked device's check-ins: stop trying until it's enrolled again.
            if (e.status == 403) {
                config.revoked = true
                cancel(ctx)
            }
            throw e
        } catch (e: Exception) {
            config.lastResult = e.message ?: e.javaClass.simpleName
            throw e
        }
    }

    /** Every 6 hours with a network, kept across reboots. */
    fun schedule(ctx: Context) {
        val job = JobInfo.Builder(JOB_ID, ComponentName(ctx, CheckInJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(INTERVAL_MS)
            .setPersisted(true)
            .build()
        ctx.getSystemService(JobScheduler::class.java)?.schedule(job)
    }

    fun cancel(ctx: Context) {
        ctx.getSystemService(JobScheduler::class.java)?.cancel(JOB_ID)
    }

    fun unenroll(ctx: Context) {
        cancel(ctx)
        Config(ctx).clear()
    }
}
