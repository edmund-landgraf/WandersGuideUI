import { mergeAttributes, Node } from '@tiptap/core';
import { ActionCost } from '@schemas/content';

export interface ActionSymbolOptions {
  keepMarks: boolean;
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    actionSymbol: {
      /**
       * Add an action symbol
       */
      setActionSymbol: (cost: ActionCost) => ReturnType;
    };
  }
}

export const ActionSymbol = Node.create<ActionSymbolOptions>({
  name: 'actionSymbol',

  addOptions() {
    return {
      keepMarks: true,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      cost: {
        default: null,
      },
    };
  },

  inline: true,

  group: 'inline',

  selectable: false,

  parseHTML() {
    return [
      {
        tag: 'abbr.action-symbol, span.action-symbol, abbr[class="action-symbol"]',
        getAttrs: (el) => {
          const node = el as HTMLElement;
          const raw = node.getAttribute('data-action-symbol') || node.textContent?.trim() || '1';
          const convertDigit = (value: string): ActionCost => {
            switch (value) {
              case '2':
                return 'TWO-ACTIONS';
              case '3':
                return 'THREE-ACTIONS';
              case '4':
                return 'FREE-ACTION';
              case '5':
                return 'REACTION';
              default:
                return 'ONE-ACTION';
            }
          };
          return { cost: node.getAttribute('cost') || convertDigit(raw) };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const convertCost = (cost: ActionCost) => {
      switch (cost) {
        case 'ONE-ACTION':
          return '1';
        case 'TWO-ACTIONS':
          return '2';
        case 'THREE-ACTIONS':
          return '3';
        case 'FREE-ACTION':
          return '4';
        case 'REACTION':
          return '5';
        default:
          return '1';
      }
    };
    const symbol = convertCost(HTMLAttributes.cost);
    return [
      'abbr',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'action-symbol',
        'data-action-symbol': symbol,
      }),
      symbol,
    ];
  },

  addCommands() {
    return {
      setActionSymbol:
        (cost: ActionCost) =>
        ({ commands, chain, state, editor }) => {
          return commands.first([
            () => commands.exitCode(),
            () =>
              commands.command(() => {
                const { selection, storedMarks } = state;

                if (selection.$from.parent.type.spec.isolating) {
                  return false;
                }

                const { keepMarks } = this.options;
                const { splittableMarks } = editor.extensionManager;
                const marks = storedMarks || (selection.$to.parentOffset && selection.$from.marks());

                return chain()
                  .insertContent({ type: this.name, attrs: { cost } })
                  .command(({ tr, dispatch }) => {
                    if (dispatch && marks && keepMarks) {
                      const filteredMarks = marks.filter((mark) => splittableMarks.includes(mark.type.name));

                      tr.ensureMarks(filteredMarks);
                    }

                    return true;
                  })
                  .run();
              }),
          ]);
        },
    };
  },
});
