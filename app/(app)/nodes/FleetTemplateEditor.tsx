'use client'
import React, { useMemo, useRef } from 'react'
import { Form, Spin, Toast, Typography } from '@douyinfe/semi-ui'
import type { FormApi, FormFCChild } from '@douyinfe/semi-ui/lib/es/form'
import TemplateFields from '@/app/ui/TemplateFields'
import type { BiliType } from '@/app/lib/api-streamer'
import { useTypeTree } from '@/app/lib/use-streamers'
import { IconPlusCircle } from '@douyinfe/semi-icons'
import { FormPage, usePageLabelPosition } from '@/app/ui/shell'
import {
  createTemplate,
  errorMessage,
  updateTemplate,
  type FleetNode,
  type FleetTemplate,
  type TemplateInput,
} from '@/app/lib/use-fleet'
import { parsePersonalCards, serializePersonalCards } from '@/app/lib/personal-cards'
import {
  enhancementIssues,
  ENHANCEMENT_BLOCK_FIELD,
  parseEnhancementFields,
  serializeEnhancementFields,
} from '@/app/lib/upload-enhancements'
import styles from './page.module.scss'

const { Text } = Typography

type TypeTree = { value: number; children: BiliType[] }[]

/** 模板 → 表单初始值，与「投稿管理 / 编辑模板」同一套换算 */
function toForm(template: FleetTemplate | null, typeTree: TypeTree | undefined) {
  if (!template) return {}
  const parent = typeTree?.find((t) => t.children.some((c) => c.id === template.tid))?.value
  // personal_cards 实体上是 JSON 字符串，表单里以结构化数组编辑；解析失败按空数组处理并提示
  const personalCards = parsePersonalCards(template.personal_cards)
  // 五项投稿增强（合集/商业推广/联合投稿/章节/字幕）同理：JSON 字符串宽容解析，失败置 broken 标志
  const enhancements = parseEnhancementFields(template)
  return {
    ...template,
    ...enhancements,
    tid: typeTree && template.tid !== null ? [parent, template.tid] : (template.tid ?? undefined),
    sound: (template.dolby === 1 ? ['dolby'] : []).concat(template.hires === 1 ? ['hires'] : []),
    interaction: (template.up_close_danmu === 1 ? ['up_close_danmu'] : [])
      .concat(template.up_close_reply === 1 ? ['up_close_reply'] : [])
      .concat(template.up_selection_reply === 1 ? ['up_selection_reply'] : []),
    charging_pay: template.charging_pay === 1,
    no_reprint: template.no_reprint === 1,
    is_only_self: template.is_only_self === 1,
    isDtime: Boolean(template.dtime),
    personal_cards: personalCards.cards,
    personal_cards_broken: personalCards.broken || undefined,
  }
}

function fromForm(values: Record<string, any>): TemplateInput {
  const flag = (list: unknown, key: string) => (Array.isArray(list) && list.includes(key) ? 1 : 0)
  return {
    template_name: values.template_name,
    account_mid: values.account_mid ?? null,
    title: values.title ?? '',
    tid: Array.isArray(values.tid) ? values.tid[1] : (values.tid ?? null),
    tid_v2: values.tid_v2 ?? null,
    copyright: values.copyright ?? null,
    copyright_source: values.copyright_source ?? '',
    cover_path: values.cover_path ?? '',
    description: values.description ?? '',
    dynamic: values.dynamic ?? '',
    tags: values.tags ?? [],
    dolby: flag(values.sound, 'dolby'),
    hires: flag(values.sound, 'hires'),
    up_selection_reply: flag(values.interaction, 'up_selection_reply'),
    up_close_reply: flag(values.interaction, 'up_close_reply'),
    up_close_danmu: flag(values.interaction, 'up_close_danmu'),
    charging_pay: values.charging_pay ? 1 : 0,
    no_reprint: values.no_reprint ? 1 : 0,
    is_only_self: values.is_only_self ? 1 : 0,
    dtime: values.isDtime ? (values.dtime ?? null) : null,
    credits: values.credits ?? null,
    uploader: values.uploader ?? null,
    extra_fields: values.extra_fields ?? '',
    personal_cards: serializePersonalCards(values.personal_cards),
    // 五项投稿增强：结构化表单值序列化成实体上的 JSON 字符串 / 可空标量
    ...serializeEnhancementFields(values),
  }
}

