import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function AlkesModal({
  open, onClose, title, eyebrow, subtitle, meta, size = 'wide', children, footer,
  className = '', dismissDisabled = false,
}) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const closeRef = useRef(onClose)
  const dismissRef = useRef(dismissDisabled)
  closeRef.current = onClose
  dismissRef.current = dismissDisabled

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    const body = document.body
    const previousOverflow = body.style.overflow
    const previousPadding = body.style.paddingRight
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    body.style.overflow = 'hidden'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`

    const focusFirst = () => {
      const dialog = dialogRef.current
      if (!dialog) return
      const preferred = dialog.querySelector('[data-autofocus]')
      const first = preferred || dialog.querySelector(FOCUSABLE) || dialog
      first.focus?.()
    }
    const frame = window.requestAnimationFrame(focusFirst)

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !dismissRef.current) {
        event.preventDefault()
        closeRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll(FOCUSABLE)].filter((element) => element.offsetParent !== null)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      body.style.overflow = previousOverflow
      body.style.paddingRight = previousPadding
      previousFocus?.focus?.()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div
      className="alkes-modal-backdrop"
      onMouseDown={(event) => {
        if (!dismissRef.current && event.target === event.currentTarget) closeRef.current?.()
      }}
    >
      <section
        ref={dialogRef}
        className={`alkes-modal alkes-modal--${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="alkes-modal-header">
          <div className="alkes-modal-title">
            {eyebrow && <span className="alkes-modal-eyebrow">{eyebrow}</span>}
            <div className="alkes-modal-title-line">
              <h2 id={titleId}>{title}</h2>
              {meta && <div className="alkes-modal-meta">{meta}</div>}
            </div>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="alkes-modal-close" aria-label="Tutup dialog" disabled={dismissDisabled} onClick={() => closeRef.current?.()}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="alkes-modal-content">{children}</div>
        {footer && <footer className="alkes-modal-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  )
}
