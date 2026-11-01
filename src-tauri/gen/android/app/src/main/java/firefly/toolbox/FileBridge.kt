package firefly.toolbox

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONObject

/** JNI-only file bridge. It is never exposed to JavaScript or remote WebViews. */
object FileBridge {
  @JvmStatic fun open(context: Context, payload: String): String {
    return try {
      val request = JSONObject(payload)
      val uri = Uri.parse(request.getString("path"))
      if (uri.scheme != "content") return JSONObject().put("error", "请选择系统文件选择器提供的文件。").toString()
      val resolver = context.contentResolver
      var name = "selected-file.bin"
      var size = 0L
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn)
          if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn).coerceAtLeast(0)
        }
      }
      val mime = resolver.getType(uri) ?: "application/octet-stream"
      val result = JSONObject().put("name", name.take(240)).put("size", size).put("mime", mime)
      val descriptor = resolver.openFileDescriptor(uri, if (request.optBoolean("write")) "wt" else "r")
        ?: return JSONObject().put("error", "无法打开所选文件。").toString()
      descriptor.use { result.put("fd", it.detachFd()) }
      result.toString()
    } catch (_: Exception) { JSONObject().put("error", "Android 文件读取或写入权限不可用。").toString() }
  }
}
