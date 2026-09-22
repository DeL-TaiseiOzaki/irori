import { EditorState, Prec, type Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { searchKeymap } from '@codemirror/search';
import { basicSetup, minimalSetup } from 'codemirror';

// History, text selection and search belong to editing, not to the optional assistance.
// Keeping the same history state field installed avoids losing undo on reconfiguration.
export const editingCore = [
  minimalSetup,
  EditorState.allowMultipleSelections.of(true),
  keymap.of(searchKeymap),
];
const plainHighlight = HighlightStyle.define([]);

export function assistanceExtensions(enabled: boolean, highlight: HighlightStyle): Extension {
  return [
    enabled ? basicSetup : [],
    // An explicit empty highlighter also suppresses minimalSetup's fallback colours.
    Prec.high(syntaxHighlighting(enabled ? highlight : plainHighlight)),
  ];
}

export async function languageForFilename(filename?: string): Promise<Extension> {
  if (!filename || /\.(md|markdown|mdown|mkd)$/i.test(filename))
    return markdown({ codeLanguages: languages });
  const language = LanguageDescription.matchFilename(languages, filename);
  return language ? language.load() : [];
}
