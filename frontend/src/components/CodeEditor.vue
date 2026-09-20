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
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state'
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
  showTooltip,
} from '@codemirror/view'
import type { Tooltip } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  autocompletion,
  closeBrackets,
  CompletionContext,
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
  shouldConsumeSpaceForColumn,
  sqlContextOf,
  toggleColumnMark,
} from '@/utils/sql/sqlCompletion'
import type {
  ColumnCompletion,
  CompletionFeatureFlags,
  CompletionMode,
  CompletionRuntime,
} from '@/utils/sql/sqlCompletion'
import { parseSqlTriggerMode, sqlCompletionTrigger } from '@/utils/sql/sqlCompletionTrigger'
import { parseShowSystemDatabases } from '@/utils/sql/sqlVisibility'
import { inTemplateFragment } from '@/utils/sql/sqlTemplateCompletion'
import {
  jumpToNextPlaceholder,
  parsePlaceholderTabJump,
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
import { editorSearchExtensions, openEditorSearch } from '@/utils/editorSearch'
import { notify } from '@/utils/notify'
import { copyText } from '@/utils/clipboard'
import {
  isRenaming,
  renameTargetAt as renameTargetAtSql,
  sqlRenameExtension,
  startRenameAt,
} from '@/utils/sql/rename/sqlRenameView'
import type { RenameTargetKind } from '@/utils/sql/rename/sqlRenameView'
import type { SqlRenameViewOptions } from '@/utils/sql/rename/sqlRenameView'
import { createTableSqlAt, tableHoverAt } from '@/utils/sql/hover/sqlTableHover'
import { buildColumnHoverCard, COMMENT_ICON, TABLE_ICON } from '@/utils/sql/columnHoverCard'
import {
  openTableCardPopup,
  renderTableCardInto,
} from '@/utils/sql/hover/tableCard'
import type { TableCardModel } from '@/utils/sql/hover/tableCard'
import { resolveCreateTableSql } from '@/utils/sql/ddl/createTableSqlSource'
import type { CreateTableSqlResult } from '@/utils/sql/ddl/createTableSqlSource'
import { createTableModelOf, generateCreateTableSql } from '@/utils/sql/ddl/sqlCreateTable'
import { dialectOf, fetchPrimaryKeys } from '@/utils/sql/rowSql'
import { fetchTableIndexes } from '@/utils/sql/tableIndexes'
import { parameterInfoAt } from '@/utils/sql/sqlParameterInfo'
import { useMetadataStore } from '@/stores/metadataStore'
import { resolveTableAtPosition } from '@/utils/sql/semantic/sqlSymbols'
import {
  definitionNavigationExtension,
  definitionTargetAt,
  goToDefinition,
} from '@/utils/sql/semantic/sqlDefinition'
import { symbolHighlightExtension } from '@/utils/sql/semantic/sqlSymbolHighlight'
import type { SqlTableHover } from '@/utils/sql/hover/sqlTableHover'

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
/** 表结构卡片的异步补齐（外键）走元数据 store 的缓存 */
const metadataStore = useMetadataStore()

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
    /*
     * 字号 = 编辑器字号 × 缩放比例。用 calc 而不是在 JS 里乘：
     * 缩放比例是 CSS 变量，改「设置 → 缩放比例」时这里不必重建编辑器。
     */
    '&': { fontSize: `calc(${configStore.editorFontSize}px * var(--app-scale, 1))` },
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

  /*
   * 重命名期间不给候选：Enter 必须归重命名（提交），不能被补全截走。
   * 在候选源这一层挡掉，比「按位置判定」更硬 —— 无论谁触发都不会冒出来。
   */
  return sources.map(source => (context: CompletionContext) =>
    (isRenaming(context.state) ? null : source(context)))
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
      // 设置项：候选里是否展示系统库（默认展示；关掉后显式写 mysql.user 仍能解析）
      showSystemDatabases: parseShowSystemDatabases(configStore.values.sql_show_system_databases),
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
    /*
     * 候选项左侧：勾选框（10，仅多选列）→ 类型图标（20）→ 列名（50）→ 描述区（80）。
     * 类型图标与勾选框都只对特定候选产出（不适用时返回 null，不留空位）。
     */
    addToOptions: [
      { render: renderColumnCheckbox, position: 10 },
      { render: renderTypeIcon, position: 20 },
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
      // 卡片拼装在 utils/sql/columnHoverCard.ts（与结果表头悬停共用同一份）
      create: () => ({ dom: buildColumnHoverCard(hover.info) }),
    }
  })
}

