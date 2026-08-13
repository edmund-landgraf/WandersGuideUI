import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';
import type { AbilityBlockType, ContentType } from '@schemas/content';

export type ContentLinkRef = {
  type: ContentType | AbilityBlockType | 'condition';
  id: string;
};

type ContentLinkContextValue = {
  stack: ContentLinkRef[];
  open: (href: string) => void;
  back: () => void;
  close: () => void;
};

const ContentLinkContext = createContext<ContentLinkContextValue>({
  stack: [],
  open: () => {},
  back: () => {},
  close: () => {},
});

export const CONTENT_STACK_SELECTOR = '[data-content-stack-modal]';

export function ContentLinkProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<ContentLinkRef[]>([]);

  const open = useCallback((href: string) => {
    const data = getContentDataFromHref(href);
    if (!data) return;
    setStack((current) => {
      const top = current[current.length - 1];
      if (top && top.type === data.type && top.id === data.id) return current;
      return [...current, data];
    });
  }, []);

  const back = useCallback(() => {
    setStack((current) => (current.length === 0 ? current : current.slice(0, -1)));
  }, []);

  const close = useCallback(() => {
    setStack((current) => (current.length === 0 ? current : []));
  }, []);

  const value = useMemo(() => ({ stack, open, back, close }), [stack, open, back, close]);
  return <ContentLinkContext.Provider value={value}>{children}</ContentLinkContext.Provider>;
}

export function useContentLinks() {
  return useContext(ContentLinkContext);
}

export function isContentStackOpen() {
  return Boolean(document.querySelector(CONTENT_STACK_SELECTOR));
}
