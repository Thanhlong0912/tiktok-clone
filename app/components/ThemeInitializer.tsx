"use client"

import { useEffect } from 'react'

const ThemeInitializer = () => {
  useEffect(() => {
    const isDarkTheme = localStorage.getItem('theme') === 'dark'
    document.documentElement.classList.toggle('dark', isDarkTheme)
  }, [])

  return null
}

export default ThemeInitializer
