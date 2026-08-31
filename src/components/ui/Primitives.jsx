import { forwardRef, useEffect, useId, useRef } from 'react'
import Icon from '../Icon.jsx'

function classes(...values) {
  return values.filter(Boolean).join(' ')
}

export const Button = forwardRef(function Button({
  variant = 'secondary',
  size = 'default',
  icon,
  iconAfter,
  className = '',
  type = 'button',
  children,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes('ui-button', `ui-button-${variant}`, `ui-button-${size}`, className)}
      {...props}
    >
      {icon}
      {children}
      {iconAfter}
    </button>
  )
})

export function IconButton({ label, children, className = '', ...props }) {
  return (
    <Button variant="ghost" size="small" className={classes('ui-icon-button', className)} aria-label={label} title={label} {...props}>
      {children}
    </Button>
  )
}

const STATUS_META = {
  DRAFT: { tone: 'neutral', label: 'Draft', icon: 'clock' },
  MENUNGGU_APPROVAL: { tone: 'warning', label: 'Menunggu Approval', icon: 'clock' },
  PENDING: { tone: 'warning', label: 'Menunggu', icon: 'clock' },
  SUBMITTED: { tone: 'warning', label: 'Menunggu Approval', icon: 'clock' },
  DISETUJUI: { tone: 'success', label: 'Disetujui', icon: 'check-circle' },
  APPROVED: { tone: 'success', label: 'Disetujui', icon: 'check-circle' },
  DITOLAK: { tone: 'danger', label: 'Ditolak', icon: 'x-circle' },
  REJECTED: { tone: 'danger', label: 'Ditolak', icon: 'x-circle' },
  PERLU_PERBAIKAN: { tone: 'warning', label: 'Perlu Perbaikan', icon: 'alert-triangle' },
  CORRECTION_REQUIRED: { tone: 'warning', label: 'Perlu Perbaikan', icon: 'alert-triangle' },
  EXPIRED: { tone: 'neutral', label: 'Expired', icon: 'clock' },
  ACTIVE: { tone: 'success', label: 'Active', icon: 'check-circle' },
  AKTIF: { tone: 'success', label: 'Aktif', icon: 'check-circle' },
  INACTIVE: { tone: 'neutral', label: 'Inactive', icon: 'x-circle' },
  NONAKTIF: { tone: 'neutral', label: 'Nonaktif', icon: 'x-circle' },
  INVITED: { tone: 'info', label: 'Invited', icon: 'clock' },
  DISABLED: { tone: 'neutral', label: 'Disabled', icon: 'x-circle' },
  CLOSED: { tone: 'neutral', label: 'Closed', icon: 'check-circle' },
  ARCHIVED: { tone: 'neutral', label: 'Archived', icon: 'clock' },
  DELETED: { tone: 'danger', label: 'Deleted', icon: 'x-circle' },
}

function statusKey(status) {
  return String(status ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
}

export function StatusBadge({ status, tone, children, className = '' }) {
  const meta = STATUS_META[statusKey(status)] ?? { tone: 'info', label: String(status ?? ''), icon: 'info' }
  return (
    <span className={classes('ui-status-badge', `ui-status-${tone ?? meta.tone}`, className)}>
      <Icon name={meta.icon} size={14} />
      <span>{children ?? meta.label}</span>
    </span>
  )
}

export function Card({ as: Component = 'section', variant = 'default', className = '', children, ...props }) {
  return <Component className={classes('ui-card', `ui-card-${variant}`, className)} {...props}>{children}</Component>
}

export function SummaryCard({ className = '', ...props }) {
  return <Card variant="summary" className={className} {...props} />
}

export function KpiCard({ label, value, helper, icon, className = '', children, ...props }) {
  return (
    <Card variant="kpi" className={className} {...props}>
      <div className="ui-kpi-heading"><span className="ui-kpi-label">{label}</span>{icon}</div>
      <strong className="ui-kpi-value">{value}</strong>
      {helper && <span className="ui-kpi-helper">{helper}</span>}
      {children}
    </Card>
  )
}

export function ActionCard({ as, onClick, className = '', children, ...props }) {
  const Component = as ?? (onClick ? 'button' : 'article')
  return (
    <Card as={Component} variant="action" className={className} onClick={onClick} type={Component === 'button' ? 'button' : undefined} {...props}>
      {children}
    </Card>
  )
}

export function Tabs({ items, value, onChange, ariaLabel = 'Navigasi tab', className = '', renderLabel }) {
  return (
    <div className={classes('ui-tabs', className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={classes('ui-tab', value === item.id && 'ui-tab-active')}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {renderLabel ? renderLabel(item) : item.label ?? item.name}
        </button>
      ))}
    </div>
  )
}

