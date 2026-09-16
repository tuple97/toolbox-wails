<script setup lang="ts">
/**
 * CodeMirror 6 编辑器封装：全应用唯一的代码编辑器组件。
 *
 * 设计要点：
 *  - 实例必须放 shallowRef：CM6 view 内部结构庞大，放进普通 ref 会被深层代理，
 *    调用开销极高；
 *  - 语言 / 主题 / 只读 / 字体各自用 Compartment：切换时 dispatch 一个新配置即可，
 *    不销毁重建编辑器（重建会丢滚动位置与撤销栈）；
 *  - 主题的两层分工见 utils/logLanguage.ts：
 *    EditorView.theme 管渲染层，HighlightStyle 管语法高亮层；
 *  - SQL 补全源由 utils/sqlCompletion.ts 提供（per-editor，靠 registerCompletionContext
 *    登记上下文；其它编辑器没登记就退化为空结果）。
 */
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completeAnyWord,
  completeFromList,
  completionStatus,
  selectedCompletion,
} from '@codemirror/autocomplete'
import type { Completion, CompletionSource } from '@codemirror/autocomplete'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { MySQL, PostgreSQL, sql } from '@codemirror/lang-sql'
import type { SQLDialect } from '@codemirror/lang-sql'
import { javascript, localCompletionSource, snippets } from '@codemirror/lang-javascript'
import { useConfigStore } from '@/stores/configStore'
import {
  columnHoverAt,
  contextKindAt,
  createSqlCompletion,
  defaultMetadataProvider,
  isColumnMarked,
  isPositionalEligible,
  sqlContextOf,
  toggleColumnMark,
} from '@/utils/sql/sqlCompletion'
import type {
  ColumnCompletion,
  CompletionFeatureFlags,
  CompletionMode,
  CompletionRuntime,
  SqlColumnInfo,
} from '@/utils/sql/sqlCompletion'
import { parseSqlTriggerMode, sqlCompletionTrigger } from '@/utils/sql/sqlCompletionTrigger'
import { inTemplateFragment } from '@/utils/sql/sqlTemplateCompletion'
import {
  jumpToNextPlaceholder,
  templatePlaceholderExtension,
} from '@/utils/sql/template/templatePlaceholder'
import { analyzeHybridCursor } from '@/utils/sql/hybridCursor'
import { createStatementBoxExtension } from '@/utils/sql/sqlStatementBox'
import { sqlStatementRunGutter, type RunnableStatement } from '@/utils/sql/sqlRunGutter'
import {
  LOG_LANGUAGE_ID,
  editorThemeExtensions,
  editorThemeNameOf,
  logLanguage,
} from '@/utils/logLanguage'
import { editorErrorField, errorRangeOf, setEditorErrors } from '@/utils/editorErrors'
import type { EditorError, ErrorPosition } from '@/utils/editorErrors'

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
  /** 编辑器实例就绪（用于登记补全上下文等实例级能力） */
  (e: 'mount', view: EditorView): void
  /**
   * 光标 / 选区变化（无载荷）。
   *
   * 编辑器状态不是响应式对象，调用方拿不到「当前选中的是哪段 SQL」的变化时机；
   * 这里只发一个信号，由调用方重新读自己的最新状态即可。
   */
  (e: 'selection'): void
  /** 点击语句左侧的运行按钮（把该语句交给调用方执行） */
  (e: 'run-statement', statement: RunnableStatement): void
}>()

