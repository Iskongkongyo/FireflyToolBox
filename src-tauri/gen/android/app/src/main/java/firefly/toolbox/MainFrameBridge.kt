package firefly.toolbox

import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.util.concurrent.Executors

/** Origin and frame identity come from WebView, never from a script's payload. */
object MainFrameBridge {
  // WebMessageListener runs on the UI thread. Wry's Java interface normally
  // enters Rust from a background thread; preserve that to avoid UI deadlocks.
  private val ipcExecutor = Executors.newSingleThreadExecutor { work ->
    Thread(work, "FireflyIpc").apply { isDaemon = true }
  }
  fun origins(): Set<String> = setOf("http://tauri.localhost", "https://tauri.localhost") +
    if (BuildConfig.DEBUG) setOf("http://localhost:1420", "http://127.0.0.1:1420") else emptySet()

  // Called by Wry's class extension instead of registering its global Java IPC.
  // Forward the unchanged payload only after WebView authenticates the sender.
  fun installIpc(webView: WebView, delegate: Any) {
    require(delegate is Ipc) { "Unexpected Android IPC implementation" }
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    val origins = origins()
    WebViewCompat.addWebMessageListener(webView, "ipc", origins) { _, message, sourceOrigin, isMainFrame, _ ->
      if (!isMainFrame || sourceOrigin.toString() !in origins) return@addWebMessageListener
      val data = try { message.data } catch (_: Exception) { null }
      if (data != null) ipcExecutor.execute { delegate.postMessage(data) }
    }
  }
}
