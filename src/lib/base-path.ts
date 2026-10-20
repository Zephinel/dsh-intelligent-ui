// DSH mounts the client at the document root; no Next.js base path exists here.
export const BASE_PATH = ''

export const withBase = (path: string) => `${BASE_PATH}${path}`
