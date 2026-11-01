package firefly.toolbox

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Called through the main window's Rust command ACL, never a JavascriptInterface. */
object CacheBridge {
  private var view = WeakReference<WebView>(null)
  fun attach(webView: WebView) { view = WeakReference(webView) }

  @JvmStatic fun clear(): String {
    val done = CountDownLatch(1)
    var result = "浏览器尚未就绪。"
    Handler(Looper.getMainLooper()).post {
      try {
        val webView = view.get()
        if (webView != null) {
          // clearCache removes generated resource caches, not cookies/WebStorage.
          webView.clearCache(true)
          result = "ok"
        }
      } catch (_: Exception) { result = "浏览器缓存清理失败。" }
      finally { done.countDown() }
    }
    return if (done.await(20, TimeUnit.SECONDS)) result else "浏览器缓存清理超时。"
  }
}
