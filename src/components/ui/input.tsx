import * as React from 'react';
import { cn } from '@utils/cn';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        'h-8 w-full border border-p1-border bg-p1-inset px-2.5 text-sm text-p1-text outline-none placeholder:text-p1-faint focus:border-p1-accent/60 disabled:opacity-50',
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