const props = withDefaults(defineProps<{
  /** 编辑内容（v-model） */
  modelValue: string
  /** 语言：sql / javascript / toolbox-log（执行记录） */
  language?: string
  /**
   * 数据库类型（mysql / postgres…），决定 SQL 方言。
   * 方言影响语法树的词法：默认（标准 SQL）会把 MySQL 的反引号标识符判成错误节点，
   * 语法树与补全的作用域分析都会变差。
   */
  dbType?: string
  /** 主题名（应用主题键，如 toolbox-dark）；留空时跟随全局配置 */
  theme?: string
  /** 是否只读 */
  readonly?: boolean
  /** 编辑器高度 */
  height?: string
  /** 是否显示行号 */
  showLineNumbers?: boolean
  /** 是否关闭智能提示（日志展示场景） */
  disableSuggestions?: boolean
  /**
   * 补全模式：sql / sql-template / javascript / none。
   * 显式传入优先；不传时按 language 推导（sql → sql、javascript → javascript、其余 → none）。
   * 详见 utils/sqlCompletion.ts 的分派说明。
   */
  completionMode?: '' | CompletionMode
  /** 是否给识别出的每条 SQL 套边框（仅 sql 语言生效，命令执行器用） */
  showStatementFrames?: boolean
  /** 是否在行号左侧显示「执行这条语句」按钮（仅 sql 语言生效，命令执行器用） */
  showRunButtons?: boolean
  /**
   * 页面注入的动态补全上下文（可按需覆盖 sql / 模板变量 / 脚本全局标识符）。
   *
   * 与「登记式」上下文（registerCompletionContext 等）的关系：登记的是**实例级**默认值，
   * 这个函数是**页面级**覆盖，且每次查询都重新求值 —— 于是模板变量改了配置、
   * 查询页换了连接之后，同一个编辑器无需重建就能拿到新上下文。
   */
  completionContext?: () => Partial<CompletionRuntime> | undefined
  /** 定向扩展开关（关掉函数候选、只留变量等轻量场景） */
  featureFlags?: CompletionFeatureFlags
}>(), {
  language: 'sql',
  theme: '',
  readonly: false,
  height: '260px',
  showLineNumbers: true,
  disableSuggestions: false,
  completionMode: '',
  showStatementFrames: false,
  showRunButtons: false,
})

const configStore = useConfigStore()

/** 编辑器实例（重量级对象：必须 shallowRef） */
const viewRef = shallowRef<EditorView | null>(null)
const host = shallowRef<HTMLDivElement | null>(null)

/** 各维度独立 Compartment，便于运行时重配置 */
const languageCompartment = new Compartment()
const themeCompartment = new Compartment()
const readOnlyCompartment = new Compartment()
const fontCompartment = new Compartment()

// ---------------------------------------------------------------- 各层扩展

/** 连接类型 → SQL 方言；未知类型返回 undefined（用标准 SQL） */
function sqlDialectOf(dbType: string): SQLDialect | undefined {
  switch (dbType.toLowerCase()) {
    case 'mysql':
      return MySQL
    case 'postgres':
    case 'postgresql':
      return PostgreSQL
    default:
      return undefined
  }
}

/** 语言扩展：SQL / JavaScript / 日志（未知语言按纯文本处理） */
function languageExtension(): Extension {
  switch (props.language) {
    case 'sql':
      return sql({ dialect: sqlDialectOf(props.dbType ?? '') })
    case 'javascript':
      return javascript()
    case LOG_LANGUAGE_ID:
      return logLanguage()
    default:
      return []
  }
}

/** 当前生效的编辑器主题名：显式传入优先，否则跟随全局主题 */
function themeName(): string {
  if (props.theme) {
    return props.theme
  }
  return editorThemeNameOf(configStore.theme)
}

/** 字体与字号跟随「设置 → 编辑器字体 / 编辑器字号」 */
function fontExtension(): Extension {
  const fontFamily = configStore.editorFontStack
  return EditorView.theme({
    '&': { fontSize: `${configStore.editorFontSize}px` },
    '.cm-scroller': {
      fontFamily,
      lineHeight: '1.6',
    },
    /*
     * 补全/悬停浮层也用编辑器字体。
     * 浮层是 .cm-editor 的子元素、不在 .cm-scroller 内，只写 .cm-scroller
     * 的话它会回退成界面字体（Inter/雅黑），和代码字体不一致。
     */
    '.cm-tooltip': {
      fontFamily,
    },
  })
}

/** 只读：同时禁编辑与禁光标输入行为 */
function readOnlyExtension(): Extension {
  return props.readonly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : []
}

/**
 * 生效的补全模式：显式传入优先，否则按 language 推导。
 * 日志（toolbox-log）等未知语言一律 none——不注册任何补全源。
 */
function resolvedCompletionMode(): CompletionMode {
  if (props.completionMode) {
    return props.completionMode
  }
  if (props.language === 'sql') {
    return 'sql'
  }
  if (props.language === 'javascript') {
    return 'javascript'
  }
  return 'none'
}

