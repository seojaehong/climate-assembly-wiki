/// <reference path="../.astro/types.d.ts" />

// YAML file module declarations — allows `import foo from '*.yaml'`
// Astro with Vite supports YAML imports via vite-plugin-yaml or similar.
// Here we declare the module type so TypeScript does not error.
// The runtime transform is handled by Vite's built-in YAML loader (Astro 5+).
declare module '*.yaml' {
  const value: unknown;
  export default value;
}
