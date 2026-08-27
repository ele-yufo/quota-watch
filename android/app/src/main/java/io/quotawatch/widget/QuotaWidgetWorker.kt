package io.quotawatch.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.quotawatch.data.SharedStore
import io.quotawatch.net.ApiClient
import java.util.concurrent.TimeUnit

/**
 * 小组件的后台刷新（20 分钟周期，网络可用时）。网络优先、5s 超时；失败
 * 保留 SharedStore 里的上次快照，由 widget 渲染侧按快照时间标 stale
 * （>20 分钟）。与 iOS WidgetKit 的 timeline 刷新同一节奏。
 */
class QuotaWidgetWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val store = SharedStore.get(applicationContext)
        if (store.host.isBlank() || store.caFingerprint.isNullOrBlank()) {
            // 未配对 —— widget 显示「未配对」空态，不需要重试。
            FeaturedWidget().updateAll(applicationContext)
            OverviewWidget().updateAll(applicationContext)
            return Result.success()
        }
        val client = ApiClient(
            host = store.host, port = store.port,
            token = store.token.ifEmpty { null },
            caFingerprint = store.caFingerprint,
            timeoutSeconds = 5,
        )
        return try {
            val providers = client.quota()
            store.saveSnapshot(providers)
            FeaturedWidget().updateAll(applicationContext)
            OverviewWidget().updateAll(applicationContext)
            Result.success()
        } catch (_: Exception) {
            // 缓存兜底 —— 重试交给下一个周期，不烧电量。
            FeaturedWidget().updateAll(applicationContext)
            OverviewWidget().updateAll(applicationContext)
            Result.success()
        }
    }

    companion object {
        private const val WORK_NAME = "quota-widget-refresh"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<QuotaWidgetWorker>(20, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** App 内刷新成功后顺手跑一次 —— iOS 的 reloadAllTimelines 对应物，
         *  但走的是 WorkManager 去重，不会风暴。 */
        fun kickNow(context: Context) {
            val request = androidx.work.OneTimeWorkRequestBuilder<QuotaWidgetWorker>()
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(
                    "$WORK_NAME-now",
                    androidx.work.ExistingWorkPolicy.KEEP,
                    request,
                )
        }
    }
}
