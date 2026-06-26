import type { JSX } from 'react'

/**
 * 아주 가벼운 마크다운 표시기. 외부 라이브러리 없이
 * 제목/리스트/Given·When·Then 키워드 강조만 처리한다.
 */
export function MarkdownView({ source }: { source: string }): JSX.Element {
  const lines = source.replace(/\r\n/g, '\n').split('\n')

  return (
    <div className="space-y-1 font-mono text-[12.5px] leading-relaxed">
      {lines.map((raw, i) => {
        const line = raw.trimEnd()
        if (line.trim() === '') return <div key={i} className="h-2" />

        // 헤딩
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
          const level = heading[1].length
          const cls =
            level <= 1
              ? 'text-[15px] font-semibold text-text'
              : level === 2
                ? 'text-[13.5px] font-semibold text-text'
                : 'text-[12.5px] font-semibold text-brand-soft'
          return (
            <div key={i} className={`pt-2 ${cls}`}>
              {heading[2]}
            </div>
          )
        }

        // 리스트 아이템
        const li = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line)
        if (li) {
          const indent = li[1].length
          return (
            <div
              key={i}
              className="flex gap-2 text-text/90"
              style={{ paddingLeft: `${indent * 0.5 + 0.25}rem` }}
            >
              <span className="select-none text-brand-soft">•</span>
              <span>{highlightKeywords(li[3])}</span>
            </div>
          )
        }

        return (
          <div key={i} className="text-text/80">
            {highlightKeywords(line)}
          </div>
        )
      })}
    </div>
  )
}

/** Given/When/Then(및 한글 키워드) 강조 */
function highlightKeywords(text: string): JSX.Element {
  const re = /\b(Given|When|Then|And|But)\b|(전제|조건|입력|동작|행위|결과|기대|검증)/g
  const out: (string | JSX.Element)[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <span key={key++} className="font-semibold text-brand-soft">
        {m[0]}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
