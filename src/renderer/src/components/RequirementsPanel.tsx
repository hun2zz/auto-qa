import { useState, type JSX } from 'react'
import { useStore } from '../store'
import { Button } from './Button'
import { PanelHeader, PanelBody, EmptyState } from './common'
import { DocIcon, UploadIcon, CloseIcon } from './icons'

export function RequirementsPanel(): JSX.Element {
  const requirements = useStore((s) => s.requirements)
  const uploadRequirement = useStore((s) => s.uploadRequirement)
  const uploading = useStore((s) => !!s.busyKeys['uploadRequirement'])
  const [pasteOpen, setPasteOpen] = useState(false)

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
              <article
                key={req.path}
                className="group rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:border-brand/50 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)]"
              >
                <div className="mb-3 flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-soft ring-1 ring-brand/30">
                    <DocIcon />
                  </div>
                  <h3 className="truncate text-sm font-medium text-text" title={req.name}>
                    {req.name}
                  </h3>
                </div>
                <p className="line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted">
                  {req.preview || '(미리보기 없음)'}
                </p>
              </article>
            ))}
          </div>
        )}
      </PanelBody>

      {pasteOpen && <PasteModal onClose={() => setPasteOpen(false)} />}
    </>
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
