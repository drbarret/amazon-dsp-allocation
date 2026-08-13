"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  React.useEffect(() => {
    if (open) {
      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") onOpenChange(false)
      }
      document.addEventListener("keydown", handleEsc)
      return () => document.removeEventListener("keydown", handleEsc)
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-50 w-full max-w-md rounded-lg border bg-white p-6 shadow-lg dark:bg-zinc-900">
        {children}
      </div>
    </div>
  )
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("text-sm text-zinc-500 dark:text-zinc-400", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:gap-2 mt-4", className)}
      {...props}
    />
  )
}

function DialogClose({
  className,
  onClose,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { onClose?: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        className
      )}
      onClick={onClose}
      {...props}
    >
      <XIcon className="size-4" />
      <span className="sr-only">Fechar</span>
    </button>
  )
}

export {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
}
