'use client';

/**
 * Read-only code viewer: CodeMirror with syntax highlighting + a VSCode-style
 * git gutter (green = added line, amber = modified line), derived from the
 * file's unified diff vs the base branch.
 */

import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { type Extension, RangeSetBuilder, StateField } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';

type Change = 'add' | 'mod';

/** Map new-file line numbers → change kind, parsed from a unified diff. */
export function changedLines(diff: string): Map<number, Change> {
  const map = new Map<number, Change>();
  if (!diff) return map;
  let line = 0;
  let pendingDel = 0;
  for (const raw of diff.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      pendingDel = 0;
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (raw.startsWith('-')) {
      pendingDel++;
      continue;
    }
    if (raw.startsWith('+')) {
      map.set(line, pendingDel > 0 ? 'mod' : 'add');
      if (pendingDel > 0) pendingDel--;
      line++;
      continue;
    }
    // context line
    pendingDel = 0;
    line++;
  }
  return map;
}

const gitTheme = EditorView.baseTheme({
  // Inset box-shadow = gutter bar without shifting the text.
  '.cm-git-add': {
    backgroundColor: 'rgba(34,197,94,0.08)',
    boxShadow: 'inset 2px 0 0 #22c55e',
  },
  '.cm-git-mod': {
    backgroundColor: 'rgba(245,158,11,0.08)',
    boxShadow: 'inset 2px 0 0 #f59e0b',
  },
});

/** A StateField that paints changed lines (read-only doc → built once). */
function gitField(changed: Map<number, Change>, added: boolean): Extension {
  const build = (doc: {
    lines: number;
    line: (n: number) => { from: number };
  }) => {
    const b = new RangeSetBuilder<Decoration>();
    for (let i = 1; i <= doc.lines; i++) {
      // A brand-new file is entirely added → every line green.
      const kind = added ? 'add' : changed.get(i);
      if (kind) {
        b.add(
          doc.line(i).from,
          doc.line(i).from,
          Decoration.line({
            class: kind === 'add' ? 'cm-git-add' : 'cm-git-mod',
          }),
        );
      }
    }
    return b.finish();
  };
  return StateField.define<DecorationSet>({
    create: (state) => build(state.doc),
    update: (value, tr) => (tr.docChanged ? build(tr.state.doc) : value),
    provide: (f) => EditorView.decorations.from(f),
  });
}

function langExtension(filename: string): Extension {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext)) {
    return javascript({ jsx: true, typescript: ext === 'ts' || ext === 'tsx' });
  }
  if (ext === 'css' || ext === 'scss' || ext === 'less') return css();
  if (ext === 'html' || ext === 'htm' || ext === 'vue' || ext === 'svelte') {
    return html();
  }
  if (ext === 'json') return json();
  if (ext === 'md' || ext === 'mdx') return markdown();
  if (ext === 'py') return python();
  return [];
}

export function CodeViewer({
  filename,
  content,
  diff,
  added = false,
}: {
  filename: string;
  content: string;
  diff: string;
  /** File is new vs base → every line painted as added (green). */
  added?: boolean;
}) {
  return (
    <CodeMirror
      value={content}
      theme={oneDark}
      height='100%'
      readOnly
      editable={false}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
      }}
      extensions={[
        langExtension(filename),
        gitField(changedLines(diff), added),
        gitTheme,
        EditorView.lineWrapping,
      ]}
      style={{ height: '100%', fontSize: '12px' }}
    />
  );
}
