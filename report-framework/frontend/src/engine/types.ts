// Mirror of schema/report-template.schema.json (the parts the renderer needs).

export type Expr =
  | string
  | number
  | {
      fn: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'first' | 'divide' | 'subtract' | 'multiply' | 'concat' | 'ifNull'
      field?: string
      args?: Expr[]
      scope?: 'rows' | 'groupRows'
    }

export interface Style {
  [k: string]: string | number | undefined
}

export interface Column {
  header: string
  cell: string
  align?: 'left' | 'center' | 'right'
  width?: number | string
  style?: Style
  headerStyle?: Style
}

export interface FooterCell {
  text?: string
  align?: 'left' | 'center' | 'right'
  colSpan?: number
  style?: Style
}

export interface Block {
  type:
    | 'row' | 'column' | 'text' | 'field' | 'labeledField'
    | 'image' | 'spacer' | 'rule' | 'table' | 'html' | 'richtext'
  id?: string
  if?: string
  style?: Style
  className?: string
  children?: Block[]
  gap?: number
  widths?: (number | string)[]
  text?: string
  label?: string
  value?: string
  src?: string
  lines?: string[]
  html?: string
  height?: number
  data?: 'rows' | 'groupRows'
  groupRef?: string
  columns?: Column[]
  footerRows?: FooterCell[][]
}

export interface GroupDef {
  id: string
  by: string
  aggregates?: Record<string, Expr>
}

export interface ReportTemplate {
  id: string
  title: string
  version?: string
  sourceRpt?: string
  page?: {
    size?: 'A4' | 'Letter' | 'Legal'
    orientation?: 'portrait' | 'landscape'
    marginsMm?: { top?: number; right?: number; bottom?: number; left?: number }
  }
  dataSource: {
    endpoint?: string
    method?: string
    params?: Record<string, string>
    rowsPath: string
  }
  params?: { name: string; label?: string; type?: string; required?: boolean; default?: unknown }[]
  header?: Record<string, string>
  computed?: Record<string, Expr>
  groups?: GroupDef[]
  constants?: Record<string, unknown>
  body: Block[]
}

export interface GroupRow {
  key: string
  rows: Record<string, unknown>[]
  [agg: string]: unknown
}

// The evaluation context passed around while rendering.
export interface RenderContext {
  rows: Record<string, unknown>[]
  header: Record<string, unknown>
  computed: Record<string, unknown>
  constants: Record<string, unknown>
  param: Record<string, unknown>
  groupRows: Record<string, GroupRow[]> // groupId -> rows
  // per-iteration scopes injected by table rendering:
  row?: Record<string, unknown>
  group?: GroupRow
}