/**
 * 表结构悬停：鼠标停在**表名或表别名**上时展示列清单。
 *
 * 与列悬停并列（那个答「这一列是什么」，这个答「这张表长什么样」），
 * 但共用同一套语义解析与元数据缓存：别名 `u` 解析到 `users` 后取它的列。
 * 模板区域先挡掉 —— `FROM {{ table }}` 里的 `table` 是模板变量，不是物理表。
 */
function tableHoverExtension(): Extension {
  const mode = resolvedCompletionMode()
  if (mode !== 'sql' && mode !== 'sql-template') {
    return []
  }

  return hoverTooltip((view, pos) => {
    if (analyzeHybridCursor(view.state, pos, { mode }).language !== 'sql') {
      return null
    }
    const hover = tableHoverAt(view.state, pos, sqlRuntimeFor(view, mode))
    if (!hover) {
      return null
    }
    return {
      pos: hover.from,
      end: hover.to,
      above: true,
      create: () => ({
        dom: renderTableHover(view, hover.info, async () => {
          // 悬停卡片与右键菜单走同一个来源策略：原生 DDL 优先
          const resolved = await resolveDdl(view, {
            tableName: hover.info.tableName,
            schema: hover.info.schemaName,
            sql: hover.info.createTableSql,
          })
          await copyText(resolved.sql)
        }),
      }),
    }
  })
}

/** 悬停 / 重命名共用的运行期上下文（每次现读，切连接后立即生效） */
function sqlRuntimeFor(view: EditorView, mode: CompletionMode): CompletionRuntime {
  return {
    mode,
    sql: sqlContextOf(view) ?? undefined,
    // 与补全同一份元数据提供者：重命名的列别名准入判断要按它查来源表的列
    metadata: defaultMetadataProvider,
  }
}

/** 重命名会话的选项（扩展与右键入口共用同一份反馈出口） */
function renameOptions(): SqlRenameViewOptions {
  return {
    runtime: view => sqlRuntimeFor(view, resolvedCompletionMode()),
    notify: (notice) => {
      if (notice.type === 'success') {
        notify.success(notice.message)
      }
      else {
        notify.warning(notice.message)
      }
    },
  }
}

/** 表别名重命名：Enter 提交、Esc 取消、光标移出自动取消 */
function renameExtension(): Extension {
  const mode = resolvedCompletionMode()
  if (props.readonly || (mode !== 'sql' && mode !== 'sql-template')) {
    return []
  }
  return sqlRenameExtension(renameOptions())
}

/**
 * 供父组件调用：在指定位置开始重命名（右键菜单入口）；返回是否已进入。
 *
 * 表别名 / CTE 名称 / 列别名共用这一个入口 —— 具体是哪种由语义解析决定，
 * 调用方不需要（也不应该）自己判断。
 */
function renameSymbolAt(pos: number): boolean {
  const view = viewRef.value
  return view ? startRenameAt(view, pos, renameOptions()) : false
}

/**
 * 供父组件调用：该位置可重命名的对象类型（菜单标签用）；null 表示没有可用动作。
 *
 * 与 `renameSymbolAt` 共用同一套判定，菜单与实际行为不会不一致。
 */
function renameTargetAt(pos: number): RenameTargetKind | null {
  const view = viewRef.value
  return view ? renameTargetAtSql(view, pos, renameOptions()) : null
}

/**
 * 供父组件调用：打开查找 / 替换面板（右键菜单入口）。
 *
 * 面板与快捷键都由 `@codemirror/search` 提供（见 utils/editorSearch.ts），
 * 这里只是把它暴露给外部的菜单 —— 菜单让能力可发现，Ctrl+F 才是常用路径。
 */
function openSearch(): boolean {
  const view = viewRef.value
  return view ? openEditorSearch(view) : false
}

