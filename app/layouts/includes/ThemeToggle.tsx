import React, { useEffect, useState } from 'react'
import { FaMoon } from 'react-icons/fa'
import { BsSunFill } from 'react-icons/bs'

const ThemeToggle = () => {
  const [darkMode, setDarkMode] = useState<boolean | undefined>(undefined)

  useEffect(()=>{
    const theme = localStorage.getItem("theme")
    if (theme === "dark") setDarkMode(true)
  }, [])

  useEffect(()=>{
    if (typeof darkMode !== "boolean") return;

    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem("theme", "dark")
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem("theme", "light")
    }
  }, [darkMode])

  return (
    <div
      className='relative w-14 h-8 flex items-center dark:bg-blue-950 bg-yellow-200 cursor-pointer rounded-full p-1'
      onClick={() => setDarkMode(!darkMode)}
    >
      <div
        className='absolute flex items-center justify-center bg-yellow-200 dark:bg-blue-950 w-6 h-6 rounded-full shadow-md transform transition-transform duration-300'
        style={darkMode ? { left: '2px' } : { right: '2px' }}
      >
        {darkMode ? <FaMoon className="text-blue-950" size={20} /> : <BsSunFill className="text-yellow-400" size={20} />}
      </div>
    </div>
  )
}

export default ThemeToggle
