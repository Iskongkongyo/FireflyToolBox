package firefly.toolbox

import org.junit.Assert.*
import org.junit.Test

class WebsiteDownloadsTest {
  @Test fun filenamesRemovePathsControlsAndEmptyNames() {
    assertEquals("file_.txt", WebsiteDownloads.safeName("../../file?.txt"))
    assertEquals("file_.txt", WebsiteDownloads.safeName("C:\\folder\\file\u0000.txt"))
    assertEquals("download", WebsiteDownloads.safeName(" ... "))
    assertEquals("中文文件.txt", WebsiteDownloads.safeName("中文文件.txt"))
  }

  @Test fun filenameTruncationKeepsCompleteUnicodeCharactersAndTheExtension() {
    for (prefix in listOf("", "a", "ab")) {
      val name = WebsiteDownloads.safeName(prefix + "😀".repeat(100) + ".txt")
      assertTrue(name.endsWith(".txt"))
      assertTrue(name.length <= 80)
      assertTrue(name.toByteArray(Charsets.UTF_8).size < 255)
      assertEquals("Filename has an unpaired surrogate", name, String(name.toByteArray(Charsets.UTF_8), Charsets.UTF_8))
    }
  }
}
