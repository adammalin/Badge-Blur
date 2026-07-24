using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class BadgeBlurProgram
{
    private const string MutexName = @"Local\BadgeBlurApplication";
    private const string QuitEventName = @"Local\BadgeBlurQuit";

    [STAThread]
    private static int Main(string[] args)
    {
        if (Array.Exists(args, argument =>
            string.Equals(argument, "--quit", StringComparison.OrdinalIgnoreCase)))
        {
            SignalQuit();
            return 0;
        }

        bool createdNew;
        using (Mutex applicationMutex = new Mutex(true, MutexName, out createdNew))
        {
            if (!createdNew)
            {
                OpenExistingInstance();
                return 0;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                Application.Run(new BadgeBlurContext());
                return 0;
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "Badge Blur could not start.\r\n\r\n" + error.Message,
                    "Badge Blur",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }
        }
    }

    private static void SignalQuit()
    {
        try
        {
            using (EventWaitHandle quitEvent =
                EventWaitHandle.OpenExisting(QuitEventName))
            {
                quitEvent.Set();
            }
        }
        catch (WaitHandleCannotBeOpenedException)
        {
            // The app is not running.
        }
    }

    private static void OpenExistingInstance()
    {
        string portPath = BadgeBlurContext.PortFilePath;
        if (!File.Exists(portPath))
        {
            return;
        }

        int port;
        if (int.TryParse(File.ReadAllText(portPath).Trim(), out port))
        {
            BadgeBlurContext.OpenBrowser("http://127.0.0.1:" + port + "/");
        }
    }
}

internal sealed class BadgeBlurContext : ApplicationContext
{
    private const int FirstPort = 4173;
    private const int LastPort = 4193;
    private const string QuitEventName = @"Local\BadgeBlurQuit";

    private readonly NotifyIcon trayIcon;
    private readonly System.Windows.Forms.Timer stateTimer;
    private readonly EventWaitHandle quitEvent;
    private readonly Icon applicationIcon;
    private Process serverProcess;
    private string appUrl;
    private volatile bool serverReady;
    private volatile bool serverFailed;
    private bool browserOpened;
    private bool failureReported;
    private bool quitting;

    internal static string PortFilePath
    {
        get { return Path.Combine(Path.GetTempPath(), "badge-blur.port"); }
    }

    internal BadgeBlurContext()
    {
        string installDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string nodePath = Path.Combine(installDirectory, "runtime", "node.exe");
        string serverPath = Path.Combine(installDirectory, "scripts", "serve.mjs");
        string iconPath = Path.Combine(installDirectory, "BadgeBlur.ico");

        if (!File.Exists(nodePath) || !File.Exists(serverPath))
        {
            throw new FileNotFoundException(
                "The installation is incomplete. Reinstall Badge Blur.");
        }

        applicationIcon = File.Exists(iconPath)
            ? new Icon(iconPath)
            : Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Open Badge Blur", null, delegate { OpenApp(); });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit Badge Blur", null, delegate { Quit(); });

        trayIcon = new NotifyIcon();
        trayIcon.Icon = applicationIcon;
        trayIcon.Text = "Badge Blur";
        trayIcon.ContextMenuStrip = menu;
        trayIcon.Visible = true;
        trayIcon.DoubleClick += delegate { OpenApp(); };

        quitEvent = new EventWaitHandle(
            false,
            EventResetMode.AutoReset,
            QuitEventName);

        int port = FindAvailablePort();
        appUrl = "http://127.0.0.1:" + port + "/";
        File.WriteAllText(PortFilePath, port.ToString());

        ProcessStartInfo startInfo = new ProcessStartInfo();
        startInfo.FileName = nodePath;
        startInfo.Arguments = Quote(serverPath);
        startInfo.WorkingDirectory = installDirectory;
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.WindowStyle = ProcessWindowStyle.Hidden;
        startInfo.EnvironmentVariables["BADGE_REMOVER_PORT"] = port.ToString();
        startInfo.EnvironmentVariables["BADGE_REMOVER_OPEN_BROWSER"] = "0";
        startInfo.EnvironmentVariables["BADGE_REMOVER_PREFERRED_BROWSER"] = "edge";

