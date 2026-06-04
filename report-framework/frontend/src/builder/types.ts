// Builder-internal model. It is assembled into a real ReportTemplate by toTemplate().

export type FieldType = 'number' | 'string' | 'date'

export interface FieldInfo {
  name: string
  type: FieldType
  sample?: string
}

export type FormatKind = 'text' | 'number' | 'money' | 'date'

/** A field placed in the header band (label + bound value). */
export interface HeaderItem {
  id: string
  label: string
  field: string
  format: FormatKind
  bold: boolean
}

/** A field placed as a table column. */
export interface ColumnItem {
  id: string
  header: string
  field: string
  format: FormatKind
  align: 'left' | 'center' | 'right'
  total: boolean // include a SUM of this column in the totals row
}

export interface DataSourceState {
  endpoint: string
  name: string // view or stored-proc name
  rowsPath: string
  criteria: string // e.g. "SALE_NO={{param.saleNo}}"
}

export interface BuilderState {
  title: string
  titleText: string
  dataSource: DataSourceState
  headerItems: HeaderItem[]
  columns: ColumnItem[]
  footerLines: string[]
}

export function emptyBuilder(): BuilderState {
  return {
    title: 'New Report',
    titleText: 'New Report',
    dataSource: {
      endpoint: '/api/v1/n1/dynamic-query-data',
      name: 'VIW_SALE_MASTER_DETAIL',
      rowsPath: 'raw_response.Data',
      criteria: 'SALE_NO={{param.saleNo}}',
    },
    headerItems: [],
    columns: [],
    footerLines: [],
  }
}

/** Default display format for a discovered field type. */
export function defaultFormat(t: FieldType): FormatKind {
  if (t === 'number') return 'number'
  if (t === 'date') return 'date'
  return 'text'
}

/** Build the `{{ ... | filter }}` binding fragment for a format. */
export function formatPipe(format: FormatKind): string {
  switch (format) {
    case 'money': return ' | money'
    case 'number': return ' | number:2'
    case 'date': return ' | date:dd/MM/yyyy'
    default: return ''
  }
}
