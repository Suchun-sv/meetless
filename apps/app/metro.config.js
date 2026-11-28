const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
config.resolver.useWatchman = false;

// The app bundle must never pull the Node side of the client (ClientNode, node:sqlite, ws, MCP).
// Only these entry points of @meetless/client are allowed: ./web (web-bridge), ./bridge (types),
// and the renderer-safe files under src/ (sync-protocol, api-call).
const FORBIDDEN = [/^node:/, /^ws$/, /^@modelcontextprotocol\//, /^@meetless\/client$/, /^@meetless\/server/];
const CLIENT_NODE = /packages[\\/]client[\\/]src[\\/](node|cache|capture\.ts|git|log|index)/;
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (FORBIDDEN.some((re) => re.test(moduleName))) {
    throw new Error(`[meetless] "${moduleName}" is Node-only and may not enter the app bundle (from ${context.originModulePath})`);
  }
  const res = defaultResolve ? defaultResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  if (res && res.type === 'sourceFile' && CLIENT_NODE.test(res.filePath)) {
    throw new Error(`[meetless] ${path.relative(projectRoot, res.filePath)} is Node-only (from ${context.originModulePath})`);
  }
  return res;
};

module.exports = config;
