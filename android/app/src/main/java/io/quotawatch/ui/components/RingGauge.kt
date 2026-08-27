package io.quotawatch.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.quotawatch.ui.theme.QWColors
import io.quotawatch.ui.theme.UsageLevel

/**
 * 270° open ring gauge — port of RingGauge.swift: from 0.125 to 0.875 of the
 * circle (0 = 12 o'clock, clockwise), 90° gap at the bottom. In Canvas
 * coordinates that's startAngle 135°, sweep 270°.
 */
@Composable
fun RingGauge(
    fraction: Float,
    level: UsageLevel,
    diameter: Dp,
    lineWidth: Dp = 7.dp,
    modifier: Modifier = Modifier,
    animated: Boolean = true,
    center: (@Composable () -> Unit)? = null,
) {
    val sweep by animateFloatAsState(
        targetValue = fraction.coerceIn(0f, 1f),
        animationSpec = tween(durationMillis = if (animated) 420 else 0),
        label = "ring-sweep",
    )
    Box(modifier = modifier.size(diameter), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(diameter)) {
            val stroke = Stroke(width = lineWidth.toPx(), cap = StrokeCap.Round)
            val inset = lineWidth.toPx() / 2
            val arcSize = Size(size.width - lineWidth.toPx(), size.height - lineWidth.toPx())
            val topLeft = Offset(inset, inset)
            drawArc(
                color = QWColors.Surface2,
                startAngle = 135f, sweepAngle = 270f, useCenter = false,
                topLeft = topLeft, size = arcSize, style = stroke,
            )
            if (sweep > 0f) {
                drawArc(
                    color = level.color,
                    startAngle = 135f, sweepAngle = 270f * sweep, useCenter = false,
                    topLeft = topLeft, size = arcSize, style = stroke,
                )
            }
        }
        center?.invoke()
    }
}
