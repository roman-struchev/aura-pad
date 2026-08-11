import * as monaco from 'monaco-editor'
import { curlCommandAt, looksLikeCurl, parseCurl } from './curl'
import { parseHttpFile } from './httpFile'

// Monaco support for `.http` files: a small Monarch grammar plus the "Run"
// CodeLens above every request. The lens is the whole discoverability story
// for the feature - a request block looks inert until a clickable ▶ Run sits
// on top of it.
//
// The command handlers live in App (they need the tab path, the response
// pane, settings), so they're injected here rather than imported: Monaco
// commands are registered once for the lifetime of the process, while React
// state is not.

export const HTTP_LANGUAGE_ID = 'http'
const RUN_COMMAND = 'aurapad.http.runBlock'
const COPY_CURL_COMMAND = 'aurapad.http.copyAsCurl'

type BlockHandler = (modelUri: string, line: number) => void

let runHandler: BlockHandler | null = null
let copyCurlHandler: BlockHandler | null = null

export function setHttpBlockHandlers(handlers: {
  run: BlockHandler
  copyAsCurl: BlockHandler
}): void {
  runHandler = handlers.run
  copyCurlHandler = handlers.copyAsCurl
}

let registered = false

export function registerHttpLanguage(): void {
  if (registered) return
  registered = true

  monaco.languages.register({ id: HTTP_LANGUAGE_ID, extensions: ['.http', '.rest'] })

  monaco.languages.setMonarchTokensProvider(HTTP_LANGUAGE_ID, {
    defaultToken: '',
    tokenizer: {
      root: [
        // Block separator first: it also starts with #, so it has to win
        // over the comment rule.
        [/^\s*###.*$/, 'keyword'],
        [/^\s*(#|\/\/).*$/, 'comment'],
        [/^\s*@[\w.-]+/, 'variable.name'],
        [/\{\{[^}]*\}\}/, 'variable.predefined'],
        [/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\b/, 'keyword.control'],
        [/^\s*curl\b/, 'keyword.control'],
        [/https?:\/\/[^\s{}]+/, 'string'],
        [/^[A-Za-z][\w-]*(?=\s*:)/, 'attribute.name'],
        [/^\s*<\s+\S.*$/, 'string'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\b\d+\b/, 'number']
      ]
    }
  })

  // Comment toggling (Cmd+/) needs to know what a comment looks like.
  monaco.languages.setLanguageConfiguration(HTTP_LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['[', ']']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' }
    ]
  })

  monaco.editor.registerCommand(RUN_COMMAND, (_accessor, uri: string, line: number) =>
    runHandler?.(uri, line)
  )
  monaco.editor.registerCommand(COPY_CURL_COMMAND, (_accessor, uri: string, line: number) =>
    copyCurlHandler?.(uri, line)
  )

  monaco.languages.registerCodeLensProvider(HTTP_LANGUAGE_ID, {
    provideCodeLenses: (model) => {
      const uri = model.uri.toString()
      const lenses = parseHttpFile(model.getValue()).flatMap((block) => {
        // Monaco line numbers are 1-based; the parser's are 0-based.
        const range = new monaco.Range(block.requestLine + 1, 1, block.requestLine + 1, 1)
        return [
          {
            range,
            id: `run-${block.requestLine}`,
            command: {
              id: RUN_COMMAND,
              title: '▶ Run',
              arguments: [uri, block.requestLine]
            }
          },
          {
            range,
            id: `curl-${block.requestLine}`,
            command: {
              id: COPY_CURL_COMMAND,
              title: 'Copy as cURL',
              arguments: [uri, block.requestLine]
            }
          }
        ]
      })
      return { lenses, dispose: () => undefined }
    },
    resolveCodeLens: (_model, lens) => lens
  })

  // The same ▶ Run over a curl command in *any* file - a README, a shell
  // script, a scratch note. Without it that case is discoverable only by
  // knowing Cmd+Enter, which is exactly the case the feature started from.
  //
  // The lens appears only where the command would actually run: a README's
  // `curl … | bash` is refused at run time (it needs a shell), so offering to
  // run it would be a lie. Parsing is against a dummy cwd so a relative
  // `-d @body.json` doesn't suppress the lens; the run resolves it for real
  // against the file's own directory.
  monaco.languages.registerCodeLensProvider(
    { scheme: '*', pattern: '**' },
    {
      provideCodeLenses: (model) => {
        if (model.getLanguageId() === HTTP_LANGUAGE_ID) return { lenses: [], dispose: () => {} }
        const uri = model.uri.toString()
        const lines = model.getLinesContent()
        const lenses: monaco.languages.CodeLens[] = []
        for (let i = 0; i < lines.length; i++) {
          if (!looksLikeCurl(lines[i])) continue
          // A continuation line is part of the command above it, not a second
          // command; only the first line of each gets a lens.
          if (i > 0 && /\\\s*$/.test(lines[i - 1])) continue
          const command = curlCommandAt(lines, i)
          if (!command || !parseCurl(command, '/').ok) continue
          lenses.push({
            range: new monaco.Range(i + 1, 1, i + 1, 1),
            id: `run-curl-${i}`,
            command: { id: RUN_COMMAND, title: '▶ Run', arguments: [uri, i] }
          })
        }
        return { lenses, dispose: () => undefined }
      },
      resolveCodeLens: (_model, lens) => lens
    }
  )
}