/**
 * 供父组件调用：该位置是否有可复制建表语句的物理表。
 *
 * 按**名字**判断（有表名且不是派生表 / CTE）；列元数据是否已就绪交给动作本身
 * 去处理 —— 否则刚打开标签页时菜单会少一项，看起来像功能不稳定。
 */
function canCopyCreateTableAt(pos: number): boolean {
  const view = viewRef.value
  if (!view) {
    return false
  }
  const table = resolveTableAtPosition(view.state, pos, props.dbType ?? '')
  return Boolean(table && !table.virtual)
}

/** 供父组件调用：该位置是否有可跳转的定义（右键菜单项用） */
function canGoToDefinitionAt(pos: number): boolean {
  const view = viewRef.value
  return view ? definitionTargetAt(view.state, pos, props.dbType ?? '') !== null : false
}

/** 供父组件调用：跳到定义（光标在声明上则跳到第一处引用） */
function goToDefinitionAt(pos: number): boolean {
  const view = viewRef.value
  if (!view) {
    return false
  }
  return goToDefinition(view, pos, { runtime: v => sqlRuntimeFor(v, resolvedCompletionMode()) })
}

/** 跳转到定义（Ctrl/Cmd + 左键、F12） */
function definitionNavExtension(): Extension {
  const mode = resolvedCompletionMode()
  if (props.readonly || (mode !== 'sql' && mode !== 'sql-template')) {
    return []
  }
  return definitionNavigationExtension({ runtime: view => sqlRuntimeFor(view, mode) })
}

/** 光标处符号的引用高亮（只读编辑器同样有用，故不排除 readonly） */
function symbolHighlight(): Extension {
  const mode = resolvedCompletionMode()
  if (mode !== 'sql' && mode !== 'sql-template') {
    return []
  }
  return symbolHighlightExtension({ runtime: view => sqlRuntimeFor(view, mode) })
}

/** 供父组件调用：复制该位置对应表的 CREATE TABLE */
async function copyCreateTableAt(pos: number): Promise<boolean> {
  const view = viewRef.value
  if (!view) {
    return false
  }
  const result = createTableSqlAt(view.state, pos, sqlRuntimeFor(view, resolvedCompletionMode()))
  if (!result) {
    notify.warning('未识别到可建表的物理表')
    return false
  }
  try {
    // 优先数据库自己的 DDL（带索引等完整定义），拿不到才用按元数据生成的那份
    const resolved = await resolveDdl(view, result)
    await copyText(resolved.sql)
    notify.success(
      `已复制 ${result.tableName} 的建表语句（${resolved.source === 'database' ? '来自数据库' : '按元数据生成'}）`,
    )
    return true
  }
  catch (e) {
    notify.error(e instanceof Error ? e.message : String(e))
    return false
  }
}

/**
 * 建表语句的最终来源：数据库原生 DDL 优先，回退到本地生成。
 *
 * 连接上下文取当下的（切库 / 切连接后立即生效），拿不到连接时直接用本地那份。
 */
async function resolveDdl(
  view: EditorView,
  args: { tableName: string, schema: string, sql: string },
): Promise<CreateTableSqlResult> {
  const sql = sqlContextOf(view)
  if (!sql?.connId) {
    return { sql: args.sql, source: 'generated' }
  }
  return resolveCreateTableSql({
    connId: sql.connId,
    database: sql.database,
    dbType: sql.dbType,
    schema: args.schema,
    table: args.tableName,
    generated: args.sql,
  })
}

/**
 * 表结构卡片：标题行（表名 + 复制按钮）、列清单（名称 / 类型 / 注释）、索引区块。
 *
 * DOM 拼装在 utils/sql/hover/tableCard.ts（与补全候选里的「来源表」点击共用）；
 * 这里负责把 SqlTableHover 翻译成 model，并在卡片挂出后**异步补**主外键与索引
 * （数据到了就地重画 —— CM 的 tooltip 会一直挂着宿主元素，重画安全）。
 */
