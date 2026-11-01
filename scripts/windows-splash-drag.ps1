param([ValidateSet('probe','drag')][string]$Action, [int]$OwnedProcess, [ValidateSet('splash','main')][string]$Kind = 'splash')
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class FireflySplashDrag {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; public Point(int x, int y) { X=x; Y=y; } }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint id);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr order, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static IntPtr Find(uint process) {
    IntPtr found=IntPtr.Zero;
    EnumWindows((window, data) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      Rect rect; GetWindowRect(window,out rect);
      // Tao retains caption style bits on undecorated Windows windows. Before
      // skip only the splash is visible; afterward only the main window is.
      if (owner==process && IsWindowVisible(window) && rect.Right-rect.Left>=320 && rect.Bottom-rect.Top>=300) { found=window; return false; }
      return true;
    },IntPtr.Zero);
    return found;
  }
  public static string Describe(uint process) {
    string result="";
    EnumWindows((window,data)=>{uint owner;GetWindowThreadProcessId(window,out owner);if(owner==process){Rect rect;GetWindowRect(window,out rect);result+=window+" visible="+IsWindowVisible(window)+" style="+GetWindowLong(window,-16).ToString("x")+" rect="+rect.Left+","+rect.Top+","+rect.Right+","+rect.Bottom+"; ";}return true;},IntPtr.Zero);
    return result;
  }
  public static void Drag(IntPtr window) {
    Rect rect; GetWindowRect(window,out rect);
    Point original; GetCursorPos(out original);
    int x=rect.Left+(rect.Right-rect.Left)/3, y=rect.Top+(rect.Bottom-rect.Top)/3;
    try {
      SetWindowPos(window,new IntPtr(-1),0,0,0,0,19);
      SetForegroundWindow(window); bool positioned=SetCursorPos(x,y); Thread.Sleep(150);
      IntPtr hit=GetAncestor(WindowFromPoint(new Point(x,y)),2);
      if (hit!=window) throw new Exception("Owned splash is obscured; no mouse input sent. Expected="+window+" hit="+hit+" cursor="+positioned+" point="+x+","+y);
      mouse_event(2,0,0,0,UIntPtr.Zero); Thread.Sleep(200);
      for(int step=1;step<=8;step++){SetCursorPos(x+step*15,y+step*10);Thread.Sleep(35);}
    } finally {mouse_event(4,0,0,0,UIntPtr.Zero);SetWindowPos(window,new IntPtr(-2),0,0,0,0,19);SetCursorPos(original.X,original.Y);}
    Thread.Sleep(200);
  }
}
'@
[void][FireflySplashDrag]::SetProcessDPIAware()
$window = [FireflySplashDrag]::Find([uint32]$OwnedProcess)
if ($window -eq [IntPtr]::Zero) { @{found=$false; windows=[FireflySplashDrag]::Describe([uint32]$OwnedProcess)} | ConvertTo-Json -Compress; exit 0 }
$before = New-Object FireflySplashDrag+Rect
[void][FireflySplashDrag]::GetWindowRect($window, [ref]$before)
if ($Action -eq 'drag') { [FireflySplashDrag]::Drag($window) }
$after = New-Object FireflySplashDrag+Rect
[void][FireflySplashDrag]::GetWindowRect($window, [ref]$after)
@{found=$true; before=$before; after=$after} | ConvertTo-Json -Compress
