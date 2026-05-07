import os from "node:os";
import path from "node:path";

const DEFAULT_APP_NAME = "copilot-cli-cost";

export function getAppCacheDirectory(options = {}) {
  const appName = options.appName ?? DEFAULT_APP_NAME;
  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const pathApi = getPlatformPathApi(platform);

  if (platform === "win32") {
    return pathApi.join(
      readNonEmptyString(env.LOCALAPPDATA) ?? pathApi.join(homeDirectory, "AppData", "Local"),
      appName
    );
  }

  const xdgCacheHome = readNonEmptyString(env.XDG_CACHE_HOME);
  if (xdgCacheHome) {
    return pathApi.join(xdgCacheHome, appName);
  }

  if (platform === "darwin") {
    return pathApi.join(homeDirectory, "Library", "Caches", appName);
  }

  return pathApi.join(homeDirectory, ".cache", appName);
}

export function getAppCacheSubdirectory(name, options = {}) {
  const platform = options.platform ?? process.platform;
  return getPlatformPathApi(platform).join(getAppCacheDirectory(options), name);
}

function getPlatformPathApi(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function readNonEmptyString(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return String(value);
}