export const FLEET_TEMPLATES_BACK = { href: '/nodes?tab=templates', label: '投稿模板' }

/**
 * 控制面上的投稿模板页：字段与本机「投稿管理」的模板页共用 `TemplateFields` 和同一个页面外壳，
 * 只是「投稿账号」按节点上报的 mid 选（凭据文件留在各节点上）。
 */
export default function FleetTemplateEditor({
  template,
  nodes,
  onSaved,
}: {
  /** null 为新建 */
  template: FleetTemplate | null
  nodes: FleetNode[]
  onSaved: () => void
}) {
  const labelPosition = usePageLabelPosition()
  const api = useRef<FormApi>(undefined)
  const { typeTree, isLoading } = useTypeTree()

  const accounts = useMemo(() => {
    const byMid = new Map<number, { uname: string; nodes: string[] }>()
    for (const node of nodes) {
      for (const account of node.accounts) {
        const entry = byMid.get(account.mid) ?? { uname: account.uname, nodes: [] }
        entry.uname ||= account.uname
        entry.nodes.push(node.name)
        byMid.set(account.mid, entry)
      }
    }
    const options = [...byMid.entries()]
      .sort((a, b) => b[1].nodes.length - a[1].nodes.length || a[0] - b[0])
      .map(([mid, { uname, nodes }]) => ({
        value: mid,
        label: (
          <span className={styles.accountOption}>
            <span>{uname || `mid ${mid}`}</span>
            <Text type="tertiary" size="small">
              {uname ? `mid ${mid} · ` : ''}
              {nodes.join('、')}
            </Text>
          </span>
        ),
      }))
    const current = template?.account_mid
    if (current && !byMid.has(current)) {
      options.push({
        value: current,
        label: (
          <span className={styles.accountOption}>
            <span>mid {current}</span>
            <Text type="danger" size="small">
              没有节点登记这个账号
            </Text>
          </span>
        ),
      })
    }
    return options
  }, [nodes, template])

  const initValues = useMemo(() => toForm(template, typeTree), [template, typeTree])

  const save = async () => {
    const values = await api.current?.validate()
    if (!values) return
    // 商业推广互斥、章节规则等在 UI 层先拦一次（与后端校验一致），有问题时不下发
    const issues = enhancementIssues(values)
    if (issues.length) {
      Toast.error({
        content: (
          <div>
            {issues.map((issue, index) => (
              <div key={index}>{issue.message}</div>
            ))}
          </div>
        ),
        duration: 6,
      })
      api.current?.scrollToField(ENHANCEMENT_BLOCK_FIELD[issues[0].block])
      return
    }
    try {
      const input = fromForm(values)
      if (template) await updateTemplate(template.id, input)
      else await createTemplate(input)
      Toast.success(template ? '模板已保存，已下发到用它的节点' : '模板已创建')
      onSaved()
    } catch (e) {
      Toast.error({ content: errorMessage(e), duration: 6 })
      throw e
    }
  }

  const accountField = (
    <Form.Select
      field="account_mid"
      label={{ text: '投稿账号', optional: true }}
      style={{ width: '100%', maxWidth: 320 }}
      optionList={accounts}
      showClear
      placeholder={accounts.length ? '选择节点上报的账号' : '还没有节点上报 B 站账号'}
      extraText="房间只能派到登记了这个账号的节点；不选则节点上投稿没有账号（配合 Noop 上传插件只录不投）"
    />
  )

  return (
    <FormPage
      title={template ? `编辑投稿模板「${template.template_name}」` : '新建投稿模板'}
      description="Fleet 投稿模板：保存后下发到用它的节点"
      back={FLEET_TEMPLATES_BACK}
      okText={template ? '保存模板' : '创建模板'}
      okIcon={template ? undefined : <IconPlusCircle />}
      onOk={isLoading ? undefined : save}
    >
      {isLoading ? (
        <div className={styles.dialogCenter}>
          <Spin />
        </div>
      ) : (
        <Form
          className={styles.templateForm}
          initValues={initValues}
          getFormApi={(formApi) => (api.current = formApi)}
          labelPosition={labelPosition}
          labelWidth="140px"
          render={(props: FormFCChild<any>) => <TemplateFields {...props} accountField={accountField} plainTid={!typeTree} />}
        />
      )}
    </FormPage>
  )
}