        serverProcess = Process.Start(startInfo);
        if (serverProcess == null)
        {
            throw new InvalidOperationException(
                "The private local processing service did not start.");
        }

        Thread readinessThread = new Thread(WaitForServer);
        readinessThread.IsBackground = true;
        readinessThread.Start();

        stateTimer = new System.Windows.Forms.Timer();
        stateTimer.Interval = 300;
        stateTimer.Tick += CheckState;
        stateTimer.Start();
    }

    private static string Quote(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private int FindAvailablePort()
    {
        for (int port = FirstPort; port <= LastPort; port += 1)
        {
            if (!IsPortOpen(port))
            {
                return port;
            }
        }
        throw new InvalidOperationException(
            "No local port is available between 4173 and 4193.");
    }

    private static bool IsPortOpen(int port)
    {
        try
        {
            using (TcpClient client = new TcpClient())
            {
                IAsyncResult result = client.BeginConnect(
                    IPAddress.Loopback,
                    port,
                    null,
                    null);
                bool connected = result.AsyncWaitHandle.WaitOne(120);
                if (connected)
                {
                    client.EndConnect(result);
                }
                return connected;
            }
        }
        catch
        {
            return false;
        }
    }

    private void WaitForServer()
    {
        for (int attempt = 0; attempt < 150; attempt += 1)
        {
            if (serverProcess == null || serverProcess.HasExited)
            {
                serverFailed = true;
                return;
            }

            try
            {
                HttpWebRequest request =
                    (HttpWebRequest)WebRequest.Create(appUrl + "api/status");
                request.Timeout = 500;
                request.ReadWriteTimeout = 500;
                using (HttpWebResponse response =
                    (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode == HttpStatusCode.OK)
                    {
                        serverReady = true;
                        return;
                    }
                }
            }
            catch
            {
                Thread.Sleep(100);
            }
        }
        serverFailed = true;
    }

    private void CheckState(object sender, EventArgs eventArgs)
    {
        if (quitEvent.WaitOne(0))
        {
            Quit();
            return;
        }

        if (serverProcess == null || serverProcess.HasExited)
        {
            if (!failureReported)
            {
                failureReported = true;
                MessageBox.Show(
                    "Badge Blur stopped unexpectedly. Reinstall the app if " +
                    "the problem continues.",
                    "Badge Blur",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            Quit();
            return;
        }

        if (serverReady && !browserOpened)
        {
            browserOpened = true;
            OpenApp();
        }
        else if (serverFailed && !failureReported)
        {
            failureReported = true;
            trayIcon.ShowBalloonTip(
                5000,
                "Badge Blur",
                "The local service is still starting. Double-click the tray " +
                "icon to try opening it.",
                ToolTipIcon.Warning);
        }
    }

    private void OpenApp()
    {
        OpenBrowser(appUrl);
    }

    internal static void OpenBrowser(string url)
    {
        try
        {
            ProcessStartInfo edge = new ProcessStartInfo();
            edge.FileName = "msedge.exe";
            edge.Arguments = url;
            edge.UseShellExecute = true;
            Process.Start(edge);
        }
        catch
        {
            ProcessStartInfo browser = new ProcessStartInfo();
            browser.FileName = url;
            browser.UseShellExecute = true;
            Process.Start(browser);
        }
    }

    private void Quit()
    {
        if (quitting)
        {
            return;
        }
        quitting = true;
        stateTimer.Stop();
        trayIcon.Visible = false;

        try
        {
            if (serverProcess != null && !serverProcess.HasExited)
            {
                serverProcess.Kill();
                serverProcess.WaitForExit(3000);
            }
        }
        catch
        {
            // Windows will release the remaining process at sign-out.
        }

        try
        {
            if (File.Exists(PortFilePath))
            {
                File.Delete(PortFilePath);
            }
        }
        catch
        {
            // A stale port file is harmless and is replaced at next launch.
        }

        trayIcon.Dispose();
        quitEvent.Dispose();
        if (applicationIcon != null)
        {
            applicationIcon.Dispose();
        }
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !quitting)
        {
            Quit();
        }
        base.Dispose(disposing);
    }
}