function renderTableHover(view: EditorView, info: SqlTableHover, copyDdl: () => Promise<void>): HTMLElement {
  const host = document.createElement('div')
  const model: TableCardModel = {
    tableName: info.tableName,
    schemaName: info.schemaName || undefined,
    columns: info.columns,
    virtual: info.virtual,
    createTableSql: info.createTableSql || undefined,
    onCopyDdl: copyDdl,
  }
  renderTableCardInto(host, model)

  const sql = sqlContextOf(view)
  if (sql?.connId && !info.virtual) {
    void enrichTableCard(host, model, {
      connId: sql.connId,
      database: sql.database,
      dbType: sql.dbType,
      schema: info.schemaName,
      table: info.tableName,
    })
  }
  return host
}

/**
 * 异步补齐一张表的主外键与索引，并把宿主重画成更全的版本。
 *
 * 三个来源互相独立：主键走 information_schema（rowSql，带缓存）、外键走
 * 元数据 store（同样带缓存）、索引走 information_schema / pg_indexes（带缓存）。
 * 全部失败时卡片保持原样 —— 这些都是展示增强。
 */
async function enrichTableCard(
  host: HTMLElement,
  model: TableCardModel,
  source: { connId: number, database: string, dbType: string, schema: string, table: string },
): Promise<void> {
  const [primaryKeys, foreignKeys, indexes] = await Promise.all([
    fetchPrimaryKeys(
      { connId: source.connId, database: source.database, dbType: source.dbType, sql: '' },
      { schema: source.schema, table: source.table },
      dialectOf(source.dbType),
    ),
    Promise.resolve(metadataStore.loadForeignKeys(source.connId, source.schema || source.database, source.table)),
    fetchTableIndexes(source.connId, source.schema || source.database, source.table, source.dbType),
  ])
  // 悬停可能已经结束（宿主被 CM 摘掉）：不在文档里就不画
  if (!host.isConnected) {
    return
  }
  renderTableCardInto(host, {
    ...model,
    primaryKeys,
    foreignKeys: foreignKeys.map(fk => ({
      column: fk.column,
      referencedTable: fk.referencedTable,
      referencedColumn: fk.referencedColumn,
    })),
    indexes,
  })
}

/**
 * 「补全候选 tips 里点击来源表名」弹出的表结构浮层。
 *
 * 数据口径与悬停一致（同一份元数据缓存 + 同一套加载函数），
 * 区别只在呈现：这里是独立浮层（tableCard.openTableCardPopup），
 * 因为补全弹层的宽度装不下整张表卡片。
 */
function openTableCardFromDetail(view: EditorView, source: string, rect: DOMRect): void {
  const sql = sqlContextOf(view)
  if (!sql?.connId) {
    return
  }
  // 血缘源头表名：`库.表` 或裸表名（见 sqlCompletionColumnPool 的 from 约定）
  const segments = source.split('.')
  const schema = segments.length > 1 ? segments[0]! : ''
  const tableName = segments[segments.length - 1]!
  const columns = defaultMetadataProvider
    .columns(sql.connId, schema || sql.database, tableName)
    .map(column => ({ name: column.name, dataType: column.dataType, comment: column.comment || '' }))
  if (!columns.length) {
    notify.warning(`暂无 ${source} 的结构信息`)
    return
  }

  const dialect = dialectOf(sql.dbType)
  const ddl = generateCreateTableSql(
    createTableModelOf({ schema: schema || undefined, tableName, columns }),
    dialect,
  )
  const model: TableCardModel = {
    tableName,
    schemaName: schema || undefined,
    columns,
    createTableSql: ddl || undefined,
    onCopyDdl: async () => {
      const resolved = await resolveDdl(view, { tableName, schema, sql: ddl })
      await copyText(resolved.sql)
    },
  }
  openTableCardPopup({
    model,
    anchor: { x: rect.left, y: rect.bottom },
    loadExtras: () => enrichTableModel({
      connId: sql.connId,
      database: sql.database,
      dbType: sql.dbType,
      schema,
      table: tableName,
    }),
  })
}

/**
 * 拉一张表的主外键与索引（浮层版的异步补齐）：
 * 与 enrichTableCard 同一套数据来源，只是返回数据而不是就地重画。
 */
