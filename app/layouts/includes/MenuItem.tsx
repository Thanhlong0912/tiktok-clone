import Link from 'next/link'
import { IconType } from 'react-icons'

interface NavMenuItemProps {
  label: string
  href: string
  icon: IconType
  iconActive?: IconType
  active?: boolean
  onClick?: () => void
}

const MenuItem = ({ label, href, icon: Icon, iconActive, active, onClick }: NavMenuItemProps) => {
  const ActiveIcon = iconActive || Icon
  const RenderIcon = active ? ActiveIcon : Icon

  const content = (
    <div
      className={`group flex w-full items-center rounded-lg p-2.5 transition-colors hover:bg-surface-subtle ${
        active ? 'text-tiktok' : 'text-ink'
      }`}
    >
      <div className="mx-auto flex items-center lg:mx-0">
        <RenderIcon size={26} className="shrink-0" />
        <span
          className={`ml-2 mt-0.5 hidden text-[17px] lg:block ${
            active ? 'font-bold' : 'font-semibold'
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  )

  if (onClick) {
    return (
      <button onClick={onClick} className="w-full text-left" aria-label={label}>
        {content}
      </button>
    )
  }

  return (
    <Link href={href} aria-label={label}>
      {content}
    </Link>
  )
}

export default MenuItem
