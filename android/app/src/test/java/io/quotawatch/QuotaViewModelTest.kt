package io.quotawatch

import io.quotawatch.data.HealthResponse
import io.quotawatch.data.QuotaDisplayMode
import io.quotawatch.data.QuotaProvider
import io.quotawatch.data.QuotaStore
import io.quotawatch.data.QuotaWindow
import io.quotawatch.data.WindowKind
import io.quotawatch.net.ApiClient
import io.quotawatch.net.ApiError
import io.quotawatch.net.QuotaApi
import io.quotawatch.ui.QuotaViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class QuotaViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    private fun win(kind: WindowKind, remainingPct: Double, name: String = kind.wire) =
        QuotaWindow(name, kind, used = 100 - remainingPct, total = 100.0, unit = "percent",
            remainingPct = remainingPct, resetAt = null, timestamp = "2026-08-28T00:00:00.000Z")

    private fun provider(id: String, vararg windows: QuotaWindow) =
        QuotaProvider(id, id, "claude", windows.toList())

    private class FakeStore : QuotaStore {
        override var host = "mac.local"
        override var port = 3737
        override var token = "tok"
        override var caFingerprint: String? = "a".repeat(64)
        override var demoMode = false
        override var displayMode = QuotaDisplayMode.USED
        val savedSnapshots = mutableListOf<List<QuotaProvider>>()
        var cachedSnapshot: Pair<List<QuotaProvider>, Instant>? = null
        var connectionWrites = 0

        override fun saveConnection(host: String, port: Int, token: String, caFingerprint: String?) {
            connectionWrites++
            this.host = host; this.port = port; this.token = token; this.caFingerprint = caFingerprint
        }

        override fun saveSnapshot(providers: List<QuotaProvider>, at: Instant) {
            savedSnapshots.add(providers)
        }

        override fun loadSnapshot() = cachedSnapshot
    }

    private class FakeApi(
        var quotaResults: ArrayDeque<Result<List<QuotaProvider>>> = ArrayDeque(),
    ) : QuotaApi {
        var quotaCalls = 0
        var claimResult: Result<Pair<String, String?>> = Result.success("newtok" to "b".repeat(64))

        private fun next(): Result<List<QuotaProvider>> =
            if (quotaResults.isEmpty()) Result.success(emptyList()) else quotaResults.removeFirst()

        override suspend fun quota(): List<QuotaProvider> {
            quotaCalls++
            return next().getOrElse { throw ApiClient.ApiException(ApiError.Unreachable) }
        }

        override suspend fun health() = HealthResponse("ok", 1, "dev", 1, emptyList())
        override suspend fun pollNow(providerId: String?) = true
        override suspend fun claimPairingCode(code: String) = claimResult.getOrThrow()
    }

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun vm(
        store: FakeStore,
        api: FakeApi,
        nudges: MutableList<Unit> = mutableListOf(),
    ) = QuotaViewModel(
        store = store,
        apiFactory = { _, _, _, _ -> api },
        widgetNudge = { nudges.add(Unit) },
        jitter = { 0 },
    )

    @Test fun `cold start retries three times then flags initial failure`() = runTest {
        val api = FakeApi(ArrayDeque(listOf(
            Result.failure<List<QuotaProvider>>(RuntimeException()),
            Result.failure(RuntimeException()), Result.failure(RuntimeException()),
            Result.failure(RuntimeException()),
        )))
        val vm = vm(FakeStore(), api)
        vm.startAutoRefresh()
        runCurrent()
        assertEquals(1, api.quotaCalls)
        advanceTimeBy(2_100); runCurrent()
        assertEquals(2, api.quotaCalls)
        advanceTimeBy(2_100); runCurrent()
        assertEquals(3, api.quotaCalls)
        advanceTimeBy(2_100); runCurrent()
        assertEquals(4, api.quotaCalls)
        assertTrue(vm.uiState.value.initialLoadFailed)
        vm.stopAutoRefresh() // infinite loop must not reach runTest's idle-drain
    }

    @Test fun `success on second cold-start attempt avoids failure flag`() = runTest {
        val api = FakeApi(ArrayDeque(listOf(
            Result.failure<List<QuotaProvider>>(RuntimeException()),
            Result.success(listOf(provider("p", win(WindowKind.SESSION, 50.0)))),
        )))
        val store = FakeStore()
        val vm = vm(store, api)
        vm.startAutoRefresh()
        runCurrent()
        advanceTimeBy(2_100); runCurrent()
        assertFalse(vm.uiState.value.initialLoadFailed)
        assertEquals(1, vm.uiState.value.providers.size)
        assertEquals(1, store.savedSnapshots.size)
        vm.stopAutoRefresh()
    }

    @Test fun `steady loop refreshes every ten seconds`() = runTest {
        val api = FakeApi() // always succeeds with empty list
        val vm = vm(FakeStore(), api)
        vm.startAutoRefresh()
        runCurrent()
        assertEquals(1, api.quotaCalls)
        advanceTimeBy(10_100); runCurrent()
        assertEquals(2, api.quotaCalls)
        advanceTimeBy(10_100); runCurrent()
        assertEquals(3, api.quotaCalls)
        vm.stopAutoRefresh()
    }

    @Test fun `failed fetch with empty memory falls back to cached snapshot`() = runTest {
        val store = FakeStore()
        val cached = listOf(provider("cached", win(WindowKind.WEEK, 66.0)))
        store.cachedSnapshot = cached to Instant.parse("2026-08-28T01:00:00Z")
        val api = FakeApi(ArrayDeque(listOf(Result.failure(RuntimeException()))))
        val vm = vm(store, api)
        vm.refresh()
        assertEquals("cached", vm.uiState.value.providers[0].providerId)
        assertTrue(vm.uiState.value.lastError is ApiError.Unreachable)
    }

    @Test fun `alert dismissal holds until a new window goes critical`() = runTest {
        val critical = provider("a", win(WindowKind.SESSION, 5.0, "session"))
        val api = FakeApi(ArrayDeque(listOf(
            Result.success(listOf(critical)),
            Result.success(listOf(critical)),
            Result.success(listOf(critical, provider("b", win(WindowKind.WEEK, 3.0, "weekly")))),
        )))
        val vm = vm(FakeStore(), api)
        vm.refresh()
        assertTrue(vm.uiState.value.showAlert)
        vm.dismissAlert()
        vm.refresh()
        assertFalse(vm.uiState.value.showAlert) // same set, stays dismissed
        vm.refresh()
        assertTrue(vm.uiState.value.showAlert) // new critical window → re-alert
    }

    @Test fun `demo mode never writes the widget snapshot`() = runTest {
        val store = FakeStore()
        val vm = vm(store, FakeApi())
        vm.enterDemo()
        vm.refresh()
        assertTrue(store.savedSnapshots.isEmpty())
        assertEquals(6, vm.uiState.value.providers.size)
    }

    @Test fun `successful claim stores connection atomically and refreshes`() = runTest {
        val store = FakeStore()
        store.host = ""
        val api = FakeApi(ArrayDeque(listOf(
            Result.success(listOf(provider("p", win(WindowKind.SESSION, 90.0)))),
        )))
        val vm = vm(store, api)
        val err = vm.applyPairingCode("192.168.1.9", 3737, "004751", "c".repeat(64))
        assertNull(err)
        assertEquals(1, store.connectionWrites)
        assertEquals("newtok", store.token)
        assertEquals("192.168.1.9", store.host)
        assertEquals("b".repeat(64), store.caFingerprint) // claim response wins
        assertEquals(1, vm.uiState.value.providers.size)
    }

    @Test fun `claim unauthorized maps to the regenerate message`() = runTest {
        val api = FakeApi()
        api.claimResult = Result.failure(ApiClient.ApiException(ApiError.Unauthorized))
        val vm = vm(FakeStore(), api)
        val err = vm.applyPairingCode("h", 3737, "000000", "c".repeat(64))
        assertEquals("配对码无效或已过期 — 在 Mac 菜单栏点「配对」重新生成", err)
    }
}