async function enrichTableModel(source: {
  connId: number
  database: string
  dbType: string
  schema: string
  table: string
}): Promise<Partial<TableCardModel>> {
  const [primaryKeys, foreignKeys, indexes] = await Promise.all([
    fetchPrimaryKeys(
      { connId: source.connId, database: source.database, dbType: source.dbType, sql: '' },
      { schema: source.schema, table: source.table },
      dialectOf(source.dbType),
    ),
    Promise.resolve(metadataStore.loadForeignKeys(source.connId, source.schema || source.database, source.table)),
    fetchTableIndexes(source.connId, source.schema || source.database, source.table, source.dbType),
  ])
  return {
    primaryKeys,
    foreignKeys: foreignKeys.map(fk => ({
      column: fk.column,
      referencedTable: fk.referencedTable,
      referencedColumn: fk.referencedColumn,
    })),
    indexes,
  }
}

// ---------------------------------------------------------------- 函数参数提示（Ctrl+P）

/** 开 / 关参数提示浮层的效果（值即 CM 的 Tooltip 描述，null 表示关闭） */
const setParameterTip = StateEffect.define<Tooltip | null>()

/**
 * 参数提示的状态字段。
 *
 * 打开后的**跟随**逻辑在 update 里：光标 / 文档一变就重新解析 ——
 * 还在某个（同一个或另一个）函数的参数列表里就跟着走（IDEA 的手感），
 * 走出了参数列表就自动关掉。键位见 baseExtensions 的 keymap。
 */
const parameterTipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(value, tr) {
    const explicit = tr.effects.find(effect => effect.is(setParameterTip))
    if (explicit) {
      return explicit.value
    }
    if (!value) {
      return null
    }
    return parameterTipSpecOf(tr.state)
  },
  provide: field => showTooltip.computeN([field], (state) => {
    const tooltip = state.field(field)
    return tooltip ? [tooltip] : []
  }),
})

/** 由光标位置构造参数提示 tooltip；不在参数列表里返回 null */
function parameterTipSpecOf(state: EditorState): Tooltip | null {
  const info = parameterInfoAt(state.doc.toString(), state.selection.main.head)
  if (!info) {
    return null
  }
  return {
    pos: info.openParen,
    above: true,
    create: () => ({ dom: buildParameterTipCard(info) }),
  }
}

/** Ctrl+P：光标在参数列表里就显示提示。没有命中也要吞掉按键，否则浏览器会弹打印 */
function showParameterInfo(view: EditorView): boolean {
  view.dispatch({ effects: setParameterTip.of(parameterTipSpecOf(view.state)) })
  return true
}

/** Esc 关闭（补全开着时 Esc 先归补全，它的键位注册在更高优先级） */
function closeParameterTip(view: EditorView): boolean {
  if (!view.state.field(parameterTipField, false)) {
    return false
  }
  view.dispatch({ effects: setParameterTip.of(null) })
  return true
}

/**
 * 参数提示卡片：签名行（函数名 + 逐个参数，当前参数高亮）+ 描述 + 返回类型。
 * 数据全部来自函数目录（utils/sql/functionCatalog.ts），这里只负责呈现。
 */
function buildParameterTipCard(info: ReturnType<typeof parameterInfoAt>): HTMLElement {
  const root = document.createElement('div')
  root.className = 'param-tip'
  if (!info) {
    return root
  }

  const signature = document.createElement('div')
  signature.className = 'param-tip__signature'
  const name = document.createElement('span')
  name.className = 'param-tip__name'
  name.textContent = info.doc.name
  signature.appendChild(name)
  signature.appendChild(document.createTextNode('('))

  const lastParamIndex = Math.max(0, info.doc.params.length - 1)
  info.doc.params.forEach((param, index) => {
    if (index > 0) {
      signature.appendChild(document.createTextNode(', '))
    }
    const arg = document.createElement('span')
    arg.className = `param-tip__arg${index === Math.min(info.argIndex, lastParamIndex) ? ' is-active' : ''}`
    arg.textContent = param.optional ? `${param.name}?` : param.name
    signature.appendChild(arg)
  })
  if (info.doc.variadic) {
    signature.appendChild(document.createTextNode(', …'))
  }
  signature.appendChild(document.createTextNode(')'))
  root.appendChild(signature)

  const description = document.createElement('div')
  description.className = 'param-tip__description'
  description.textContent = info.doc.description
  root.appendChild(description)

  if (info.doc.returns) {
    const returns = document.createElement('div')
    returns.className = 'param-tip__returns'
    returns.textContent = `返回 ${info.doc.returns}`
    root.appendChild(returns)
  }
  return root
}

