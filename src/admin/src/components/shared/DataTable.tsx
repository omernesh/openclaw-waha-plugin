// DataTable — generic @tanstack/react-table v8 wrapper with server-side pagination
// DO NOT CHANGE: uses v8 API (useReactTable, not useTable). manualPagination: true is required
// for server-side pagination to work correctly. getCoreRowModel() is REQUIRED.
// Verified working: Phase 21 (2026-03-18)

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
}: DataTableProps<TData>) {
  const pageCount = Math.ceil(total / pagination.pageSize)

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

      {/* Pagination controls */}
      <div className="flex items-center justify-between px-1">
        <div className="text-sm text-muted-foreground">
          {total > 0
            ? `Page ${pagination.pageIndex + 1} of ${Math.max(1, pageCount)} (${total} total)`
            : 'No results'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPaginationChange({ ...pagination, pageIndex: pagination.pageIndex - 1 })}
            disabled={pagination.pageIndex === 0 || loading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPaginationChange({ ...pagination, pageIndex: pagination.pageIndex + 1 })}
            disabled={pagination.pageIndex >= pageCount - 1 || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
