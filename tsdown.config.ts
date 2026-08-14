// tsdown config: 纯对象，由 tsdown CLI 消费。
export default {
  entry: {
    client: 'src/client.ts',
  },
  outDir: 'lib',
  format: 'cjs',
  target: 'es2022',
  clean: false,
  // The package exports ./lib/client.js and Harness loads it as a classic script.
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  deps: {
    neverBundle: [/@deepseek-ai\/.*/, /^react$/],
  },
  outputOptions: {
    banner: "window.__ModuleLoader__.load({ id: 'dsh-tavern-mode', factory: (require) => {",
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
