import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { MatchRange } from '../lib/responseSearch';

class EmptyMatch extends WidgetType {
  constructor(private readonly className: string) { super(); }
  eq(other: EmptyMatch) { return this.className === other.className; }
  toDOM() {
    const mark = document.createElement('span');
    mark.className = this.className;
    return mark;
  }
}

export const setResponseHighlights = StateEffect.define<{ matches: MatchRange[]; active: number }>();
export const responseHighlights = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(setResponseHighlights)) continue;
      const { matches, active } = effect.value;
      return Decoration.set(matches.flatMap(({ from, to }, i) => {
        if (from < 0 || to < from || to > transaction.state.doc.length) return [];
        const cls = i === active ? 'cm-resp-match cm-resp-match-active' : 'cm-resp-match';
        if (from === to) return Decoration.widget({ widget: new EmptyMatch(cls) }).range(from);
        return Decoration.mark({ class: cls }).range(from, to);
      }));
    }
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: field => EditorView.decorations.from(field),
});
