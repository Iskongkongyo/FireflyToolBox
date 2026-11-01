package firefly.toolbox

import android.app.Service
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.ParcelFileDescriptor
import android.os.Process
import java.io.ByteArrayOutputStream

/** Runs untrusted JS in an Android isolated process with no app permissions. */
class ModuleService : Service() {
  companion object {
    const val RUN = 1
    const val CANCEL = 2
    // One 8 MiB browser entry can expand sixfold when JSON escapes controls.
    const val REQUEST_BYTES = 48 * 1024 * 1024 + 64 * 1024
    init { System.loadLibrary("firefly_toolbox_lib") }
    @JvmStatic external fun runNative(request: String): String
  }

  private val messenger = Messenger(Handler(Looper.getMainLooper()) { message: Message ->
    when (message.what) {
      RUN -> {
        val data = message.data
        data.classLoader = ParcelFileDescriptor::class.java.classLoader
        val request = data.getParcelable<ParcelFileDescriptor>("request")
        val response = data.getParcelable<ParcelFileDescriptor>("response")
        // Lazy Bundle parcels can retain additional pipe descriptors. Release
        // them now, otherwise the caller waits for EOF until this process dies.
        data.clear()
        if (request != null && response != null) {
          Thread {
                val reply = try {
                  val bytes = ParcelFileDescriptor.AutoCloseInputStream(request).use { input ->
                    val output = ByteArrayOutputStream()
                    val chunk = ByteArray(8192)
                    val limit = REQUEST_BYTES
                    while (output.size() <= limit) {
                      val size = input.read(chunk, 0, minOf(chunk.size, limit + 1 - output.size()))
                      if (size < 0) break
                      output.write(chunk, 0, size)
                    }
                    output.toByteArray()
                  }
                  if (bytes.size > REQUEST_BYTES) {
                    "{\"text\":null,\"error\":\"模块请求过大。\"}"
                  } else {
                    runNative(String(bytes, Charsets.UTF_8))
                  }
                } catch (_: Exception) {
                  "{\"text\":null,\"error\":\"模块执行器无法读取请求。\"}"
                }
                try { ParcelFileDescriptor.AutoCloseOutputStream(response).use { it.write(reply.toByteArray(Charsets.UTF_8)) } }
                catch (_: Exception) { }
          }.start()
        } else { request?.close(); response?.close() }
        true
      }
      CANCEL -> {
        Process.killProcess(Process.myPid())
        true
      }
      else -> false
    }
  })

  override fun onBind(intent: Intent?): IBinder = messenger.binder
}
