import { useEffect, useState, type JSX } from 'react'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState } from './common'
import { DocIcon, UploadIcon, CloseIcon, TrashIcon } from './icons'

export function RequirementsPanel(): JSX.Element {
  const requirements = useStore((s) => s.requirements)
  const uploadRequirement = useStore((s) => s.uploadRequirement)
  const uploading = useStore((s) => !!s.busyKeys['uploadRequirement'])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [detailName, setDetailName] = useState<string | null>(null)

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="secondary" icon={<DocIcon />} onClick={() => setPasteOpen(true)}>
        직접 붙여넣기
      </Button>
      <Button
        variant="primary"
        icon={<UploadIcon />}
        loading={uploading}
        loadingText="업로드 중…"
        onClick={uploadRequirement}
      >
        파일 업로드
      </Button>
    </div>
  )

  return (
    <>
      <PanelHeader
        step={1}
        title="요구사항"
        desc="문서·PDF·가이드 화면(이미지)을 업로드하거나, 요구사항 텍스트를 바로 붙여넣으세요."
        action={requirements.length > 0 ? actions : undefined}
      />
      <PanelBody>
        {requirements.length === 0 ? (
          <EmptyState
            icon={<DocIcon width={26} height={26} />}
            title="등록된 요구사항이 없습니다"
            desc="md / txt / pdf / 이미지(가이드 화면) 파일을 올리거나, 요구사항을 직접 붙여넣으면 AI 가 분석해 체크리스트를 생성합니다."
            action={actions}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {requirements.map((req) => (
              <button
                key={req.path}
                onClick={() => setDetailName(req.name)}
                className="group rounded-xl border border-border bg-surface p-5 text-left transition-all duration-200 hover:border-brand/50 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)]"
              >
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-soft ring-1 ring-brand/30">
                    <DocIcon />
                  </div>
                  <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-text" title={req.name}>
                    {req.name}
                  </h3>
                  <span className="shrink-0 text-[11px] text-muted opacity-0 transition-opacity group-hover:opacity-100">
                    상세 →
                  </span>
                </div>
                <p className="line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                  {req.preview || '(미리보기 없음)'}
                </p>
              </button>
            ))}
          </div>
        )}
      </PanelBody>

      {pasteOpen && <PasteModal onClose={() => setPasteOpen(false)} />}
      {detailName && (
        <RequirementDetailModal name={detailName} onClose={() => setDetailName(null)} />
      )}
    </>
  )
}

function RequirementDetailModal({
  name,
  onClose
}: {
  name: string
  onClose: () => void
}): JSX.Element {
  const project = useStore((s) => s.project)
  const saveRequirement = useStore((s) => s.saveRequirement)
  const deleteRequirement = useStore((s) => s.deleteRequirement)
  const saving = useStore((s) => !!s.busyKeys['saveRequirement'])
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [editable, setEditable] = useState(true)
  const [loading, setLoading] = useState(true)
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    let alive = true
    if (!project) return
    void window.api.getRequirementDetail(project.path, name).then((d) => {
      if (!alive) return
      setContent(d.content)
      setOriginal(d.content)
      setEditable(d.editable)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [project, name])

  const dirty = content !== original
  const save = async (): Promise<void> => {
    if (await saveRequirement(name, content)) setOriginal(content)
  }
  const del = async (): Promise<void> => {
    await deleteRequirement(name)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-text">{name}</h2>
            <p className="mt-0.5 text-xs text-muted">
              {editable ? '내용을 수정하고 저장할 수 있습니다.' : 'PDF/이미지 요구사항 — 편집 불가(재업로드로 교체).'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="text-sm text-muted">불러오는 중…</p>
          ) : editable ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={18}
              className="min-h-[360px] w-full resize-y rounded-lg border border-border bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-text outline-none transition-colors focus:border-brand"
            />
          ) : (
            <p className="rounded-lg border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted">
              이 요구사항은 PDF/이미지 파일이라 여기서 편집할 수 없어요. AI 는 파일을 직접 읽습니다.
              내용을 바꾸려면 파일을 다시 업로드하세요.
            </p>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
          {confirmDel ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-bad">정말 삭제할까요?</span>
              <Button variant="secondary" onClick={() => void del()}>
                삭제 확인
              </Button>
              <button onClick={() => setConfirmDel(false)} className="text-[11px] text-muted hover:text-text">
                취소
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              icon={<TrashIcon width={14} height={14} />}
              onClick={() => setConfirmDel(true)}
            >
              삭제
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              닫기
            </Button>
            {editable && (
              <Button
                variant="primary"
                loading={saving}
                loadingText="저장 중…"
                disabled={!dirty}
                onClick={() => void save()}
              >
                {dirty ? '저장' : '저장됨'}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

function PasteModal({ onClose }: { onClose: () => void }): JSX.Element {
  const addRequirementText = useStore((s) => s.addRequirementText)
  const saving = useStore((s) => !!s.busyKeys['addRequirementText'])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const submit = async (): Promise<void> => {
    if (!content.trim()) return
    const ok = await addRequirementText(title.trim() || '요구사항', content)
    if (ok) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-text">요구사항 직접 붙여넣기</h2>
            <p className="mt-0.5 text-xs text-muted">붙여넣은 내용은 .md 파일로 저장됩니다.</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">제목 (선택)</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 상담예약 폼 / 구성원 상세 / 301 리다이렉트"
              className="rounded-lg border border-border bg-bg px-3.5 py-2.5 text-sm text-text outline-none transition-colors placeholder:text-muted/60 focus:border-brand"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">요구사항 내용</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="요구사항 / 기능 명세 / 합격기준을 그대로 붙여넣으세요…"
              rows={12}
              className="min-h-[240px] resize-y rounded-lg border border-border bg-bg px-3.5 py-3 font-mono text-[12.5px] leading-relaxed text-text outline-none transition-colors placeholder:text-muted/60 focus:border-brand"
            />
          </label>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            loading={saving}
            loadingText="저장 중…"
            onClick={submit}
            disabled={!content.trim()}
          >
            요구사항 추가
          </Button>
        </footer>
      </div>
    </div>
  )
}
