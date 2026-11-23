package org.seredina.agent

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.text.format.DateUtils
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.google.zxing.integration.android.IntentIntegrator

/**
 * One screen: enroll (scan or paste the console's code), then see what was
 * last sent and send it again. Built in code -- it's a handful of views.
 */
class MainActivity : Activity() {
    private lateinit var content: LinearLayout
    private var pending: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = Text.title
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = dp(20)
            setPadding(pad, pad, pad, pad)
        }
        setContentView(ScrollView(this).apply { addView(content) })
        render()
        handleLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleLink(intent)
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    /** The QR's link opened directly by a camera app. */
    private fun handleLink(intent: Intent?) {
        val data = intent?.dataString ?: return
        intent.data = null
        if (Config(this).enrolled) return
        val link = EnrollLink.parse(data)
        if (link == null) message(Text.notALink) else withPhonePermissions { enroll(link) }
    }

    private fun render() {
        content.removeAllViews()
        val config = Config(this)
        if (!config.enrolled) {
            heading(Text.title)
            paragraph(Text.notEnrolled)
            button(Text.scan) { withPhonePermissions { scan() } }
            button(Text.paste) { withPhonePermissions { pasteDialog() } }
            paragraph(Text.whatIsSent, small = true)
            return
        }
        heading(Inventory.deviceName(this))
        paragraph("${Text.server}: ${config.server}")
        val last = if (config.lastReportAt == 0L) Text.never else DateUtils.getRelativeTimeSpanString(config.lastReportAt).toString()
        paragraph("${Text.lastReport}: $last")
        if (config.revoked) {
            paragraph(Text.revoked)
        } else {
            config.lastResult?.let { paragraph(Text.failed(it)) }
            paragraph(Text.reportsEvery, small = true)
            button(Text.sendNow) { sendNow() }
        }
        button(Text.unenroll) {
            AlertDialog.Builder(this)
                .setMessage(Text.unenrollConfirm)
                .setPositiveButton(Text.ok) { _, _ ->
                    Agent.unenroll(this)
                    render()
                }
                .setNegativeButton(Text.cancel, null)
                .show()
        }
        paragraph(Text.whatIsSent, small = true)
        paragraph("v${Agent.version(this)}", small = true)
    }

    private fun scan() {
        IntentIntegrator(this)
            .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            .setPrompt(Text.scanPrompt)
            .setBeepEnabled(false)
            .setOrientationLocked(false)
            .initiateScan()
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val result = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (result == null) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val contents = result.contents ?: return
        val link = EnrollLink.parse(contents)
        if (link == null) message(Text.notALink) else enroll(link)
    }

    private fun pasteDialog() {
        val input = EditText(this).apply {
            hint = Text.pasteHint
            setSingleLine(false)
        }
        AlertDialog.Builder(this)
            .setTitle(Text.paste)
            .setView(input)
            .setPositiveButton(Text.ok) { _, _ ->
                val link = EnrollLink.parse(input.text.toString())
                if (link == null) message(Text.notALink) else enroll(link)
            }
            .setNegativeButton(Text.cancel, null)
            .show()
    }

    private fun enroll(link: EnrollLink) {
        busy(Text.enrolling)
        Thread {
            val error = try {
                Agent.enroll(applicationContext, link)
                null
            } catch (e: Exception) {
                e.message ?: e.javaClass.simpleName
            }
            runOnUiThread {
                render()
                if (error != null && !Config(this).enrolled) message(Text.enrollFailed(error))
            }
        }.start()
    }

    private fun sendNow() {
        busy(Text.sending)
        Thread {
            try {
                Agent.checkIn(applicationContext)
            } catch (e: Exception) {
                // Kept in Config.lastResult and shown by render().
            }
            runOnUiThread { render() }
        }.start()
    }

    /**
     * The SIMs and their numbers need phone permissions: asked once, before
     * enrolling. Either answer goes on -- without them the inventory just
     * has no SIM numbers.
     */
    private fun withPhonePermissions(action: () -> Unit) {
        val wanted = listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_PHONE_NUMBERS)
            .filterNot { Inventory.granted(this, it) }
        if (wanted.isEmpty()) {
            action()
            return
        }
        pending = action
        requestPermissions(wanted.toTypedArray(), REQUEST_PHONE)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_PHONE) {
            val action = pending
            pending = null
            action?.invoke()
        }
    }

    // --- views -------------------------------------------------------------

    private fun busy(text: String) {
        content.removeAllViews()
        paragraph(text)
    }

    private fun heading(text: String) {
        content.addView(
            TextView(this).apply {
                this.text = text
                textSize = 22f
                setTypeface(typeface, Typeface.BOLD)
                setPadding(0, 0, 0, dp(12))
            },
        )
    }

    private fun paragraph(text: String, small: Boolean = false) {
        content.addView(
            TextView(this).apply {
                this.text = text
                textSize = if (small) 13f else 16f
                alpha = if (small) 0.7f else 1f
                setPadding(0, dp(6), 0, dp(6))
            },
        )
    }

    private fun button(text: String, onClick: () -> Unit) {
        content.addView(
            Button(this).apply {
                this.text = text
                gravity = Gravity.CENTER
                setOnClickListener(View.OnClickListener { onClick() })
            },
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = dp(10)
            },
        )
    }

    private fun message(text: String) {
        AlertDialog.Builder(this).setMessage(text).setPositiveButton(Text.ok, null).show()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val REQUEST_PHONE = 10
    }
}
