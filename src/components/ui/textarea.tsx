import * as React from 'react';
import { cn } from '@utils/cn';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full border border-p1-border bg-p1-inset px-2.5 py-1.5 text-sm text-p1-text outline-none placeholder:text-p1-faint focus:border-p1-accent/60 disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
