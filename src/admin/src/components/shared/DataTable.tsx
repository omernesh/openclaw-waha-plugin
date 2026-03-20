// DataTable — generic @tanstack/react-table v8 wrapper with server-side pagination
// DO NOT CHANGE: uses v8 API (useReactTable, not useTable). manualPagination: true is required
// for server-side pagination to work correctly. getCoreRowModel() is REQUIRED.
// Verified working: Phase 21 (2026-03-18)
// Pagination overhaul: numbered pages + page-size dropdown — quick task 260320-u7x
// Sortable column headers: client-side sort on current page data — quick task 260320

import * as React from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// DO NOT CHANGE: SortState tracks which column is sorted and in which direction.
// null means no sort active. Cycle: none -> asc -> desc -> none.
export interface SortState {
  columnId: string
  direction: 'asc' | 'desc'
}

// Column meta extension — set meta.sortable = true and meta.sortValue accessor
// to enable sorting on a column. sortValue receives the row and returns a sortable value.
// DO NOT REMOVE: this augments @tanstack/react-table ColumnMeta globally.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    sortable?: boolean
    sortValue?: (row: TData) => string | number | boolean | null | undefined
  }
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[]
  data: TData[]
  total: number                           // total rows from server (for page count)
  pagination: { pageIndex: number; pageSize: number }
  onPaginationChange: (pagination: { pageIndex: number; pageSize: number }) => void
  rowSelection?: Record<string, boolean>
  onRowSelectionChange?: (selection: Record<string, boolean>) => void
  onRowClick?: (row: TData) => void
  loading?: boolean
  getRowId?: (row: TData) => string       // default: uses 'jid' field
  expandedRowId?: string | null           // for group participant expansion
  renderExpandedRow?: (row: TData) => React.ReactNode
  pageSizeOptions?: number[]              // default: [10, 25, 50, 100]
}

