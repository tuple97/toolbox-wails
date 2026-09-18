/**
 * 补全包（bundle）级的候选族注册表。
 *
 * 与 `sqlSuggestions` 里的候选族注册表同一套写法，但粒度更粗一层：
 * 那里的族都发生在「非点号场景」，这里管的是**整条链路**——
 *
 *  1. `after-dot`：光标前有点号（`u.` / `库.`）时的候选，走 resolveAfterDot；
 *  2. `general`：非点号场景，交给 sqlSuggestions 的候选族注册表；
 *  3. `join-conditions`：`ON |` 位置追加整条关联条件（外键优先，命名启发式兜底）；
 *  4. `group-by`：GROUP BY 位置把 SELECT 里未聚合的列提前（不合适时本身就是空数组）；
 *  5. `smart-items`：`*` 展开 / 比较值 / INSERT 列清单（受 smartItems 开关控制）。
 *
 * 顺序由注册表决定，与改造前 `sqlBundle` 里的书写顺序**逐条对应**，
 * 因此这次拆分是纯结构改动：既有的补全用例一个都不改就该全绿。
 *
 * 为什么值得拆：过去这五件事的顺序与开关散在 `sqlBundle` 里（`options.push` 与
 * `if (…)` 混排），「谁先谁后、谁在什么位置出现」只能靠通读函数体得知；
 * 现在每个族自己声明 `supports`，加一个族 = 注册表里加一项。
 */
import type { Completion } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { CompletionFeatureFlags } from '../sqlCompletion'
import type { CompletionContextKind, SqlCursorText } from '../sqlCursor'
import type { TableRef } from '../sqlSchema'
import {
  generalSuggestions,
  joinConditionSuggestions,
  resolveAfterDot,
  smartSuggestions,
} from '../sqlSuggestions'
import type { SqlSuggestDeps } from '../sqlSuggestions'
import type { SmartColumn } from '../sqlSmartItems'
import type { SqlCompletionSlot } from './sqlCompletionSlot'

/** 一次「候选生成之前」已经算好的全部输入：候选族只读它，不自己去解析 SQL */
export interface BundleContext {
  state: EditorState
  pos: number
  doc: string
  /** 光标所在行的光标之前部分（点号回看用） */
  lineBefore: string
  /** 光标前正在输入的词 */
  word: string
  /** 光标前的限定符段（`u` → `['u']`；没有点号时为 null） */
  qualifier: string[] | null
  /** SQL 光标语义（子句 / 位置类别 / 多选意图 / 关联目标） */
  intent: SqlCursorText
  /** 作用域链（内 → 外） */
  scopes: TableRef[][]
  deps: SqlSuggestDeps
  flags: CompletionFeatureFlags
  /** 槽位（资格过滤与关键字集合都按它算） */
  slot: SqlCompletionSlot
  contextKind: CompletionContextKind
  /** 智能项总开关 */
  smart: boolean
  /** 片段型候选是否可用（会替换既有文本 / 一次插入多列的那些） */
  fragments: boolean
  autoAlias: boolean
  preferredQualifier: string
  /** GROUP BY 的推荐列与「已推荐过、普通列候选里要去掉」的列 */
  promoted: { items: Completion[], skip: Set<string> }
  /** 表引用 → 列清单（派生表用静态列，物理表查元数据） */
  columnsOf: (ref: TableRef) => SmartColumn[]
}

/** 一个补全包级候选族 */
export interface BundleProvider {
  id: string
  supports: (ctx: BundleContext) => boolean
  provide: (ctx: BundleContext) => Completion[]
}

/** 点号路径：光标前有 `u.` / `库.`（来源位置的限定名要库里的表，不当别名解析） */
const afterDotProvider: BundleProvider = {
  id: 'after-dot',
  supports: ctx => ctx.qualifier !== null,
  /*
   * 候选直接来自候选池（数组是共享缓存）：必须复制再交给调用方，
   * 否则后面的 push 会写坏缓存里的那份。
   */
  provide: (ctx) => {
    // supports 已经保证有值；这里再兜一次，免得将来有人绕过 supports 直接调 provide
    const segments = ctx.qualifier
    if (!segments) {
      return []
    }
    return [...resolveAfterDot(
      segments,
      ctx.scopes,
      ctx.deps,
      ctx.word,
      { skipAlias: ctx.slot === 'from-source' },
    )]
  },
}

/** 非点号场景：交给 sqlSuggestions 的候选族注册表 */
const generalProvider: BundleProvider = {
  id: 'general',
  supports: ctx => ctx.qualifier === null,
  provide: ctx => generalSuggestions({
    intent: ctx.intent,
    scopes: ctx.scopes,
    deps: ctx.deps,
    flags: ctx.flags,
    skipColumns: ctx.promoted.skip,
    prefix: ctx.word,
    autoAlias: ctx.autoAlias,
    preferredQualifier: ctx.preferredQualifier,
    slot: ctx.slot,
  }),
}

/**
 * 关联条件：`ON |` 位置追加整条条件（外键 + 命名启发式）。
 *
 * 与普通列候选**并存**：想自己写条件的人照样能挑列名。
 */
const joinConditionProvider: BundleProvider = {
  id: 'join-conditions',
  supports: ctx => ctx.contextKind === 'join-on' && ctx.flags.joinSuggestions !== false,
  provide: ctx => joinConditionSuggestions(ctx.scopes, ctx.deps, ctx.intent.joinTarget),
}

/** GROUP BY 推荐列：位置不对时 `promoted.items` 本身就是空数组 */
const groupByProvider: BundleProvider = {
  id: 'group-by',
  supports: () => true,
  provide: ctx => ctx.promoted.items,
}

/** 智能项：`*` 展开 / 比较值 / INSERT 列清单 */
const smartItemsProvider: BundleProvider = {
  id: 'smart-items',
  supports: ctx => ctx.smart,
  provide: ctx => smartSuggestions({
    intent: ctx.intent,
    pos: ctx.pos,
    scopes: ctx.scopes,
    deps: ctx.deps,
    columnsOf: ctx.columnsOf,
    fragments: ctx.fragments,
  }),
}

/**
 * 默认注册表：顺序 = 候选出现顺序（点号 / 通用 → 关联条件 → GROUP BY 推荐 → 智能项）。
 *
 * 与改造前 `sqlBundle` 里的顺序一致 —— 这是「同一位置多族并存时谁先出现」的唯一依据。
 */
export const DEFAULT_BUNDLE_PROVIDERS: BundleProvider[] = [
  afterDotProvider,
  generalProvider,
  joinConditionProvider,
  groupByProvider,
  smartItemsProvider,
]

/** 跑一遍注册表：`supports` 通过就取它的候选，按注册顺序拼起来 */
export function runBundleProviders(
  ctx: BundleContext,
  providers: BundleProvider[] = DEFAULT_BUNDLE_PROVIDERS,
): Completion[] {
  const out: Completion[] = []
  for (const provider of providers) {
    if (provider.supports(ctx)) {
      out.push(...provider.provide(ctx))
    }
  }
  return out
}
