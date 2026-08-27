package io.quotawatch.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.quotawatch.data.Formatting
import io.quotawatch.net.ApiError
import io.quotawatch.ui.theme.QWColors
import java.time.Instant

/** 1dp separator — the open-layout divider (iOS Hairline). */
@Composable
fun Hairline(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(QWColors.Border))
}

/** Marks content as stale: 62% opacity (iOS qwStale). */
fun Modifier.qwStale(stale: Boolean): Modifier =
    if (stale) this.alpha(0.62f) else this

@Composable
fun LoadingStateView() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 120.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = QWColors.Accent, strokeWidth = 2.dp, modifier = Modifier.size(28.dp))
        Text("正在读取最新配额", color = QWColors.Foreground, fontSize = 15.sp,
            modifier = Modifier.padding(top = 16.dp))
        Text("采集器通常会在几秒内回应", color = QWColors.Muted, fontSize = 13.sp,
            modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
fun ErrorStateView(error: ApiError?, onRetry: () -> Unit) {
    val isParse = error is ApiError.Decoding
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 120.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = if (isParse) Icons.Outlined.Info else Icons.Outlined.Warning,
            contentDescription = null,
            tint = QWColors.Muted,
            modifier = Modifier.size(32.dp),
        )
        Text(
            if (isParse) "这次数据没有读懂" else "无法连接到 Mac",
            color = QWColors.Foreground, fontSize = 16.sp,
            modifier = Modifier.padding(top = 14.dp),
        )
        Text(
            if (isParse) "采集器在线，但返回内容不完整。旧数据仍保留。"
            else error?.message ?: "检查 daemon 是否已用 --lan 启动，且手机与 Mac 在同一网络。",
            color = QWColors.Muted, fontSize = 13.sp, textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp).padding(horizontal = 40.dp),
        )
        Row(modifier = Modifier.padding(top = 18.dp)) {
            androidx.compose.material3.TextButton(onClick = onRetry) {
                Icon(Icons.Outlined.Refresh, contentDescription = null,
                    tint = QWColors.Accent, modifier = Modifier.size(16.dp))
                Spacer(Modifier.size(6.dp))
                Text("重试连接", color = QWColors.Accent, fontSize = 14.sp)
            }
        }
    }
}

/** Offline banner: "离线 · 显示 Xs 前缓存". */
@Composable
fun StaleBanner(updatedAt: Instant?) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Warning, contentDescription = null,
            tint = QWColors.Warning, modifier = Modifier.size(14.dp))
        Spacer(Modifier.size(6.dp))
        Text(
            updatedAt?.let { "离线 · 显示 ${Formatting.ago(it)} 前缓存" } ?: "离线 · 显示最近缓存",
            color = QWColors.Warning, fontSize = 12.sp,
        )
    }
}

/** 44×44 circular utility button (iOS IconCircle). */
@Composable
fun IconCircle(onClick: () -> Unit, content: @Composable () -> Unit) {
    Box(
        modifier = Modifier
            .size(44.dp)
            .background(QWColors.Surface, CircleShape)
            .padding(0.dp),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.material3.IconButton(onClick = onClick) { content() }
    }
}
