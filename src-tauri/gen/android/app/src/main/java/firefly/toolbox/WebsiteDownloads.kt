package firefly.toolbox

import android.Manifest
import android.app.DownloadManager
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.URLUtilCompat
import java.util.Locale

/** Hands ordinary public HTTP(S) downloads to Android's background service. */
class WebsiteDownloads(private val activity: ComponentActivity) {
  private data class Download(val uri: Uri, val name: String, val mime: String?, val userAgent: String?)
  private var pending: Download? = null
  private val storagePermission = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    val download = pending
    pending = null
    if (download != null) {
      if (granted) enqueue(download)
      else message("未获得存储权限，无法保存到下载文件夹。")
    }
  }

  fun start(url: String, userAgent: String?, disposition: String?, mimeType: String?) {
    if (activity.isFinishing || activity.isDestroyed) return
    val uri = Uri.parse(url)
    val scheme = uri.scheme?.lowercase(Locale.ROOT)
    if (scheme !in listOf("http", "https") || uri.host.isNullOrBlank() || !uri.userInfo.isNullOrEmpty()) {
      message("此链接不是 HTTP/HTTPS 文件直链，暂不支持下载。")
      return
    }
    val mime = mimeType?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)
      ?.takeIf { Regex("^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$").matches(it) }
    val suggested = disposition?.let { URLUtilCompat.getFilenameFromContentDisposition(it) }?.takeIf { it.isNotBlank() }
      ?: URLUtilCompat.guessFileName(url, null, mime)
    val name = safeName(suggested)
    val download = Download(uri.buildUpon().scheme(scheme).build(), name, mime, userAgent)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
      if (pending != null) return
      pending = download
      storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
    } else enqueue(download)
  }

  private fun enqueue(download: Download) {
    try {
      val request = DownloadManager.Request(download.uri)
        .setTitle(download.name)
        .setDescription("来源：${download.uri.host}")
        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, download.name)
      download.mime?.let { request.setMimeType(it) }
      download.userAgent?.takeIf { !it.contains('\r') && !it.contains('\n') }?.let { request.addRequestHeader("User-Agent", it) }
      activity.getSystemService(DownloadManager::class.java).enqueue(request)
      message("已开始下载，可在通知栏查看进度。")
    } catch (_: Exception) {
      message("无法开始下载，请检查链接或系统下载服务。")
    }
  }

  companion object {
    internal fun safeName(value: String): String {
      val name = value.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().trimEnd('.').ifBlank { "download" }
      val dot = name.lastIndexOf('.')
      val suffix = if (dot > 0 && name.length - dot <= 17) name.substring(dot) else ""
      // At most 80 UTF-16 units keeps even Chinese filenames below the usual
      // filesystem byte limit, while retaining a normal file extension.
      val stem = name.removeSuffix(suffix).take(80 - suffix.length)
      return stem.dropLastWhile { Character.isHighSurrogate(it) } + suffix
    }
  }

  private fun message(text: String) = Toast.makeText(activity, text, Toast.LENGTH_LONG).show()
}
