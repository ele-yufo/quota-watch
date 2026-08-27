package io.quotawatch.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.quotawatch.data.DemoData
import io.quotawatch.data.HealthResponse
import io.quotawatch.data.QuotaDisplayMode
import io.quotawatch.data.QuotaProvider
import io.quotawatch.data.QuotaStore
import io.quotawatch.data.QuotaWindow
import io.quotawatch.net.ApiClient
import io.quotawatch.net.ApiError
import io.quotawatch.net.PairingPayload
import io.quotawatch.net.QuotaApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import kotlin.random.Random

data class QuotaUiState(
    // Live data
    val providers: List<QuotaProvider> = emptyList(),
    val lastUpdated: Instant? = null,
    val lastError: ApiError? = null,
    val isRefreshing: Boolean = false,
    val isPolling: Boolean = false,
    /** True only after the initial quick-retry grace period has failed — lets
     *  the UI keep the loading state through a transient cold-start miss. */
    val initialLoadFailed: Boolean = false,
    // Persisted connection (mirrored from QuotaStore)
    val host: String = "",
    val port: Int = 3737,
    val token: String = "",
    val caFingerprint: String? = null,
    val demoMode: Boolean = false,
    val displayMode: QuotaDisplayMode = QuotaDisplayMode.USED,
    val dismissedAlertSignature: String? = null,
) {
    val isConfigured: Boolean get() = demoMode || host.isNotBlank()
    val loadError: String? get() = lastError?.message

    val criticalWindows: List<Pair<QuotaProvider, QuotaWindow>>
        get() = providers.flatMap { p -> p.windows.filter { it.remainingPct < 10 }.map { p to it } }

    /** The single most-at-risk window across all providers — the hero dial. */
    val mostUrgent: Pair<QuotaProvider, QuotaWindow>?
        get() = providers.mapNotNull { p -> p.primary?.let { p to it } }
            .minByOrNull { it.second.remainingPct }

    val criticalCount: Int get() = criticalWindows.size

    /** Stable signature of the current critical set. Dismissing the alert
     *  remembers this; a NEW window going critical changes it so the alert
     *  reappears rather than staying silenced forever. */
    val alertSignature: String
        get() = criticalWindows.map { "${it.first.providerId}:${it.second.windowName}" }
            .sorted().joinToString("|")

    val showAlert: Boolean
        get() = criticalCount > 0 && alertSignature != dismissedAlertSignature
}

/**
 * Connection settings + live quota state — the AppModel port. Owns the
 * auto-refresh loop (10s + 0–3s jitter, foreground only).
 *
 * Dependencies are constructor-injected so the whole thing runs in JVM unit
 * tests (fake store + fake api); production wiring is [create].
 */
