import React from "react"
import SideNavMain from "./includes/SideNavMain"
import TopNav from "./includes/TopNav"
import { usePathname } from "next/navigation"

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isHome = pathname === '/'

    return (
        <>
            {/* Top bar: hidden over the immersive mobile feed, shown everywhere else */}
            <div className={isHome ? 'hidden md:block' : 'block'}>
                <TopNav />
            </div>
            <div className={`mx-auto flex w-full justify-between ${isHome ? 'max-w-none px-0' : 'px-0 lg:px-2.5'}`}>
                {/* Left rail: desktop/tablet only — mobile uses the bottom nav */}
                <div className="hidden md:block">
                    <SideNavMain />
                </div>
                {children}
            </div>
        </>
    )
}
