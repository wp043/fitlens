import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

export interface NotificationDependencies {
  platform: NodeJS.Platform;
  run(file: string, args: string[]): Promise<unknown>;
}

const defaultDependencies: NotificationDependencies = {
  platform: process.platform,
  run: (file, args) => execFile(file, args, { timeout: 5_000 }),
};

function clean(value: string, limit: number) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, limit);
}

export async function sendLocalNotification(
  title: string,
  message: string,
  dependencies: NotificationDependencies = defaultDependencies,
) {
  const safeTitle = clean(title, 100);
  const safeMessage = clean(message, 300);
  if (dependencies.platform === "darwin") {
    await dependencies.run("osascript", [
      "-e", "on run argv",
      "-e", "display notification (item 2 of argv) with title (item 1 of argv)",
      "-e", "end run",
      "--",
      safeTitle,
      safeMessage,
    ]);
    return;
  }
  if (dependencies.platform === "linux") {
    await dependencies.run("notify-send", ["--app-name=FitLens", safeTitle, safeMessage]);
    return;
  }
  if (dependencies.platform === "win32") {
    const script = [
      "$title=$args[0];$message=$args[1]",
      "Add-Type -AssemblyName System.Windows.Forms",
      "$note=New-Object System.Windows.Forms.NotifyIcon",
      "$note.Icon=[System.Drawing.SystemIcons]::Information",
      "$note.BalloonTipTitle=$title;$note.BalloonTipText=$message;$note.Visible=$true",
      "$note.ShowBalloonTip(5000);Start-Sleep -Milliseconds 5500;$note.Dispose()",
    ].join(";");
    await dependencies.run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
      safeTitle,
      safeMessage,
    ]);
    return;
  }
  throw new Error(`Local notifications are not supported on ${dependencies.platform}`);
}
