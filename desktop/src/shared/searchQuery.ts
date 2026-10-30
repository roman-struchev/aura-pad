// How a search query is turned into a matcher, shared by main (which walks
// the files) and the renderer (which previews what a replacement would do and
// tells the user when the pattern itself is broken). One implementation, so
// the preview can't disagree with what actually gets written.

export interface SearchOptions {
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  // Comma-separated globs, VS Code style: "*.ts, src/**/*.tsx". Empty means
  // "the usual text-ish extensions" (see SEARCHABLE_EXTENSION_RE).
  include?: string
}

export interface ReplaceRequest {
  // The files to rewrite - the renderer's own selection, so unchecked files
  // and tabs with unsaved edits never reach main.
  paths: string[]
  query: string
  replacement: string
  options: SearchOptions
}

export interface ReplaceResult {
  success: boolean
  error?: string
  filesChanged: number
  replacements: number
  // False when the snapshot was too big to hold (see REPLACE_UNDO_LIMIT) -
  // the UI must not offer an undo it can't honor.
  canUndo: boolean
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Lookarounds rather than \b: \b is defined against word characters, so a
// query that starts or ends with punctuation ("--flag", "foo()") would match
// in places "whole word" clearly doesn't mean.
function wholeWordWrap(source: string): string {
  return `(?<!\\w)(?:${source})(?!\\w)`
}

// Returns null when the user is mid-typing an invalid regex, which is the
// normal state of a regex field rather than an error worth shouting about.
export function buildSearchRegex(query: string, options: SearchOptions = {}): RegExp | null {
  if (!query) return null
  let source = options.regex ? query : escapeRegExp(query)
  if (options.wholeWord) source = wholeWordWrap(source)
  try {
    return new RegExp(source, options.caseSensitive ? 'g' : 'gi')
  } catch {
    return null
  }
}

// In a literal search the replacement is literal too: "$1" means those two
// characters, not "whatever group 1 captured". In regex mode the groups are
// the point, so it is passed through untouched.
export function replacementFor(replacement: string, options: SearchOptions = {}): string {
  return options.regex ? replacement : replacement.replace(/\$/g, '$$$$')
}

// A file-name glob, translated the way search fields everywhere do it:
// "*" stops at a separator, "**" crosses them, "?" is one character, and
// "{a,b}" is an alternation. Everything else is literal.
function globToRegExp(glob: string): RegExp {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        // "**/" also has to match zero directories, so "**/*.ts" finds a .ts
        // file sitting at the root.
        if (glob[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') source += '[^/]'
    else if (char === '{') source += '(?:'
    else if (char === '}') source += ')'
    else if (char === ',') source += '|'
    else source += escapeRegExp(char)
  }
  return new RegExp(`^${source}$`, 'i')
}

// A matcher over a workspace-relative path. A bare pattern with no separator
// ("*.ts") is matched against the file name at any depth - that is what people
// mean by it - while anything containing a slash is matched against the whole
// relative path.
export function buildIncludeMatcher(include?: string): ((relPath: string) => boolean) | null {
  const patterns = (include ?? '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
  if (patterns.length === 0) return null

  const matchers = patterns.map((pattern) => {
    const anchored = pattern.includes('/')
    let source = pattern
    // A trailing "/" or a bare directory name means "everything under it".
    if (anchored && pattern.endsWith('/')) source = `${pattern}**`
    const re = globToRegExp(anchored ? source : source)
    return { re, anchored }
  })

  return (relPath: string): boolean => {
    const posix = relPath.split('\\').join('/')
    const name = posix.slice(posix.lastIndexOf('/') + 1)
    return matchers.some(({ re, anchored }) => re.test(anchored ? posix : name))
  }
}
