/// <reference path="../.astro/types.d.ts" />

// YAML file module declarations — allows `import foo from '*.yaml'`
// Astro with Vite supports YAML imports via vite-plugin-yaml or similar.
// Here we declare the module type so TypeScript does not error.
// The runtime transform is handled by Vite's built-in YAML loader (Astro 5+).
declare module '*.yaml' {
  const value: unknown;
  export default value;
}

/**
 * 이 번들이 어느 커밋으로 빌드됐는가. astro.config.mjs 의 vite.define 이 박는다.
 * 해석 못 하면 빈 문자열이고, 그때는 배포 감지를 접는다
 * (`src/islands/mod/deploy-revision.ts`).
 */
declare const __DEPLOY_REVISION__: string;
