/**
 * 个性化卡片（B 站投稿的互动引导 / 关联视频 / 投票弹幕）。
 * 模板实体上的 personal_cards 是 JSON 数组字符串（存库为 TEXT），表单里以结构化对象编辑，
 * 提交时序列化、回填时解析，转换逻辑集中在这里供模板表单的组装与回填共用。
 */

export type PersonalCardKind = 'like' | 'related' | 'vote'

/** 互动引导（type=5）：msg ≤6 个汉字必填 */
export interface PersonalCardLike {
	kind: 'like';
	/** 卡片出现的时间点（秒），必填 */
	at: number;
	/** 引导文案，最多 6 个汉字，必填 */
	msg: string;
	/** 引导类型：0 关注 / 1 三连 / 2 关注&三连 / 3 充电 / 4 三连充电 */
	sub_type: number;
	/** 是否自动创建，默认 false */
	auto_create: boolean;
	/** 倒计时（秒），默认 10 */
	count_down: number;
}

/** 关联视频（type=2）：oid 必填 */
export interface PersonalCardRelated {
	kind: 'related';
	at: number;
	/** 目标视频号 / BV 号 / 链接，必填 */
	oid: string;
	/** 描述，可选 */
	msg?: string;
}

/** 投票弹幕（type=9）：question ≤12 字必填，options 2-4 项必填 */
export interface PersonalCardVote {
	kind: 'vote';
	at: number;
	/** 投票问题，最多 12 个字，必填 */
	question: string;
	/** 投票选项，2-4 个非空字符串，必填 */
	options: string[];
	/** 展示时长（毫秒），默认 7000 */
	duration: number;
}

export type PersonalCard = PersonalCardLike | PersonalCardRelated | PersonalCardVote

/** 卡片类型下拉的选项（label 与模板表单文案保持一致） */
export const CARD_KIND_OPTIONS: { value: PersonalCardKind; label: string }[] = [
	{ value: 'like', label: '互动引导' },
	{ value: 'related', label: '关联视频' },
	{ value: 'vote', label: '投票弹幕' },
]

/** 互动引导类型下拉的选项，value 即协议里的 sub_type */
export const LIKE_SUB_TYPE_OPTIONS: { value: number; label: string }[] = [
	{ value: 0, label: '关注' },
	{ value: 1, label: '三连' },
	{ value: 2, label: '关注&三连' },
	{ value: 3, label: '充电' },
	{ value: 4, label: '三连充电' },
]

/** 新增一张卡片时的默认值；vote 预置两个空选项（协议要求至少 2 项） */
export function emptyPersonalCard(kind: PersonalCardKind = 'like'): PersonalCard {
	if (kind === 'related') return { kind: 'related', at: 0, oid: '', msg: '' }
	if (kind === 'vote')
		return { kind: 'vote', at: 0, question: '', options: ['', ''], duration: 7000 }
	return { kind: 'like', at: 0, msg: '', sub_type: 0, auto_create: false, count_down: 10 }
}

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

/** 单张卡片的结构化兜底：kind 不认识或 at 缺失/非法返回 null（调用方丢弃并提示） */
function normalizeCard(item: unknown): PersonalCard | null {
	if (typeof item !== 'object' || item === null) return null
	const raw = item as Record<string, unknown>
	const at = toFiniteNumber(raw.at, NaN)
	if (!Number.isFinite(at) || at < 0) return null
	if (raw.kind === 'like') {
		const subType = toFiniteNumber(raw.sub_type, 0)
		return {
			kind: 'like',
			at,
			msg: toText(raw.msg),
			sub_type: Number.isInteger(subType) && subType >= 0 && subType <= 4 ? subType : 0,
			auto_create: raw.auto_create === true,
			count_down: toFiniteNumber(raw.count_down, 10),
		}
	}
	if (raw.kind === 'related') {
		const card: PersonalCardRelated = { kind: 'related', at, oid: toText(raw.oid) }
		const msg = toText(raw.msg)
		if (msg) card.msg = msg
		return card
	}
	if (raw.kind === 'vote') {
		const options = Array.isArray(raw.options) ? raw.options.map(option => toText(option)) : []
		return {
			kind: 'vote',
			at,
			question: toText(raw.question),
			options,
			duration: toFiniteNumber(raw.duration, 7000),
		}
	}
	return null
}

/**
 * 把模板实体上的 personal_cards 字符串解析成表单可编辑的卡片数组。
 * 宽容处理：空串/null 视为未配置；JSON 非法、不是数组或个别卡片无法识别时，
 * 无法识别的部分按空数组丢弃并置 broken=true，由 UI 提示而不是 crash。
 */
export function parsePersonalCards(raw: unknown): { cards: PersonalCard[]; broken: boolean } {
	if (raw === null || raw === undefined || raw === '') return { cards: [], broken: false }
	let parsed: unknown
	try {
		parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
	} catch {
		return { cards: [], broken: true }
	}
	if (!Array.isArray(parsed)) return { cards: [], broken: true }
	const cards: PersonalCard[] = []
	for (const item of parsed) {
		const card = normalizeCard(item)
		if (card) cards.push(card)
	}
	return { cards, broken: cards.length !== parsed.length }
}

/**
 * 把表单里的卡片数组序列化成 personal_cards 字符串。按 kind 只保留各自的字段
 * （切换过类型后残留的旧字段不会带出去），没有有效卡片时返回空串，与 extra_fields 的空值约定一致。
 */
export function serializePersonalCards(cards: unknown): string {
	if (!Array.isArray(cards)) return ''
	const output: PersonalCard[] = []
	for (const item of cards) {
		if (typeof item !== 'object' || item === null) continue
		const raw = item as Record<string, unknown>
		const at = toFiniteNumber(raw.at, 0)
		if (raw.kind === 'like') {
			const subType = toFiniteNumber(raw.sub_type, 0)
			output.push({
				kind: 'like',
				at,
				msg: toText(raw.msg),
				sub_type: Number.isInteger(subType) && subType >= 0 && subType <= 4 ? subType : 0,
				auto_create: raw.auto_create === true,
				count_down: toFiniteNumber(raw.count_down, 10),
			})
		} else if (raw.kind === 'related') {
			const card: PersonalCardRelated = { kind: 'related', at, oid: toText(raw.oid) }
			const msg = toText(raw.msg)
			if (msg) card.msg = msg
			output.push(card)
		} else if (raw.kind === 'vote') {
			output.push({
				kind: 'vote',
				at,
				question: toText(raw.question),
				options: Array.isArray(raw.options) ? Array.from(raw.options, option => toText(option)) : [],
				duration: toFiniteNumber(raw.duration, 7000),
			})
		}
	}
	return output.length ? JSON.stringify(output) : ''
}
