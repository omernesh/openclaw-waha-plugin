import * as React from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

interface TagInputProps {
  values: string[]                    // Raw JID strings or patterns
  onChange?: (values: string[]) => void  // Omit for read-only mode
  resolvedNames?: Record<string, string> // JID -> display name mapping
  placeholder?: string
  searchFn?: (query: string) => Promise<Array<{ value: string; label: string }>>  // For directory search
  freeform?: boolean                  // true = user can type arbitrary values (mention patterns)
  readOnly?: boolean                  // true = no add/remove, display only
  className?: string
}

export function TagInput({
  values,
  onChange,
  resolvedNames = {},
  placeholder = 'Add value...',
  searchFn,
  freeform = false,
  readOnly = false,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<Array<{ value: string; label: string }>>([])
  const [popoverOpen, setPopoverOpen] = React.useState(false)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Search with debounce when searchFn provided
  React.useEffect(() => {
    if (!searchFn || !inputValue.trim()) {
      setSearchResults([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      searchFn(inputValue).then(setSearchResults).catch((err) => { console.error('TagInput search failed:', err); setSearchResults([]) })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [inputValue, searchFn])

  function removeValue(val: string) {
    if (readOnly || !onChange) return
    onChange(values.filter((v) => v !== val))
  }

  function addValue(val: string) {
    const trimmed = val.trim()
    if (!trimmed || values.includes(trimmed) || !onChange) return
    onChange([...values, trimmed])
    setInputValue('')
    setPopoverOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (freeform && inputValue.trim()) {
        addValue(inputValue)
      }
    }
  }

  function handleSearchSelect(val: string) {
    addValue(val)
    setInputValue('')
    setSearchResults([])
    setPopoverOpen(false)
  }

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {values.map((val) => {
        const displayName = resolvedNames[val] ?? val
        return (
          <Badge
            key={val}
            variant="secondary"
            className="gap-1 pr-1 font-normal"
            title={val !== displayName ? val : undefined}
          >
            <span className="max-w-[200px] truncate">{displayName}</span>
            {!readOnly && (
              <button
                type="button"
                className="ml-0.5 rounded-full opacity-70 hover:opacity-100 focus:outline-none"
                onClick={() => removeValue(val)}
                aria-label={`Remove ${displayName}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        )
      })}

      {!readOnly && searchFn && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 items-center rounded-md border border-dashed border-input bg-transparent px-2 text-xs text-muted-foreground hover:border-ring hover:text-foreground"
            >
              {placeholder}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search..."
                value={inputValue}
                onValueChange={setInputValue}
              />
              <CommandList>
                {searchResults.length === 0 ? (
                  <CommandEmpty>
                    {inputValue.length > 0 ? (
                      freeform ? (
                        <button
                          type="button"
                          className="w-full py-2 text-center text-sm"
                          onClick={() => addValue(inputValue)}
                        >
                          Add &quot;{inputValue}&quot;
                        </button>
                      ) : (
                        <span>No results found</span>
                      )
                    ) : (
                      <span>Type to search...</span>
                    )}
                  </CommandEmpty>
                ) : (
                  <CommandGroup>
                    {searchResults.map((item) => (
                      <CommandItem
                        key={item.value}
                        value={item.value}
                        onSelect={() => handleSearchSelect(item.value)}
                      >
                        {item.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {!readOnly && !searchFn && freeform && (
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-6 w-40 text-xs"
        />
      )}
    </div>
  )
}
