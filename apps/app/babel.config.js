module.exports = function (api) {
  api.cache(true);
  // `import.meta` shows up in modern ESM deps; transform it on every platform.
  return { presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]] };
};
