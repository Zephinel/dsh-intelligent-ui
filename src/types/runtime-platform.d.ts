/**
 * `src/host/index.ts` imports the generated prompt text; esbuild embeds it with
 * its text loader, which `tsc` does not know about.
 *
 * The browser half (`src/client`) is excluded from this project because it binds
 * to DSH's runtime-provided platform packages — see `tsconfig.json`.
 */
declare module '*.txt' {
  const text: string
  export default text
}
