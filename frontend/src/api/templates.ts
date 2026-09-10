import {
  DeleteSqlTemplate,
  ExecuteTemplateQuery,
  ExtractTemplateVariables,
  GetSqlTemplate,
  ListSqlTemplates,
  PreviewTemplate,
  SaveSqlTemplate,
  ValidateScript,
} from '@wails/go/app/App'
import type {
  QueryResult,
  SQLTemplate,
  TemplateExecuteRequest,
  TemplateListItem,
} from '@/types'

/** 模板未配置页大小时的默认值，需与后端 defaultPageSize 保持一致 */
export const DEFAULT_PAGE_SIZE = 50

/** 把后端模板对象规整为前端类型 */
function toTemplate(raw: {
  id: number
  connId: number
  name: string
  sqlText: string
  variables: string
  fieldMappings: string
  preScript: string
  postScript: string
  paginationEnabled: boolean
  pageSize?: number
}): SQLTemplate {
  return {
    id: raw.id,
    connId: raw.connId,
    name: raw.name,
    sqlText: raw.sqlText,
    variables: raw.variables,
    fieldMappings: raw.fieldMappings,
    preScript: raw.preScript,
    postScript: raw.postScript,
    paginationEnabled: Boolean(raw.paginationEnabled),
    pageSize: Number(raw.pageSize) || 0,
  }
}

/** 读取模板列表（含截断的 SQL 预览） */
export async function fetchTemplateList(): Promise<TemplateListItem[]> {
  const list = await ListSqlTemplates()
  return list.map(item => ({
    id: item.id,
    name: item.name,
    connId: item.connId,
    sqlText: item.sqlText,
  }))
}

/** 读取单个模板的完整内容 */
export async function fetchTemplate(id: number): Promise<SQLTemplate> {
  return toTemplate(await GetSqlTemplate(id))
}

/** 保存模板；id 为 0 时新增 */
export function persistTemplate(tpl: SQLTemplate): Promise<number> {
  // pageSize 为后端保留字段，界面上已由各标签页的翻页控件决定
  return SaveSqlTemplate({ ...tpl, pageSize: tpl.pageSize ?? 0 })
}

/** 删除模板 */
export function removeTemplate(id: number): Promise<void> {
  return DeleteSqlTemplate(id)
}

/** 解析模板中的变量名 */
export function extractVariables(sqlText: string): Promise<string[]> {
  return ExtractTemplateVariables(sqlText) as Promise<string[]>
}

/** 预览模板渲染后的 SQL */
export function previewTemplate(
  sqlText: string,
  variables: Record<string, unknown>,
): Promise<string> {
  return PreviewTemplate(sqlText, variables)
}

/** 校验前置/后置脚本语法 */
export function validateScript(source: string): Promise<void> {
  return ValidateScript(source)
}

/**
 * 按模板执行查询。
 * 前端只传模板 ID 与变量值，SQL/脚本由后端从模板读取，保证模板更新即时生效。
 * page / pageSize 仅在模板开启分页时被后端采纳，未开启时传 0 即可。
 */
export function executeTemplateQuery(req: TemplateExecuteRequest): Promise<QueryResult> {
  return ExecuteTemplateQuery({
    ...req,
    page: req.page ?? 0,
    pageSize: req.pageSize ?? 0,
    total: req.total ?? 0,
    countTotal: req.countTotal ?? false,
  }) as unknown as Promise<QueryResult>
}
