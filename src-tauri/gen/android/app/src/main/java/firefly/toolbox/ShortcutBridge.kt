package firefly.toolbox

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import android.util.Log
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicReference

object ShortcutBridge {
  const val TOOL_ID_EXTRA = "firefly_tool_id"
  private val pendingToolId = AtomicReference<String?>(null)
  private val recentRequests = ConcurrentHashMap<String, Long>()
  private const val REQUEST_COOLDOWN_MS = 10000L

  private fun shortcutId(toolId: String, name: String): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest((toolId + "\u0000" + name).toByteArray(Charsets.UTF_8))
    return "tool-v2-" + bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  fun offerLaunch(toolId: String?) {
    if (!toolId.isNullOrBlank()) pendingToolId.set(toolId)
  }

  fun hasPendingLaunch(): Boolean = pendingToolId.get() != null

  @JvmStatic
  fun takeLaunch(@Suppress("UNUSED_PARAMETER") context: Context, @Suppress("UNUSED_PARAMETER") payload: String): String =
    pendingToolId.getAndSet(null) ?: ""

  @JvmStatic
  fun openSettings(context: Context, @Suppress("UNUSED_PARAMETER") payload: String): String {
    return try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      "ok"
    } catch (_: Exception) { "error" }
  }

  @JvmStatic
  @Suppress("DEPRECATION")
  fun create(context: Context, payload: String): String {
    var requestId: String? = null
    return try {
      if (!ShortcutManagerCompat.isRequestPinShortcutSupported(context)) return "unsupported"
      val request = JSONObject(payload)
      val toolId = request.getString("toolId")
      val name = request.getString("name")
      val image = request.optString("iconData")
      val shortcutId = shortcutId(toolId, name)
      // Match old random-ID shortcuts too. Do not persist a local "created"
      // marker: launchers can reject requests, or users can remove an icon.
      if (ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_PINNED).any {
          it.id == shortcutId || (it.shortLabel.toString() == name && it.intent?.getStringExtra(TOOL_ID_EXTRA) == toolId)
        }) return "exists"
      val now = SystemClock.elapsedRealtime()
      recentRequests.entries.removeAll { now - it.value >= REQUEST_COOLDOWN_MS }
      if (recentRequests.containsKey(shortcutId)) return "pending"
      val launch = Intent(context, MainActivity::class.java).apply {
        action = Intent.ACTION_VIEW
        // Intent identity excludes extras. Keep identity stable for this tool
        // and name, while allowing independently named icons for the same tool.
        data = Uri.Builder().scheme("fireflytoolbox").authority("shortcut").appendPath(shortcutId).build()
        putExtra(TOOL_ID_EXTRA, toolId)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
      val builder = ShortcutInfoCompat.Builder(context, shortcutId)
        .setShortLabel(name)
        .setIntent(launch)
      val bitmap = if (image.isNotEmpty()) {
        val bytes = Base64.decode(image.removePrefix("data:image/png;base64,"), Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return "bad_icon"
      } else null
      builder.setIcon(if (bitmap != null) IconCompat.createWithBitmap(bitmap) else IconCompat.createWithResource(context, R.mipmap.ic_launcher))
      requestId = shortcutId
      recentRequests[shortcutId] = now
      if (Build.VERSION.SDK_INT < 26) {
        // Older launchers use a broadcast instead of the pinned-shortcut store.
        val install = Intent("com.android.launcher.action.INSTALL_SHORTCUT")
          .putExtra(Intent.EXTRA_SHORTCUT_INTENT, launch)
          .putExtra(Intent.EXTRA_SHORTCUT_NAME, name)
          .putExtra("duplicate", false)
        if (bitmap != null) install.putExtra(Intent.EXTRA_SHORTCUT_ICON, bitmap)
        else install.putExtra(Intent.EXTRA_SHORTCUT_ICON_RESOURCE, Intent.ShortcutIconResource.fromContext(context, R.mipmap.ic_launcher))
        context.sendBroadcast(install)
        "requested"
      } else if (ShortcutManagerCompat.requestPinShortcut(context, builder.build(), null)) "requested"
      else { recentRequests.remove(shortcutId); "unsupported" }
    } catch (error: Exception) {
      requestId?.let { recentRequests.remove(it) }
      Log.w("FireflyShortcut", "Unable to request a desktop shortcut", error)
      "error"
    }
  }
}
