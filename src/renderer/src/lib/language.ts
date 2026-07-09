export function getLanguage(path: string): string {
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.md')) return 'markdown'
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  return 'plaintext'
}
