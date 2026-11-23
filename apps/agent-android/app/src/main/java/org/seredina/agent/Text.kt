package org.seredina.agent

import java.util.Locale

/** The app's few strings, in Spanish or English by the phone's language. */
object Text {
    private val es: Boolean get() = Locale.getDefault().language == "es"
    private fun t(es: String, en: String) = if (this.es) es else en

    val title get() = t("Inventario del equipo", "Device inventory")
    val notEnrolled get() = t(
        "Este equipo todavía no está inscrito. En la consola de Seredina, ve a Dispositivos, genera un código y elige Android.",
        "This device isn't enrolled yet. In the Seredina console, go to Devices, generate a code and choose Android.",
    )
    val whatIsSent get() = t(
        "Se envía: modelo, versión de Android, parche de seguridad, operador y número de las SIM, batería, almacenamiento, aplicaciones instaladas y si hay bloqueo de pantalla. No se envían fotos, mensajes, contactos ni ubicación.",
        "Sent: model, Android version, security patch, SIM carrier and number, battery, storage, installed apps and whether a screen lock is set. Never photos, messages, contacts or location.",
    )
    val scan get() = t("Escanear código", "Scan code")
    val paste get() = t("Pegar código", "Paste code")
    val pasteHint get() = t("seredina://enroll?…", "seredina://enroll?…")
    val ok get() = t("Aceptar", "OK")
    val cancel get() = t("Cancelar", "Cancel")
    val scanPrompt get() = t("Apunta al código de inscripción", "Point at the enrollment code")
    val notALink get() = t("Ese no es un código de inscripción de Seredina.", "That isn't a Seredina enrollment code.")
    val enrolling get() = t("Inscribiendo…", "Enrolling…")
    val sending get() = t("Enviando inventario…", "Sending inventory…")
    val sendNow get() = t("Enviar inventario ahora", "Send inventory now")
    val unenroll get() = t("Desvincular este equipo", "Unenroll this device")
    val unenrollConfirm get() = t(
        "El equipo dejará de reportarse. Para volver a inscribirlo hace falta un código nuevo.",
        "The device will stop reporting. Enrolling it again takes a new code.",
    )
    val server get() = t("Servidor", "Server")
    val lastReport get() = t("Último envío", "Last report")
    val never get() = t("nunca", "never")
    val reportsEvery get() = t("Se reporta solo cada 6 horas.", "It reports by itself every 6 hours.")
    val revoked get() = t(
        "Un administrador revocó este equipo. Desvincúlalo e inscríbelo con un código nuevo.",
        "An administrator revoked this device. Unenroll it and enroll it with a new code.",
    )
    fun enrollFailed(reason: String) = t("No se pudo inscribir: $reason", "Couldn't enroll: $reason")
    fun sent(time: String) = t("Enviado $time", "Sent $time")
    fun failed(reason: String) = t("Falló: $reason", "Failed: $reason")
    val caMismatch get() = t(
        "el certificado del servidor no coincide con el del código. Genera un código nuevo en la consola.",
        "the server's certificate doesn't match the code. Generate a new code in the console.",
    )
}
