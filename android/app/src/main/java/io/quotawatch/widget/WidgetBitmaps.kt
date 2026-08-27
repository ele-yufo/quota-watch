package io.quotawatch.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.content.res.ResourcesCompat
import io.quotawatch.R

/**
 * Widget 位图渲染 —— RemoteViews/Glance 加载不了 res/font 的自定义字体，
 * 也画不了圆弧，所以 Fraunces 大数字与 270° 环形都在这里用 Canvas 预渲染。
 * 与 App 内 RingGauge 同一几何：start 135°、sweep 270°、圆头描边。
 */
object WidgetBitmaps {

    private fun fraunces(context: Context): Typeface =
        ResourcesCompat.getFont(context, R.font.fraunces) ?: Typeface.DEFAULT

    /** 270° 开口环（底部 90° 缺口），track 色 + 进度色两段圆弧。 */
    fun ring(
        fraction: Float,
        trackColor: Int,
        progressColor: Int,
        sizePx: Int,
        strokePx: Float,
    ): Bitmap {
        val bmp = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = strokePx
            strokeCap = Paint.Cap.ROUND
        }
        val inset = strokePx / 2f
        val rect = RectF(inset, inset, sizePx - inset, sizePx - inset)

        paint.color = trackColor
        canvas.drawArc(rect, 135f, 270f, false, paint)

        val sweep = 270f * fraction.coerceIn(0f, 1f)
        if (sweep > 0f) {
            paint.color = progressColor
            canvas.drawArc(rect, 135f, sweep, false, paint)
        }
        return bmp
    }

    /** Fraunces 文本（百分比大数字）。颜色、字号按像素给。 */
    fun frauncesText(
        context: Context,
        text: String,
        color: Int,
        textSizePx: Float,
    ): Bitmap {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = fraunces(context)
            this.color = color
            this.textSize = textSizePx
        }
        val width = paint.measureText(text).toInt() + 2
        val fm = paint.fontMetrics
        val height = (fm.descent - fm.ascent).toInt() + 2
        val bmp = Bitmap.createBitmap(width.coerceAtLeast(1), height.coerceAtLeast(1),
            Bitmap.Config.ARGB_8888)
        Canvas(bmp).drawText(text, 1f, -fm.ascent + 1f, paint)
        return bmp
    }
}
