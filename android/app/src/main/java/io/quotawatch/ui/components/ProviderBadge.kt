package io.quotawatch.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.quotawatch.ui.theme.ProviderStyle

/** Brand glyph tile — port of ProviderBadge: rounded-rect (radius = size×0.28)
 *  filled with accent @14%, glyph tinted accent at size×0.56. */
@Composable
fun ProviderBadge(style: ProviderStyle, size: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.28f))
            .background(style.color.copy(alpha = 0.14f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = ImageVector.vectorResource(style.icon),
            contentDescription = null,
            tint = style.color,
            modifier = Modifier.size(size * 0.56f),
        )
    }
}
