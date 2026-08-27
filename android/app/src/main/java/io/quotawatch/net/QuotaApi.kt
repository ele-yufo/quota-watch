package io.quotawatch.net

import io.quotawatch.data.HealthResponse
import io.quotawatch.data.QuotaProvider

/** Network contract for the daemon API (implemented by [ApiClient]; faked in
 *  JVM unit tests). */
interface QuotaApi {
    suspend fun health(): HealthResponse
    suspend fun quota(): List<QuotaProvider>
    suspend fun pollNow(providerId: String? = null): Boolean
    suspend fun claimPairingCode(code: String): Pair<String, String?>
}