/** 仅 SQL / SQL 模板模式挂载：脚本与日志里没有受支持的函数上下文 */
function parameterInfoExtension(): Extension {
  const mode = resolvedCompletionMode()
  if (mode !== 'sql' && mode !== 'sql-template') {
    return []
  }
  return parameterTipField
}

/**
 * 列候选的描述区（补全列表右侧）：按「类型 · 来源 · 注释」分段渲染。
 *
 * 与悬停卡片同一套视觉语言：来源配表格图标、注释配气泡图标，
 * 两个图标各带一种颜色做标识（颜色在 utils/logLanguage.ts 的主题里），
 * 段与段之间用间距区分 —— 纯文本 detail 只能串成一串 `·`，所以不用它。
 *
 * 刻意**不做列对齐**（固定列宽的表格样式）：对齐要靠截断列名与注释换来，
 * 还会让纯关键字列表无谓变宽 —— 三段顺次跟在列名后面更省空间。
 */
function renderColumnDetail(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
): Node | null {
  const detail = (completion as ColumnCompletion).columnDetail
  if (!detail) {
    // 非列候选（函数 / 关键字 / 表名…）：它们的说明走字符串 detail
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
    const source = detailPart(doc, 'source', TABLE_ICON, detail.from)
    // 来源表可点击：tips 就地转为这张表的结构卡片（独立浮层）
    source.classList.add('cm-column-detail__part--link')
    source.title = '点击查看表结构'
    source.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      openTableCardFromDetail(view, detail.from ?? '', rect)
    })
    root.appendChild(source)
  }
  if (detail.comment) {
    root.appendChild(detailPart(doc, 'comment', COMMENT_ICON, detail.comment))
  }

  return root.childNodes.length ? root : null
}

/**
 * 描述区里带图标的一段。
 *
 * `kind` 只用来给**图标**上色（来源一个颜色、注释一个颜色，见主题）：
 * 一眼扫过就知道哪段是表名、哪段是注释。
 */
function detailPart(
  doc: Document,
  kind: 'source' | 'comment',
  icon: string,
  text: string,
): HTMLElement {
  const part = doc.createElement('span')
  part.className = `cm-column-detail__part cm-column-detail__part--${kind}`

  const glyph = doc.createElement('span')
  glyph.className = 'cm-column-detail__icon'
  // 图标是固定字符串（见常量定义），不含用户输入
  glyph.innerHTML = icon
  part.appendChild(glyph)

  const value = doc.createElement('span')
  // 文字这一层单独给类名：变淡只作用在文字上，图标才能保住颜色（见主题）
  value.className = 'cm-column-detail__value'
  value.textContent = text
  part.appendChild(value)

  return part
}

// ---------------------------------------------------------------- 类型图标

/**
 * 候选类型图标：每个类型一个图标，颜色由 CSS 按类型给（见 utils/logLanguage.ts）。
 *
 * 为什么不用 CM6 自带的类型图标：那些是 `c` / `f` / `λ` 之类的字母
 * （我们本来就 `icons: false` 关掉了），信息量为零，颜色也无从谈起。
 *
 * 类型取值来自各候选族：列 `field`、表 `class`、别名与变量 `variable`、
 * 库 `namespace`、关键字 `keyword`、函数 `function`、模板属性 `property`、
 * 片段与智能项 `text`。**没登记的类型不给图标**（宁缺勿错）。
 */
