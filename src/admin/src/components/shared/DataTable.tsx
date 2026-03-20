// DataTable — generic @tanstack/react-table v8 wrapper with server-side pagination
// DO NOT CHANGE: uses v8 API (useReactTable, not useTable). manualPagination: true is required
// for server-side pagination to work correctly. getCoreRowModel() is REQUIRED.
// Verified working: Phase 21 (2026-03-18)
// Pagination overhaul: numbered pages + page-size dropdown — quick task 260320-u7x

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

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

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

  const table = useReactTable({
    data,
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
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
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
