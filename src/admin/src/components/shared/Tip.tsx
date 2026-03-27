import { CircleHelp } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** Inline help tooltip icon — shared across all admin tabs. DO NOT REMOVE. */
export function Tip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <CircleHelp className="inline h-3.5 w-3.5 ml-1 text-muted-foreground cursor-help" />
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px]">
          <p className="text-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
