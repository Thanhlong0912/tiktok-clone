"use client"

import React , {useState, useEffect} from 'react'

const ClientOnly = ({children}: {children: React.ReactNode}) => {
  const [isClient, setIsClient] = useState(false)
  useEffect(()=> {setIsClient(true)}, [])

  return <>{isClient ? children : null}</>
}

export default ClientOnly