export function DataTable<TData>({
  columns,
  data,
  total,
  pagination,
  onPaginationChange,
  rowSelection = {},
  onRowSelectionChange,
  onRowClick,
  loading,
  getRowId,
  expandedRowId,
  renderExpandedRow,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: DataTableProps<TData>) {
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize))

  // Client-side sort state for current page data
  const [sort, setSort] = React.useState<SortState | null>(null)

  // Reset sort when page changes (data changes)
  const pageRef = React.useRef(pagination.pageIndex)
  if (pageRef.current !== pagination.pageIndex) {
    pageRef.current = pagination.pageIndex
    // Don't reset sort on page change — keep user's sort preference
  }

  // Toggle sort cycle: none -> asc -> desc -> none
  function handleHeaderClick(columnId: string) {
    setSort((prev) => {
      if (!prev || prev.columnId !== columnId) return { columnId, direction: 'asc' }
      if (prev.direction === 'asc') return { columnId, direction: 'desc' }
      return null // desc -> none
    })
  }

  // Apply client-side sort to current page data
  // DO NOT CHANGE: sorting is applied BEFORE passing to useReactTable so row order reflects sort.
  const sortedData = React.useMemo(() => {
    if (!sort) return data
    // Find column def by id
    const colDef = columns.find((c) => {
      const id = 'id' in c ? c.id : ('accessorKey' in c ? String(c.accessorKey) : undefined)
      return id === sort.columnId
    })
    const sortValue = colDef?.meta?.sortValue
    if (!sortValue) return data
    const sorted = [...data].sort((a, b) => {
      const aVal = sortValue(a)
      const bVal = sortValue(b)
      // nulls/undefined always last
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal
      if (typeof aVal === 'boolean' && typeof bVal === 'boolean') return (aVal ? 1 : 0) - (bVal ? 1 : 0)
      return String(aVal).localeCompare(String(bVal), undefined, { sensitivity: 'base' })
    })
    if (sort.direction === 'desc') sorted.reverse()
    return sorted
  }, [data, sort, columns])

  const table = useReactTable({
    data: sortedData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // DO NOT REMOVE: manualPagination: true — server handles pagination, not the table
    manualPagination: true,
    rowCount: total,
    state: { rowSelection, pagination },
    onRowSelectionChange: onRowSelectionChange
      ? (updater) => {
          const newVal = typeof updater === 'function' ? updater(rowSelection) : updater
          onRowSelectionChange(newVal as Record<string, boolean>)
        }
      : undefined,
    onPaginationChange: (updater) => {
      const newVal = typeof updater === 'function' ? updater(pagination) : updater
      onPaginationChange(newVal)
    },
    // DO NOT CHANGE: getRowId defaults to 'jid' field — all directory entries have jid
    getRowId: getRowId ?? ((row) => (row as Record<string, unknown>).jid as string),
  })

  // Build visible page number window (up to 5 pages around current)
  const currentPage = pagination.pageIndex
  function getPageNumbers(): number[] {
    if (pageCount <= 5) {
      return Array.from({ length: pageCount }, (_, i) => i)
    }
    let start = Math.max(0, currentPage - 2)
    const end = Math.min(pageCount - 1, start + 4)
    start = Math.max(0, end - 4)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSortable = !!header.column.columnDef.meta?.sortable
                  const columnId = header.column.id
                  const isActive = sort?.columnId === columnId
                  return (
                    <TableHead
                      key={header.id}
                      className={isSortable ? 'cursor-pointer select-none hover:bg-muted/50 transition-colors' : ''}
                      onClick={isSortable ? () => handleHeaderClick(columnId) : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        <div className={isSortable ? 'flex items-center gap-1' : ''}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {isSortable && (
                            isActive && sort ? (
                              sort.direction === 'asc'
                                ? <ArrowUp className="h-3.5 w-3.5 text-foreground" />
                                : <ArrowDown className="h-3.5 w-3.5 text-foreground" />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                            )
                          )}
                        </div>
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No results.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {expandedRowId === row.id && renderExpandedRow && (
                    <TableRow>
                      <TableCell colSpan={columns.length} className="p-0">
                        {renderExpandedRow(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination controls — numbered pages + page-size dropdown */}
      <div className="flex items-center justify-between px-1 flex-wrap gap-2">
        {/* Left: page-size dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page:</span>
          <Select
            value={String(pagination.pageSize)}
            onValueChange={(val) => {
              onPaginationChange({ pageIndex: 0, pageSize: Number(val) })
            }}
            disabled={!!loading}
          >
            <SelectTrigger className="h-8 w-[72px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Center: page info */}
        <div className="text-sm text-muted-foreground">
          {total > 0
            ? `Page ${pagination.pageIndex + 1} of ${pageCount} (${total} total)`
            : 'No results'}
        </div>

        {/* Right: numbered pagination bar */}
        <div className="flex items-center gap-1">
          {/* First page */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPaginationChange({ ...pagination, pageIndex: 0 })}
            disabled={currentPage === 0 || !!loading}
            title="First page"
          >
            {'<<'}
          </Button>
          {/* Previous */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPaginationChange({ ...pagination, pageIndex: currentPage - 1 })}
            disabled={currentPage === 0 || !!loading}
            title="Previous page"
          >
            {'<'}
          </Button>

          {/* Numbered page buttons */}
          {getPageNumbers().map((pageNum) => (
            <Button
              key={pageNum}
              variant={pageNum === currentPage ? 'default' : 'outline'}
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => onPaginationChange({ ...pagination, pageIndex: pageNum })}
              disabled={!!loading}
            >
              {pageNum + 1}
            </Button>
          ))}

          {/* Next */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPaginationChange({ ...pagination, pageIndex: currentPage + 1 })}
            disabled={currentPage >= pageCount - 1 || !!loading}
            title="Next page"
          >
            {'>'}
          </Button>
          {/* Last page */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPaginationChange({ ...pagination, pageIndex: pageCount - 1 })}
            disabled={currentPage >= pageCount - 1 || !!loading}
            title="Last page"
          >
            {'>>'}
          </Button>
        </div>
      </div>
    </div>
  )
}
