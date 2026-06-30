import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { QaConfig } from '@shared/types'
import { DEFAULT_QA_CONFIG } from '@shared/types'
import { useStore } from '../store'
import { Button } from './Button'
import { CloseIcon, GearIcon, SparkleIcon, CheckIcon, AlertIcon } from './icons'

export function ConfigModal(): JSX.Element | null {
  const open = useStore((s) => s.configOpen)
  const setConfigOpen = useStore((s) => s.setConfigOpen)
  const config = useStore((s) => s.config)
  const saveConfig = useStore((s) => s.saveConfig)
  const saving = useStore((s) => !!s.busyKeys['saveConfig'])

  const authStatus = useStore((s) => s.authStatus)
  const setAuthSecret = useStore((s) => s.setAuthSecret)
  const generateAuthSetup = useStore((s) => s.generateAuthSetup)
  const savingSecret = useStore((s) => !!s.busyKeys['setAuthSecret'])
  const generatingSetup = useStore((s) => !!s.busyKeys['generateAuthSetup'])

  const rules = useStore((s) => s.rules)
  const saveRule = useStore((s) => s.saveRule)
  const savingRule = useStore((s) => !!s.busyKeys['saveRule'])

  const knownWorld = useStore((s) => s.knownWorld)
  const analyzeSeed = useStore((s) => s.analyzeSeed)
  const generateSeed = useStore((s) => s.generateSeed)
  const saveKnownWorld = useStore((s) => s.saveKnownWorld)
  const analyzingSeed = useStore((s) => !!s.busyKeys['analyzeSeed'])
  const generatingSeed = useStore((s) => !!s.busyKeys['generateSeed'])
  const savingKW = useStore((s) => !!s.busyKeys['saveKnownWorld'])
  const [seedEnabled, setSeedEnabled] = useState(!!config?.seed?.enabled)
  const [kwDraft, setKwDraft] = useState('')

  const [form, setForm] = useState<QaConfig>(config ?? DEFAULT_QA_CONFIG)
  const [authEnabled, setAuthEnabled] = useState(!!config?.auth?.enabled)
  const [password, setPassword] = useState('')
  const [selectedRule, setSelectedRule] = useState('')
  const [ruleDraft, setRuleDraft] = useState('')

  // 모달이 열릴 때 현재 설정으로 초기화
  useEffect(() => {
    if (open) {
      setForm(config ?? DEFAULT_QA_CONFIG)
      setAuthEnabled(!!config?.auth?.enabled)
      setSeedEnabled(!!config?.seed?.enabled)
      setPassword('')
    }
  }, [open, config])

  // known-world 가 로드/변경되면 draft 동기화
  useEffect(() => {
    if (open) setKwDraft(knownWorld)
  }, [open, knownWorld])

  // 규칙 목록이 로드되면 첫 파일 선택
  useEffect(() => {
    if (open && rules.length > 0 && !rules.some((r) => r.name === selectedRule)) {
      setSelectedRule(rules[0].name)
    }
  }, [open, rules, selectedRule])

  // 선택된 규칙 파일이 바뀌면 draft 동기화
  useEffect(() => {
    const cur = rules.find((r) => r.name === selectedRule)
    setRuleDraft(cur?.content ?? '')
  }, [selectedRule, rules])

  if (!open) return null

  function update<K extends keyof QaConfig>(key: K, value: QaConfig[K]): void {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function updateAuth(key: keyof NonNullable<QaConfig['auth']>, value: string): void {
    setForm((f) => ({
      ...f,
      auth: { enabled: true, loginUrl: '', user: '', ...f.auth, [key]: value }
    }))
  }

  function buildConfig(): QaConfig {
    const next: QaConfig = { ...form }
    if (!authEnabled) {
      delete next.auth
    } else {
      next.auth = { loginUrl: '', user: '', ...next.auth, enabled: true }
    }
    next.seed = { setupCommand: '', ...next.seed, enabled: seedEnabled }
    return next
  }

  function updateSeed(setupCommand: string): void {
    setForm((f) => ({ ...f, seed: { enabled: f.seed?.enabled ?? true, setupCommand } }))
  }

  async function handleAnalyzeSeed(): Promise<void> {
    const suggested = await analyzeSeed()
    if (suggested) updateSeed(suggested)
  }

  async function handleGenerateSeed(): Promise<void> {
    const command = await generateSeed()
    if (command) {
      setSeedEnabled(true)
      updateSeed(command) // 생성한 시드 스크립트를 setup 명령으로 자동 설정
    }
  }

  function handleSave(): void {
    void saveConfig(buildConfig())
  }

  function handleSaveSecret(): void {
    const pw = password.trim()
    if (!pw) return
    void setAuthSecret(pw).then(() => setPassword(''))
  }

  const currentRuleContent = rules.find((r) => r.name === selectedRule)?.content ?? ''
  const loginUrl = form.auth?.loginUrl ?? ''
  const user = form.auth?.user ?? ''
  const hasSecret = !!authStatus?.hasSecret
  const hasSetupSpec = !!authStatus?.hasSetupSpec
  const encryptionUnavailable = authStatus?.encryptionAvailable === false
  const canGenerateSetup =
    authEnabled && loginUrl.trim() !== '' && user.trim() !== '' && hasSecret

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setConfigOpen(false)
      }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]" />

      <div className="no-drag relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl animate-[popIn_0.18s_ease-out]">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand-soft ring-1 ring-brand/30">
              <GearIcon width={15} height={15} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text">실행 설정</h2>
              <p className="text-[11px] text-muted">dev 서버 구동 및 인증 정보</p>
            </div>
          </div>
          <button
            onClick={() => setConfigOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <Field label="dev 서버 실행 명령" hint="예: npm run dev">
            <Input value={form.devCommand} onChange={(v) => update('devCommand', v)} mono />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="준비 확인 URL" hint="서버 기동 폴링 대상">
              <Input value={form.readyUrl} onChange={(v) => update('readyUrl', v)} mono />
            </Field>
            <Field label="테스트 baseURL">
              <Input value={form.baseURL} onChange={(v) => update('baseURL', v)} mono />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="준비 대기 시간 (ms)" hint="서버 기동 최대 대기 시간">
              <Input
                type="number"
                value={String(form.readyTimeoutMs)}
                onChange={(v) => update('readyTimeoutMs', Number(v) || 0)}
                mono
              />
            </Field>
            <Field label="실패 N개 시 중단" hint="0이면 끝까지 실행">
              <Input
                type="number"
                value={String(form.maxFailures ?? 0)}
                onChange={(v) => update('maxFailures', Number(v) || 0)}
                mono
              />
            </Field>
          </div>

          {/* 로그인 (선택) */}
          <div className="rounded-xl border border-border bg-surface-2/40 p-4">
            <label className="flex cursor-pointer items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text">로그인 (선택)</p>
                <p className="text-[11px] text-muted">테스트 전 자동 로그인이 필요한 경우</p>
              </div>
              <Toggle checked={authEnabled} onChange={setAuthEnabled} />
            </label>

            {authEnabled && (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                {encryptionUnavailable && (
                  <div className="flex items-start gap-2.5 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2.5">
                    <AlertIcon className="mt-0.5 shrink-0 text-warn" width={15} height={15} />
                    <p className="text-[11.5px] leading-relaxed text-warn">
                      이 머신에서는 안전한 비밀번호 암호화 저장을 사용할 수 없습니다. 로그인 셋업이
                      정상 동작하지 않을 수 있습니다.
                    </p>
                  </div>
                )}

                <Field label="로그인 URL">
                  <Input value={loginUrl} onChange={(v) => updateAuth('loginUrl', v)} mono />
                </Field>
                <Field label="아이디 / 이메일">
                  <Input value={user} onChange={(v) => updateAuth('user', v)} />
                </Field>

                <Field label="비밀번호">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Input type="password" value={password} onChange={setPassword} />
                    </div>
                    <Button
                      variant="secondary"
                      loading={savingSecret}
                      loadingText="저장 중…"
                      disabled={password.trim() === ''}
                      onClick={handleSaveSecret}
                    >
                      비밀번호 저장
                    </Button>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
                    {hasSecret ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <CheckIcon width={12} height={12} /> 저장됨 ✓
                      </span>
                    ) : (
                      '비밀번호는 설정 파일이 아닌 암호화된 별도 저장소에 보관됩니다.'
                    )}
                  </p>
                </Field>

                <div className="rounded-lg border border-border bg-bg/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-text">
                        로그인 셋업
                        {hasSetupSpec && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-normal text-ok">
                            <CheckIcon width={12} height={12} /> 생성됨 ✓
                          </span>
                        )}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      icon={<SparkleIcon width={14} height={14} />}
                      loading={generatingSetup}
                      loadingText="생성 중…"
                      disabled={!canGenerateSetup}
                      title={
                        canGenerateSetup
                          ? undefined
                          : '로그인 URL · 아이디 · 비밀번호를 먼저 입력/저장하세요'
                      }
                      onClick={() => void generateAuthSetup(buildConfig())}
                    >
                      로그인 셋업 생성 (AI)
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">
                    AI가 로그인 페이지를 읽어 자동 로그인 셋업을 만들고, 실행 시 1회 로그인 후
                    세션을 재사용합니다.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 시드 데이터 (선택) */}
          <div className="rounded-xl border border-border bg-surface-2/40 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text">시드 데이터 (선택)</p>
                <p className="text-[11px] text-muted">
                  결정적 상태(known-world)로 데이터 의존 테스트를 잠금해제
                </p>
              </div>
              <Toggle checked={seedEnabled} onChange={setSeedEnabled} />
            </div>

            <div className="mt-4 space-y-4 border-t border-border pt-4">
              <Field label="시드 (AI)" hint="분석은 읽기만 · 생성은 시드 스크립트 작성">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    icon={<SparkleIcon width={14} height={14} />}
                    loading={analyzingSeed}
                    loadingText="분석 중…"
                    onClick={() => void handleAnalyzeSeed()}
                  >
                    시드 분석
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<SparkleIcon width={14} height={14} />}
                    loading={generatingSeed}
                    loadingText="생성 중…"
                    onClick={() => void handleGenerateSeed()}
                  >
                    시드 데이터 생성
                  </Button>
                  <span className="text-[11px] text-muted">
                    스키마를 읽어 .qa/seed/seed.mjs 작성 → setup 명령 자동 설정
                  </span>
                </div>
              </Field>

              {seedEnabled && (
                <Field
                  label="시드 setup 명령"
                  hint="⚠️ 테스트 DB 를 가리키게 (dev DB 날아감 주의)"
                >
                  <Input
                    value={form.seed?.setupCommand ?? ''}
                    onChange={updateSeed}
                    mono
                  />
                </Field>
              )}

              <Field label="known-world (시드 결정적 상태)" hint="생성 프롬프트에 주입됨">
                <textarea
                  value={kwDraft}
                  onChange={(e) => setKwDraft(e.target.value)}
                  spellCheck={false}
                  rows={6}
                  placeholder="시드 분석을 누르거나 직접 작성하세요 (계정·핵심 데이터 개수·ID 등)"
                  className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-[12px] leading-relaxed text-text outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
                />
                <div className="mt-1.5 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={savingKW}
                    loadingText="저장 중…"
                    disabled={kwDraft === knownWorld}
                    onClick={() => void saveKnownWorld(kwDraft)}
                  >
                    known-world 저장
                  </Button>
                </div>
              </Field>
            </div>
          </div>

          {/* QA 규칙 (.qa/rules/*) — 단계별로 쪼갠 가드레일 */}
          <div className="rounded-xl border border-border bg-surface-2/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-text">
                  <SparkleIcon width={14} height={14} className="text-brand-soft" />
                  QA 규칙 (단계별)
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                  각 AI 단계에 해당하는 규칙만 주입됩니다. scope 가 적용 단계를 결정합니다.
                </p>
              </div>
              <Button
                variant="secondary"
                loading={savingRule}
                loadingText="저장 중…"
                disabled={!selectedRule || ruleDraft === currentRuleContent}
                onClick={() => selectedRule && void saveRule(selectedRule, ruleDraft)}
              >
                규칙 저장
              </Button>
            </div>

            {/* 파일 탭 */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {rules.map((r) => {
                const active = r.name === selectedRule
                return (
                  <button
                    key={r.name}
                    onClick={() => setSelectedRule(r.name)}
                    className={[
                      'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
                      active
                        ? 'border-brand/60 bg-brand/15 text-text'
                        : 'border-border bg-bg/40 text-muted hover:text-text'
                    ].join(' ')}
                    title={`적용 단계: ${r.scope}`}
                  >
                    <span className="font-mono">{r.name}</span>
                    <span className="rounded bg-surface-2 px-1 text-[10px] text-brand-soft">
                      {r.scope}
                    </span>
                  </button>
                )
              })}
            </div>

            <textarea
              value={ruleDraft}
              onChange={(e) => setRuleDraft(e.target.value)}
              spellCheck={false}
              rows={10}
              placeholder={rules.length === 0 ? '프로젝트를 연결하면 규칙이 생성됩니다.' : ''}
              className="mt-3 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2.5 font-mono text-[12px] leading-relaxed text-text outline-none transition-colors focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={() => setConfigOpen(false)}>
            취소
          </Button>
          <Button variant="primary" loading={saving} loadingText="저장 중…" onClick={handleSave}>
            저장
          </Button>
        </footer>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn { from { opacity: 0; transform: translateY(8px) scale(0.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label className="text-xs font-medium text-text">{label}</label>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Input({
  value,
  onChange,
  type = 'text',
  mono = false
}: {
  value: string
  onChange: (v: string) => void
  type?: 'text' | 'number' | 'password'
  mono?: boolean
}): JSX.Element {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className={[
        'h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm text-text',
        'outline-none transition-colors placeholder:text-muted',
        'focus:border-brand/60 focus:ring-2 focus:ring-brand/20',
        mono ? 'font-mono text-[12.5px]' : ''
      ].join(' ')}
    />
  )
}

function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-brand' : 'bg-surface-2 ring-1 ring-border'
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        ].join(' ')}
      />
    </button>
  )
}
