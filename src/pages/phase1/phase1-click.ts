import { useEffect, useRef } from 'react';

export function useClickVsDoubleClick(onOpen: () => void, onExecute?: () => void, delay = 250) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return () => {
    if (!onExecute) {
      onOpen();
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      onExecute();
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      onOpen();
    }, delay);
  };
}
