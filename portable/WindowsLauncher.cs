using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
internal static class WindowsLauncher {
 [STAThread] private static void Main(string[] args) {
  bool background=Array.Exists(args,arg=>arg=="--background");
  try {
   string root=AppDomain.CurrentDomain.BaseDirectory;
   bool stop=Path.GetFileName(Assembly.GetExecutingAssembly().Location).StartsWith("Stop",StringComparison.OrdinalIgnoreCase);
   string script=Path.Combine(root,"portable",stop?"stop.cjs":"launcher.cjs");
   string node=Path.Combine(root,"runtime","node.exe");
   if(!File.Exists(node)||!File.Exists(script))throw new Exception("Extract the complete portable ZIP before starting ACBot Web Monitor.");
   var info=new ProcessStartInfo(node,"\""+script+"\"");if(background){info.Arguments+=" --background";info.EnvironmentVariables["ACBOT_NO_BROWSER"]="1";}info.WorkingDirectory=root;info.UseShellExecute=false;info.CreateNoWindow=true;info.WindowStyle=ProcessWindowStyle.Hidden;
   var process=Process.Start(info);
   if(process.WaitForExit(2000)&&process.ExitCode!=0&&!background)MessageBox.Show("The monitor could not start. Open data/launcher-error.log for details.","ACBot Web Monitor",MessageBoxButtons.OK,MessageBoxIcon.Error);
  } catch(Exception error) {if(!background)MessageBox.Show(error.Message,"ACBot Web Monitor",MessageBoxButtons.OK,MessageBoxIcon.Error);}
 }
}
