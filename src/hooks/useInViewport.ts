import { type RefObject, useEffect, useState } from 'react'

export function useInViewport<T extends Element>(
  ref: RefObject<T | null>,
  rootMargin = '360px',
  once = true,
): boolean {
  const [isInViewport, setIsInViewport] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    if (!('IntersectionObserver' in window)) {
      setIsInViewport(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        setIsInViewport(entry.isIntersecting)
        if (entry.isIntersecting && once) observer.disconnect()
      },
      { rootMargin },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [once, ref, rootMargin])

  return isInViewport
}