/**
 * 补全源组装。
 *
 * 注意 `override` 会**替换掉语言自带的所有补全源**，因此必须把需要的都显式列上：
 *  - SQL / SQL 模板：项目自己的补全源（sql-template 模式下它会先判断光标是否在
 *    `{{ … }}` 内，再决定给模板候选还是 SQL 候选）；未登记连接上下文时
 *    退化为「关键字 + 函数」，见 utils/sqlCompletion.ts；
 *  - JavaScript：项目补全源只负责注入的全局标识符（variables / rows / sqlTemplate），
 *    再叠加 lang-javascript 自带的片段与作用域标识符、以及「文档内单词」。
 *
 * SQL **不挂「文档内单词」**：它会把文档里出现过的词整篇倒出来，
 * 而 SQL 编辑器里最不缺的单词就是列名——于是 `FROM ` 后面会冒出 SELECT
 * 列表里的列名，把表名候选挤掉。SQL 的候选一律由元数据补全源按子句产出。
 */
function completionSources(): CompletionSource[] {
  const sources: CompletionSource[] = []
  const mode = resolvedCompletionMode()

  if (mode === 'sql' || mode === 'sql-template') {
    sources.push(createSqlCompletion(() => viewRef.value, mode, defaultMetadataProvider, pageContext))
  }

  if (mode === 'javascript') {
    sources.push(createSqlCompletion(() => viewRef.value, 'javascript', defaultMetadataProvider, pageContext))
    sources.push(completeFromList([...snippets]))
    sources.push(localCompletionSource)
    sources.push(completeAnyWord)
  }

  return sources
}

/**
 * 页面级动态上下文：组件 prop 给出的内容每次查询重新求值。
 *
 * `featureFlags` 以 prop 为底、页面上下文里的为准（页面更清楚自己要什么）。
 */
function pageContext(): Partial<CompletionRuntime> {
  const page = props.completionContext?.() ?? {}
  return {
    ...page,
    featureFlags: {
      ...props.featureFlags,
      // 设置项：表名补全后自动补别名（每次查询重新读，改完设置下一次补全即生效）
      autoTableAlias: configStore.values.sql_completion_alias === 'true',
      ...page.featureFlags,
    },
  }
}

/**
 * 打字触发（仅 SQL / SQL 模板）。
 *
 * 本版 CodeMirror 的打字触发开关只接受布尔值，无法按位置逐次判定，
 * 因此 SQL 侧统一关掉它、改由本扩展按「触发策略」显式打开（见 sqlCompletionTrigger）。
 */
function triggerExtension(): Extension {
  const mode = resolvedCompletionMode()
  if (props.disableSuggestions || (mode !== 'sql' && mode !== 'sql-template')) {
    return []
  }
  /*
   * 模板编辑器：`{{ … }}` 片段优先于「字符串 / 注释」与位置判定
   * （与补全的分派顺序一致）—— 模板里 `'{{ device_no }}'` 这种引号内插值
   * 是最常见的写法，不这样特判的话片段里打字永远不会自动弹候选。
   */
  const templateMode = mode === 'sql-template'
  return sqlCompletionTrigger({
    getMode: () => parseSqlTriggerMode(configStore.values.sql_completion_trigger),
    getPositionalEligible: (state) => {
      const pos = state.selection.main.head
      if (templateMode && inTemplateFragment(state, pos)) {
        return true
      }
      // 位置类别与补全用同一套语言区域分析（模板识别交给引擎，不再单独判断）
      return isPositionalEligible(contextKindAt(state, pos, props.dbType ?? '', mode))
    },
    getInLiteralOrComment: (state) => {
      const pos = state.selection.main.head
      /*
       * 模板片段不算「字符串 / 注释」：那里是模板语言的地盘（引号内插值是最常见的写法）。
       * 语言区域一次判清，不再靠「先判模板再判字符串」的顺序。
       */
      return analyzeHybridCursor(state, pos, { mode }).inLiteral
    },
  })
}

