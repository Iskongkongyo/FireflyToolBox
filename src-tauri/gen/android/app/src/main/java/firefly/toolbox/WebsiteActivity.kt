package firefly.toolbox

import android.graphics.Color
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.view.View
import android.view.ViewGroup
import android.view.KeyEvent
import android.view.Gravity
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.SslErrorHandler
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import android.webkit.ValueCallback
import android.webkit.MimeTypeMap
import android.webkit.WebResourceError
import android.graphics.Bitmap
import android.content.res.ColorStateList
import android.net.http.SslError
import android.widget.LinearLayout
import android.widget.ImageButton
import android.widget.TextView
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.core.widget.doOnTextChanged
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.util.Locale

class WebsiteActivity : AppCompatActivity() {
  private lateinit var browser: WebView
  private lateinit var launchUrl: String
  private lateinit var loadingProgress: ProgressBar
  private lateinit var findBar: LinearLayout
  private lateinit var findInput: EditText
  private lateinit var findCount: TextView
  private lateinit var findPrevious: ImageButton
  private lateinit var findNext: ImageButton
  private var findMatchCount = 0
  private var pageLoading = false
  private var uploadCallback: ValueCallback<Array<Uri>>? = null
  private var uploadPickerOpen = false
  private var uploadMultiple = false
  private val downloads = WebsiteDownloads(this)
  private val blobDownloads = WebsiteBlobDownloads(this)
  private val uploadPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val callback = uploadCallback
    val multiple = uploadMultiple
    uploadCallback = null
    uploadPickerOpen = false
    uploadMultiple = false
    if (callback != null) {
      val selected = if (result.resultCode == RESULT_OK) {
        runCatching {
          val uris = mutableListOf<Uri>()
          result.data?.data?.let { uris.add(it) }
          result.data?.clipData?.let { items ->
            for (index in 0 until items.itemCount) items.getItemAt(index).uri?.let { uris.add(it) }
          }
          uris.distinct()
        }.getOrNull()
      } else null
      if (selected.isNullOrEmpty()) callback.onReceiveValue(null)
      else if (selected.any { !canUpload(it) }) {
        callback.onReceiveValue(null)
        Toast.makeText(this, "无法读取所选文件，请换用系统文件选择器重试。", Toast.LENGTH_SHORT).show()
      } else callback.onReceiveValue((if (multiple) selected else selected.take(1)).toTypedArray())
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val url = intent.getStringExtra("url") ?: return finish()
    if (!isAllowedUrl(url)) return finish()
    launchUrl = url

    val density = resources.displayMetrics.density
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.WHITE)
    }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      insets
    }

    val toolbar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = android.view.Gravity.CENTER_VERTICAL
      setPadding((8 * density).toInt(), 0, (12 * density).toInt(), 0)
      setBackgroundColor(Color.WHITE)
    }
    toolbar.addView(toolbarButton(R.drawable.ic_toolbar_back, "返回") { goBackOrClose() }, toolbarButtonParams(density))
    val title = TextView(this).apply {
      text = Uri.parse(url).host ?: "网站"
      textSize = 17f
      setTextColor(Color.rgb(36, 59, 54))
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    toolbar.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    toolbar.addView(toolbarButton(R.drawable.ic_toolbar_refresh, "刷新页面") { browser.reload() }, toolbarButtonParams(density))
    toolbar.addView(toolbarButton(R.drawable.ic_toolbar_close, "关闭网站") { finish() }, toolbarButtonParams(density))
    val more = toolbarButton(R.drawable.ic_toolbar_more, "网页菜单") {}
    more.setOnClickListener { showPageMenu(more) }
    toolbar.addView(more, toolbarButtonParams(density))
    root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (52 * density).toInt()))
    findBar = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding((8 * density).toInt(), 0, (8 * density).toInt(), 0)
      setBackgroundColor(Color.WHITE)
      visibility = View.GONE
    }
    findInput = EditText(this).apply {
      hint = "在页面中查找"
      contentDescription = "页面内查找关键词"
      textSize = 15f
      setTextColor(Color.rgb(36, 59, 54))
      setHintTextColor(Color.rgb(104, 125, 116))
      setSingleLine(true)
      minWidth = 0
      imeOptions = EditorInfo.IME_ACTION_SEARCH
      doOnTextChanged { _, _, _, _ -> searchPage() }
      setOnEditorActionListener { _, action, event ->
        if (action == EditorInfo.IME_ACTION_SEARCH || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)) {
          if (findMatchCount > 0) browser.findNext(true) else searchPage()
          true
        } else false
      }
    }
    findBar.addView(findInput, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    findCount = TextView(this).apply { textSize = 12f; setTextColor(Color.rgb(104, 125, 116)); gravity = Gravity.CENTER }
    findBar.addView(findCount, LinearLayout.LayoutParams((54 * density).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT))
    findPrevious = toolbarButton(R.drawable.ic_toolbar_up, "上一个匹配") { browser.findNext(false) }
    findNext = toolbarButton(R.drawable.ic_toolbar_down, "下一个匹配") { browser.findNext(true) }
    for (button in listOf(findPrevious, findNext, toolbarButton(R.drawable.ic_toolbar_close, "关闭页面内查找") { hidePageFind() })) {
      findBar.addView(button, LinearLayout.LayoutParams((40 * density).toInt(), (48 * density).toInt()))
    }
    updateFindCount(0, 0)
    root.addView(findBar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (52 * density).toInt()))
    loadingProgress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
      max = 100
      progressTintList = ColorStateList.valueOf(Color.rgb(39, 102, 83))
      progressBackgroundTintList = ColorStateList.valueOf(Color.rgb(231, 240, 233))
      contentDescription = "网页加载进度"
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
      visibility = View.INVISIBLE
    }
    root.addView(loadingProgress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (3 * density).toInt().coerceAtLeast(1)))
    root.addView(View(this).apply { setBackgroundColor(Color.rgb(220, 228, 223)) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (1 * density).toInt().coerceAtLeast(1)))

    browser = WebView(this).apply {
      overScrollMode = View.OVER_SCROLL_NEVER
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.allowFileAccess = false
      settings.allowContentAccess = false
      settings.allowFileAccessFromFileURLs = false
      settings.allowUniversalAccessFromFileURLs = false
      settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
      settings.setSupportMultipleWindows(false)
      settings.javaScriptCanOpenWindowsAutomatically = false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.safeBrowsingEnabled = true
      blobDownloads.attach(this)
      setDownloadListener { url, userAgent, disposition, mimeType, _ ->
        pageLoading = false
        loadingProgress.visibility = View.INVISIBLE
        if (url.startsWith("blob:")) blobDownloads.start(this, url, mimeType)
        else downloads.start(url, userAgent, disposition, mimeType)
        if (findBar.visibility == View.VISIBLE) searchPage()
      }
      setFindListener { ordinal, count, done ->
        if (done && findBar.visibility == View.VISIBLE && findInput.text.isNotEmpty() && !pageLoading) updateFindCount(ordinal, count)
      }
      webChromeClient = object : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
          // Keep the original request's lease until its picker actually returns.
          // A late result must never be sent to a newer page or file input.
          if (uploadPickerOpen || isFinishing || isDestroyed) {
            callback.onReceiveValue(null)
            return true
          }
          if (params.mode != FileChooserParams.MODE_OPEN && params.mode != FileChooserParams.MODE_OPEN_MULTIPLE) {
            callback.onReceiveValue(null)
            return true
          }
          uploadCallback = callback
          uploadMultiple = params.mode == FileChooserParams.MODE_OPEN_MULTIPLE
          try {
            val accepted = uploadTypes(params.acceptTypes.orEmpty())
            val picker = params.createIntent().apply {
              action = Intent.ACTION_OPEN_DOCUMENT
              addCategory(Intent.CATEGORY_OPENABLE)
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              putExtra(Intent.EXTRA_ALLOW_MULTIPLE, uploadMultiple)
              type = if (accepted.size == 1) accepted[0] else "*/*"
              if (accepted.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, accepted.toTypedArray())
              else removeExtra(Intent.EXTRA_MIME_TYPES)
            }
            uploadPickerOpen = true
            uploadPicker.launch(picker)
          } catch (_: Exception) {
            uploadPickerOpen = false
            cancelFileChooser()
            Toast.makeText(this@WebsiteActivity, "无法打开文件选择器，请确认设备上有可用的文件管理器。", Toast.LENGTH_SHORT).show()
          }
          return true
        }

        override fun onProgressChanged(view: WebView, newProgress: Int) {
          loadingProgress.progress = newProgress.coerceIn(0, 100)
          loadingProgress.contentDescription = "网页加载进度 ${loadingProgress.progress}%"
          loadingProgress.visibility = if (pageLoading) View.VISIBLE else View.INVISIBLE
        }
      }
      webViewClient = object : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
          blobDownloads.navigationStarted()
          cancelFileChooser()
          pageLoading = true
          clearMatchesForFind()
          loadingProgress.progress = 0
          loadingProgress.visibility = View.VISIBLE
        }
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
          !isAllowedUrl(request.url.toString())

        override fun onPageFinished(view: WebView, url: String) {
          pageLoading = false
          loadingProgress.visibility = View.INVISIBLE
          title.text = view.title?.takeIf { it.isNotBlank() } ?: Uri.parse(url).host ?: "网站"
          if (findBar.visibility == View.VISIBLE) searchPage()
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
          pageLoading = false
          loadingProgress.visibility = View.INVISIBLE
          handler.cancel()
        }
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
          if (request.isForMainFrame) { pageLoading = false; loadingProgress.visibility = View.INVISIBLE }
        }
      }
      loadUrl(url)
    }
    root.addView(browser, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    setContentView(root)
    WindowInsetsControllerCompat(window, root).apply {
      isAppearanceLightStatusBars = true
      isAppearanceLightNavigationBars = true
    }

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() = goBackOrClose()
    })
  }

  private fun goBackOrClose() {
    if (::findBar.isInitialized && findBar.visibility == View.VISIBLE) hidePageFind()
    else if (::browser.isInitialized && browser.canGoBack()) browser.goBack() else finish()
  }

  private fun toolbarButtonParams(density: Float) =
    LinearLayout.LayoutParams((44 * density).toInt(), (52 * density).toInt())

  private fun toolbarButton(icon: Int, label: String, onClick: () -> Unit): ImageButton =
    ImageButton(this).apply {
      setImageResource(icon)
      background = null
      setPadding(0, 0, 0, 0)
      contentDescription = label
      scaleType = android.widget.ImageView.ScaleType.CENTER
      setOnClickListener { onClick() }
    }

  private fun currentPageUrl() = browser.url?.takeIf(::isAllowedUrl) ?: launchUrl

  private fun showPageMenu(anchor: View) {
    PopupMenu(this, anchor, Gravity.END).apply {
      menu.add(0, 1, 0, "分享")
      menu.add(0, 2, 1, "复制网址")
      menu.add(0, 3, 2, "默认浏览器打开")
      menu.add(0, 4, 3, "页面内查找")
      setOnMenuItemClickListener { item ->
        when (item.itemId) {
          1 -> sharePage()
          2 -> copyPageUrl()
          3 -> openInBrowser()
          4 -> showPageFind()
        }
        true
      }
      show()
    }
  }

  private fun sharePage() {
    val share = Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_TEXT, currentPageUrl())
      browser.title?.takeIf { it.isNotBlank() }?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
    }
    try { startActivity(Intent.createChooser(share, "分享网页")) }
    catch (_: ActivityNotFoundException) { Toast.makeText(this, "没有可用的分享应用。", Toast.LENGTH_SHORT).show() }
  }

  private fun copyPageUrl() {
    val clipboard = getSystemService(ClipboardManager::class.java)
    clipboard.setPrimaryClip(ClipData.newPlainText("网址", currentPageUrl()))
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) Toast.makeText(this, "网址已复制", Toast.LENGTH_SHORT).show()
  }

  private fun openInBrowser() {
    // Resolve the browser using a generic HTTPS intent so a site's app-link
    // association does not redirect this explicit browser action into an app.
    val generic = Intent(Intent.ACTION_VIEW, Uri.parse("https://")).addCategory(Intent.CATEGORY_BROWSABLE)
    val handler = generic.resolveActivity(packageManager)
    val browsers = packageManager.queryIntentActivities(generic, PackageManager.MATCH_DEFAULT_ONLY)
    val external = Intent(Intent.ACTION_VIEW, Uri.parse(currentPageUrl())).addCategory(Intent.CATEGORY_BROWSABLE)
    if (handler != null && browsers.any { it.activityInfo.packageName == handler.packageName }) external.setPackage(handler.packageName)
    else external.selector = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_BROWSER)
    try { startActivity(external) }
    catch (_: ActivityNotFoundException) { Toast.makeText(this, "没有可用的浏览器。", Toast.LENGTH_SHORT).show() }
  }

  private fun showPageFind() {
    findBar.visibility = View.VISIBLE
    findInput.requestFocus()
    findInput.selectAll()
    searchPage()
    findInput.post { getSystemService(InputMethodManager::class.java).showSoftInput(findInput, InputMethodManager.SHOW_IMPLICIT) }
  }

  private fun hidePageFind() {
    findBar.visibility = View.GONE
    findInput.clearFocus()
    getSystemService(InputMethodManager::class.java).hideSoftInputFromWindow(findInput.windowToken, 0)
    clearMatchesForFind()
    browser.requestFocus()
  }

  private fun updateFindCount(ordinal: Int, count: Int) {
    findMatchCount = count
    findCount.text = "${if (count > 0) ordinal + 1 else 0}/$count"
    findCount.contentDescription = if (count > 0) "第 ${ordinal + 1} 项，共 $count 项" else "没有匹配项"
    for (button in listOf(findPrevious, findNext)) { button.isEnabled = count > 0; button.alpha = if (count > 0) 1f else 0.35f }
  }

  private fun clearMatchesForFind() {
    if (::browser.isInitialized) browser.clearMatches()
    updateFindCount(0, 0)
  }

  private fun searchPage() {
    if (!::browser.isInitialized) return
    updateFindCount(0, 0)
    val query = findInput.text.toString()
    if (findBar.visibility != View.VISIBLE || query.isEmpty() || pageLoading) browser.clearMatches()
    else browser.findAllAsync(query)
  }

  private fun isAllowedUrl(url: String): Boolean {
    if (url.length > 2048) return false
    val parsed = Uri.parse(url)
    return parsed.scheme in listOf("http", "https") && !parsed.host.isNullOrBlank() && parsed.userInfo.isNullOrEmpty()
  }

  private fun uploadTypes(values: Array<out String>): List<String> {
    val mime = Regex("^(\\*|[a-z0-9][a-z0-9.+_-]*)/(\\*|[a-z0-9][a-z0-9.+_-]*)$")
    val accepted = values.flatMap { it.split(',') }.mapNotNull { value ->
      val type = value.trim().lowercase(Locale.ROOT)
      val resolved = if (type.startsWith('.')) MimeTypeMap.getSingleton().getMimeTypeFromExtension(type.drop(1)) else type
      resolved?.takeIf { mime.matches(it) }
    }.distinct()
    return if (accepted.isEmpty() || "*/*" in accepted) listOf("*/*") else accepted
  }

  private fun canUpload(uri: Uri): Boolean {
    val authority = uri.authority ?: return false
    if (uri.scheme != "content" || authority == packageName || authority.startsWith("$packageName.")) return false
    return checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED
  }

  private fun cancelFileChooser() {
    val callback = uploadCallback
    uploadCallback = null
    uploadMultiple = false
    callback?.onReceiveValue(null)
  }

  override fun onDestroy() {
    blobDownloads.close()
    cancelFileChooser()
    if (::browser.isInitialized) {
      (browser.parent as? ViewGroup)?.removeView(browser)
      browser.destroy()
    }
    super.onDestroy()
  }
}
