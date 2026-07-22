import assert from "node:assert/strict";
import test from "node:test";
import {
  sendLocalNotification,
  type NotificationDependencies,
} from "../lib/local-notifications.ts";

function recorder(platform: NodeJS.Platform) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const dependencies: NotificationDependencies = {
    platform,
    async run(file, args) {
      calls.push({ file, args });
    },
  };
  return { calls, dependencies };
}

test("uses argument-safe native notification commands on supported platforms", async () => {
  const mac = recorder("darwin");
  await sendLocalNotification("FitLens", "winner\nchanged", mac.dependencies);
  assert.equal(mac.calls[0].file, "osascript");
  assert.equal(mac.calls[0].args.at(-1), "winner changed");

  const linux = recorder("linux");
  await sendLocalNotification("FitLens", "scores changed", linux.dependencies);
  assert.deepEqual(linux.calls[0], {
    file: "notify-send",
    args: ["--app-name=FitLens", "FitLens", "scores changed"],
  });

  const windows = recorder("win32");
  await sendLocalNotification("FitLens", "scores changed", windows.dependencies);
  assert.equal(windows.calls[0].file, "powershell.exe");
  assert.equal(windows.calls[0].args.at(-2), "FitLens");
  assert.equal(windows.calls[0].args.at(-1), "scores changed");
});

test("rejects unsupported notification platforms", async () => {
  const unsupported = recorder("aix");
  await assert.rejects(
    sendLocalNotification("FitLens", "changed", unsupported.dependencies),
    /not supported/,
  );
});
