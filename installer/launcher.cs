// Ruru.exe: ξεκινά το Ruru Chess στο δικό του Electron παράθυρο (electron\runtime\electron.exe)
// με το Node που συνοδεύει την εφαρμογή (node\node.exe), χωρίς παράθυρο κονσόλας.
// Με --edge (ή αν λείπει το Electron runtime) πέφτει πίσω στον παλιό τρόπο (Edge/Chrome με --open).
// Χτίζεται από το scripts/make-release.mjs με τον csc.exe του .NET Framework 4 (υπάρχει στα Windows,
// C# 5: χωρίς $"" κ.λπ.).
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string node = Path.Combine(dir, "node\\node.exe");
        string main = Path.Combine(dir, "src\\server\\main.ts");
        string electronExe = Path.Combine(dir, "electron\\runtime\\RuruChess.exe");
        if (!File.Exists(electronExe)) electronExe = Path.Combine(dir, "electron\\runtime\\electron.exe");
        string electronMain = Path.Combine(dir, "electron\\main.cjs");

        if (!File.Exists(node) || !File.Exists(main))
        {
            MessageBox.Show(
                "Λείπουν αρχεία του Ruru Chess (" + (File.Exists(node) ? main : node) + "). Κάνε ξανά την εγκατάσταση.\n\n" +
                "Ruru Chess files are missing. Please reinstall.",
                "Ruru Chess", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        bool forceEdge = Array.IndexOf(args, "--edge") >= 0;
        bool useElectron = !forceEdge && File.Exists(electronExe) && File.Exists(electronMain);

        try
        {
            if (useElectron)
            {
                ProcessStartInfo psi = new ProcessStartInfo(electronExe, "\"" + electronMain + "\"");
                psi.WorkingDirectory = dir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.EnvironmentVariables["RURU_NODE"] = node;
                Process.Start(psi);
                return 0;
            }

            string nodeArgs = "\"" + main + "\" --open";
            ProcessStartInfo hidden = new ProcessStartInfo(node, nodeArgs);
            hidden.WorkingDirectory = dir;
            hidden.UseShellExecute = false;
            hidden.CreateNoWindow = true;
            Process p = Process.Start(hidden);
            // ο server μένει ανοιχτός όσο υπάρχουν παράθυρα· έξοδος με σφάλμα στα πρώτα δευτερόλεπτα = πρόβλημα εκκίνησης
            if (p.WaitForExit(5000) && p.ExitCode != 0)
            {
                ProcessStartInfo visible = new ProcessStartInfo("cmd.exe", "/k \"\"" + node + "\" " + nodeArgs + "\"");
                visible.WorkingDirectory = dir;
                visible.UseShellExecute = true;
                Process.Start(visible);
            }
            return 0;
        }
        catch (Exception e)
        {
            MessageBox.Show(e.Message, "Ruru Chess", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
