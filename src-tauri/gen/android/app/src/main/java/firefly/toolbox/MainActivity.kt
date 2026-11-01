package firefly.toolbox

import android.os.Bundle
import android.content.Intent
import android.net.Uri
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : TauriActivity() {
  @Volatile private var topInsetDp = 0f
  @Volatile private var bottomInsetDp = 0f
  @Volatile private var cutoutTopDp = 0f
  @Volatile private var cutoutRightDp = 0f
  private var appWebView: WebView? = null
  private var toolFullscreenBars: Triple<Boolean, Boolean, Int>? = null
  private val navigationBackCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() {
      appWebView?.evaluateJavascript("window.dispatchEvent(new Event('firefly:native-back'))", null)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    ShortcutBridge.offerLaunch(intent?.getStringExtra(ShortcutBridge.TOOL_ID_EXTRA))
    val density = resources.displayMetrics.density
    topInsetDp = systemDimension("status_bar_height") / density
    bottomInsetDp = systemDimension("navigation_bar_height") / density
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, navigationBackCallback)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { _, insets ->
      topInsetDp = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top / density
      bottomInsetDp = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom / density
      cutoutTopDp = (insets.displayCutout?.safeInsetTop ?: 0) / density
      cutoutRightDp = (insets.displayCutout?.safeInsetRight ?: 0) / density
      appWebView?.evaluateJavascript(
        "if(document.documentElement){document.documentElement.style.setProperty('--system-status-top','${topInsetDp}px');document.documentElement.style.setProperty('--system-navigation-bottom','${bottomInsetDp}px');document.documentElement.style.setProperty('--system-cutout-top','${cutoutTopDp}px');document.documentElement.style.setProperty('--system-cutout-right','${cutoutRightDp}px')}window.dispatchEvent(new CustomEvent('firefly:insets',{detail:{top:${topInsetDp},bottom:${bottomInsetDp},cutoutTop:${cutoutTopDp},cutoutRight:${cutoutRightDp}}}))",
        null
      )
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    ShortcutBridge.offerLaunch(intent.getStringExtra(ShortcutBridge.TOOL_ID_EXTRA))
    appWebView?.evaluateJavascript("window.dispatchEvent(new Event('firefly:shortcut-open'))", null)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    appWebView = webView
    CacheBridge.attach(webView)
    webView.overScrollMode = View.OVER_SCROLL_NEVER
    installShellBridge(webView)
  }

  override fun onResume() {
    super.onResume()
    if (toolFullscreenBars != null) {
      WindowInsetsControllerCompat(window, window.decorView).hide(WindowInsetsCompat.Type.systemBars())
    }
    appWebView?.postDelayed({
      appWebView?.evaluateJavascript("window.dispatchEvent(new Event('firefly:foreground'))", null)
    }, 250)
  }

  private fun systemDimension(name: String): Int {
    val id = resources.getIdentifier(name, "dimen", "android")
    return if (id != 0) resources.getDimensionPixelSize(id) else 0
  }

  private fun setToolFullscreen(enabled: Boolean) {
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    if (enabled) {
      if (toolFullscreenBars == null) {
        val insets = ViewCompat.getRootWindowInsets(window.decorView)
        toolFullscreenBars = Triple(
          insets?.isVisible(WindowInsetsCompat.Type.statusBars()) ?: true,
          insets?.isVisible(WindowInsetsCompat.Type.navigationBars()) ?: true,
          controller.systemBarsBehavior
        )
      }
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      val previous = toolFullscreenBars ?: return
      toolFullscreenBars = null
      controller.systemBarsBehavior = previous.third
      if (previous.first) controller.show(WindowInsetsCompat.Type.statusBars())
      else controller.hide(WindowInsetsCompat.Type.statusBars())
      if (previous.second) controller.show(WindowInsetsCompat.Type.navigationBars())
      else controller.hide(WindowInsetsCompat.Type.navigationBars())
    }
  }

  private fun installShellBridge(webView: WebView) {
    // JavascriptInterface is visible even to opaque sandboxed tool frames.
    // A supported WebView must authenticate both the origin and the main frame.
    // Do not fall back to a global Java interface on older WebViews.
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return
    val origins = MainFrameBridge.origins()
    WebViewCompat.addWebMessageListener(webView, "FireflyAndroid", origins) { _, message, sourceOrigin, isMainFrame, reply ->
      if (!isMainFrame || sourceOrigin.toString() !in origins) return@addWebMessageListener
      val request = try {
        val text = message.data ?: return@addWebMessageListener
        if (text.length > 4096) return@addWebMessageListener
        JSONObject(text)
      } catch (_: Exception) { return@addWebMessageListener }
      val id = request.opt("id") as? String ?: return@addWebMessageListener
      if (id.isEmpty() || id.length > 64) return@addWebMessageListener
      val response = JSONObject().put("id", id)
      try {
        val result: Any = when (request.opt("operation")) {
          "state" -> {
            // A main-document reload abandons its tool; release only our lease.
            setToolFullscreen(false)
            JSONObject().put("top", topInsetDp).put("bottom", bottomInsetDp)
              .put("cutoutTop", cutoutTopDp).put("cutoutRight", cutoutRightDp)
              .put("shortcutPending", ShortcutBridge.hasPendingLaunch())
          }
          "setToolFullscreen" -> {
            setToolFullscreen(request.get("value") as? Boolean ?: throw IllegalArgumentException())
            true
          }
          "openWebsite" -> {
            val url = request.get("value") as? String ?: throw IllegalArgumentException()
            val parsed = Uri.parse(url)
            require(url.length <= 2048 && parsed.scheme in listOf("http", "https") &&
              !parsed.host.isNullOrBlank() && parsed.userInfo.isNullOrEmpty())
            startActivity(Intent(this, WebsiteActivity::class.java).putExtra("url", url))
            true
          }
          "setBackEnabled" -> {
            navigationBackCallback.isEnabled = request.get("value") as? Boolean ?: throw IllegalArgumentException()
            true
          }
          "setDark" -> {
            val dark = request.get("value") as? Boolean ?: throw IllegalArgumentException()
            val controller = WindowInsetsControllerCompat(window, window.decorView)
            controller.isAppearanceLightStatusBars = !dark
            controller.isAppearanceLightNavigationBars = !dark
            true
          }
          else -> throw IllegalArgumentException()
        }
        response.put("result", result)
      } catch (_: Exception) {
        response.put("error", "Android 原生请求无效或操作失败。")
      }
      reply.postMessage(response.toString())
    }
  }
}
