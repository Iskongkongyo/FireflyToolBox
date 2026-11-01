package firefly.toolbox

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.DocumentsContract
import android.util.Base64
import android.webkit.WebView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.URLUtilCompat
import org.json.JSONObject
import java.io.OutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

/** A blob transfer is authorized by DownloadListener, never by a page message. */
class WebsiteBlobDownloads(private val activity: ComponentActivity) {
  private data class Origin(val scheme: String, val host: String, val port: Int)
  private class Transfer(val id: String, val origin: Origin) {
    var phase = "begin"
    var size = 0L
    var name = ""
    var mime = "application/octet-stream"
    var written = 0L
    var busy = false
    @Volatile var cancelled = false
    var uri: Uri? = null
    var persisted = false
    var output: OutputStream? = null
    var temporary: File? = null
    var targetOpened = false
    var reply: JavaScriptReplyProxy? = null
    var dialog: AlertDialog? = null
    var progress: ProgressBar? = null
    var label: TextView? = null
    var timeout: Runnable? = null
  }
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private val resolver by lazy { activity.applicationContext.contentResolver }
  private var active: Transfer? = null
  private var picker: Transfer? = null
  private var supported = false
  private var closed = false
  private val savePicker = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    val transfer = picker
    picker = null
    if (transfer != null) {
      val uri = result.data?.data
      if (result.resultCode != Activity.RESULT_OK || uri == null) cancel(transfer, "已取消保存", false)
      else if (!writable(uri)) cancel(transfer, "无法写入所选位置，请重新选择。")
      else {
        transfer.uri = uri
        if ((result.data?.flags ?: 0) and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0) {
          transfer.persisted = runCatching { resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION); true }.getOrDefault(false)
        }
        if (transfer.cancelled || active !== transfer) io.execute { discard(transfer) }
        else open(transfer)
      }
    }
  }

  fun attach(view: WebView) {
    supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
      WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
    if (!supported) return
    // Website windows can visit any HTTP(S) origin. Native origin/frame checks
    // and an issued transfer id restrict this endpoint to the active download.
    WebViewCompat.addWebMessageListener(view, "FireflyBlobDownload", setOf("*")) { _, message, source, isMainFrame, reply ->
      val transfer = active
      if (!isMainFrame || transfer == null || transfer.cancelled || origin(source) != transfer.origin || origin(Uri.parse(view.url ?: "")) != transfer.origin) return@addWebMessageListener
      try {
        val data = message.data ?: return@addWebMessageListener
        if (data.length > 360000) return@addWebMessageListener
        val request = JSONObject(data)
        if (request.optString("id") != transfer.id) return@addWebMessageListener
        transfer.reply = reply
        receive(transfer, request, reply)
      } catch (_: Exception) { cancel(transfer, "临时文件传输失败，请重新下载。") }
    }
    val script = activity.assets.open("website-blob-download.js").bufferedReader().use { it.readText() }
    WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
  }

  fun start(view: WebView, url: String, mime: String?) {
    if (closed || activity.isFinishing || activity.isDestroyed) return
    if (!supported) { toast("请更新 Android System WebView 后下载网页临时文件。"); return }
    if (active != null || picker != null) { toast("正在保存另一个临时文件，请稍后再试。"); return }
    val pageOrigin = origin(Uri.parse(view.url ?: ""))
    val blob = Uri.parse(url)
    if (blob.scheme != "blob" || pageOrigin == null || origin(Uri.parse(blob.schemeSpecificPart)) != pageOrigin) {
      toast("无法读取这个网页临时文件。"); return
    }
    val transfer = Transfer(UUID.randomUUID().toString(), pageOrigin)
    active = transfer
    arm(transfer)
    view.evaluateJavascript("window.__fireflyBlobDownload?.start(${JSONObject.quote(transfer.id)},${JSONObject.quote(url)},${JSONObject.quote(mime ?: "")})", null)
  }

  private fun receive(transfer: Transfer, request: JSONObject, reply: JavaScriptReplyProxy) {
    when (request.optString("operation")) {
      "begin" -> {
        require(transfer.phase == "begin")
        val size = request.getLong("size")
        require(size >= 0 && request.getDouble("size") == size.toDouble())
        if (size > 2L * 1024 * 1024 * 1024) { cancel(transfer, "单个网页临时文件最多支持 2 GiB。"); return }
        val name = request.optString("name")
        require(name.length <= 1024)
        val mime = request.optString("mime").substringBefore(';').trim().lowercase(Locale.ROOT)
        transfer.mime = mime.takeIf { it.length <= 128 && Regex("^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$").matches(it) } ?: "application/octet-stream"
        transfer.name = WebsiteDownloads.safeName(name.ifBlank { URLUtilCompat.guessFileName("https://download.invalid/download", null, transfer.mime) })
        transfer.size = size
        transfer.reply = reply
        transfer.phase = "picker"
        disarm(transfer)
        picker = transfer
        try {
          savePicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = transfer.mime
            putExtra(Intent.EXTRA_TITLE, transfer.name)
            putExtra(Intent.EXTRA_LOCAL_ONLY, true)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
          })
        } catch (_: Exception) {
          picker = null
          cancel(transfer, "无法打开保存窗口，请确认有可用的文件管理器。")
        }
      }
      "chunk" -> {
        require(transfer.phase == "transfer" && !transfer.busy)
        val offset = request.getLong("offset")
        val encoded = request.getString("data")
        require(offset == transfer.written && encoded.length <= 349528)
        transfer.busy = true
        arm(transfer)
        io.execute {
          try {
            val bytes = Base64.decode(encoded, Base64.NO_WRAP)
            require(bytes.isNotEmpty() && bytes.size <= 262144 && transfer.written + bytes.size <= transfer.size)
            if (transfer.cancelled) return@execute
            transfer.output!!.write(bytes)
            transfer.written += bytes.size
            main.post {
              if (active === transfer && !transfer.cancelled) {
                transfer.busy = false
                updateProgress(transfer)
                arm(transfer)
                respond(transfer, JSONObject().put("written", transfer.written))
              }
            }
          } catch (_: Exception) { main.post { cancel(transfer, "临时文件保存失败，请重新下载。") } }
        }
      }
      "finish" -> {
        require(transfer.phase == "transfer" && !transfer.busy && transfer.written == transfer.size)
        transfer.phase = "commit"
        disarm(transfer)
        transfer.dialog?.setCancelable(false)
        transfer.dialog?.getButton(AlertDialog.BUTTON_NEGATIVE)?.isEnabled = false
        transfer.dialog?.setTitle("正在完成保存")
        transfer.progress?.isIndeterminate = true
        io.execute {
          try {
            transfer.output!!.flush()
            transfer.output?.close()
            transfer.output = null
            resolver.openOutputStream(transfer.uri!!, "wt")?.use { output ->
              transfer.targetOpened = true
              transfer.temporary!!.inputStream().use { input -> input.copyTo(output, 262144) }
            } ?: throw IllegalStateException()
            transfer.temporary?.delete()
            release(transfer)
            main.post {
              if (active === transfer && !transfer.cancelled) {
                active = null
                transfer.dialog?.dismiss()
                respond(transfer, JSONObject().put("saved", true))
                if (!closed) toast("文件已保存")
              }
            }
          } catch (_: Exception) {
            transfer.cancelled = true
            discard(transfer)
            main.post {
              if (active === transfer) active = null
              transfer.dialog?.dismiss()
              respond(transfer, JSONObject().put("error", "临时文件保存失败，请重新下载。"))
              if (!closed) toast("临时文件保存失败，请重新下载。")
            }
          }
        }
      }
      "error" -> cancel(transfer, "无法读取临时文件，链接可能已失效。")
      else -> throw IllegalArgumentException()
    }
  }

  private fun open(transfer: Transfer) {
    transfer.phase = "opening"
    arm(transfer)
    showProgress(transfer)
    io.execute {
      try {
        if (transfer.cancelled) return@execute
        transfer.temporary = File.createTempFile("website-blob-", ".part", activity.cacheDir)
        transfer.output = FileOutputStream(transfer.temporary!!)
        main.post {
          if (active === transfer && !transfer.cancelled) {
            transfer.phase = "transfer"
            arm(transfer)
            respond(transfer, JSONObject().put("ready", true))
          }
        }
      } catch (_: Exception) { main.post { cancel(transfer, "无法写入所选位置，请重新选择。") } }
    }
  }

  private fun showProgress(transfer: Transfer) {
    val density = activity.resources.displayMetrics.density
    val layout = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setPadding((24 * density).toInt(), (16 * density).toInt(), (24 * density).toInt(), 0)
    }
    transfer.label = TextView(activity).also { layout.addView(it) }
    transfer.progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100 }.also { layout.addView(it) }
    updateProgress(transfer)
    transfer.dialog = AlertDialog.Builder(activity).setTitle("正在保存文件").setView(layout)
      .setNegativeButton("取消") { _, _ -> cancel(transfer, "已取消保存", false) }
      .setOnCancelListener { cancel(transfer, "已取消保存", false) }.create().also { it.setCanceledOnTouchOutside(false); it.show() }
  }

  private fun updateProgress(transfer: Transfer) {
    val percent = if (transfer.size == 0L) 100 else (transfer.written * 100 / transfer.size).toInt()
    transfer.progress?.progress = percent
    transfer.label?.text = "${transfer.name}\n$percent%"
  }

  private fun respond(transfer: Transfer, value: JSONObject) {
    runCatching { transfer.reply?.postMessage(value.put("id", transfer.id).toString()) }
  }

  private fun cancel(transfer: Transfer, reason: String, show: Boolean = true) {
    if (transfer.cancelled || transfer.phase == "commit") return
    transfer.cancelled = true
    disarm(transfer)
    if (active === transfer) active = null
    transfer.dialog?.dismiss()
    respond(transfer, JSONObject().put("error", reason))
    io.execute { discard(transfer) }
    if (show && !activity.isFinishing && !activity.isDestroyed) toast(reason)
  }

  private fun discard(transfer: Transfer) {
    runCatching { transfer.output?.close() }
    transfer.output = null
    transfer.temporary?.delete()
    // Some DocumentsProviders update their metadata asynchronously after close.
    // Cancellation during transfer never opens the destination; only a failed
    // final copy needs to let that close notification settle before deletion.
    if (transfer.targetOpened) runCatching { Thread.sleep(2000) }
    transfer.uri?.let { uri ->
      runCatching {
        if (DocumentsContract.isDocumentUri(activity, uri)) DocumentsContract.deleteDocument(resolver, uri)
        else resolver.delete(uri, null, null)
      }
    }
    release(transfer)
  }

  private fun release(transfer: Transfer) {
    if (transfer.persisted) {
      transfer.uri?.let { runCatching { resolver.releasePersistableUriPermission(it, Intent.FLAG_GRANT_WRITE_URI_PERMISSION) } }
      transfer.persisted = false
    }
  }

  private fun arm(transfer: Transfer) {
    disarm(transfer)
    val timeout = Runnable { cancel(transfer, "临时文件保存超时，请重试。") }
    transfer.timeout = timeout
    main.postDelayed(timeout, 30000)
  }

  private fun disarm(transfer: Transfer) { transfer.timeout?.let { main.removeCallbacks(it) }; transfer.timeout = null }
  fun navigationStarted() { active?.let { cancel(it, "网页已跳转，临时文件保存已取消。", false) } }
  fun close() {
    closed = true
    active?.let {
      if (it.phase == "commit") it.dialog?.dismiss()
      else cancel(it, "网页已关闭，临时文件保存已取消。", false)
    }
    main.removeCallbacksAndMessages(null)
    io.shutdown()
  }
  private fun toast(text: String) = Toast.makeText(activity, text, Toast.LENGTH_LONG).show()

  private fun writable(uri: Uri): Boolean = uri.scheme == "content" && !uri.authority.isNullOrBlank() &&
    uri.authority != activity.packageName && !uri.authority!!.startsWith(activity.packageName + ".") &&
    activity.checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED

  private fun origin(uri: Uri): Origin? {
    val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
    val host = uri.host?.lowercase(Locale.ROOT) ?: return null
    if (scheme !in listOf("http", "https") || host.isBlank() || !uri.userInfo.isNullOrEmpty()) return null
    val port = if (uri.port == -1) (if (scheme == "https") 443 else 80) else uri.port
    return if (port in 1..65535) Origin(scheme, host, port) else null
  }
}
