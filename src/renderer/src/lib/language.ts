// Extension -> Monaco language id. Only extensions Monaco actually ships a
// grammar for are listed; anything else falls back to plaintext. A few
// config-ish formats (.conf/.cfg/.env/.properties/.toml) don't have their
// own Monaco grammar, so they're mapped to 'ini' since they're all
// line-oriented key=value/section formats close enough for highlighting.
const EXTENSION_LANGUAGE: Record<string, string> = {
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  toml: 'ini',
  env: 'ini',
  properties: 'ini',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  lua: 'lua',
  r: 'r',
  graphql: 'graphql',
  gql: 'graphql'
}

export function getLanguage(path: string): string {
  const name = path.split('/').pop() ?? path
  if (name.toLowerCase() === 'dockerfile') return 'dockerfile'

  const dotIndex = name.lastIndexOf('.')
  const ext = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : ''
  return EXTENSION_LANGUAGE[ext] ?? 'plaintext'
}
