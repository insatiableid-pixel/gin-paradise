import { cn } from "@/src/lib/utils";
import React from "react";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "primary" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-zinc-900 text-zinc-50 hover:bg-zinc-900/90": variant === "default",
            "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/20": variant === "primary",
            "bg-zinc-800 text-zinc-100 hover:bg-zinc-700": variant === "secondary",
            "border border-zinc-800 bg-transparent hover:bg-zinc-800 text-zinc-300": variant === "outline",
            "hover:bg-zinc-800 hover:text-zinc-50 text-zinc-400": variant === "ghost",
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-md px-3": size === "sm",
            "h-11 rounded-md px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
