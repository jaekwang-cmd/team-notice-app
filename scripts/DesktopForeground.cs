using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Reports only whether Explorer's desktop is active, or the opaque foreground HWND.
// The Electron host recognizes its two widget windows without reading window titles.
internal static class DesktopForeground
{
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);

    private static string State()
    {
        IntPtr foreground = GetForegroundWindow();
        IntPtr desktop = GetShellWindow();
        if (foreground == IntPtr.Zero) return "transient";
        if (foreground == desktop) return "desktop";
        uint foregroundProcess, shellProcess;
        GetWindowThreadProcessId(foreground, out foregroundProcess);
        GetWindowThreadProcessId(desktop, out shellProcess);
        if (shellProcess != 0 && shellProcess == foregroundProcess)
        {
            var buffer = new StringBuilder(128);
            GetClassName(foreground, buffer, buffer.Capacity);
            string name = buffer.ToString();
            if (name == "Progman" || name == "WorkerW") return "desktop";
            // Opening the notification area from the desktop shouldn't hide the widget.
            if (name == "Shell_TrayWnd" || name == "Shell_SecondaryTrayWnd") return "transient";
        }
        return foreground.ToInt64().ToString();
    }

    public static int Main(string[] args)
    {
        int parent;
        if (args.Length != 1 || !Int32.TryParse(args[0], out parent)) return 2;
        try
        {
            using (var app = Process.GetProcessById(parent))
            {
                string previous = null;
                while (!app.HasExited)
                {
                    string state = State();
                    if (previous != state)
                    {
                        Console.WriteLine(state);
                        previous = state;
                    }
                    Thread.Sleep(140);
                }
            }
        }
        catch (IOException) { }
        catch (ArgumentException) { }
        return 0;
    }
}
