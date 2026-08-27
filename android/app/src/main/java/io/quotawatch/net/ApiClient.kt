package io.quotawatch.net

import io.quotawatch.data.HealthResponse
import io.quotawatch.data.QuotaProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.InterruptedIOException
import javax.net.ssl.SSLException

/** Errors mirror APIClient.swift's APIError with the same Chinese copy. */
sealed class ApiError(val message: String) {
    data object NotConfigured : ApiError("尚未配置连接")
    data object Unreachable : ApiError("无法连接到 Mac — 确认在同一网络，且 daemon 已启动")
    data object Unauthorized : ApiError("配对码无效或已过期 — 在 Mac 上重新生成后再试")
    data object CertChanged : ApiError("证书校验失败 — daemon 证书已更换，请重新配对")
    data object Timeout : ApiError("连接超时")
    data class BadStatus(val code: Int) : ApiError("服务器错误 ($code)")
    data object Decoding : ApiError("这次数据没有读懂")
}

/**
 * HTTPS-only client for the daemon API. There is NO cleartext fallback (the
 * iOS http://-without-fingerprint path is not ported — the daemon is
 * HTTPS-only, so it could never work).
 */
class ApiClient(
    private val host: String,
    private val port: Int,
    private val token: String?,
    private val caFingerprint: String?,
    private val timeoutSeconds: Long = 8,
) : QuotaApi {
    private val json = Json { ignoreUnknownKeys = true }

    class ApiException(val error: ApiError) : Exception(error.message)

    private fun baseUrl(): String {
        val fp = FingerprintPin.normalize(caFingerprint)
            ?: throw ApiException(ApiError.NotConfigured)
        val h = host.trim()
        if (h.isEmpty()) throw ApiException(ApiError.NotConfigured)
        return "https://$h:$port"
    }

    private suspend fun <T> execute(
        path: String,
        method: String = "GET",
        body: String? = null,
        parse: (String) -> T,
    ): T = withContext(Dispatchers.IO) {
        val fp = FingerprintPin.normalize(caFingerprint)
            ?: throw ApiException(ApiError.NotConfigured)
        val client = PinnedHttpClients.client(fp, timeoutSeconds)
        val builder = Request.Builder()
            .url(baseUrl() + path)
            .method(method, body?.toRequestBody("application/json".toMediaType()))
        if (!token.isNullOrEmpty()) {
            builder.header("Authorization", "Bearer $token")
        }
        try {
            client.newCall(builder.build()).execute().use { resp ->
                when {
                    resp.code == 401 -> throw ApiException(ApiError.Unauthorized)
                    !resp.isSuccessful -> throw ApiException(ApiError.BadStatus(resp.code))
                    else -> {
                        val text = resp.body?.string()
                            ?: throw ApiException(ApiError.Decoding)
                        try {
                            parse(text)
                        } catch (e: ApiException) {
                            throw e
                        } catch (_: Exception) {
                            throw ApiException(ApiError.Decoding)
                        }
                    }
                }
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: SSLException) {
            throw ApiException(ApiError.CertChanged)
        } catch (e: InterruptedIOException) {
            throw ApiException(ApiError.Timeout)
        } catch (e: java.io.IOException) {
            throw ApiException(ApiError.Unreachable)
        }
    }

    override suspend fun health(): HealthResponse = execute("/health") {
        json.decodeFromString(HealthResponse.serializer(), it)
    }

    override suspend fun quota(): List<QuotaProvider> = execute("/quota") {
        json.decodeFromString(it)
    }

    /** Blocks until the poll finishes — give it the full timeout. */
    override suspend fun pollNow(providerId: String?): Boolean {
        val path = if (providerId != null) "/poll?provider=$providerId" else "/poll"
        return execute(path, method = "POST", body = "") { text ->
            text.contains("\"ok\":true")
        }
    }

    /** Exchange a 6-digit pairing code for the API token. Unauthenticated by
     *  design (the only exempt route); the code IS the credential. */
    override suspend fun claimPairingCode(code: String): Pair<String, String?> {
        val body = """{"code":"$code"}"""
        return execute("/pair/claim", method = "POST", body = body) { text ->
            val obj = json.parseToJsonElement(text).jsonObject
            val ok = obj["ok"]?.toString()?.contains("true") == true
            val token = obj["token"]?.toString()?.trim('"')?.takeIf { it.isNotEmpty() && it != "null" }
            val fp = obj["caFingerprint"]?.toString()?.trim('"')?.takeIf { it.isNotEmpty() && it != "null" }
            if (!ok || token == null) throw ApiException(ApiError.Unauthorized)
            token to fp
        }
    }
}
