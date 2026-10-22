/**
 * 投稿增强配置：加入合集 / 商业推广（花火带货 + 其他）/ 联合投稿 / 章节管理 / 字幕设置。
 *
 * 模板实体上 porder、staffs、chapters 是 JSON 字符串（存库 TEXT，空串表示未配置），
 * adorder_id、adorder_type、subtitle_zh、subtitle_en、section_id 是可空标量。
 * 表单里全部以结构化值编辑：提交时用 serializeEnhancementFields 序列化，
 * 回填时用 parseEnhancementFields 宽容解析（解析失败置 broken 标志由 UI 提示，不 crash）。
 * 本文件保持纯函数、不依赖 React，本机模板页 / Fleet 模板页 / TemplateFields 共用。
 */

// ---------- 实体侧的 JSON 形状 ----------

/** 商业推广-其他（实体 porder 字段的 JSON 对象）；flow_id 由后端补齐，UI 不传 */
export interface PorderInfo {
	industry_id: number
	/** 0 非官方 / 1 官方合作 */
	official: number
	brand_name?: string
	brand_id?: number
	/** 1 搜索选中已有品牌 / 2 手动填写品牌名 */
	brand_source?: number
	/** 推广形式 id 的逗号串 */
	show_type?: string
}

/** 联合投稿参与者（实体 staffs 数组元素） */
export interface StaffEntry {
	title: string
	mid: number
}

/** 章节（实体 chapters 数组元素），单位秒 */
export interface ChapterEntry {
	from: number
	to: number
	content: string
}

// ---------- 表单侧的结构化形状 ----------

/** 商业推广-其他在表单里的结构化值（提交时拼成 PorderInfo 再 stringify） */
export interface PorderFormValue {
	industry_id?: number | null
	official?: boolean
	brand_name?: string
	brand_id?: number | null
	brand_source?: number | null
	/** 推广形式多选的 id，序列化时拼成逗号串 */
	show_type?: number[]
}

/** 联合投稿参与者在表单里的值；uname 只用于展示，序列化时只保留 title + mid */
export interface StaffFormValue {
	mid: number
	uname: string
	title: string
}

/** 章节行在表单里的值；from/to 允许小数，未填为 null（由校验拦下） */
export interface ChapterFormRow {
	from: number | null
	to: number | null
	content: string
}

/** 商业推广的两个 tab（照 B 站投稿页：视频带货 / 其他） */
export type AdTab = 'goods' | 'other'

/**
 * 表单里与实体同名字段的结构化覆盖：实体上是 JSON 字符串 / 可空标量，
 * 表单里是结构化对象数组 / 可空标量。TemplateFieldsValues 用它覆盖 StudioEntity。
 */
export interface UploadEnhancementFormOverrides {
	section_id?: number | null
	ad_enabled?: boolean
	ad_tab?: AdTab
	adorder_id?: number | null
	adorder_type?: number | null
	porder_form?: PorderFormValue
	staffs?: StaffFormValue[]
	chapters?: ChapterFormRow[]
	subtitle_zh?: string | null
	subtitle_en?: string | null
}

// ---------- 常量选项 ----------

/** 花火单类型（adorder_type）的中文名 */
export const ADORDER_TYPE_OPTIONS: { value: number; label: string }[] = [
	{ value: 0, label: '商单' },
	{ value: 1, label: '任务' },
	{ value: 2, label: '带货' },
	{ value: 3, label: '广告合伙人' },
	{ value: 4, label: '招募' },
	{ value: 5, label: 'CPVV' },
]

/** 联合投稿职位的常见预设，可自定义输入 */
export const STAFF_TITLE_PRESETS: string[] = ['出演', '策划', '配音', '手书', '审核', '剪辑']

// ---------- 基础取值 ----------