/** 智能提示（日志等只读场景可用 disableSuggestions 关闭；none 模式一律不装） */
function completionExtension(): Extension {
  if (props.disableSuggestions || resolvedCompletionMode() === 'none') {
    return []
  }
  const sources = completionSources()
  if (!sources.length) {
    return []
  }
  const mode = resolvedCompletionMode()
  return autocompletion({
    override: sources,
    maxRenderedOptions: 50,
    /*
     * SQL / SQL 模板的「打字自动弹」由 triggerExtension 按触发策略接管：
     * 这里必须关掉编辑器自带的开关，否则位置判定形同虚设。
     * JavaScript 保持自带行为（语言源需要它）。
     */
    activateOnTyping: mode !== 'sql' && mode !== 'sql-template',
    /*
     * 打开列表即高亮第一项（CM6 默认 false）。
     * 默认行为下「刚弹出列表时按回车」会因为没有任何高亮项而落到
     * defaultKeymap 的换行上，体验上就是「回车不选中而是换行」。
     */
    selectOnOpen: true,
    /*
     * 不要关掉 defaultKeymap：CM6 内部的补全快捷键是通过
     * `Prec.highest` 注册的（Enter 接受、Esc 关闭、方向键选择），
     * 关掉之后 Enter 会被 defaultKeymap 的换行抢走。
     */
    defaultKeymap: true,
    /*
     * 关掉 CM6 默认的类型图标（那些 c / f / λ 之类的字母）。
     * 列表里已经有列名勾选框，再叠一串图标显得吵，也和「克制」的观感不符；
     * 类型信息由每项后面的 detail 文本承担。
     */
    icons: false,
    // 候选项左侧：勾选框（10，仅列名）；描述区（80）由 renderColumnDetail 组装
    addToOptions: [
      { render: renderColumnCheckbox, position: 10 },
      { render: renderColumnDetail, position: 80 },
    ],
  })
}

// ---------------------------------------------------------------- 列悬停提示

/**
 * 列悬停提示：鼠标停在列名上显示「类型 · 注释 · 来源表」。
 *
 * 数据来源与补全完全一致（utils/sqlCompletion 的作用域解析 + 元数据缓存），
 * 因此派生表 / CTE 的列也能溯源到物理表。只在 SQL / SQL 模板模式挂载：
 * 脚本编辑器与日志面板没有可查的列。
 */
function columnHoverExtension(): Extension {
  const mode = resolvedCompletionMode()
  if (mode !== 'sql' && mode !== 'sql-template') {
    return []
  }

  return hoverTooltip((view, pos) => {
    const hover = columnHoverAt(view.state, pos, {
      mode,
      sql: sqlContextOf(view) ?? undefined,
    })
    if (!hover) {
      return null
    }

    return {
      pos: hover.from,
      end: hover.to,
      above: true,
      create: () => ({ dom: renderColumnHover(hover.info) }),
    }
  })
}

/** 「来源表」图标（表格轮廓，跟随文字颜色） */
const TABLE_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6"/><path d="M2.2 6.6h11.6M6.6 6.6v6.2"/></svg>'

/** 「注释」图标（对话气泡） */
const COMMENT_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.4 3.4h9.2a1.6 1.6 0 0 1 1.6 1.6v4.6a1.6 1.6 0 0 1-1.6 1.6H7.2L4.4 13.6v-2.4H3.4a1.6 1.6 0 0 1-1.6-1.6V5a1.6 1.6 0 0 1 1.6-1.6Z"/></svg>'

/**
 * 悬停卡片：标题行是「列名 + 完整类型」，下面是带图标的来源表与注释。
 * 结构尽量扁平（不放标签底色块、不画分隔线），观感更接近 IDE 的悬停提示。
 */
function renderColumnHover(info: SqlColumnInfo): HTMLElement {
  const root = document.createElement('div')
  root.className = 'column-hover'

  const head = document.createElement('div')
  head.className = 'column-hover__head'

  const name = document.createElement('span')
  name.className = 'column-hover__name'
  name.textContent = info.name
  head.appendChild(name)

  if (info.dataType) {
    const type = document.createElement('span')
    type.className = 'column-hover__type'
    type.textContent = info.dataType
    head.appendChild(type)
  }

  root.appendChild(head)

  const rows: HTMLElement[] = []
  if (info.table) {
    rows.push(hoverRow(TABLE_ICON, info.derived ? `${info.table}（派生列）` : info.table))
  }
  if (info.comment) {
    rows.push(hoverRow(COMMENT_ICON, info.comment))
  }
  if (rows.length) {
    const meta = document.createElement('div')
    meta.className = 'column-hover__meta'
    meta.append(...rows)
    root.appendChild(meta)
  }

  return root
}

/** 悬停卡片里的一行「图标 + 内容」（图标是固定字符串，不含用户输入） */
function hoverRow(icon: string, value: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'column-hover__row'

  const glyph = document.createElement('span')
  glyph.className = 'column-hover__icon'
  glyph.innerHTML = icon
  row.appendChild(glyph)

  const text = document.createElement('span')
  text.className = 'column-hover__value'
  text.textContent = value
  row.appendChild(text)

  return row
}