class QuotaViewModel(
    private val store: QuotaStore,
    private val apiFactory: (host: String, port: Int, token: String?, caFingerprint: String?) -> QuotaApi,
    private val widgetNudge: suspend () -> Unit = {},
    private val jitter: (Long) -> Long = { bound -> Random.nextLong(0, bound) },
) : ViewModel() {

    private val _uiState = MutableStateFlow(
        QuotaUiState(
            host = store.host,
            port = store.port,
            token = store.token,
            caFingerprint = store.caFingerprint,
            demoMode = store.demoMode,
            displayMode = store.displayMode,
        ),
    )
    val uiState: StateFlow<QuotaUiState> = _uiState.asStateFlow()

    private var refreshJob: Job? = null

    private fun client(): QuotaApi = _uiState.value.let {
        apiFactory(it.host, it.port, it.token.ifEmpty { null }, it.caFingerprint)
    }

    // ── Display mode / demo ──────────────────────────────────────────────

    fun setDisplayMode(mode: QuotaDisplayMode) {
        store.displayMode = mode
        _uiState.update { it.copy(displayMode = mode) }
        nudgeWidgets()
    }

    fun toggleDisplayMode() = setDisplayMode(_uiState.value.displayMode.next)

    /** Turn demo mode on (sample data immediately, never persisted to the
     *  widget cache — demo is an in-app preview only). */
    fun enterDemo() {
        store.demoMode = true
        _uiState.update {
            it.copy(
                demoMode = true,
                providers = DemoData.providers(),
                lastUpdated = Instant.now(),
                lastError = null,
                initialLoadFailed = false,
            )
        }
    }

    fun exitDemo() {
        store.demoMode = false
        _uiState.update { it.copy(demoMode = false, providers = emptyList(), lastUpdated = null) }
    }

    // ── Pairing ──────────────────────────────────────────────────────────

    /** Set connection atomically: one store write, one widget nudge, no
     *  intermediate state. Pairing always goes through here. */
    private fun applyConnection(host: String, port: Int, token: String, caFingerprint: String?) {
        store.demoMode = false
        store.saveConnection(host, port, token, caFingerprint)
        _uiState.update {
            it.copy(host = host, port = port, token = token,
                caFingerprint = caFingerprint, demoMode = false)
        }
        nudgeWidgets()
    }

    /** Apply a scanned legacy payload that carries a raw token. */
    fun applyPairing(payload: PairingPayload) {
        applyConnection(payload.host, payload.port, payload.token ?: "", payload.caFingerprint)
        viewModelScope.launch { refresh() }
    }

    /** Exchange a short-lived pairing code for the token (POST /pair/claim),
     *  then store the connection. Returns null on success, else a user-facing
     *  message. Unlike iOS, [caFingerprint] is REQUIRED — the daemon is
     *  HTTPS-only and there is no cleartext fallback to downgrade to. */
    suspend fun applyPairingCode(
        host: String,
        port: Int,
        code: String,
        caFingerprint: String,
    ): String? {
        val client = apiFactory(host, port, null, caFingerprint)
        return try {
            val (token, claimedFp) = client.claimPairingCode(code)
            applyConnection(host, port, token, claimedFp ?: caFingerprint)
            // Fetch right away so the widget cache has real data before the
            // next auto-refresh tick (up to 10s away).
            refresh()
            null
        } catch (e: ApiClient.ApiException) {
            when (e.error) {
                is ApiError.Unauthorized -> "配对码无效或已过期 — 在 Mac 菜单栏点「配对」重新生成"
                is ApiError.CertChanged -> "证书校验失败 — daemon 证书已更换，请在 Mac 上重新配对"
                else -> e.error.message
            }
        } catch (e: Exception) {
            "配对失败：${e.message}"
        }
    }

    // ── Data loading ─────────────────────────────────────────────────────

    /** Fetch quota once; keeps prior data on failure and records the error. */
    suspend fun refresh() {
        val state = _uiState.value
        if (state.demoMode) {
            _uiState.update {
                it.copy(providers = DemoData.providers(), lastUpdated = Instant.now(),
                    lastError = null, initialLoadFailed = false)
            }
            return // demo is in-app only — never written to the widget cache
        }
        if (!state.isConfigured || state.isRefreshing) return
        _uiState.update { it.copy(isRefreshing = true) }
        try {
            val providers = client().quota()
            _uiState.update {
                it.copy(providers = providers, lastUpdated = Instant.now(),
                    lastError = null, initialLoadFailed = false, isRefreshing = false)
            }
            store.saveSnapshot(providers)
            nudgeWidgets()
        } catch (e: ApiClient.ApiException) {
            recordFetchFailure(e.error)
        } catch (e: Exception) {
            recordFetchFailure(ApiError.Unreachable)
        }
    }

    private fun recordFetchFailure(error: ApiError) {
        // Offline fallback: memory is empty but the store still holds the last
        // good snapshot — surface it instead of a blank list. The stale banner
        // marks the age; a later success replaces it.
        val cached = if (_uiState.value.providers.isEmpty()) store.loadSnapshot() else null
        _uiState.update {
            it.copy(
                lastError = error,
                isRefreshing = false,
                providers = cached?.first ?: it.providers,
                lastUpdated = cached?.second ?: it.lastUpdated,
            )
        }
    }

    /** Fire-and-forget wrappers for non-suspend UI callbacks. */
    fun refreshAsync() { viewModelScope.launch { refresh() } }
    fun pollNowAsync() { viewModelScope.launch { pollNow() } }

    /** Ask the daemon to poll providers now, then re-read. */
    suspend fun pollNow() {
        val state = _uiState.value
        if (!state.isConfigured || state.isPolling) return
        _uiState.update { it.copy(isPolling = true) }
        try {
            client().pollNow()
        } catch (_: Exception) {
            // fire-and-forget — the subsequent refresh surfaces real errors
        }
        _uiState.update { it.copy(isPolling = false) }
        refresh()
    }

    /** Test the current settings against /health. */
    suspend fun testConnection(): Result<HealthResponse> = try {
        Result.success(client().health())
    } catch (e: ApiClient.ApiException) {
        Result.failure(e)
    } catch (e: Exception) {
        Result.failure(ApiClient.ApiException(ApiError.Unreachable))
    }

    // ── Alert dismissal ──────────────────────────────────────────────────

    fun dismissAlert() {
        _uiState.update { it.copy(dismissedAlertSignature = it.alertSignature) }
    }

    // ── Auto-refresh lifecycle ───────────────────────────────────────────

    /** Start the refresh loop (idempotent). Call when the app comes to the
     *  foreground; cancelled by [stopAutoRefresh]. Cold start retries quickly
     *  a few times before surfacing the error screen, then settles into the
     *  10s cadence. */
    fun startAutoRefresh() {
        refreshJob?.cancel()
        refreshJob = viewModelScope.launch {
            refresh()

            // Quick-retry grace: a single transient first-fetch miss shouldn't
            // flash the error screen. Retry every 2s up to 3× while never loaded.
            var quick = 0
            while (_uiState.value.lastUpdated == null && quick < 3) {
                delay(2_000)
                refresh()
                quick++
            }
            if (_uiState.value.lastUpdated == null) {
                _uiState.update { it.copy(initialLoadFailed = true) }
            }

            while (true) {
                // 10s base + 0–3s jitter — keeps multiple devices / clock
                // boundaries from hammering the daemon in lockstep.
                delay(10_000 + jitter(3_000))
                refresh()
            }
        }
    }

    fun stopAutoRefresh() {
        refreshJob?.cancel()
        refreshJob = null
    }

    private fun nudgeWidgets() {
        viewModelScope.launch { widgetNudge() }
    }

    companion object {
        /** Production wiring: SharedPreferences store + OkHttp api + Glance nudge. */
        fun create(
            store: QuotaStore,
            widgetNudge: suspend () -> Unit,
        ): QuotaViewModel = QuotaViewModel(
            store = store,
            apiFactory = { host, port, token, fp -> ApiClient(host, port, token, fp) },
            widgetNudge = widgetNudge,
        )
    }
}
