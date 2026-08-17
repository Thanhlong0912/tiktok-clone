import { MouseEvent, ReactNode } from 'react'

type AutoScrollToggleProps = {
  enabled: boolean
  onChange: (enabled: boolean) => void
  /** Rendered before the label, so the row lines up with the icon rows around it. */
  icon?: ReactNode
  className?: string
  labelClassName?: string
}

const AutoScrollToggle = ({
  enabled,
  onChange,
  icon,
  className = '',
  labelClassName = '',
}: AutoScrollToggleProps) => {
  const toggleAutoScroll = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onChange(!enabled)
  }

  return (
    <button
      onClick={toggleAutoScroll}
      type="button"
      role="switch"
      aria-checked={enabled}
      className={`flex items-center justify-between gap-3 ${className}`}
      aria-label="Toggle auto scroll"
    >
      <span className={`flex items-center gap-2.5 ${labelClassName}`}>
        {icon}
        Auto scroll
      </span>
      <span
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors ${
          enabled ? 'bg-[#5fd4ee]' : 'bg-white/25'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </span>
    </button>
  )
}

export default AutoScrollToggle
