package io.quotawatch.data

import android.content.Context
import android.content.SharedPreferences
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.time.Instant

/**
 * The app ↔ widget bridge — Android counterpart of iOS's App Group
 * UserDefaults (SharedStore.swift), same keys. Glance widgets run in this
 * process, so a plain SharedPreferences readable synchronously is enough;
 * no encrypted store (iOS keeps the same plaintext mirror for its widget).
 */
class SharedStore(context: Context) : QuotaStore {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("quotawatch", Context.MODE_PRIVATE)

    private val json = Json { ignoreUnknownKeys = true }

    override var host: String
        get() = prefs.getString(KEY_HOST, "") ?: ""
        set(value) = prefs.edit().putString(KEY_HOST, value).apply()

    override var port: Int
        get() = prefs.getInt(KEY_PORT, 0).let { if (it == 0) 3737 else it }
        set(value) = prefs.edit().putInt(KEY_PORT, value).apply()

    override var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    override var caFingerprint: String?
        get() = prefs.getString(KEY_FP, null)
        set(value) = prefs.edit().putString(KEY_FP, value).apply()

    override var demoMode: Boolean
        get() = prefs.getBoolean(KEY_DEMO, false)
        set(value) = prefs.edit().putBoolean(KEY_DEMO, value).apply()

    override var displayMode: QuotaDisplayMode
        get() = QuotaDisplayMode.fromWire(prefs.getString(KEY_MODE, null))
        set(value) = prefs.edit().putString(KEY_MODE, value.wire).apply()

    /** One atomic write after pairing — mirrors AppModel.applyConnection:
     *  all four connection fields land together so the widget never sees a
     *  half-updated configuration. */
    override fun saveConnection(host: String, port: Int, token: String, caFingerprint: String?) {
        prefs.edit()
            .putString(KEY_HOST, host)
            .putInt(KEY_PORT, port)
            .putString(KEY_TOKEN, token)
            .putString(KEY_FP, caFingerprint)
            .apply()
    }

    override fun saveSnapshot(providers: List<QuotaProvider>, at: Instant) {
        prefs.edit()
            .putString(KEY_SNAPSHOT, json.encodeToString(providers))
            .putLong(KEY_SNAPSHOT_AT, at.epochSecond)
            .apply()
    }

    override fun loadSnapshot(): Pair<List<QuotaProvider>, Instant>? {
        val raw = prefs.getString(KEY_SNAPSHOT, null) ?: return null
        val providers = try {
            json.decodeFromString<List<QuotaProvider>>(raw)
        } catch (_: Exception) {
            return null
        }
        val at = Instant.ofEpochSecond(prefs.getLong(KEY_SNAPSHOT_AT, Instant.now().epochSecond))
        return providers to at
    }

    companion object {
        const val KEY_HOST = "qw.host"
        const val KEY_PORT = "qw.port"
        const val KEY_TOKEN = "qw.token"
        const val KEY_FP = "qw.caFingerprint"
        const val KEY_SNAPSHOT = "qw.snapshot"
        const val KEY_SNAPSHOT_AT = "qw.snapshotAt"
        const val KEY_MODE = "qw.displayMode"
        const val KEY_DEMO = "qw.demo"

        @Volatile private var instance: SharedStore? = null

        fun get(context: Context): SharedStore =
            instance ?: synchronized(this) {
                instance ?: SharedStore(context).also { instance = it }
            }
    }
}
