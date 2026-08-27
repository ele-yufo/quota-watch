package io.quotawatch.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.glance.appwidget.updateAll
import io.quotawatch.data.SharedStore
import io.quotawatch.widget.FeaturedWidget
import io.quotawatch.widget.OverviewWidget

/** App 导航：列表（含欢迎/加载/错误）→ 详情 / 设置 / 配对（扫码或手动）。 */
@Composable
fun QWNavHost() {
    val context = LocalContext.current
    val nav = rememberNavController()
    val vm: QuotaViewModel = viewModel(
        initializer = {
            QuotaViewModel.create(
                store = SharedStore.get(context),
                widgetNudge = {
                    FeaturedWidget().updateAll(context)
                    OverviewWidget().updateAll(context)
                },
            )
        },
    )
    val state by vm.uiState.collectAsState()

    // 前台才刷新 —— port of AppModel 的 foreground-only 语义。
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> vm.startAutoRefresh()
                Lifecycle.Event.ON_STOP -> vm.stopAutoRefresh()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val version = remember {
        try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "dev"
        } catch (_: Exception) {
            "dev"
        }
    }

    NavHost(navController = nav, startDestination = "list") {
        composable("list") {
            QuotaListScreen(
                state = state,
                onOpenDetail = { nav.navigate("detail/${it.providerId}") },
                onOpenSettings = { nav.navigate("settings") },
                onOpenPairing = { scan ->
                    nav.navigate(if (scan) "pairing?tab=scan" else "pairing?tab=manual")
                },
                onPollNow = vm::pollNowAsync,
                onRefresh = vm::refreshAsync,
                onToggleMode = vm::toggleDisplayMode,
                onDismissAlert = vm::dismissAlert,
                onDemo = vm::enterDemo,
            )
        }
        composable(
            "detail/{providerId}",
            arguments = listOf(navArgument("providerId") { type = NavType.StringType }),
        ) { entry ->
            val id = entry.arguments?.getString("providerId")
            val provider = state.providers.firstOrNull { it.providerId == id }
            if (provider == null) {
                nav.popBackStack()
            } else {
                ProviderDetailScreen(
                    provider = provider,
                    mode = state.displayMode,
                    demoMode = state.demoMode,
                    lastUpdated = state.lastUpdated,
                    stale = state.loadError != null,
                )
            }
        }
        composable("settings") {
            SettingsScreen(
                state = state,
                version = version,
                onTestConnection = {
                    vm.testConnection().map { it.providers.size }
                },
                onOpenPairing = { nav.navigate("pairing?tab=scan") },
                onSetDisplayMode = vm::setDisplayMode,
                onToggleDemo = {
                    if (state.demoMode) vm.exitDemo() else vm.enterDemo()
                },
            )
        }
        composable(
            "pairing?tab={tab}",
            arguments = listOf(navArgument("tab") { defaultValue = "scan" }),
        ) { entry ->
            val tab = if (entry.arguments?.getString("tab") == "manual") {
                PairingTab.MANUAL
            } else {
                PairingTab.SCAN
            }
            PairingScreen(
                initialTab = tab,
                onScanned = { payload ->
                    val code = payload.code
                    if (code != null) {
                        vm.applyPairingCode(payload.host, payload.port, code,
                            payload.caFingerprint!!)
                    } else {
                        vm.applyPairing(payload)
                        null
                    }
                },
                onClaimManual = { host, port, code, fp ->
                    vm.applyPairingCode(host, port, code, fp)
                },
                onDone = {
                    nav.popBackStack("list", inclusive = false)
                },
            )
        }
    }
}
