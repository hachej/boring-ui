// The data-table kit of satnaing/shadcn-admin (MIT, Copyright (c) 2024 Sat Naing, commit e16c87f2): toolbar, faceted filter, column header,
// view options, pagination and the table of `features/tasks`, adapted: lucide icons instead of @radix-ui/react-icons, a plain checkbox list
// instead of cmdk, local state instead of URL state. Based on shadcn/ui's data-table example (MIT).
// @ts-nocheck: demo source, bundled by esbuild.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, EyeOff, PlusCircle, SlidersHorizontal, X } from 'lucide-react';
import { flexRender, getCoreRowModel, getFacetedRowModel, getFacetedUniqueValues, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { cn } from './ui/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Separator } from './ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

export function DataTableColumnHeader({ column, title, className }) {
  if (!column.getCanSort()) return <div className={cn(className)}>{title}</div>;
  return <div className={cn('flex items-center space-x-2', className)}>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 data-[state=open]:bg-accent">
          <span>{title}</span>
          {column.getIsSorted() === 'desc' ? <ArrowDown className="ms-2 h-4 w-4" /> : column.getIsSorted() === 'asc' ? <ArrowUp className="ms-2 h-4 w-4" /> : <ChevronsUpDown className="ms-2 h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => column.toggleSorting(false)}><ArrowUp className="size-3.5 text-muted-foreground/70" />Asc</DropdownMenuItem>
        <DropdownMenuItem onClick={() => column.toggleSorting(true)}><ArrowDown className="size-3.5 text-muted-foreground/70" />Desc</DropdownMenuItem>
        {column.getCanHide() && <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => column.toggleVisibility(false)}><EyeOff className="size-3.5 text-muted-foreground/70" />Hide</DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function DataTableFacetedFilter({ column, title, options }) {
  const facets = column?.getFacetedUniqueValues();
  const selected = new Set(column?.getFilterValue() ?? []);
  const toggle = value => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value); else next.add(value);
    column?.setFilterValue(next.size ? [...next] : undefined);
  };
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="outline" size="sm" className="h-8 border-dashed" data-testid={`filter-${column?.id}`}>
        <PlusCircle className="size-4" />
        {title}
        {selected.size > 0 && <>
          <Separator orientation="vertical" className="mx-2 h-4" />
          <div className="flex gap-1">
            {selected.size > 2 ? <Badge variant="secondary" className="rounded-sm px-1 font-normal">{selected.size} selected</Badge>
              : options.filter(option => selected.has(option.value)).map(option => <Badge variant="secondary" key={option.value} className="rounded-sm px-1 font-normal">{option.label}</Badge>)}
          </div>
        </>}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-52 p-1" align="start">
      <ul role="listbox" aria-multiselectable="true" aria-label={title} className="m-0 list-none p-0">
        {options.map(option => {
          const on = selected.has(option.value);
          return <li key={option.value} role="option" aria-selected={on}>
            <button type="button" data-testid={`filter-option-${option.value}`} onClick={() => toggle(option.value)} className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent">
              <span className={cn('flex size-4 items-center justify-center rounded-sm border border-primary', on ? 'bg-primary text-primary-foreground' : 'opacity-50 [&_svg]:invisible')}><Check className="size-3.5" /></span>
              {option.icon && <option.icon className="size-4 text-muted-foreground" />}
              <span>{option.label}</span>
              {facets?.get(option.value) ? <span className="ms-auto font-mono text-xs text-muted-foreground">{facets.get(option.value)}</span> : null}
            </button>
          </li>;
        })}
      </ul>
      {selected.size > 0 && <>
        <Separator className="my-1" />
        <button type="button" onClick={() => column?.setFilterValue(undefined)} className="w-full cursor-pointer rounded-sm px-2 py-1.5 text-center text-sm hover:bg-accent">Clear filters</button>
      </>}
    </PopoverContent>
  </Popover>;
}

export function DataTableViewOptions({ table }) {
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" className="ms-auto h-8"><SlidersHorizontal className="size-4" />View</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-40">
      <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {table.getAllColumns().filter(column => typeof column.accessorFn !== 'undefined' && column.getCanHide()).map(column =>
        <DropdownMenuCheckboxItem key={column.id} className="capitalize" checked={column.getIsVisible()} onCheckedChange={value => column.toggleVisibility(!!value)}>{column.id}</DropdownMenuCheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function DataTableToolbar({ table, searchPlaceholder = 'Filter...', filters = [] }) {
  const filtered = table.getState().columnFilters.length > 0 || table.getState().globalFilter;
  return <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <Input data-testid="table-filter" placeholder={searchPlaceholder} value={table.getState().globalFilter ?? ''} onChange={event => table.setGlobalFilter(event.target.value)} className="h-8 w-40 lg:w-64" />
      {filters.map(filter => { const column = table.getColumn(filter.columnId); return column ? <DataTableFacetedFilter key={filter.columnId} column={column} title={filter.title} options={filter.options} /> : null; })}
      {filtered && <Button variant="ghost" onClick={() => { table.resetColumnFilters(); table.setGlobalFilter(''); }} className="h-8 px-2 lg:px-3">Reset<X className="ms-2 h-4 w-4" /></Button>}
    </div>
    <DataTableViewOptions table={table} />
  </div>;
}

function pageNumbers(current, total) {
  if (total <= 5) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 3) return [1, 2, 3, 4, '...', total];
  if (current >= total - 2) return [1, '...', total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

export function DataTablePagination({ table, className }) {
  const current = table.getState().pagination.pageIndex + 1, total = table.getPageCount();
  return <div data-testid="table-pagination" className={cn('flex items-center justify-between overflow-clip px-2', '@max-2xl/content:flex-col-reverse @max-2xl/content:gap-4', className)} style={{ overflowClipMargin: 1 }}>
    <div className="flex w-full items-center justify-between">
      <div className="flex w-25 items-center justify-center text-sm font-medium @2xl/content:hidden">Page {current} of {total}</div>
      <div className="flex items-center gap-2 @max-2xl/content:flex-row-reverse">
        <Select value={`${table.getState().pagination.pageSize}`} onValueChange={value => table.setPageSize(Number(value))}>
          <SelectTrigger className="h-8 w-17.5" aria-label="Rows per page"><SelectValue placeholder={table.getState().pagination.pageSize} /></SelectTrigger>
          <SelectContent side="top">{[5, 10, 20, 50].map(size => <SelectItem key={size} value={`${size}`}>{size}</SelectItem>)}</SelectContent>
        </Select>
        <p className="hidden text-sm font-medium sm:block">Rows per page</p>
      </div>
    </div>
    <div className="flex items-center sm:space-x-6 lg:space-x-8">
      <div className="flex w-25 items-center justify-center text-sm font-medium @max-3xl/content:hidden">Page {current} of {total}</div>
      <div className="flex items-center space-x-2">
        <Button variant="outline" className="size-8 p-0 @max-md/content:hidden" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}><span className="sr-only">Go to first page</span><ChevronsLeft className="h-4 w-4" /></Button>
        <Button variant="outline" className="size-8 p-0" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><span className="sr-only">Go to previous page</span><ChevronLeft className="h-4 w-4" /></Button>
        {pageNumbers(current, total).map((page, index) => <div key={`${page}-${index}`} className="flex items-center">
          {page === '...' ? <span className="px-1 text-sm text-muted-foreground">...</span>
            : <Button variant={current === page ? 'default' : 'outline'} className="h-8 min-w-8 px-2" onClick={() => table.setPageIndex(page - 1)}><span className="sr-only">Go to page {page}</span>{page}</Button>}
        </div>)}
        <Button variant="outline" className="size-8 p-0" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}><span className="sr-only">Go to next page</span><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="outline" className="size-8 p-0 @max-md/content:hidden" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}><span className="sr-only">Go to last page</span><ChevronsRight className="h-4 w-4" /></Button>
      </div>
    </div>
  </div>;
}

/** The table of `features/tasks`: toolbar with search and faceted filters, a bordered table with sortable headers, pagination. `bare` drops the toolbar and pagination. */
export function DataTable({ columns, data, filters = [], searchPlaceholder, globalFilterFn, initialFilter = '', initialSorting = [], pageSize = 10, bare = false, rowProps, emptyText = 'No results.', testId }) {
  const [sorting, setSorting] = useState(initialSorting);
  const [columnVisibility, setColumnVisibility] = useState({});
  const [globalFilter, setGlobalFilter] = useState(initialFilter);
  const [columnFilters, setColumnFilters] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });
  const table = useReactTable({
    data, columns, state: { sorting, columnVisibility, columnFilters, globalFilter, pagination },
    onSortingChange: setSorting, onColumnVisibilityChange: setColumnVisibility, onColumnFiltersChange: setColumnFilters, onGlobalFilterChange: setGlobalFilter, onPaginationChange: setPagination,
    ...(globalFilterFn ? { globalFilterFn } : {}),
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getPaginationRowModel: getPaginationRowModel(), getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(), getFacetedUniqueValues: getFacetedUniqueValues(),
  });
  return <div data-testid={testId} className="flex flex-1 flex-col gap-4">
    {!bare && <DataTableToolbar table={table} searchPlaceholder={searchPlaceholder} filters={filters} />}
    <div className="overflow-hidden rounded-md border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map(group => <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map(header => <TableHead key={header.id} colSpan={header.colSpan} className={cn(header.column.columnDef.meta?.className, header.column.columnDef.meta?.thClassName)}>
              {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
            </TableHead>)}
          </TableRow>)}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? table.getRowModel().rows.map(row => <TableRow key={row.id} {...(rowProps?.(row.original) ?? {})}>
            {row.getVisibleCells().map(cell => <TableCell key={cell.id} className={cn(cell.column.columnDef.meta?.className, cell.column.columnDef.meta?.tdClassName)}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
          </TableRow>) : <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">{emptyText}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
    {!bare && <DataTablePagination table={table} className="mt-auto" />}
  </div>;
}