/**
 * 列候选的描述区（补全列表右侧）：按「类型 · 来源 · 注释」分段渲染。
 *
 * 与悬停卡片同一套视觉语言：来源配表格图标、注释配气泡图标，
 * 段与段之间用间距区分——纯文本 detail 只能串成一串 `·`，所以不用它。
 */
function renderColumnDetail(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
): Node | null {
  const detail = (completion as ColumnCompletion).columnDetail
  if (!detail) {
    return null
  }

  const doc = view.dom.ownerDocument
  const root = doc.createElement('span')
  root.className = 'cm-column-detail'

  if (detail.dataType) {
    const type = doc.createElement('span')
    type.className = 'cm-column-detail__part cm-column-detail__type'
    type.textContent = detail.dataType
    root.appendChild(type)
  }
  if (detail.from) {
    root.appendChild(detailPart(doc, TABLE_ICON, detail.from))
  }
  if (detail.comment) {
    root.appendChild(detailPart(doc, COMMENT_ICON, detail.comment))
  }

  return root.childNodes.length ? root : null
}

/** 描述区里带图标的一段 */
function detailPart(doc: Document, icon: string, text: string): HTMLElement {
  const part = doc.createElement('span')
  part.className = 'cm-column-detail__part'

  const glyph = doc.createElement('span')
  glyph.className = 'cm-column-detail__icon'
  glyph.innerHTML = icon
  part.appendChild(glyph)

  const value = doc.createElement('span')
  value.textContent = text
  part.appendChild(value)

  return part
}

// ---------------------------------------------------------------- 列名勾选

/**
 * 勾选框 DOM 缓存（label → 元素）。
 *
 * 空格切换勾选时直接改这个元素的 data 属性，不重新查询补全源——
 * 后者会重建整份候选列表、把高亮位置和勾选状态一起清掉。
 */
const checkNodes = new WeakMap<EditorView, Map<string, HTMLElement>>()

function setCheckState(el: HTMLElement, checked: boolean) {
  el.dataset.checked = checked ? 'true' : 'false'
}

/**
 * 列候选的身份键。
 *
 * 用候选自己的 `columnKey`（`schema.table@source.column`）而不是裸列名：
 * 多表 JOIN 下 `u.id` 与 `o.id` 是两个候选，按列名当键会互相影响。
 */
function columnKeyOf(completion: Completion): string {
  return (completion as ColumnCompletion).columnKey ?? completion.label
}

/**
 * 在列名候选项最左侧渲染勾选框（其它类型不渲染）。
 * position 10 排在默认内容之前（CM6 内置：icon 20 / label 50 / detail 80）。
 */
function renderColumnCheckbox(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
): Node | null {
  const mode = resolvedCompletionMode()
  if ((mode !== 'sql' && mode !== 'sql-template') || completion.type !== 'field') {
    return null
  }

  const key = columnKeyOf(completion)
  const box = view.dom.ownerDocument.createElement('span')
  box.className = 'cm-sqlcheck'
  box.setAttribute('aria-hidden', 'true')
  setCheckState(box, isColumnMarked(view, key))

  let nodes = checkNodes.get(view)
  if (!nodes) {
    nodes = new Map()
    checkNodes.set(view, nodes)
  }
  nodes.set(key, box)
  return box
}

/**
 * 空格：勾选 / 取消勾选当前高亮的列名。
 *
 * 只有「补全列表打开且高亮项是列名」时才消费按键，其余情况返回 false，
 * 空格照常输入。勾选后回车会一次性插入所有勾选项（见 utils/sqlCompletion.ts）。
 */
function toggleCheckedColumn(view: EditorView): boolean {
  if (completionStatus(view.state) !== 'active') {
    return false
  }
  const completion = selectedCompletion(view.state)
  if (!completion || completion.type !== 'field') {
    return false
  }

  // 勾选按候选身份记录，并带上该候选自己的插入文本（一次插入多列时各带各的别名）
  const key = columnKeyOf(completion)
  const insertText = (completion as ColumnCompletion).columnInsert ?? completion.label
  const checked = toggleColumnMark(view, key, insertText)

  const box = checkNodes.get(view)?.get(key)
  if (box) {
    setCheckState(box, checked)
  }
  return true
}

