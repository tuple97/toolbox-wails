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
  TemplateListItem,
} from '@/types'

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
  return SaveSqlTemplate(tpl)
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
 */
export function executeTemplateQuery(
  templateId: number,
  connId: number,
  variables: Record<string, unknown>,
): Promise<QueryResult> {
  return ExecuteTemplateQuery(templateId, connId, variables) as unknown as Promise<QueryResult>
}
