package io.quotawatch

import android.app.Application
import io.quotawatch.widget.QuotaWidgetWorker

class QWApp : Application() {
    override fun onCreate() {
        super.onCreate()
        QuotaWidgetWorker.schedule(this)
    }
}
