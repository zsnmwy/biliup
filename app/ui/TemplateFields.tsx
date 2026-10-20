import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { FormFCChild } from '@douyinfe/semi-ui/lib/es/form'
import {
  IconChevronDown,
  IconChevronUp,
  IconMinusCircle,
  IconPlusCircle,
} from '@douyinfe/semi-icons'
import {
  Avatar,
  Button,
  Collapsible,
  Form,
  InputGroup,
  Space,
  Typography,
  ArrayField,
  Notification,
  ScrollList,
  ScrollItem,
  Tabs,
  TabPane,
  Input as RawInput,
  TextArea as RawTextArea,
  // TextArea,
  useFormState,
} from '@douyinfe/semi-ui'
import useSWR from 'swr'
import { BiliType, fetcher, StudioEntity } from '../lib/api-streamer'
import {
  CARD_KIND_OPTIONS,
  LIKE_SUB_TYPE_OPTIONS,
  emptyPersonalCard,
  type PersonalCard,
  type PersonalCardKind,
} from '../lib/personal-cards'
import {
  ADORDER_TYPE_OPTIONS,
  STAFF_TITLE_PRESETS,
  adPromotionIssues,
  chapterIssues,
  chapterClock,
  emptyChapterRow,
  extractBrandCandidates,
  extractIndustryList,
  extractSeasons,
  extractShowTypeList,
  extractStaffCandidates,
  parseChapterText,
  seasonSectionOptions,
  staffIssues,
  type AdTab,
  type StaffCandidate,
  type UploadEnhancementFormOverrides,
} from '../lib/upload-enhancements'
import { useMe } from '../lib/use-me'
import { useBiliUsers, useTypeTree } from '../lib/use-streamers'

/** 把已保存的定时发布延迟 dtime(秒)换算成滚轮的「小时 / 分钟」;没有或不在可选范围内时用默认的 4 小时 0 分 */
function delayFromDtime(dtime: any): { hours: number; minutes: number } {
  if (dtime) {
    const hours = Math.floor(dtime / 3600)
    const minutes = Math.floor((dtime % 3600) / 60)
    if (hours >= 4 && hours < 24 * 15) {
      return { hours, minutes: Math.floor(minutes / 5) * 5 }
    }
  }
  return { hours: 4, minutes: 0 }
}

/** 表单里 personal_cards 以结构化卡片数组编辑，提交时才由各页面 JSON.stringify 成实体上的字符串 */
export type TemplateFieldsValues = Omit<
  StudioEntity,
  'personal_cards' | keyof UploadEnhancementFormOverrides
> & {
  isDtime: boolean
  personal_cards?: PersonalCard[]
  /** 编辑回填时 personal_cards 无法完整解析（JSON 非法或有识别不了的卡片），据此在区块里提示 */
  personal_cards_broken?: boolean
  // 五项投稿增强的结构化字段（加入合集/商业推广/联合投稿/章节/字幕），类型见 UploadEnhancementFormOverrides
  porder_broken?: boolean
  staffs_broken?: boolean
  chapters_broken?: boolean
} & UploadEnhancementFormOverrides

type TemplateFieldsProps = FormFCChild<TemplateFieldsValues> & {
  /** 替换「投稿账号」一栏（Fleet 控制面按节点上报的 mid 选账号，而不是本机的凭据文件） */
  accountField?: React.ReactNode
  /** 分区树拉不到时（本机没有 B 站账号）改为直接填分区 ID，值是数字而不是 [父, 子] */
  plainTid?: boolean
}