/** 与编辑器无关的基础能力（行号、历史、括号、快捷键等） */
function baseExtensions(): Extension[] {
  const extensions: Extension[] = [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(2),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    // 超长行自动折行，长 SQL 不横向滚动
    EditorView.lineWrapping,
    /*
     * tabindex 必须显式给：CM6 在只读（editable=false）时会把 .cm-content 设成
     * contentEditable="false"，浏览器就不会因为点击而聚焦它 —— 于是按键（Ctrl+A 全选、
     * Ctrl+C 复制）落不到编辑器上，只有鼠标划选能用（那是 CM 自己实现的）。
     * 加上 tabindex 后只读编辑器也能获得焦点，CM 自带的 Mod-a / 复制与我们的快捷键才生效。
     */
    EditorView.contentAttributes.of({ spellcheck: 'false', tabindex: '0' }),
    // 补全快捷键由 autocompletion 自己以 Prec.highest 注册（见 completionExtension），
    // 这里不要再重复绑定 completionKeymap；只补一个它没有的「空格勾选列名」
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      { key: 'Space', run: toggleCheckedColumn },
      /*
       * Tab 先走「模板占位跳转」：块片段插入后条件位与块体是链上的两个占位，
       * 走完（或没有占位）时返回 false，自然落回下面的缩进行为。
       */
      { key: 'Tab', run: jumpToNextPlaceholder },
      indentWithTab,
    ]),
    EditorView.updateListener.of(handleUpdate),
    // 错误波浪线的装饰位（未设置错误时为空，不产生任何开销）
    editorErrorField,
    // 模板占位链的位置存储（没有占位时为空数组，零开销）
    templatePlaceholderExtension(),
  ]

  /*
   * 语句运行按钮：每条语句左侧一个 ▶，点击执行它；执行中/成功/失败会换成对应图标。
   * 必须排在行号 gutter 之前，才显示在行号左边（gutter 按扩展顺序排列）。
   */
  if (props.showRunButtons && props.language === 'sql') {
    extensions.push(sqlStatementRunGutter({
      dbType: () => props.dbType ?? '',
      onRun: statement => emit('run-statement', statement),
    }))
  }

  if (props.showLineNumbers) {
    extensions.push(lineNumbers(), highlightActiveLineGutter())
  }

  /*
   * 语句边框：光标所在语句的一个整框（见 utils/sqlStatementBox.ts）。
   * 用 CM 自己的 layer 绘制，滚动/改窗口/软换行重排都由 CM 驱动重绘，
   * 语句范围按连接方言切分（分号或行首关键字分隔）。
   */
  if (props.showStatementFrames && props.language === 'sql') {
    extensions.push(createStatementBoxExtension(() => props.dbType ?? ''))
  }

  return extensions
}

/** 文档变化 → 回抛 v-model（程序化写入不回抛，避免冗余响应链） */
function handleUpdate(update: ViewUpdate) {
  // 先播报光标/选区变化：调用方据此重算「当前操作的是哪段 SQL」
  if (update.selectionSet || update.docChanged) {
    emit('selection')
  }
  if (!update.docChanged || props.readonly) {
    return
  }
  const value = update.state.doc.toString()
  if (value === props.modelValue) {
    return
  }
  emit('update:modelValue', value)
  emit('change', value)
}

// ---------------------------------------------------------------- 生命周期

onMounted(() => {
  const parent = host.value
  if (!parent) {
    return
  }

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      ...baseExtensions(),
      completionExtension(),
      triggerExtension(),
      columnHoverExtension(),
      languageCompartment.of(languageExtension()),
      themeCompartment.of(editorThemeExtensions(themeName())),
      readOnlyCompartment.of(readOnlyExtension()),
      fontCompartment.of(fontExtension()),
    ],
  })

  const view = new EditorView({ state, parent })
  viewRef.value = view
  emit('mount', view)
})

onBeforeUnmount(() => {
  // 重量级实例必须显式销毁
  viewRef.value?.destroy()
  viewRef.value = null
})

// ---------------------------------------------------------------- 响应式同步

/** 外部写入（父组件 setValue / 切换标签恢复内容） */
watch(() => props.modelValue, (value) => {
  const view = viewRef.value
  if (!view || value === view.state.doc.toString()) {
    return
  }
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  })
})

watch([() => props.language, () => props.dbType], () => {
  viewRef.value?.dispatch({
    effects: languageCompartment.reconfigure(languageExtension()),
  })
})