export function FilterBar({ className = '', children, actions, helper, ...props }) {
  return (
    <div className={classes('ui-filter-bar', className)} {...props}>
      <div className="ui-filter-fields">{children}</div>
      {(helper || actions) && <div className="ui-filter-trailing">{helper}{actions}</div>}
    </div>
  )
}

export function FilterField({ label, htmlFor, className = '', children }) {
  return (
    <label className={classes('ui-field', className)} htmlFor={htmlFor}>
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  )
}

export function DataTable({ className = '', frameClassName = '', sticky = false, children, ...props }) {
  return (
    <div className={classes('ui-table-frame', frameClassName)}>
      <table className={classes('ui-data-table', sticky && 'ui-data-table-sticky', className)} {...props}>{children}</table>
    </div>
  )
}

export const Input = forwardRef(function Input({ className = '', invalid = false, ...props }, ref) {
  return <input ref={ref} className={classes('ui-control', invalid && 'ui-control-invalid', className)} aria-invalid={invalid || undefined} {...props} />
})

export const Select = forwardRef(function Select({ className = '', invalid = false, children, ...props }, ref) {
  return <select ref={ref} className={classes('ui-control', invalid && 'ui-control-invalid', className)} aria-invalid={invalid || undefined} {...props}>{children}</select>
})

export const Textarea = forwardRef(function Textarea({ className = '', invalid = false, ...props }, ref) {
  return <textarea ref={ref} className={classes('ui-control', 'ui-textarea', invalid && 'ui-control-invalid', className)} aria-invalid={invalid || undefined} {...props} />
})

export const DateInput = forwardRef(function DateInput(props, ref) {
  return <Input ref={ref} type="date" {...props} />
})

export const CurrencyInput = forwardRef(function CurrencyInput({ className = '', ...props }, ref) {
  return <Input ref={ref} inputMode="decimal" className={classes('ui-currency-input', className)} {...props} />
})

export const SearchInput = forwardRef(function SearchInput({ className = '', ...props }, ref) {
  return <span className={classes('ui-search-control', className)}><Icon name="search" size={16} /><Input ref={ref} type="search" {...props} /></span>
})

export function FormField({ label, htmlFor, helper, error, required = false, className = '', children }) {
  return (
    <div className={classes('ui-form-field', className)}>
      <label className="ui-field-label" htmlFor={htmlFor}>{label}{required && <span aria-hidden="true"> *</span>}</label>
      {children}
      {(error || helper) && <span className={classes('ui-field-helper', error && 'ui-field-error')}>{error ?? helper}</span>}
    </div>
  )
}

const ALERT_ICON = { info: 'info', success: 'check-circle', warning: 'alert-triangle', danger: 'x-circle' }

export function Alert({ tone = 'info', title, children, className = '' }) {
  return (
    <div className={classes('ui-alert', `ui-alert-${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={ALERT_ICON[tone] ?? 'info'} size={16} />
      <div>{title && <strong>{title}</strong>}{children && <div className="ui-alert-content">{children}</div>}</div>
    </div>
  )
}

export function StatePanel({ state = 'empty', title, children, action, className = '' }) {
  const icon = state === 'loading' ? 'loader' : state === 'error' ? 'x-circle' : 'info'
  return (
    <div className={classes('ui-state-panel', `ui-state-${state}`, className)} role={state === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={30} className={state === 'loading' ? 'ui-icon-spin' : ''} />
      <strong>{title ?? (state === 'loading' ? 'Memuat data' : state === 'error' ? 'Data tidak dapat dimuat' : 'Belum ada data')}</strong>
      {children && <div className="ui-state-content">{children}</div>}
      {action}
    </div>
  )
}

export function Modal({ open, onClose, title, size = 'medium', children, footer, className = '', closeOnBackdrop = true }) {
  const titleId = useId()
  const dialogRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    dialogRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="ui-modal-backdrop" onMouseDown={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onClose?.() }}>
      <div ref={dialogRef} className={classes('ui-modal', `ui-modal-${size}`, className)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="ui-modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton label="Tutup dialog" onClick={onClose}><Icon name="close" size={18} /></IconButton>
        </header>
        <div className="ui-modal-content">{children}</div>
        {footer && <footer className="ui-modal-footer">{footer}</footer>}
      </div>
    </div>
  )
}

export function ModalSection({ title, className = '', children }) {
  return <section className={classes('ui-modal-section', className)}>{title && <h3>{title}</h3>}{children}</section>
}
