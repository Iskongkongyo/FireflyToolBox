package firefly.toolbox

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.ParcelFileDescriptor
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.UUID

/** Synchronous JNI entry used from a Rust blocking thread, never from the UI thread. */
object ModuleBridge {
  private val busy = AtomicBoolean(false)
  private val cancellationRequested = AtomicBoolean(false)
  @Volatile private var activeService: Messenger? = null

  @JvmStatic fun cancel() {
    cancellationRequested.set(true)
    try { activeService?.send(Message.obtain(null, ModuleService.CANCEL)) }
    catch (_: Exception) { }
  }

  @JvmStatic fun execute(context: Context, payload: String, timeoutMs: Long): String {
    if (!busy.compareAndSet(false, true)) return error("已有模块正在运行。")
    if (cancellationRequested.getAndSet(false)) {
      busy.set(false)
      return error("模块执行已取消。")
    }
    val connected = CountDownLatch(1)
    val closed = AtomicBoolean(false)
    var service: Messenger? = null
    val connection = object : ServiceConnection {
      override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        if (closed.get()) return
        service = binder?.let(::Messenger)
        activeService = service
        connected.countDown()
      }
      override fun onServiceDisconnected(name: ComponentName?) {
        if (closed.get()) return
        service = null
        activeService = null
        connected.countDown()
      }
      override fun onBindingDied(name: ComponentName?) { if (!closed.get()) { service = null; activeService = null; connected.countDown() } }
      override fun onNullBinding(name: ComponentName?) { if (!closed.get()) connected.countDown() }
    }
    val bound = try {
      val intent = Intent(context, ModuleService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // Each step gets a fresh isolated instance. A new bind must never attach
        // to the preceding step's process while Android is tearing it down.
        context.bindIsolatedService(intent, Context.BIND_AUTO_CREATE, "run_" + UUID.randomUUID().toString().replace("-", ""), context.mainExecutor, connection)
      } else context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
    } catch (_: Exception) { false }
    if (!bound) {
      busy.set(false)
      return error("无法启动 Android 模块执行器。")
    }
    val handler = Handler(Looper.getMainLooper())
    val deadline = Runnable { cancel() }
    val pipes = mutableListOf<ParcelFileDescriptor>()
    try {
      if (!connected.await(3, TimeUnit.SECONDS) || service == null) return error("模块执行器连接失败。")
      if (cancellationRequested.get()) return error("模块执行已取消。")
      val request = ParcelFileDescriptor.createPipe()
      pipes.addAll(request)
      val response = ParcelFileDescriptor.createPipe()
      pipes.addAll(response)
      request[0].use { requestRead ->
        response[1].use { responseWrite ->
          val message = Message.obtain(null, ModuleService.RUN)
          message.data = Bundle().apply {
            putParcelable("request", requestRead)
            putParcelable("response", responseWrite)
          }
          service!!.send(message)
        }
      }
      val writer = Thread {
        try { ParcelFileDescriptor.AutoCloseOutputStream(request[1]).use { it.write(payload.toByteArray(Charsets.UTF_8)) } }
        catch (_: Exception) { }
      }
      writer.start()
      handler.postDelayed(deadline, timeoutMs.coerceIn(1, 3000) + 1500)
      val output = ByteArrayOutputStream()
      ParcelFileDescriptor.AutoCloseInputStream(response[0]).use { stream ->
          val chunk = ByteArray(8192)
          while (true) {
            val size = stream.read(chunk)
            if (size < 0) break
            if (output.size() + size > 28 * 1024 * 1024) {
              cancel()
              return error("模块输出过大。")
            }
            output.write(chunk, 0, size)
          }
      }
      writer.join(1000)
      return if (output.size() == 0) error("模块执行器异常退出或已取消。")
        else String(output.toByteArray(), Charsets.UTF_8)
    } catch (_: Exception) {
      cancel()
      return error("模块执行器异常退出或已取消。")
    } finally {
      handler.removeCallbacks(deadline)
      closed.set(true)
      activeService = null
      pipes.forEach { try { it.close() } catch (_: Exception) { } }
      try { context.unbindService(connection) } catch (_: IllegalArgumentException) { }
      cancellationRequested.set(false)
      busy.set(false)
    }
  }

  private fun error(message: String): String =
    "{\"text\":null,\"error\":\"${message}\"}"
}
