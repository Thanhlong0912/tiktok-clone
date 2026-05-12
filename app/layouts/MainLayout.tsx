import React from "react"
import SideNavMain from "./includes/SideNavMain"
import TopNav from "./includes/TopNav"
import { usePathname } from "next/navigation"

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isHome = pathname === '/'

    return (
      	<>
					<div className={isHome ? 'hidden md:block' : 'block'}>
						<TopNav/>
					</div>
					<div className={`flex justify-between mx-auto w-full ${isHome ? 'max-w-none px-0 md:max-w-[1140px] md:px-2.5' : 'lg:px-2.5 px-0'}`}>
						<div className={isHome ? 'hidden md:block' : 'block'}>
							<SideNavMain />
						</div>
						{children}
					</div>
      	</>
    )
}
