'use client'
import React, { useRef } from 'react'
import { Form, Toast, Notification, Typography } from '@douyinfe/semi-ui'
import { FormApi } from '@douyinfe/semi-ui/lib/es/form'
import { IconPlusCircle } from '@douyinfe/semi-icons'
import { sendRequest, StudioEntity } from '../../../lib/api-streamer'
import { serializePersonalCards } from '../../../lib/personal-cards'
import {
  enhancementIssues,
  ENHANCEMENT_BLOCK_FIELD,
  serializeEnhancementFields,
} from '../../../lib/upload-enhancements'
import useSWRMutation from 'swr/mutation'
import { useRouter } from 'next/navigation'
import TemplateFields from '../../../ui/TemplateFields'
import { FormPage, usePageLabelPosition } from '@/app/ui/shell'

export default function Add() {
  const { Paragraph } = Typography
  const { trigger } = useSWRMutation('/v1/upload/streamers', sendRequest)
  const router = useRouter()
  const api = useRef<FormApi>(undefined)
  const labelPosition = usePageLabelPosition()

  const handleCreate = async () => {
    const values = await api.current?.validate()
    if (!values) return
    // 商业推广互斥、章节规则、联合投稿职位等在 UI 层先拦一次；有问题就不发请求并滚到对应区块
    const issues = enhancementIssues(values)
    if (issues.length) {
      Notification.error({
        title: '投稿配置有误，未保存',
        content: (
          <div>
            {issues.map((issue, index) => (
              <div key={index}>{issue.message}</div>
            ))}
          </div>
        ),
        position: 'top',
      })
      api.current?.scrollToField(ENHANCEMENT_BLOCK_FIELD[issues[0].block])
      return
    }
    try {
      const studioEntity: StudioEntity = {
        template_name: values.template_name,
        user_cookie: values.user_cookie,
        copyright: values.copyright,
        id: values.id,
        copyright_source: values.copyright_source ?? '',
        tid: values.tid[1],
        tid_v2: values.tid_v2 ?? null,
        cover_path: values.cover_path ?? '',
        title: values.title ?? '',
        description: values.description ?? '',
        dynamic: values.dynamic ?? '',
        tags: values.tags ?? [],
        dolby: values.sound?.includes('dolby') ? 1 : 0,
        hires: values.sound?.includes('hires') ? 1 : 0,
        up_selection_reply: values.interaction?.includes('up_selection_reply') ? 1 : 0,
        up_close_reply: values.interaction?.includes('up_close_reply') ? 1 : 0,
        up_close_danmu: values.interaction?.includes('up_close_danmu') ? 1 : 0,
        charging_pay: values.charging_pay ? 1 : 0,
        no_reprint: values.no_reprint ? 1 : 0,
        is_only_self: values.is_only_self ? 1 : 0,
        mission_id: values.mission_id,
        dtime: values.isDtime ? values?.dtime : null,
        credits: values.credits,
        uploader: values.uploader,
        extra_fields: values.extra_fields ?? '',
        // 表单里是结构化卡片数组，这里序列化成实体上的 JSON 字符串；没有卡片时存空串
        personal_cards: serializePersonalCards(values.personal_cards),
        // 五项投稿增强（加入合集/商业推广/联合投稿/章节/字幕）：结构化表单值序列化成实体字段
        ...serializeEnhancementFields(values),
      }
      await trigger(studioEntity)
      Toast.success('创建成功')
      router.push('/upload-manager')
    } catch (e: any) {
      Notification.error({
        title: '创建失败',
        content: <Paragraph style={{ maxWidth: 450 }}>{e.message}</Paragraph>,
        style: { width: 'min-content' },
      })
      throw e
    }
  }

  return (
    <FormPage
      title="新建投稿模板"
      description="配置投稿模板,保存后可用于上传录制文件"
      back={{ href: '/upload-manager', label: '投稿管理' }}
      okText="创建模板"
      okIcon={<IconPlusCircle />}
      onOk={handleCreate}
    >
      <Form
        autoScrollToError
        onSubmit={handleCreate}
        component={TemplateFields}
        getFormApi={(formApi) => (api.current = formApi)}
        labelWidth="140px"
        labelPosition={labelPosition}
      />
    </FormPage>
  )
}
