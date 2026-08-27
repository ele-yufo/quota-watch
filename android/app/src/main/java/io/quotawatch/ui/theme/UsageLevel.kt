package io.quotawatch.ui.theme

import androidx.compose.ui.graphics.Color

/** Quota semantics, shared by gauges/alerts/dots — port of UsageLevel in
 *  Theme.swift. remainingPct ≥ 25 → ok, 10–24 → warn, < 10 → danger. */
enum class UsageLevel(val color: Color, val label: String) {
    OK(QWColors.Accent, "充足"),
    WARN(QWColors.Warning, "偏紧"),
    DANGER(QWColors.Danger, "告急");

    companion object {
        fun of(remainingPct: Double): UsageLevel = when {
            remainingPct >= 25 -> OK
            remainingPct >= 10 -> WARN
            else -> DANGER
        }
    }
}