const TYPE_ICONS: Record<string, string> = {
  // 列（几行文本的轮廓）
  field: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M3.2 4.4h9.6M3.2 8h6.4M3.2 11.6h8"/></svg>',
  // 表（复用悬停卡片那张表格轮廓）
  class: TABLE_ICON,
  // 别名 / 变量（标签）
  variable: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8.8 2.8h4.4v4.4l-5.8 5.8-4.4-4.4z"/><circle cx="11" cy="5" r="0.9"/></svg>',
  // 库（圆柱）
  namespace: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><ellipse cx="8" cy="4.2" rx="4.6" ry="1.9"/><path d="M3.4 4.2v7.6c0 1.05 2.05 1.9 4.6 1.9s4.6-.85 4.6-1.9V4.2"/><path d="M3.4 8c0 1.05 2.05 1.9 4.6 1.9S12.6 9.05 12.6 8"/></svg>',
  // 关键字（钥匙）
  keyword: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><circle cx="5.6" cy="10.4" r="2.6"/><path d="M7.6 8.4 13.2 2.8M10.6 5.4l1.5 1.5"/></svg>',
  // 函数（括号 + 实心点）
  function: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M6.2 2.8C4.7 5.2 4.7 10.8 6.2 13.2M9.8 2.8c1.5 2.4 1.5 8 0 10.4"/><circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none"/></svg>',
  // 模板属性（方括号 + 点）
  property: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M5.6 3.2H3.6v9.6h2M10.4 3.2h2v9.6h-2"/><circle cx="8" cy="8" r="1.3"/></svg>',
  // 片段 / 智能项（四角星）
  text: '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2.4 9.2 6.8 13.6 8 9.2 9.2 8 13.6 6.8 9.2 2.4 8 6.8 6.8z"/></svg>',
}

/**
 * 候选左侧的类型图标（position 20：排在勾选框之后、列名之前）。
 *
 * 每个类型一种颜色（CSS 按 `cm-type-icon--<type>` 上色），
 * 于是「这是列还是表还是关键字」一眼可辨，不用去读「类型」那段文字。
 */
