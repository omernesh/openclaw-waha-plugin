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

const SEARCH_DEBOUNCE_MS = 300

interface TagInputProps {
  values: string[]                    // Raw JID strings or patterns
  onChange?: (values: string[]) => void  // Omit for read-only mode
  resolvedNames?: Record<string, string> // JID -> display name mapping
  placeholder?: string
  searchFn?: (query: string) => Promise<Array<{ value: string; label: string; phone?: string }>>  // For directory search
  freeform?: boolean                  // true = user can type arbitrary values (mention patterns)
  readOnly?: boolean                  // true = no add/remove, display only
  mergeByName?: boolean               // true = group JIDs that resolve to the same name into one tag
  className?: string
}

/** Groups JIDs by their resolved display name so duplicates show as one tag.
 *  - Wildcards ('*') are never merged with anything else.
 *  - JIDs that don't resolve (displayName === jid) are kept as standalone tags.
 *  DO NOT CHANGE — deduplicates @c.us / @lid pairs for allowFrom display. */
function buildMergedTags(
  values: string[],
  resolvedNames: Record<string, string>,
): Array<{ displayName: string; jids: string[] }> {
  const groups: Array<{ displayName: string; jids: string[] }> = []
  const nameIndex: Record<string, number> = {}

  for (const jid of values) {
    const resolved = resolvedNames[jid]
    // Only merge if the JID actually resolved to a human name (not itself) and is not '*'
    if (resolved && resolved !== jid && jid !== '*') {
      if (resolved in nameIndex) {
        groups[nameIndex[resolved]].jids.push(jid)
      } else {
        nameIndex[resolved] = groups.length
        groups.push({ displayName: resolved, jids: [jid] })
      }
    } else {
      // Unresolved JIDs and wildcards stay standalone
      groups.push({ displayName: resolvedNames[jid] ?? jid, jids: [jid] })
    }
  }
  return groups
}

export function TagInput({
  values,
  onChange,
  resolvedNames = {},
  placeholder = 'Add value...',
  searchFn,
  freeform = false,
  readOnly = false,
  mergeByName = false,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = React.useState('')
  const [searchResults, setSearchResults] = React.useState<Array<{ value: string; label: string; phone?: string }>>([])
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
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [inputValue, searchFn])

  function removeValue(val: string) {
    if (readOnly || !onChange) return
    onChange(values.filter((v) => v !== val))
  }

  /** Remove all JIDs in a merged group at once */
  function removeGroup(jids: string[]) {
    if (readOnly || !onChange) return
    const jidSet = new Set(jids)
    onChange(values.filter((v) => !jidSet.has(v)))
  }

  // Build merged tag groups when mergeByName is enabled
  const mergedTags = mergeByName ? buildMergedTags(values, resolvedNames) : null

  function addValue(val: string) {
    const trimmed = val.trim()
    if (!trimmed || values.includes(trimmed) || !onChange) return
    onChange([...values, trimmed])
    setInputValue('')
    setPopoverOpen(false)
  }

  function renderEmptyState() {
    if (inputValue.length === 0) return <span>Type to search...</span>
    if (freeform) return (
      <button
        type="button"
        className="w-full py-2 text-center text-sm"
        onClick={() => addValue(inputValue)}
      >
        Add &quot;{inputValue}&quot;
      </button>
    )
    return <span>No results found</span>
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
    setSearchResults([])
  }

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {mergedTags
        ? /* Merged mode: group JIDs with same resolved name into one tag */
          mergedTags.map((group) => (
            <Badge
              key={group.jids.join('|')}
              variant="secondary"
              className="gap-1 pr-1 font-normal"
              title={group.jids.length > 1 ? group.jids.join(', ') : (group.jids[0] !== group.displayName ? group.jids[0] : undefined)}
            >
              <span className="max-w-[200px] truncate">{group.displayName}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="ml-0.5 rounded-full opacity-70 hover:opacity-100 focus:outline-none"
                  onClick={() => removeGroup(group.jids)}
                  aria-label={`Remove ${group.displayName}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))
        : /* Standard mode: one tag per value */
          values.map((val) => {
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
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search..."
                value={inputValue}
                onValueChange={setInputValue}
              />
              <CommandList>
                {searchResults.length === 0 ? (
                  <CommandEmpty>{renderEmptyState()}</CommandEmpty>
                ) : (
                  <CommandGroup>
                    {searchResults.map((item) => (
                      <CommandItem
                        key={item.value}
                        value={item.value}
                        onSelect={() => handleSearchSelect(item.value)}
                      >
                        {item.label}
                        {item.phone && <span className="ml-1.5 text-muted-foreground text-xs">({item.phone})</span>}
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