function toText(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

function toFiniteNumber(value: unknown, fallback: number): number {
	const n =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim() !== ''
				? Number(value)
				: NaN
	return Number.isFinite(n) ? n : fallback
}

function isPositiveInteger(value: number): boolean {
	return Number.isInteger(value) && value > 0
}

// tsconfig 目标是 ES2017，字面量 \p{...} 会被 tsc 拒绝（需要 ES2018+），用 RegExp 构造等价表达式
const EMOJI_PATTERN = new RegExp('\\p{Extended_Pictographic}', 'u')

/** 标题里是否包含 emoji（B 站章节标题不允许） */
export function containsEmoji(text: string): boolean {
	return EMOJI_PATTERN.test(text)
}

// ---------- B 站透传响应的兼容提取 ----------
// 服务端对 /bili/seasons、/bili/staff/search、/bili/ad/brand/list 基本是 B 站原样透传，
// 包装层级与字段名在不同接口间不一致，这里统一做宽容提取。

/** 在透传响应里找「第一个数组」：数组本身、data/result/list/items 字段，或它们的嵌套 */
export function extractBiliList(body: unknown): unknown[] {
	if (Array.isArray(body)) return body
	if (typeof body !== 'object' || body === null) return []
	const record = body as Record<string, unknown>
	for (const key of ['data', 'result', 'list', 'items']) {
		const value = record[key]
		if (Array.isArray(value)) return value
		if (value !== null && typeof value === 'object') {
			const nested = extractBiliList(value)
			if (nested.length) return nested
		}
	}
	return []
}

/** 在嵌套对象里按多个候选键找列表（archive/pre 的行业与推广形式在 data.porder 下） */
function pickListByKey(body: unknown, keys: string[], depth = 0): unknown[] | null {
	if (depth > 4 || typeof body !== 'object' || body === null) return null
	const record = body as Record<string, unknown>
	for (const key of keys) {
		if (Array.isArray(record[key])) return record[key]
	}
	for (const next of ['data', 'porder', 'result']) {
		const found = pickListByKey(record[next], keys, depth + 1)
		if (found) return found
	}
	return null
}

function normalizeNameId(item: unknown): { id: number; name: string } | null {
	if (typeof item !== 'object' || item === null) return null
	const raw = item as Record<string, unknown>
	const id = toFiniteNumber(raw.id ?? raw.industry_id, NaN)
	if (!Number.isInteger(id)) return null
	const name = toText(raw.name ?? raw.industry_name).trim()
	return { id, name: name || String(id) }
}

/** GET /bili/archive/pre 响应里的行业列表（industry_list，只有 {id, name}） */
export function extractIndustryList(pre: unknown): { id: number; name: string }[] {
	const list = pickListByKey(pre, ['industry_list']) ?? []
	return Array.from(list, normalizeNameId).filter((item): item is { id: number; name: string } => item !== null)
}

/** GET /bili/archive/pre 响应里的推广形式列表（showtype_list，只有 {id, name}） */
export function extractShowTypeList(pre: unknown): { id: number; name: string }[] {
	const list = pickListByKey(pre, ['showtype_list', 'show_type_list']) ?? []
	return Array.from(list, normalizeNameId).filter((item): item is { id: number; name: string } => item !== null)
}

export interface SeasonSection {
	id: number
	title: string
}

export interface SeasonOption {
	id: number
	title: string
	sections: SeasonSection[]
}

/** GET /bili/seasons 响应：合集与其小节（加入合集下拉的数据源） */
export function extractSeasons(body: unknown): SeasonOption[] {
	const seasons: SeasonOption[] = []
	for (const item of extractBiliList(body)) {
		if (typeof item !== 'object' || item === null) continue
		const raw = item as Record<string, unknown>
		const id = toFiniteNumber(raw.id, NaN)
		if (!Number.isInteger(id)) continue
		const sections: SeasonSection[] = []
		for (const section of Array.isArray(raw.sections) ? raw.sections : []) {
			if (typeof section !== 'object' || section === null) continue
			const sectionRaw = section as Record<string, unknown>
			const sectionId = toFiniteNumber(sectionRaw.id, NaN)
			if (!Number.isInteger(sectionId)) continue
			sections.push({ id: sectionId, title: toText(sectionRaw.title) || `小节 ${sectionId}` })
		}
		seasons.push({ id, title: toText(raw.title) || `合集 ${id}`, sections })
	}
	return seasons
}

/** 合集 → 下拉选项：展示「合集标题 / 小节标题」，值是小节 id */
export function seasonSectionOptions(seasons: SeasonOption[]): { value: number; label: string }[] {
	const options: { value: number; label: string }[] = []
	for (const season of seasons) {
		for (const section of season.sections) {
			options.push({ value: section.id, label: `${season.title} / ${section.title}` })
		}
	}
	return options
}

export interface StaffCandidate {
	mid: number
	uname: string
	/** B 站返回的默认职位建议，可为空 */
	title: string
	face?: string
}

/** GET /bili/staff/search 响应：联合投稿成员候选（B 站透传，字段名做兼容提取） */
export function extractStaffCandidates(body: unknown): StaffCandidate[] {
	const candidates: StaffCandidate[] = []
	for (const item of extractBiliList(body)) {
		if (typeof item !== 'object' || item === null) continue
		const raw = item as Record<string, unknown>
		const mid = toFiniteNumber(raw.mid ?? raw.id, NaN)
		if (!isPositiveInteger(mid)) continue
		candidates.push({
			mid,
			uname: toText(raw.uname ?? raw.name ?? raw.author ?? raw.nickname),
			title: toText(raw.title ?? raw.pos ?? raw.position),
			face: toText(raw.face) || undefined,
		})
	}
	return candidates
}

export interface BrandCandidate {
	brand_id: number
	brand_name: string
}

/** GET /bili/ad/brand/list 响应：品牌候选（B 站透传，字段名做兼容提取） */
export function extractBrandCandidates(body: unknown): BrandCandidate[] {
	const candidates: BrandCandidate[] = []
	for (const item of extractBiliList(body)) {
		if (typeof item !== 'object' || item === null) continue
		const raw = item as Record<string, unknown>
		const brandId = toFiniteNumber(raw.brand_id ?? raw.id, NaN)
		const brandName = toText(raw.brand_name ?? raw.name).trim()
		if (!isPositiveInteger(brandId) || !brandName) continue
		candidates.push({ brand_id: brandId, brand_name: brandName })
	}
	return candidates
}

// ---------- 商业推广-其他（porder） ----------

export function emptyPorderForm(): PorderFormValue {
	return { industry_id: null, official: false, brand_name: '', brand_id: null, brand_source: null, show_type: [] }
}

/** 「其他」tab 里是否已经配置了任何内容（决定要不要做必填校验、要不要提示互斥） */
export function hasPorderContent(form: unknown): boolean {
	if (typeof form !== 'object' || form === null) return false
	const raw = form as Record<string, unknown>
	if (Number.isInteger(toFiniteNumber(raw.industry_id, NaN))) return true
	if (raw.official === true) return true
	if (toText(raw.brand_name).trim()) return true
	if (isPositiveInteger(toFiniteNumber(raw.brand_id, NaN))) return true
	return Array.isArray(raw.show_type) && raw.show_type.length > 0
}

/**
 * 把模板实体上的 porder 字符串解析成表单值。
 * 宽容处理：空视为未配置；JSON 非法、不是对象或 industry_id 读不出来时 broken=true，
 * 由 UI 提示「保存后将覆盖」，避免编辑一次就悄悄改坏。
 */
export function parsePorderForm(raw: unknown): { form: PorderFormValue; present: boolean; broken: boolean } {
	if (raw === null || raw === undefined || raw === '') {
		return { form: emptyPorderForm(), present: false, broken: false }
	}
	let parsed: unknown
	try {
		parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
	} catch {
		return { form: emptyPorderForm(), present: true, broken: true }
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return { form: emptyPorderForm(), present: true, broken: true }
	}
	const record = parsed as Record<string, unknown>
	const industryId = toFiniteNumber(record.industry_id, NaN)
	const brandId = toFiniteNumber(record.brand_id, NaN)
	const brandSource = toFiniteNumber(record.brand_source, NaN)
	const showTypes =
		typeof record.show_type === 'string'
			? record.show_type
					.split(',')
					.map((part) => Number(part.trim()))
					.filter((n) => Number.isInteger(n) && n >= 0)
			: Array.isArray(record.show_type)
				? Array.from(record.show_type, (n) => toFiniteNumber(n, NaN)).filter((n) => Number.isInteger(n) && n >= 0)
				: []
	return {
		form: {
			industry_id: Number.isInteger(industryId) ? industryId : null,
			official: record.official === 1 || record.official === true,
			brand_name: toText(record.brand_name),
			brand_id: isPositiveInteger(brandId) ? brandId : null,
			brand_source: brandSource === 1 || brandSource === 2 ? brandSource : null,
			show_type: showTypes,
		},
		present: true,
		broken: !Number.isInteger(industryId),
	}
}

/** 表单值 → 实体 porder 字符串；没有行业 id（组不出合法对象）或什么都没填时返回空串 */
export function serializePorderForm(form: unknown): string {
	if (typeof form !== 'object' || form === null) return ''
	const raw = form as Record<string, unknown>
	const industryId = toFiniteNumber(raw.industry_id, NaN)
	if (!Number.isInteger(industryId) || industryId < 0) return ''
	const official = raw.official === true
	const brandName = toText(raw.brand_name).trim()
	const brandId = toFiniteNumber(raw.brand_id, NaN)
	const brandSource = toFiniteNumber(raw.brand_source, NaN)
	const showTypes = Array.isArray(raw.show_type)
		? Array.from(raw.show_type, (n) => toFiniteNumber(n, NaN)).filter((n) => Number.isInteger(n) && n >= 0)
		: []
	const porder: PorderInfo = { industry_id: industryId, official: official ? 1 : 0 }
	if (brandName) porder.brand_name = brandName
	if (isPositiveInteger(brandId)) porder.brand_id = brandId
	if (brandSource === 1 || brandSource === 2) porder.brand_source = brandSource
	if (showTypes.length) porder.show_type = showTypes.join(',')
	return JSON.stringify(porder)
}

// ---------- 联合投稿（staffs） ----------

/**
 * 把模板实体上的 staffs 字符串解析成表单值。宽容处理：空视为未配置；
 * JSON 非法、不是数组或个别参与者缺 mid 时，能识别的照常带回并置 broken=true。
 */
export function parseStaffForm(raw: unknown): { staffs: StaffFormValue[]; broken: boolean } {
	if (raw === null || raw === undefined || raw === '') return { staffs: [], broken: false }
	let parsed: unknown
	try {
		parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
	} catch {
		return { staffs: [], broken: true }
	}
	if (!Array.isArray(parsed)) return { staffs: [], broken: true }
	const staffs: StaffFormValue[] = []
	for (const item of parsed) {
		if (typeof item !== 'object' || item === null) continue
		const record = item as Record<string, unknown>
		const mid = toFiniteNumber(record.mid, NaN)
		if (!isPositiveInteger(mid)) continue
		staffs.push({ mid, uname: toText(record.uname), title: toText(record.title) })
	}
	return { staffs, broken: staffs.length !== parsed.length }
}

/** 表单值 → 实体 staffs 字符串（只有 {title, mid}）；没有有效参与者时返回空串 */
export function serializeStaffForm(list: unknown): string {
	if (!Array.isArray(list)) return ''
	const staffs: StaffEntry[] = []
	for (const item of list) {
		if (typeof item !== 'object' || item === null) continue
		const record = item as Record<string, unknown>
		const mid = toFiniteNumber(record.mid, NaN)
		if (!isPositiveInteger(mid)) continue
		staffs.push({ title: toText(record.title).trim(), mid })
	}
	return staffs.length ? JSON.stringify(staffs) : ''
}

// ---------- 章节（chapters） ----------

export function emptyChapterRow(): ChapterFormRow {
	return { from: null, to: null, content: '' }
}

/**
 * 把模板实体上的 chapters 字符串解析成表单行。宽容处理：空视为未配置；
 * JSON 非法、不是数组或个别章节缺 from 时，能识别的照常带回并置 broken=true。
 * 结束时间缺失的行保留为 null，交由章节校验在保存前拦下。
 */
export function parseChapterRows(raw: unknown): { rows: ChapterFormRow[]; broken: boolean } {
	if (raw === null || raw === undefined || raw === '') return { rows: [], broken: false }
	let parsed: unknown
	try {
		parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
	} catch {
		return { rows: [], broken: true }
	}
	if (!Array.isArray(parsed)) return { rows: [], broken: true }
	const rows: ChapterFormRow[] = []
	for (const item of parsed) {
		if (typeof item !== 'object' || item === null) continue
		const record = item as Record<string, unknown>
		const from = toFiniteNumber(record.from, NaN)
		if (!Number.isFinite(from) || from < 0) continue
		const to = toFiniteNumber(record.to, NaN)
		rows.push({
			from,
			to: Number.isFinite(to) ? to : null,
			content: toText(record.content),
		})
	}
	return { rows, broken: rows.length !== parsed.length }
}

/** 表单行 → 实体 chapters 字符串；开始/结束时间不完整的行丢弃，一条有效都没有时返回空串 */
export function serializeChapterRows(rows: unknown): string {
	if (!Array.isArray(rows)) return ''
	const chapters: ChapterEntry[] = []
	for (const item of rows) {
		if (typeof item !== 'object' || item === null) continue
		const record = item as Record<string, unknown>
		const from = toFiniteNumber(record.from, NaN)
		const to = toFiniteNumber(record.to, NaN)
		if (!Number.isFinite(from) || from < 0 || !Number.isFinite(to) || to <= from) continue
		chapters.push({ from, to, content: toText(record.content).trim() })
	}
	return chapters.length ? JSON.stringify(chapters) : ''
}

/** "mm:ss" 或 "hh:mm:ss" → 秒；不合法的写法返回 null */
export function parseChapterClock(text: string): number | null {
	const trimmed = text.trim()
	if (!/^\d{1,3}(:\d{1,2}){1,2}$/.test(trimmed)) return null
	const parts = trimmed.split(':').map(Number)
	if (parts.length === 2) {
		const [minutes, seconds] = parts
		return seconds > 59 ? null : minutes * 60 + seconds
	}
	const [hours, minutes, seconds] = parts
	return minutes > 59 || seconds > 59 ? null : hours * 3600 + minutes * 60 + seconds
}

/** 秒 → "mm:ss"（不足 1 小时）或 "hh:mm:ss"；用于把已有章节回填成文本导入的格式 */
export function chapterClock(seconds: number): string {
	const total = Math.max(0, Math.round(seconds))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const secs = total % 60
	const hh = String(hours).padStart(2, '0')
	const mm = String(minutes).padStart(2, '0')
	const ss = String(secs).padStart(2, '0')
	return hours ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * 文本导入：每行 `mm:ss 标题` 或 `hh:mm:ss 标题`，空行跳过。
 * 每段结束时间取下一行的起点；最后一段留空（null）由用户补填。
 * 行级错误（时间、标题、emoji）或章节级校验不过时 errors 非空，调用方不应写入表单。
 */
export function parseChapterText(text: string): { rows: ChapterFormRow[]; errors: string[] } {
	const errors: string[] = []
	const marks: { from: number; content: string }[] = []
	const lines = text.split(/\r?\n/)
	let lineNo = 0
	for (const line of lines) {
		lineNo += 1
		const trimmed = line.trim()
		if (!trimmed) continue
		const splitAt = trimmed.search(/\s/)
		if (splitAt < 0) {
			errors.push(`第 ${lineNo} 行：格式应为「mm:ss 标题」`)
			continue
		}
		const clockText = trimmed.slice(0, splitAt)
		const from = parseChapterClock(clockText)
		if (from === null) {
			errors.push(`第 ${lineNo} 行：无法识别的时间「${clockText}」`)
			continue
		}
		const content = trimmed.slice(splitAt).trim()
		if (!content) {
			errors.push(`第 ${lineNo} 行：标题不能为空`)
			continue
		}
		if (content.length > 16) {
			errors.push(`第 ${lineNo} 行：标题不能超过 16 个字`)
			continue
		}
		if (containsEmoji(content)) {
			errors.push(`第 ${lineNo} 行：标题不能包含 emoji`)
			continue
		}
		marks.push({ from, content })
	}
	if (errors.length) return { rows: [], errors }
	if (!marks.length) return { rows: [], errors: ['请至少填写一行章节'] }
	const rows: ChapterFormRow[] = marks.map((mark, index) => ({
		from: mark.from,
		to: index + 1 < marks.length ? marks[index + 1].from : null,
		content: mark.content,
	}))
	// 最后一段的结束时间本来就设计成留空由用户补填，导入时不算错误
	return { rows, errors: validateChapters(rows, { allowOpenEnd: true }) }
}

/**
 * 章节的硬校验（与 B 站文本导入规则对齐）：2-10 段、第一段 from=0、
 * 相邻起点间隔 ≥5 秒、标题非空 ≤16 字、拒绝 emoji、每段结束时间必须大于开始时间。
 * 没有配置章节（空数组）时不产生错误。`allowOpenEnd` 允许最后一段暂缺结束时间（文本导入后的中间态），
 * 保存前仍按默认的严格模式校验。
 */
export function validateChapters(rows: unknown, options?: { allowOpenEnd?: boolean }): string[] {
	if (!Array.isArray(rows) || rows.length === 0) return []
	const allowOpenEnd = options?.allowOpenEnd === true
	const issues: string[] = []
	if (rows.length < 2) issues.push('章节至少需要 2 段')
	if (rows.length > 10) issues.push('章节最多 10 段')
	const fromOf = (row: unknown): number | null => {
		const from = toFiniteNumber((row as Record<string, unknown> | null)?.from, NaN)
		return Number.isFinite(from) ? from : null
	}
	rows.forEach((row, index) => {
		const no = index + 1
		const record = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
		const from = fromOf(row)
		const to = toFiniteNumber(record.to, NaN)
		const openEnd = allowOpenEnd && !Number.isFinite(to) && index === rows.length - 1
		if (from === null || from < 0) issues.push(`第 ${no} 段缺少合法的开始时间（秒）`)
		if (!Number.isFinite(to)) {
			if (!openEnd) issues.push(`第 ${no} 段缺少结束时间（秒）`)
		} else if (from !== null && to <= from) issues.push(`第 ${no} 段结束时间必须大于开始时间`)
		const content = toText(record.content).trim()
		if (!content) issues.push(`第 ${no} 段标题不能为空`)
		else if (content.length > 16) issues.push(`第 ${no} 段标题不能超过 16 个字`)
		else if (containsEmoji(content)) issues.push(`第 ${no} 段标题不能包含 emoji`)
	})
	const firstFrom = fromOf(rows[0])
	if (firstFrom !== null && firstFrom !== 0) issues.push('第一段章节必须从 0 秒开始')
	for (let index = 1; index < rows.length; index += 1) {
		const previous = fromOf(rows[index - 1])
		const current = fromOf(rows[index])
		if (previous !== null && current !== null && current - previous < 5) {
			issues.push(`第 ${index + 1} 段与上一段的开始时间间隔至少 5 秒`)
		}
	}
	return issues
}

// ---------- 标量字段 ----------

/** 花火单号：正整数，否则视为未填 */
export function toAdorderId(value: unknown): number | null {
	const n = toFiniteNumber(value, NaN)
	return isPositiveInteger(n) ? n : null
}

/** 花火单类型：0-5 的整数，否则视为未选 */
export function toAdorderType(value: unknown): number | null {
	const n = toFiniteNumber(value, NaN)
	return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null
}

/** 合集小节 id：正整数，否则视为未选 */
export function toSectionId(value: unknown): number | null {
	const n = toFiniteNumber(value, NaN)
	return isPositiveInteger(n) ? n : null
}

/** 字幕文件路径：去首尾空白后非空才有值 */
export function toSubtitlePath(value: unknown): string | null {
	const text = toText(value).trim()
	return text || null
}

// ---------- 校验与互斥 ----------

/** 校验问题归属的区块，页面用它决定保存被拦时滚动到哪里 */
export type EnhancementIssueBlock = 'ad' | 'staff' | 'chapter'

export interface EnhancementIssue {
	block: EnhancementIssueBlock
	message: string
}

export const ENHANCEMENT_BLOCK_FIELD: Record<EnhancementIssueBlock, string> = {
	ad: 'ad_enabled',
	staff: 'staffs',
	chapter: 'chapters',
}

/** 校验函数关心的那一小撮表单值，避免依赖整个表单的类型 */
export interface EnhancementFormSnapshot {
	copyright?: unknown
	is_only_self?: unknown
	charging_pay?: unknown
	ad_enabled?: unknown
	adorder_id?: unknown
	adorder_type?: unknown
	porder_form?: unknown
	staffs?: unknown
	chapters?: unknown
}

/** 「商业推广-其他」组内部的必填校验（配置了一部分才算配置） */
export function porderFormIssues(form: unknown): string[] {
	if (!hasPorderContent(form)) return []
	const issues: string[] = []
	const raw = (typeof form === 'object' && form !== null ? form : {}) as Record<string, unknown>
	if (!Number.isInteger(toFiniteNumber(raw.industry_id, NaN))) issues.push('商业推广-其他：请选择推广行业')
	if (raw.official === true && !toText(raw.brand_name).trim()) {
		issues.push('商业推广-其他：勾选官方合作后请搜索选择或手动填写品牌')
	}
	if (!Array.isArray(raw.show_type) || raw.show_type.length === 0) {
		issues.push('商业推广-其他：请至少选择一种推广形式')
	}
	return issues
}

/**
 * 商业推广（花火 + 其他）的问题清单，含 UI 层互斥：
 * - 其他 与 仅自己可见/充电面板 互斥
 * - 花火单号 与 其他 互斥
 * - 花火（单号或类型）与 转载（copyright=2）互斥
 * - 花火类型除带货（type=2，即「投稿后再添加商品」的悬赏带货）外必须与单号一起填
 * 关闭商业推广开关时其余残留值不参与校验（序列化时也会全部丢弃）。
 */
export function adPromotionIssues(values: EnhancementFormSnapshot | null | undefined): EnhancementIssue[] {
	if (values?.ad_enabled !== true) return []
	const issues: EnhancementIssue[] = []
	const porder = serializePorderForm(values.porder_form)
	const adorderId = toAdorderId(values.adorder_id)
	const adorderType = toAdorderType(values.adorder_type)
	const flagOn = (value: unknown) => value === true || value === 1
	if (porder && (flagOn(values.is_only_self) || flagOn(values.charging_pay))) {
		issues.push({ block: 'ad', message: '仅自己可见/开启充电的稿件不支持商业推广' })
	}
	if (porder && adorderId !== null) {
		issues.push({ block: 'ad', message: '商业推广与花火商单不能同时配置' })
	}
	if ((adorderId !== null || adorderType !== null) && values.copyright === 2) {
		issues.push({ block: 'ad', message: '花火带货不支持转载稿件' })
	}
	if (adorderId !== null && adorderType === null) {
		issues.push({ block: 'ad', message: '已填花火单号，请选择花火类型' })
	}
	if (adorderId === null && adorderType !== null && adorderType !== 2) {
		issues.push({
			block: 'ad',
			message: '该花火类型需要填写花火单号；带货（投稿后再添加商品）可不填单号',
		})
	}
	for (const message of porderFormIssues(values.porder_form)) {
		issues.push({ block: 'ad', message })
	}
	return issues
}

/** 联合投稿的问题清单：每个已添加的参与者都要有职位 */
export function staffIssues(values: EnhancementFormSnapshot | null | undefined): EnhancementIssue[] {
	const list = Array.isArray(values?.staffs) ? values.staffs : []
	const issues: EnhancementIssue[] = []
	list.forEach((item, index) => {
		const record = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
		if (toText(record.title).trim()) return
		const name = toText(record.uname).trim() || `mid ${toText(record.mid) || '?'}`
		issues.push({ block: 'staff', message: `请为参与者「${name}」选择或输入职位` })
	})
	return issues
}

/** 章节的问题清单 */
export function chapterIssues(values: EnhancementFormSnapshot | null | undefined): EnhancementIssue[] {
	return validateChapters(values?.chapters).map((message) => ({ block: 'chapter' as const, message }))
}

/** 五个增强能力的全部校验问题；保存前检查，非空则禁止提交 */
export function enhancementIssues(values: EnhancementFormSnapshot | null | undefined): EnhancementIssue[] {
	return [...adPromotionIssues(values), ...staffIssues(values), ...chapterIssues(values)]
}

// ---------- 实体 ⇆ 表单 的整体转换 ----------

/** 提交模板时发给后端的八个增强字段 */
export interface SerializedEnhancements {
	porder: string
	adorder_id: number | null
	adorder_type: number | null
	staffs: string
	chapters: string
	subtitle_zh: string | null
	subtitle_en: string | null
	section_id: number | null
}

/**
 * 表单值 → 实体字段。商业推广开关关闭时花火与 porder 全部丢弃；
 * staffs、chapters、porder 没有有效内容时存空串（与 extra_fields 的空值约定一致）。
 */
export function serializeEnhancementFields(values: EnhancementFormSnapshot | null | undefined): SerializedEnhancements {
	const raw = (typeof values === 'object' && values !== null ? values : {}) as EnhancementFormSnapshot &
		Record<string, unknown>
	const enabled = raw.ad_enabled === true
	return {
		porder: enabled ? serializePorderForm(raw.porder_form) : '',
		adorder_id: enabled ? toAdorderId(raw.adorder_id) : null,
		adorder_type: enabled ? toAdorderType(raw.adorder_type) : null,
		staffs: serializeStaffForm(raw.staffs),
		chapters: serializeChapterRows(raw.chapters),
		subtitle_zh: toSubtitlePath(raw.subtitle_zh),
		subtitle_en: toSubtitlePath(raw.subtitle_en),
		section_id: toSectionId(raw.section_id),
	}
}

export interface ParsedEnhancements extends UploadEnhancementFormOverrides {
	porder_broken?: boolean
	staffs_broken?: boolean
	chapters_broken?: boolean
}

/**
 * 模板实体 → 表单初始值。porder / staffs / chapters 宽容解析并携带 broken 标志；
 * ad_enabled 按实体里是否已有花火或 porder 推断，ad_tab 优先停在「其他」便于看到已有配置。
 */
export function parseEnhancementFields(entity: unknown): ParsedEnhancements {
	const raw = (typeof entity === 'object' && entity !== null ? entity : {}) as Record<string, unknown>
	const porder = parsePorderForm(raw.porder)
	const staffs = parseStaffForm(raw.staffs)
	const chapters = parseChapterRows(raw.chapters)
	const adorderId = toAdorderId(raw.adorder_id)
	return {
		section_id: toSectionId(raw.section_id),
		ad_enabled: porder.present || adorderId !== null || toAdorderType(raw.adorder_type) !== null,
		ad_tab: porder.present ? 'other' : 'goods',
		adorder_id: adorderId,
		adorder_type: toAdorderType(raw.adorder_type),
		porder_form: porder.form,
		porder_broken: porder.broken || undefined,
		staffs: staffs.staffs,
		staffs_broken: staffs.broken || undefined,
		chapters: chapters.rows,
		chapters_broken: chapters.broken || undefined,
		subtitle_zh: toText(raw.subtitle_zh),
		subtitle_en: toText(raw.subtitle_en),
	}
}