function renderTypeIcon(
  completion: Completion,
  _state: EditorState,
  view: EditorView,
): Node | null {
  // CM6 的 type 允许是多个类名（空格分隔），取第一个当类型
  const kind = (completion.type ?? '').split(/\s+/)[0]
  const icon = TYPE_ICONS[kind]
  if (!icon) {
    return null
  }

  const span = view.dom.ownerDocument.createElement('span')
  span.className = `cm-type-icon cm-type-icon--${kind}`
  span.setAttribute('aria-hidden', 'true')
  // 图标是固定字符串（见 TYPE_ICONS），不含用户输入
  span.innerHTML = icon
  return span
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

  /*
   * 只有「多选列」意图才给复选框：`t.|`、`, |` 是多选，`t.user_id,|`、`t.em|` 是普通单选。
   * 判断完全来自候选身上的 `columnMode`（引擎按光标意图打的标），
   * 这里不再自己看文本或位置。
   */
  if ((completion as ColumnCompletion).columnMode !== 'multi') {
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
 * **只在多选列模式消费**（`t.|`、`, |`）：单选场景（`t.user_id,|`、`t.em|`）里
 * 空格必须原样插入 —— 用户按空格是想分隔，不是想勾选。判定交给
 * `shouldConsumeSpaceForColumn`（纯函数，读候选上的 `columnMode`），
 * 于是「空格归谁」与「有没有复选框」用的是同一个意图。
 */
function toggleCheckedColumn(view: EditorView): boolean {
  const completion = selectedCompletion(view.state)
  if (!completion || !shouldConsumeSpaceForColumn(completionStatus(view.state), completion)) {
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
    // 查找 / 替换 + 选中词同名高亮 + 官方快捷键（见 utils/editorSearch.ts）
    ...editorSearchExtensions(),
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
      // Ctrl+P：函数参数提示。没有命中也吞掉按键 —— 放行会让浏览器弹打印
      { key: 'Ctrl-p', mac: 'Mod-p', run: showParameterInfo },
      // Esc：关参数提示（补全开着时 Esc 由补全的高优先级键位先接走）
      { key: 'Escape', run: closeParameterTip },
      { key: 'Space', run: toggleCheckedColumn },
      /*
       * Tab 先走「模板占位跳转」：块片段插入后条件位与块体是链上的两个占位，
       * 走完（或没有占位）时返回 false，自然落回下面的缩进行为。
       *
       * 开关（设置项 `template_placeholder_tab`）在**按键时**读：改完设置立即生效，
       * 不需要重建编辑器；关掉后 Tab 只剩缩进。
       */
      {
        key: 'Tab',
        run: view => (parsePlaceholderTabJump(configStore.values.template_placeholder_tab)
          ? jumpToNextPlaceholder(view)
          : false),
      },
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
      // 表悬停排在列悬停之前：表名 / 别名位置优先出「表结构」，列位置才落到列卡片
      tableHoverExtension(),
      columnHoverExtension(),
      // Ctrl+P 函数参数提示（仅在 SQL / SQL 模板模式挂载）
      parameterInfoExtension(),
      // 重命名会话（状态 + 装饰 + Enter/Esc + 光标守护）
      renameExtension(),
      // 跳转到定义（Ctrl/Cmd + 左键、F12）
      definitionNavExtension(),
      // 光标处符号的引用高亮
      symbolHighlight(),
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

/**
 * 供父组件调用：只暴露必要的编辑器能力，避免外部直接操作编辑器内部状态。
 *
 * 语义驱动的动作成对暴露：`renameTargetAt` / `canCopyCreateTableAt` 回答
 * 「这里能做什么」，`renameSymbolAt` / `copyCreateTableAt` 真正去做 ——
 * 调用方只需要给一个文档位置，解析、校验与反馈都在编辑器内部完成。
 */
defineExpose({
  insertText,
  setErrors,
  renameSymbolAt,
  renameTargetAt,
  copyCreateTableAt,
  canCopyCreateTableAt,
  goToDefinitionAt,
  canGoToDefinitionAt,
  openSearch,
})
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
 * 列悬停卡片与表结构卡片的样式在 styles/global.css（.column-hover* / .table-hover*）：
 * 它们同时被补全候选的表名点击浮层与结果表头的 #app-tip 富卡片模式复用，
 * 不能留在本组件的 scoped 样式里。
 */

/*
 * 函数参数提示（Ctrl+P，DOM 由 buildParameterTipCard 拼装）。
 * 浮层底色 / 边框 / 圆角 / 阴影由 CM 主题的 .cm-tooltip 提供，这里只排内容；
 * 层次与列悬停卡片一致：签名是主体（函数名加粗、当前参数品牌色下划线），
 * 描述与返回类型小一档弱色。
 */
.code-editor :deep(.param-tip) {
  min-width: 180px;
  max-width: 420px;
  padding: 8px 10px;
  font-size: var(--app-font-size-xs);
  line-height: 1.5;
  user-select: text;
}

.code-editor :deep(.param-tip__signature) {
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  word-break: break-all;
}

.code-editor :deep(.param-tip__name) {
  color: var(--text-color);
  font-weight: 600;
}

.code-editor :deep(.param-tip__arg.is-active) {
  color: var(--brand-color);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.code-editor :deep(.param-tip__description) {
  margin-top: 6px;
  color: var(--text-color);
}

.code-editor :deep(.param-tip__returns) {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: var(--app-font-size-2xs);
}

/*
 * 重命名中的别名：底色高亮 + 下划线，明确「这一段正在被改名」。
 * 与错误波浪线一样只在会话期间存在，不进入常规编辑观感。
 */
.code-editor :deep(.cm-rename-active) {
  border-radius: 3px;
  background: var(--primary-color-soft, rgba(64, 158, 255, 0.18));
  box-shadow: inset 0 -1px 0 var(--primary-color, #409eff);
}

/*
 * 表结构卡片的样式在 styles/global.css（.table-hover*）：
 * 它同时被「补全候选里的表名点击弹出的独立浮层」复用，不能留在 scoped 样式里。
 *
 * 光标处符号的出现位置：声明给稍重的底色，引用轻一档 ——
 * 既能一眼看出「用在哪」，也不至于把代码糊成一片。
 */
.code-editor :deep(.cm-symbol-declaration) {
  border-radius: 3px;
  background: var(--primary-color-soft, rgba(64, 158, 255, 0.22));
}

.code-editor :deep(.cm-symbol-reference) {
  border-radius: 3px;
  background: var(--primary-color-soft, rgba(64, 158, 255, 0.12));
}
</style>
