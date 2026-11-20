package org.seredina.agent

import android.app.job.JobParameters
import android.app.job.JobService

/** The periodic check-in. Retried by the system with backoff when it fails. */
class CheckInJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        Thread {
            val ok = try {
                Agent.checkIn(applicationContext)
                true
            } catch (e: Exception) {
                false
            }
            jobFinished(params, !ok && !Config(applicationContext).revoked)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