watch([() => props.theme, () => configStore.theme], () => {
  viewRef.value?.dispatch({
    effects: themeCompartment.reconfigure(editorThemeExtensions(themeName())),
  })
})

watch(() => props.readonly, () => {
  viewRef.value?.dispatch({
    effects: readOnlyCompartment.reconfigure(readOnlyExtension()),
  })
})

watch([() => configStore.editorFontSize, () => configStore.editorFontStack], () => {
  viewRef.value?.dispatch({
    effects: fontCompartment.reconfigure(fontExtension()),
  })
})

/**
 * 在当前光标（或选区）处插入文本。
 *
 * 行为约定：可撤销（CM6 每次 dispatch 都是独立撤销单元），
 * 插入后若文本含占位词则选中它，方便直接改写。
 *
 * @returns 是否插入成功（编辑器未就绪时为 false）
 */
function insertText(text: string, placeholder = '变量'): boolean {
  const view = viewRef.value
  if (!text || !view) {
    return false
  }

  try {
    const selection = view.state.selection.main
    const start = selection.from
    const index = text.indexOf(placeholder)
    const anchor = index >= 0 ? start + index : start + text.length
    const head = index >= 0 ? anchor + placeholder.length : anchor

    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor, head },
      scrollIntoView: true,
    })
    view.focus()
    return true
  }
  catch (e) {
    // 插入失败时明确告知，避免「点了没反应」
    console.error('[CodeEditor] insertText failed', e)
    return false
  }
}

/**
 * 标记 / 清除编辑器里的错误（底部红色波浪线），供模板语法校验等使用。
 *
 * @param positions 错误位置（行号从 1 起）；传空数组即清空
 * @param options.reveal 是否滚动到第一个错误并聚焦（保存前校验失败时用）
 */
function setErrors(positions: ErrorPosition[], options: { reveal?: boolean } = {}): void {
  const view = viewRef.value
  if (!view) {
    return
  }

  const errors = positions
    .map(position => errorRangeOf(view.state, position))
    .filter((error): error is EditorError => error !== null)
  view.dispatch({ effects: setEditorErrors.of(errors) })

  if (options.reveal && errors.length) {
    view.dispatch({
      selection: { anchor: errors[0].from },
      effects: EditorView.scrollIntoView(errors[0].from, { y: 'center' }),
    })
    view.focus()
  }
}

/** 供父组件调用：只暴露插入与错误标记，避免外部直接操作编辑器 */
defineExpose({ insertText, setErrors })
</script>

<template>
  <div ref="host" class="code-editor" :style="{ height }" />
</template>

<style scoped>
/*
 * 容器只负责尺寸：编辑器背景透明、内部滚动由 CM6 自己处理
 * （背景与光标等配色在 utils/logLanguage.ts 的 EditorView.theme 里）。
 */
.code-editor {
  overflow: hidden;
}

.code-editor :deep(.cm-editor) {
  height: 100%;
}

.code-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}

.code-editor :deep(.cm-scroller) {
  overflow: auto;
}

/* 补全弹层的高度 / 内边距 / 圆角由 utils/logLanguage.ts 的主题统一给出 */

/*
 * 列悬停卡片（内容由 renderColumnHover 拼装）。
 * 浮层底色 / 边框 / 圆角 / 阴影由 CM 主题里的 .cm-tooltip 统一提供，这里只排内容。
 * 排版尽量扁平：标题行 + 两行带图标的次要信息，不用底色块与分隔线。
 */
.code-editor :deep(.column-hover) {
  min-width: 220px;
  max-width: 420px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.5;
}

.code-editor :deep(.column-hover__head) {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.code-editor :deep(.column-hover__name) {
  color: var(--text-color);
  font-size: 13px;
  font-weight: 600;
}

/* 类型跟一个等宽的完整定义（varchar(32) / decimal(10,2)），保持次要层级 */
.code-editor :deep(.column-hover__type) {
  min-width: 0;
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  word-break: break-all;
}

.code-editor :deep(.column-hover__meta) {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 8px;
}

.code-editor :deep(.column-hover__row) {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11.5px;
}

.code-editor :deep(.column-hover__icon) {
  display: inline-flex;
  flex: 0 0 auto;
  margin-top: 1px;
  opacity: 0.7;
}

.code-editor :deep(.column-hover__value) {
  min-width: 0;
  word-break: break-word;
}
</style>
