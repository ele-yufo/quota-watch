package io.quotawatch.data

import java.time.Instant

/**
 * Persistence contract for connection + snapshot state (implemented by
 * [SharedStore]; faked in JVM unit tests).
 */
interface QuotaStore {
    var host: String
    var port: Int
    var token: String
    var caFingerprint: String?
    var demoMode: Boolean
    var displayMode: QuotaDisplayMode

    /** One atomic write after pairing — the widget never sees a half-updated
     *  configuration (mirrors AppModel.applyConnection). */
    fun saveConnection(host: String, port: Int, token: String, caFingerprint: String?)

    fun saveSnapshot(providers: List<QuotaProvider>, at: Instant = Instant.now())
    fun loadSnapshot(): Pair<List<QuotaProvider>, Instant>?
}
