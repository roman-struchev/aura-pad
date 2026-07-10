// Quotes a value so it's safe to splice into a command string that gets
// *typed into* an interactive shell (via ptyWrite), as opposed to passed as
// an argv array to something like execFile - a path containing a quote,
// `$(...)`, backticks, or a space would otherwise either break the command
// or let the shell execute part of the path as its own command.
export function quoteForShell(value: string, platform: string): string {
  if (platform === 'win32') {
    // cmd.exe has no fully safe quoting story, but wrapping in double quotes
    // and doubling any embedded ones handles the common cases (spaces,
    // stray quotes) without needing a full parser.
    return `"${value.replace(/"/g, '""')}"`
  }
  // POSIX shells (bash/zsh): nothing is special inside single quotes except
  // a single quote itself, so close the quote, emit an escaped one, and
  // reopen for each occurrence.
  return `'${value.replace(/'/g, `'\\''`)}'`
}