const TemplateFields: React.FC<TemplateFieldsProps> = ({
  formState,
  formApi,
  values,
  accountField,
  plainTid,
}) => {
  const {
    Section,
    Input,
    DatePicker,
    TimePicker,
    Select,
    Switch,
    InputNumber,
    Checkbox,
    CheckboxGroup,
    RadioGroup,
    Radio,
    Cascader,
    TagInput,
    TextArea,
  } = Form
  const { Text } = Typography
  const { typeTree, isError, isLoading } = useTypeTree()
  const treeData = typeTree?.map((type: BiliType) => {
    return {
      ...type,
      children: type.children.map(cType => {
        return {
          label: (
            <>
              {cType.name}{' '}
              <Text type="quaternary" size="small">
                {cType.desc}
              </Text>
            </>
          ),
          value: cType.id,
        }
      }),
    }
  })
  const collapsed = (
    <>
      <CheckboxGroup
        field="sound"
        options={[
          { label: '杜比音效', value: 'dolby' },
          { label: 'Hi-Res无损音质', value: 'hires' },
        ]}
        direction="horizontal"
        label="音效设置"
      />
      <CheckboxGroup
        field="interaction"
        options={[
          { label: '关闭弹幕', value: 'up_close_danmu' },
          { label: '关闭评论', value: 'up_close_reply' },
          { label: '开启精选评论', value: 'up_selection_reply' },
        ]}
        direction="horizontal"
        label="互动设置"
      />
      <Input field="dynamic" label="粉丝动态" style={{ width: '100%', maxWidth: 464 }} />
      <Form.Select
        field="uploader"
        label="上传插件"
        initValue={values.uploader ?? 'biliup-rs'}
        style={{ width: '100%', maxWidth: 250 }}
        showClear
      >
        <Form.Select.Option value="bili_web">bili_web</Form.Select.Option>
        <Form.Select.Option value="biliup-rs">biliup-rs</Form.Select.Option>
        <Form.Select.Option value="Noop">Noop</Form.Select.Option>
      </Form.Select>
      <Switch field="no_reprint" label="自制声明" />
      <Switch field="is_only_self" label="仅自己可见" />
      <Form.Switch field="charging_pay" label="开启充电面板" />
      <ArrayField field="credits">
        {({ add, arrayFields }) => (
          <Form.Section text="简介@替换">
            <div className="semi-form-field-extra" style={{ fontSize: '14px' }}>
              如需在简介中@别人，请使用此项。示例：
              <br />
              简介：{'\u007B'}streamer{'\u007D'}主播直播间地址：{'\u007B'}url{'\u007D'} 【@credit】
              <br />
              其中的&quot;@credits&quot;会依次替换为下面输入的@
            </div>
            <Button icon={<IconPlusCircle />} onClick={() => add()} theme="light">
              添加行
            </Button>
            {arrayFields.map(({ field, key, remove }, i) => (
              <div key={key} style={{ width: '100%', display: 'flex' }}>
                <InputGroup>
                  <Input field={`${field}.username`} label="需要@的用户名" placeholder="username" />
                  <Input field={`${field}.uid`} label="需要@的uid" placeholder="uid" />
                </InputGroup>
                <Button
                  type="danger"
                  theme="borderless"
                  icon={<IconMinusCircle />}
                  onClick={remove}
                  style={{ margin: 12 }}
                />
              </div>
            ))}
          </Form.Section>
        )}
      </ArrayField>
    </>
  )
  const [isOpen, setOpen] = useState(false)
  const { biliUsers } = useBiliUsers()
  const list = biliUsers?.map(item => {
    return {
      value: item.value,
      label: (
        <>
          <Avatar size="extra-small" src={item.face} />
          <span style={{ marginLeft: 8 }}>{item.name}</span>
        </>
      ),
    }
  })
  const currentAccount = formApi.getValue('user_cookie')
  const accountOptions =
    currentAccount === 'account:current'
      ? [{ value: currentAccount, label: '保留当前账号' }, ...(list ?? [])]
      : list
  const toggle = () => {
    setOpen(!isOpen)
    formApi.scrollToField('isDtime')
  }
  const scrollStyle = {
    border: 'unset',
    boxShadow: 'unset',
    width: 300,
    height: 300,
  }
  const allowedHoursList = new Array(24 * 15).fill(0).map((_, i) => {
    return {
      value: i,
      text: `${i}小时`,
      disabled: i < 4 || i >= 24 * 15,
    }
  })
  const allowedMinutesList = new Array(60 / 5).fill(0).map((_, i) => {
    return {
      value: i * 5,
      text: `${i * 5}分钟`,
    }
  })
  // 滚轮的初始选中值取自表单里已有的 dtime(编辑模板时)。Semi Form 在构造时就把 initValues 放进
  // store,首次渲染即可读到,直接作为 useState 初始值,不必挂载后在 effect 里再 setState 一轮
  const [selectedHours, setSelectedHours] = useState(() => delayFromDtime(formApi.getValue('dtime')).hours)
  const [selectedMinutes, setSelectedMinutes] = useState(() => delayFromDtime(formApi.getValue('dtime')).minutes)

  // ---- 五项投稿增强（加入合集/商业推广/联合投稿/章节/字幕）的数据源 ----
  // /bili/* 代理需要一个可用的 B 站账号；SWR 按 key 去重，这里的 /bili/archive/pre 与分区树共用同一份请求
  const { can } = useMe()
  const canUseBiliProxy = can('upload.submit')
  const {
    data: seasonsBody,
    error: seasonsError,
    isLoading: seasonsLoading,
  } = useSWR(canUseBiliProxy ? '/bili/seasons' : null, fetcher, { shouldRetryOnError: false })
  const seasons = useMemo(() => extractSeasons(seasonsBody), [seasonsBody])
  const sectionOptions = useMemo(() => seasonSectionOptions(seasons), [seasons])
  const { data: preBody } = useSWR(canUseBiliProxy ? '/bili/archive/pre' : null, fetcher, {
    shouldRetryOnError: false,
  })
  // Semi Select 的 optionList 是 {value, label} 形状，行业/推广形式提取出来是 {id, name}，这里换算
  const industryOptions = useMemo(
    () => extractIndustryList(preBody).map((item) => ({ value: item.id, label: item.name })),
    [preBody],
  )
  const showTypeOptions = useMemo(
    () => extractShowTypeList(preBody).map((item) => ({ value: item.id, label: item.name })),
    [preBody],
  )

  // 商业推广的两个 tab（视频带货/其他）；编辑回填时 initValues 里 ad_tab 指向已有配置的那一侧
  const [adTab, setAdTab] = useState<AdTab>(() => (formApi.getValue('ad_tab') as AdTab | undefined) ?? 'goods')

  // 品牌搜索：勾选「官方合作」后才可用，输入防抖 500ms（与 B 站投稿页一致）
  const [brandKw, setBrandKw] = useState('')
  const [brandKwQuery, setBrandKwQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setBrandKwQuery(brandKw.trim()), 500)
    return () => clearTimeout(timer)
  }, [brandKw])
  const brandOfficial = values.porder_form?.official === true
  const {
    data: brandBody,
    error: brandError,
    isLoading: brandSearching,
  } = useSWR(
    brandOfficial && brandKwQuery ? `/bili/ad/brand/list?brand_name=${encodeURIComponent(brandKwQuery)}` : null,
    fetcher,
    { shouldRetryOnError: false },
  )
  const brandCandidates = useMemo(() => extractBrandCandidates(brandBody), [brandBody])
  const pickBrand = (candidate: { brand_id: number; brand_name: string }) => {
    formApi.setValue('porder_form.brand_name', candidate.brand_name)
    formApi.setValue('porder_form.brand_id', candidate.brand_id)
    formApi.setValue('porder_form.brand_source', 1)
    setBrandKw('')
  }
  // 搜不到品牌时允许手填：brand_source=2，brand_id 留空
  const useManualBrand = () => {
    formApi.setValue('porder_form.brand_name', brandKwQuery)
    formApi.setValue('porder_form.brand_id', null)
    formApi.setValue('porder_form.brand_source', 2)
    setBrandKw('')
  }
  const clearBrand = () => {
    formApi.setValue('porder_form.brand_name', '')
    formApi.setValue('porder_form.brand_id', null)
    formApi.setValue('porder_form.brand_source', null)
    setBrandKw('')
  }

  // 联合投稿成员搜索：输入防抖 400ms，候选点「添加」进 staffs 数组
  const [staffKw, setStaffKw] = useState('')
  const [staffKwQuery, setStaffKwQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setStaffKwQuery(staffKw.trim()), 400)
    return () => clearTimeout(timer)
  }, [staffKw])
  const {
    data: staffBody,
    error: staffError,
    isLoading: staffSearching,
  } = useSWR(staffKwQuery ? `/bili/staff/search?kw=${encodeURIComponent(staffKwQuery)}` : null, fetcher, {
    shouldRetryOnError: false,
  })
  const staffCandidates = useMemo(() => extractStaffCandidates(staffBody), [staffBody])

  // 章节：表格编辑 / 文本导入两种录入方式；导入草稿与解析错误是纯本地状态
  const [chapterMode, setChapterMode] = useState<'table' | 'text'>('table')
  const [chapterText, setChapterText] = useState('')
  const [chapterTextErrors, setChapterTextErrors] = useState<string[]>([])
  const importChapters = () => {
    const { rows, errors } = parseChapterText(chapterText)
    if (errors.length) {
      setChapterTextErrors(errors)
      return
    }
    setChapterTextErrors([])
    formApi.setValue('chapters', rows)
  }
  const switchChapterMode = (mode: 'table' | 'text') => {
    setChapterMode(mode)
    // 首次切到文本导入时，把已编辑的章节行回填成「mm:ss 标题」草稿，避免两边内容对不上
    if (mode === 'text' && !chapterText && Array.isArray(values.chapters)) {
      const draft = values.chapters
        .map(row => (typeof row?.from === 'number' ? `${chapterClock(row.from)} ${row.content ?? ''}` : ''))
        .filter(Boolean)
        .join('\n')
      setChapterText(draft)
    }
  }
  const moveChapter = (index: number, delta: number) => {
    const rows = Array.isArray(values.chapters) ? [...values.chapters] : []
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    ;[rows[index], rows[target]] = [rows[target], rows[index]]
    formApi.setValue('chapters', rows)
  }

  return (
    <>
      <Section text={'基本信息'}>
        <Input
          rules={[{ required: true }]}
          field="template_name"
          label="模板名称"
          style={{ width: '100%', maxWidth: 464 }}
        />
        {accountField ?? (
          <Form.Select
            rules={[{ required: true }]}
            field="user_cookie"
            label={{ text: '投稿账号' }}
            style={{ width: '100%', maxWidth: 176 }}
            optionList={accountOptions}
          />
        )}
      </Section>
      <Section text={'基本设置'}>
        <Input
          field="title"
          label="视频标题"
          style={{ width: '100%', maxWidth: 464 }}
          placeholder="稿件标题"
          extraText={
            <div style={{ fontSize: 14 }}>
              {'\u007B'}streamer{'\u007D'}: 录播备注
              <br />
              {'\u007B'}title{'\u007D'}: 直播标题
              <br />
              %Y-%m-%d %H_%M_%S: 开始录制时的 年-月-日 时_分_秒
            </div>
          }
        />
        <RadioGroup
          field="copyright"
          label="类型"
          direction="vertical"
          initValue={formApi.getValue('copyright') ?? 2}
          extraText={<div style={{ fontSize: 14 }}>如不填写转载来源默认为直播间地址</div>}
        >
          <Radio value={2} style={{ alignItems: 'center', width: '100%' }} addonStyle={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <span style={{ flexShrink: 0 }}>转载</span>
            <Input
              field="copyright_source"
              onClick={() => formApi.setValue('copyright', 2)}
              placeholder="转载视频请注明来源（例：转自http://www.xx.com/yy）注明来源会更快地通过审核哦"
              noLabel
              fieldStyle={{ padding: 0, marginLeft: 12, flex: 1, minWidth: 0, maxWidth: 560 }}
            />
          </Radio>
          <div onClick={() => formApi.setValue('copyright_source', '')}>
            <Radio value={1}>自制</Radio>
          </div>
        </RadioGroup>
        {plainTid ? (
          <InputNumber
            field="tid"
            label="分区 ID"
            style={{ width: '100%', maxWidth: 272 }}
            placeholder="投稿分区 tid"
            extraText="本机没有可用的 B 站账号，拉不到分区列表，请直接填分区 ID"
            rules={[{ required: true }]}
          />
        ) : (
          <Cascader
            field="tid"
            label="分区"
            style={{ width: '100%', maxWidth: 272 }}
            treeData={treeData}
            placeholder="投稿分区"
            dropdownStyle={{ maxWidth: 670 }}
            rules={[{ required: true }]}
          />
        )}
        <InputNumber
          field="tid_v2"
          label="分区 tid_v2"
          style={{ width: '100%', maxWidth: 272 }}
          placeholder="可选，新版分区 ID"
          extraText="对应 B 站 tid_v2；不填则仅使用上方分区"
        />
        <TagInput
          max={12}
          maxLength={20}
          field="tags"
          label="标签"
          allowDuplicates={false}
          addOnBlur={true}
          separator=","
          placeholder="可用英文逗号分隔以批量输入标签，失焦/Enter 以保存"
          style={{ width: '100%', maxWidth: 560 }}
          rules={[{ required: true, message: 'Tag不能为空' }]}
          onExceed={v => {
            Notification.warning({
              title: '标签输入错误',
              position: 'top',
              content: '标签数量不能超过12个',
              duration: 3,
            })
          }}
          onInputExceed={v => {
            Notification.warning({
              title: '标签输入错误',
              position: 'top',
              content: '单个标签字数不能超过20',
              duration: 3,
            })
          }}
        />
        <Input
          field="cover_path"
          label="视频封面"
          style={{ width: '100%', maxWidth: 464 }}
          placeholder="/cover/up.jpg"
        />
        <TextArea
          style={{ width: '100%', maxWidth: 560 }}
          field="description"
          label="简介"
          placeholder="填写更全面的相关信息，让更多的人能找到你的视频吧"
          autosize
          maxCount={2000}
          showClear
        />
        <TextArea
          style={{ width: '100%', maxWidth: 560 }}
          field="extra_fields"
          label="额外字段"
          placeholder="Json格式，示例：{key: 'value'}"
          autosize
          maxCount={2000}
          showClear
          rules={[
            {
              validator: (rule, value) => {
                if (!value) return true;
                try {
                  JSON.parse(value);
                  return true;
                } catch (e) {
                  return false;
                }
              },
              message: '请输入正确的Json格式文本',
            }
          ]}
        />

        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--semi-color-tertiary)' }}>
          <Switch
            field="isDtime"
            label={{ text: '定时发布' }}
            checkedText="｜"
            uncheckedText="〇"
            onChange={checked => {
              // 打开时滚轮已显示一个延迟（默认 4 小时），没点「确认」也按它保存；
              // 否则 dtime 为空，保存后定时发布被悄悄丢掉，再打开开关也是关的
              if (checked && !formApi.getValue('dtime')) {
                formApi.setValue('dtime', selectedHours * 3600 + selectedMinutes * 60)
              }
            }}
          />
          <span style={{ paddingLeft: 12, fontSize: 12 }}>
            (当前+2小时 ≤ 可选时间 ≤
            当前+15天，转载稿件撞车判定以过审发布时间为准。上传速度不佳的机器请谨慎开启，或设置更大的延迟时间。)
          </span>
        </div>
        {values.isDtime ? (
          <ScrollList
            style={scrollStyle}
            header={'延迟时间'}
            footer={
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  const delaySeconds = selectedHours * 3600 + selectedMinutes * 60
                  formApi.setValue('dtime', delaySeconds)
                  Notification.success({
                    title: '保存成功',
                    content: `延迟时间：${selectedHours}小时${selectedMinutes}分钟`,
                    duration: 3,
                    position: 'top',
                  })
                }}
              >
                确认
              </Button>
            }
          >
            <ScrollItem
              mode="wheel"
              cycled={true}
              list={allowedHoursList}
              type={1}
              selectedIndex={allowedHoursList.findIndex(item => item.value === selectedHours)}
              onSelect={item => setSelectedHours(item.value)}
            />
            <ScrollItem
              mode="wheel"
              cycled={true}
              list={allowedMinutesList}
              type={2}
              selectedIndex={allowedMinutesList.findIndex(item => item.value === selectedMinutes)}
              onSelect={item => setSelectedMinutes(item.value)}
            />
          </ScrollList>
        ) : null}
      </Section>

      {/* —— 投稿增强：以下五个区块对应 Rust 模板实体新字段，序列化/回填/校验见 lib/upload-enhancements.ts —— */}
      <Section text="加入合集">
        <Form.Select
          field="section_id"
          label="加入合集"
          optionList={sectionOptions}
          filter
          showClear
          placeholder={seasonsError ? '合集列表加载失败' : seasonsLoading ? '合集列表加载中…' : '选择投稿后要加入的小节'}
          style={{ width: '100%', maxWidth: 464 }}
          extraText="投稿成功后自动加入所选小节（发布后生效，失败不影响投稿）"
        />
        {seasonsError ? (
          <div style={{ fontSize: 14, color: 'var(--semi-color-danger)' }}>
            合集列表加载失败（需要至少一个可用的 B 站账号），可稍后重试；不影响其它配置的保存
          </div>
        ) : null}
      </Section>

      <Section text="商业推广">
        <Checkbox field="ad_enabled" noLabel>
          增加商业推广信息（单稿件仅支持选择一种）
        </Checkbox>
        {values.ad_enabled ? (
          <>
            <Tabs type="button" activeKey={adTab} onChange={key => setAdTab(key as AdTab)}>
              <TabPane tab="视频带货" itemKey="goods" />
              <TabPane tab="其他" itemKey="other" />
            </Tabs>
            {/* 两个 tab 的字段始终挂载、只切换显示：Semi 表单字段卸载时默认会丢值（keepState 在复杂场景下不可靠），
                切 tab 不能清掉用户已填的花火单号或推广信息，互斥校验也要两边都看得到 */}
            <div style={{ display: adTab === 'goods' ? undefined : 'none' }}>
              <InputNumber
                field="adorder_id"
                label="花火单号"
                placeholder="花火商单 / 任务的单号"
                min={0}
                step={1}
                style={{ width: 240 }}
              />
              <Form.Select
                field="adorder_type"
                label="花火类型"
                optionList={ADORDER_TYPE_OPTIONS}
                placeholder="选择单号对应的类型"
                showClear
                style={{ width: 240 }}
              />
              <div style={{ fontSize: 12, color: 'var(--semi-color-tertiary)' }}>
                投稿后再添加商品：投稿成功后请前往【创作中心—收益管理—悬赏带货】配置商品
              </div>
            </div>
            <div style={{ display: adTab === 'other' ? undefined : 'none' }}>
              <Form.Select
                field="porder_form.industry_id"
                label="行业"
                optionList={industryOptions}
                placeholder={
                  industryOptions.length ? '选择推广行业' : '行业列表来自 B 站（需要可用的投稿账号）'
                }
                filter
                showClear
                style={{ width: 240 }}
              />
              <Checkbox
                field="porder_form.official"
                noLabel
                onChange={e => {
                  // 取消官方合作时品牌一并清空（品牌只在官方合作下有意义）
                  if (!e.target.checked) clearBrand()
                }}
              >
                官方合作
              </Checkbox>
              {brandOfficial ? (
                <>
                  <RawInput
                    value={brandKw}
                    onChange={setBrandKw}
                    placeholder="品牌搜索：输入名称，点击候选选择"
                    showClear
                    style={{ width: 360 }}
                  />
                  {values.porder_form?.brand_name ? (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <Text>
                        已选品牌：{values.porder_form.brand_name}
                        {values.porder_form.brand_source === 2 ? '（手动填写）' : ''}
                      </Text>
                      <Button
                        size="small"
                        theme="borderless"
                        type="danger"
                        onClick={clearBrand}
                        style={{ marginLeft: 12 }}
                      >
                        清除
                      </Button>
                    </div>
                  ) : null}
                  {brandKwQuery ? (
                    <div style={{ width: '100%' }}>
                      {brandSearching ? (
                        <Text type="tertiary">品牌搜索中…</Text>
                      ) : brandCandidates.length ? (
                        brandCandidates.map(candidate => (
                          <div
                            key={candidate.brand_id}
                            style={{ display: 'flex', alignItems: 'center', margin: '2px 0' }}
                          >
                            <Text>{candidate.brand_name}</Text>
                            <Button
                              size="small"
                              theme="borderless"
                              onClick={() => pickBrand(candidate)}
                              style={{ marginLeft: 12 }}
                            >
                              选择
                            </Button>
                          </div>
                        ))
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          {brandError ? (
                            <Text type="danger">品牌搜索失败</Text>
                          ) : (
                            <Text type="tertiary">没有搜到相关品牌</Text>
                          )}
                          <Button size="small" theme="borderless" onClick={useManualBrand} style={{ marginLeft: 12 }}>
                            使用「{brandKwQuery}」作为品牌名
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              ) : null}
              <Form.Select
                field="porder_form.show_type"
                label="推广形式"
                optionList={showTypeOptions}
                placeholder={showTypeOptions.length ? '可多选' : '推广形式来自 B 站（需要可用的投稿账号）'}
                multiple
                showClear
                style={{ width: '100%', maxWidth: 464 }}
              />
            </div>
            {/* 互斥与必填在 UI 层先拦：与保存时的校验同一份函数（lib/upload-enhancements.ts） */}
            {adPromotionIssues(values).length ? (
              <div style={{ fontSize: 14, color: 'var(--semi-color-danger)' }}>
                {adPromotionIssues(values).map((issue, index) => (
                  <div key={index}>{issue.message}</div>
                ))}
              </div>
            ) : null}
            {values.porder_broken ? (
              <div style={{ fontSize: 14, color: 'var(--semi-color-warning)' }}>
                已保存的商业推广-其他数据无法完整识别（不是有效的 JSON 或缺少行业 id），已按空数据处理；保存后将覆盖为新内容
              </div>
            ) : null}
          </>
        ) : null}
      </Section>

      <ArrayField field="staffs">
        {({ addWithInitValue, arrayFields }) => (
          <Form.Section text="联合投稿">
            <div className="semi-form-field-extra" style={{ fontSize: '14px' }}>
              投稿成功后按 B 站联合投稿规则生效；与充电面板可能冲突（B 站限制）
            </div>
            {values.staffs_broken ? (
              <div style={{ fontSize: 14, color: 'var(--semi-color-warning)', marginBottom: 12 }}>
                已保存的联合投稿数据无法完整识别（不是有效的 JSON 或参与者缺少 mid），无法识别的部分已丢弃；保存后将覆盖为新内容
              </div>
            ) : null}
            <RawInput
              value={staffKw}
              onChange={setStaffKw}
              placeholder="搜索 B 站成员：输入昵称，点击候选添加"
              showClear
              style={{ width: 360, marginBottom: 8 }}
            />
            {staffKwQuery ? (
              staffSearching ? (
                <Text type="tertiary">成员搜索中…</Text>
              ) : staffError ? (
                <Text type="danger">成员搜索失败（需要至少一个可用的 B 站账号），可稍后重试</Text>
              ) : staffCandidates.length ? (
                <div style={{ width: '100%', marginBottom: 8 }}>
                  {staffCandidates.map((candidate: StaffCandidate) => {
                    const added = (values.staffs ?? []).some(member => member?.mid === candidate.mid)
                    return (
                      <div key={candidate.mid} style={{ display: 'flex', alignItems: 'center', margin: '2px 0' }}>
                        <Avatar size="extra-small" src={candidate.face || '/noface.jpg'} />
                        <span style={{ marginLeft: 8 }}>{candidate.uname || `mid ${candidate.mid}`}</span>
                        <Text type="tertiary" size="small" style={{ marginLeft: 8 }}>
                          mid {candidate.mid}
                          {candidate.title ? ` · ${candidate.title}` : ''}
                        </Text>
                        <Button
                          size="small"
                          theme="borderless"
                          disabled={added}
                          onClick={() => addWithInitValue({ mid: candidate.mid, uname: candidate.uname, title: candidate.title || '' })}
                          style={{ marginLeft: 12 }}
                        >
                          {added ? '已添加' : '添加'}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <Text type="tertiary">没有找到相关用户</Text>
              )
            ) : null}
            {arrayFields.map(({ field, key, remove }, i) => {
              const member = values.staffs?.[i]
              return (
                <div key={key} style={{ width: '100%', display: 'flex', alignItems: 'flex-start' }}>
                  <div style={{ width: 220, paddingTop: 8, wordBreak: 'break-all' }}>
                    <Text>{member?.uname || `mid ${member?.mid ?? ''}`}</Text>
                  </div>
                  <Form.AutoComplete
                    field={`${field}.title`}
                    label="职位"
                    data={STAFF_TITLE_PRESETS}
                    placeholder="选择或输入职位"
                    style={{ width: 200 }}
                  />
                  <Button
                    type="danger"
                    theme="borderless"
                    icon={<IconMinusCircle />}
                    onClick={remove}
                    style={{ marginTop: 32 }}
                  />
                </div>
              )
            })}
            {staffIssues(values).length ? (
              <div style={{ fontSize: 14, color: 'var(--semi-color-danger)' }}>
                {staffIssues(values).map((issue, index) => (
                  <div key={index}>{issue.message}</div>
                ))}
              </div>
            ) : null}
          </Form.Section>
        )}
      </ArrayField>

      <ArrayField field="chapters">
        {({ addWithInitValue, arrayFields }) => (
          <Form.Section text="章节管理">
            <div className="semi-form-field-extra" style={{ fontSize: '14px' }}>
              视频进度条上的分段章节：2-10 段，第一段从 0 秒开始，相邻章节起点至少间隔 5 秒
            </div>
            {values.chapters_broken ? (
              <div style={{ fontSize: 14, color: 'var(--semi-color-warning)', marginBottom: 12 }}>
                已保存的章节数据无法完整识别（不是有效的 JSON 或缺少开始时间），无法识别的部分已丢弃；保存后将覆盖为新内容
              </div>
            ) : null}
            <Tabs
              type="button"
              activeKey={chapterMode}
              onChange={key => switchChapterMode(key === 'text' ? 'text' : 'table')}
              style={{ marginBottom: 12 }}
            >
              <TabPane tab="表格编辑" itemKey="table" />
              <TabPane tab="文本导入" itemKey="text" />
            </Tabs>
            {/* 两种录入方式都保持挂载、只切换显示：切走再切回来时，已编辑的表格行 / 草稿不丢 */}
            <div style={{ width: '100%', marginBottom: 12, display: chapterMode === 'text' ? undefined : 'none' }}>
              <RawTextArea
                value={chapterText}
                onChange={setChapterText}
                placeholder={'每行一条，格式：mm:ss 标题 或 hh:mm:ss 标题\n00:00 开场\n05:30 正片开始\n01:02:00 高潮部分'}
                autosize={{ minRows: 4, maxRows: 10 }}
                style={{ width: '100%', maxWidth: 560 }}
              />
              <div style={{ marginTop: 8 }}>
                <Button icon={<IconPlusCircle />} theme="light" onClick={importChapters}>
                  解析并导入
                </Button>
              </div>
              {chapterTextErrors.length ? (
                <div style={{ fontSize: 14, color: 'var(--semi-color-danger)', marginTop: 8 }}>
                  {chapterTextErrors.map((message, index) => (
                    <div key={index}>{message}</div>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={{ width: '100%', display: chapterMode === 'table' ? undefined : 'none' }}>
              <Button
                icon={<IconPlusCircle />}
                theme="light"
                disabled={arrayFields.length >= 10}
                onClick={() => addWithInitValue(emptyChapterRow())}
                style={{ marginBottom: 12 }}
              >
                添加章节
              </Button>
              {arrayFields.map(({ field, key, remove }, i) => (
                <div key={key} style={{ width: '100%', display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <InputNumber
                    field={`${field}.from`}
                    label="开始（秒）"
                    min={0}
                    step={0.1}
                    placeholder="如 0"
                    style={{ width: 180 }}
                  />
                  <InputNumber
                    field={`${field}.to`}
                    label="结束（秒）"
                    min={0}
                    step={0.1}
                    placeholder="如 65.2"
                    style={{ width: 180, marginLeft: 12 }}
                  />
                  <Input
                    field={`${field}.content`}
                    label="标题"
                    maxLength={16}
                    placeholder="章节标题，最多 16 字"
                    style={{ width: 260, marginLeft: 12 }}
                  />
                  <Button
                    theme="borderless"
                    icon={<IconChevronUp />}
                    onClick={() => moveChapter(i, -1)}
                    disabled={i === 0}
                    style={{ marginTop: 32 }}
                  />
                  <Button
                    theme="borderless"
                    icon={<IconChevronDown />}
                    onClick={() => moveChapter(i, 1)}
                    disabled={i === arrayFields.length - 1}
                    style={{ marginTop: 32 }}
                  />
                  <Button
                    type="danger"
                    theme="borderless"
                    icon={<IconMinusCircle />}
                    onClick={remove}
                    style={{ marginTop: 32 }}
                  />
                </div>
              ))}
            </div>
            {chapterIssues(values).length ? (
              <div style={{ fontSize: 14, color: 'var(--semi-color-danger)' }}>
                {chapterIssues(values).map((issue, index) => (
                  <div key={index}>{issue.message}</div>
                ))}
              </div>
            ) : null}
          </Form.Section>
        )}
      </ArrayField>

      <Section text="字幕设置">
        <Input
          field="subtitle_zh"
          label="中文字幕"
          style={{ width: '100%', maxWidth: 464 }}
          placeholder="服务器本地 .srt/.ass 文件路径"
        />
        <Input
          field="subtitle_en"
          label="英文字幕"
          style={{ width: '100%', maxWidth: 464 }}
          placeholder="服务器本地 .srt/.ass 文件路径"
        />
      </Section>

      <ArrayField field="personal_cards">
        {({ addWithInitValue, arrayFields }) => (
          <Form.Section text="个性化卡片">
            <div className="semi-form-field-extra" style={{ fontSize: '14px' }}>
              投稿时自动挂载互动引导、关联视频、投票弹幕（仅 Web 提交通道生效）
            </div>
            {values.personal_cards_broken ? (
              <div style={{ fontSize: 14, color: 'var(--semi-color-warning)', marginBottom: 12 }}>
                已保存的个性化卡片数据无法完整识别（不是有效的 JSON 或卡片类型未知），已按空数据处理；保存后将覆盖为新内容
              </div>
            ) : null}
            <Button
              icon={<IconPlusCircle />}
              onClick={() => addWithInitValue(emptyPersonalCard('like'))}
              theme="light"
              style={{ marginBottom: 12 }}
            >
              添加卡片
            </Button>
            {arrayFields.map(({ field, key, remove }, i) => {
              const kind: PersonalCardKind = values.personal_cards?.[i]?.kind ?? 'like'
              return (
                <div
                  key={key}
                  style={{
                    width: '100%',
                    marginBottom: 12,
                    padding: '4px 16px 12px',
                    border: '1px solid var(--semi-color-border)',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                    <Form.Select
                      field={`${field}.kind`}
                      label="卡片类型"
                      optionList={CARD_KIND_OPTIONS}
                      style={{ width: 176 }}
                      onChange={value => {
                        // 切到投票弹幕时还没有选项就补两个空位，协议要求至少 2 项
                        const card = values.personal_cards?.[i]
                        if (
                          value === 'vote' &&
                          card &&
                          !Array.isArray((card as { options?: unknown }).options)
                        ) {
                          formApi.setValue(`personal_cards[${i}].options`, ['', ''])
                        }
                      }}
                    />
                    <InputNumber
                      field={`${field}.at`}
                      label="出现时间（秒）"
                      placeholder="卡片出现的秒数，如 30"
                      min={0}
                      step={0.5}
                      style={{ width: 240, marginLeft: 12 }}
                      rules={[
                        {
                          validator: (_rule, value) =>
                            typeof value === 'number' && Number.isFinite(value) && value >= 0,
                          message: '请填写不小于 0 的出现时间（秒）',
                        },
                      ]}
                    />
                    <Button
                      type="danger"
                      theme="borderless"
                      icon={<IconMinusCircle />}
                      onClick={remove}
                      style={{ marginTop: 32 }}
                    />
                  </div>
                  {kind === 'like' ? (
                    <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <Input
                        field={`${field}.msg`}
                        label="引导文案"
                        maxLength={6}
                        placeholder="最多 6 个汉字"
                        style={{ width: 240 }}
                        rules={[
                          { required: true, message: '请填写引导文案' },
                          {
                            validator: (_rule, value) => typeof value === 'string' && value.length <= 6,
                            message: '文案最多 6 个汉字',
                          },
                        ]}
                      />
                      <Form.Select
                        field={`${field}.sub_type`}
                        label="引导类型"
                        optionList={LIKE_SUB_TYPE_OPTIONS}
                        style={{ width: 176, marginLeft: 12 }}
                      />
                      <InputNumber
                        field={`${field}.count_down`}
                        label="倒计时（秒）"
                        min={0}
                        style={{ width: 176, marginLeft: 12 }}
                      />
                      <Checkbox field={`${field}.auto_create`} label="自动创建" style={{ marginLeft: 12 }} />
                    </div>
                  ) : null}
                  {kind === 'related' ? (
                    <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <Input
                        field={`${field}.oid`}
                        label="目标视频"
                        placeholder="BV 号 / av 号 / 链接"
                        style={{ width: 320 }}
                        rules={[{ required: true, message: '请填写目标视频号或链接' }]}
                      />
                      <Input
                        field={`${field}.msg`}
                        label="描述"
                        placeholder="选填，展示在卡片上的说明"
                        style={{ width: 320, marginLeft: 12 }}
                      />
                    </div>
                  ) : null}
                  {kind === 'vote' ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <Input
                          field={`${field}.question`}
                          label="投票问题"
                          maxLength={12}
                          placeholder="最多 12 个字"
                          style={{ width: 320 }}
                          rules={[
                            { required: true, message: '请填写投票问题' },
                            {
                              validator: (_rule, value) => typeof value === 'string' && value.length <= 12,
                              message: '问题最多 12 个字',
                            },
                          ]}
                        />
                        <InputNumber
                          field={`${field}.duration`}
                          label="展示时长（毫秒）"
                          min={0}
                          step={500}
                          style={{ width: 200, marginLeft: 12 }}
                        />
                      </div>
                      <ArrayField field={`${field}.options`}>
                        {({ add: addOption, arrayFields: optionFields }) => (
                          <div style={{ width: '100%' }}>
                            {optionFields.map(({ field: optionField, key: optionKey, remove: removeOption }, oi) => (
                              <div key={optionKey} style={{ display: 'flex', alignItems: 'flex-start' }}>
                                <Input
                                  field={optionField}
                                  label={`选项 ${oi + 1}`}
                                  placeholder={`选项 ${oi + 1}`}
                                  style={{ width: 320 }}
                                  rules={[{ required: true, message: '选项不能为空' }]}
                                />
                                <Button
                                  type="danger"
                                  theme="borderless"
                                  icon={<IconMinusCircle />}
                                  onClick={removeOption}
                                  disabled={optionFields.length <= 2}
                                  style={{ marginTop: 32 }}
                                />
                              </div>
                            ))}
                            <Button
                              icon={<IconPlusCircle />}
                              theme="light"
                              onClick={() => addOption()}
                              disabled={optionFields.length >= 4}
                              style={{ marginTop: 8 }}
                            >
                              添加选项
                            </Button>
                          </div>
                        )}
                      </ArrayField>
                    </>
                  ) : null}
                </div>
              )
            })}
          </Form.Section>
        )}
      </ArrayField>

      <Section
        style={{ paddingBottom: 40 }}
        text={
          <div style={{ cursor: 'pointer' }} onClick={toggle}>
            更多设置{' '}
            {isOpen ? (
              <IconChevronUp style={{ marginLeft: 12 }} />
            ) : (
              <IconChevronDown style={{ marginLeft: 12 }} />
            )}
          </div>
        }
      >
        <Collapsible isOpen={isOpen} keepDOM>
          {collapsed}
        </Collapsible>
      </Section>
    </>
  )
}

export default TemplateFields
