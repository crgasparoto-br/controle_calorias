import * as React from "react";

import { cn } from "@/lib/utils";

type CardProps = React.ComponentProps<"div"> & {
  /**
   * When true, the card content can be expanded/collapsed.
   * When omitted, cards with a direct CardHeader + CardContent become collapsible automatically.
   */
  collapsible?: boolean;
  /** Opens a collapsible card by default. Auto-collapsible cards stay closed by default. */
  defaultOpen?: boolean;
};

function isCardSlot(
  child: React.ReactNode,
  component: React.ComponentType<React.ComponentProps<"div">>,
) {
  return React.isValidElement(child) && child.type === component;
}

function getDataBoolean(value: unknown) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function Card({ className, children, collapsible, defaultOpen, ...props }: CardProps) {
  const childArray = React.Children.toArray(children);
  const hasHeader = childArray.some(child => isCardSlot(child, CardHeader));
  const hasContent = childArray.some(child => isCardSlot(child, CardContent));
  const dataCollapsible = getDataBoolean((props as Record<string, unknown>)["data-collapsible"]);
  const dataDefaultOpen = getDataBoolean((props as Record<string, unknown>)["data-default-open"]);
  const shouldCollapse = collapsible ?? dataCollapsible ?? (hasHeader && hasContent);
  const [open, setOpen] = React.useState(defaultOpen ?? dataDefaultOpen ?? false);
  const isCollapsed = shouldCollapse && !open;

  const renderedChildren = shouldCollapse
    ? childArray.map(child => {
        if (isCardSlot(child, CardContent)) {
          return isCollapsed ? null : child;
        }

        if (isCardSlot(child, CardHeader) && React.isValidElement<{ className?: string }>(child)) {
          return React.cloneElement(child, {
            className: cn(child.props.className, "pr-28"),
          });
        }

        return child;
      })
    : children;

  return (
    <div
      data-slot="card"
      data-state={shouldCollapse ? (open ? "open" : "closed") : undefined}
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        shouldCollapse && "relative transition-shadow",
        isCollapsed && "gap-0",
        className
      )}
      {...props}
    >
      {shouldCollapse ? (
        <button
          type="button"
          aria-expanded={open}
          className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setOpen(current => !current)}
        >
          {open ? "Recolher" : "Expandir"}
          <span className={cn("text-sm leading-none transition-transform", open && "rotate-180")}>⌄</span>
        </button>
      ) : null}
      {renderedChildren}
    </div>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
