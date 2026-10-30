import { buildDictionary, type Dictionary } from './hunspell'
import { tokenize } from './tokenize'
import type { SpellLanguage } from '../../../../shared/spellcheck'

// The spell checker, off the UI thread.
//
// It holds the parsed dictionaries (a few hundred thousand stems) and answers
// two questions: which words in this text are unknown, and what did the user
// probably mean by this one. Both are fast enough to run on every pause in
// typing - the cost that isn't is building the dictionary, which happens once
// per language per session.
//
// Nothing here reaches the network or the filesystem: main hands over the
// dictionary text, and the document text comes from the editor.

const dictionaries = new Map<SpellLanguage, Dictionary>()

export type SpellWorkerRequest =
  | { type: 'load'; lang: SpellLanguage; aff: string; dic: string }
  | { type: 'unload'; lang: SpellLanguage }
  | { type: 'check'; id: number; text: string; ignore: string[] }
  | { type: 'suggest'; id: number; word: string; ignore: string[] }

export interface SpellIssue {
  word: string
  // Character offset into the text that was checked.
  offset: number
}

export type SpellWorkerResponse =
  | { type: 'loaded'; lang: SpellLanguage; stems: number }
  | { type: 'checked'; id: number; issues: SpellIssue[] }
  | { type: 'suggestions'; id: number; word: string; words: string[] }
  | { type: 'error'; message: string }

const post = (message: SpellWorkerResponse): void => self.postMessage(message)

// Every loaded dictionary gets a say: a word is wrong only when none of them
// knows it. That is what a Russian note with English terms in it needs, and
// it costs one extra lookup per language.
function known(word: string, ignore: Set<string>): boolean {
  if (ignore.has(word.toLowerCase())) return true
  for (const dictionary of dictionaries.values()) {
    if (dictionary.check(word)) return true
  }
  return false
}

self.onmessage = (event: MessageEvent<SpellWorkerRequest>): void => {
  const message = event.data
  try {
    if (message.type === 'load') {
      const dictionary = buildDictionary(message.aff, message.dic)
      dictionaries.set(message.lang, dictionary)
      post({ type: 'loaded', lang: message.lang, stems: dictionary.stems })
      return
    }

    if (message.type === 'unload') {
      dictionaries.delete(message.lang)
      return
    }

    if (message.type === 'check') {
      // With no dictionary loaded there is nothing to be wrong against -
      // reporting every word as unknown would be worse than saying nothing.
      const issues = dictionaries.size === 0 ? [] : checkText(message.text, message.ignore)
      post({ type: 'checked', id: message.id, issues })
      return
    }

    if (message.type === 'suggest') {
      const ignore = new Set(message.ignore.map((w) => w.toLowerCase()))
      const words: string[] = []
      for (const dictionary of dictionaries.values()) {
        for (const suggestion of dictionary.suggest(message.word)) {
          if (!words.includes(suggestion) && !ignore.has(suggestion.toLowerCase())) {
            words.push(suggestion)
          }
        }
      }
      post({ type: 'suggestions', id: message.id, word: message.word, words: words.slice(0, 8) })
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}

function checkText(text: string, ignoreList: string[]): SpellIssue[] {
  const ignore = new Set(ignoreList.map((w) => w.toLowerCase()))
  // The same unknown word usually appears many times in a document; deciding
  // once per distinct word turns the repeats into a Map lookup.
  const decided = new Map<string, boolean>()
  const issues: SpellIssue[] = []
  for (const token of tokenize(text)) {
    let ok = decided.get(token.word)
    if (ok === undefined) {
      ok = known(token.word, ignore)
      decided.set(token.word, ok)
    }
    if (!ok) issues.push(token)
  }
  return issues
}
