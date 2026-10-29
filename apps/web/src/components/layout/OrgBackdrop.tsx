'use client'

import { useEffect, useState } from 'react'

type TimeTheme = 'morning' | 'day' | 'night'

const timeTheme = (hour: number): TimeTheme => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'day' : 'night')

/** Brand overlay for white text, darker on the left where the copy sits. */
const BRAND: Record<TimeTheme, string> = {
  morning: 'linear-gradient(110deg, rgba(10,77,166,.88) 0%, rgba(30,111,240,.55) 50%, rgba(255,176,32,.12) 100%)',
  day: 'linear-gradient(110deg, rgba(10,77,166,.9) 0%, rgba(30,111,240,.55) 50%, rgba(30,111,240,.1) 100%)',
  // The night photo is already dark, so its overlay is lighter to let the lit campus show through.
  night: 'linear-gradient(110deg, rgba(2,8,23,.8) 0%, rgba(10,31,77,.45) 50%, rgba(10,77,166,.08) 100%)',
}
/** Light overlay for dark text. */
const LIGHT = 'linear-gradient(180deg, rgba(255,255,255,.88), rgba(255,255,255,.94) 60%, #fff)'

/**
 * Full-bleed background that follows the visitor's local time (morning, day, night).
 * `org` is the organisation set used across the website; `student` is used on the Download page.
 */
export function OrgBackdrop({ look = 'org', tone = 'brand' }: { look?: 'org' | 'student'; tone?: 'brand' | 'light' }) {
  // Unknown on the server; the photo is requested only once the visitor's local time is known,
  // so a page never downloads two backgrounds.
  const [time, setTime] = useState<TimeTheme | null>(null)
  useEffect(() => {
    const update = () => setTime(timeTheme(new Date().getHours()))
    update()
    const id = window.setInterval(update, 60_000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className={`absolute inset-0 bg-cover bg-center transition-opacity duration-700 ${time ? 'opacity-100' : 'opacity-0'}`} style={time ? { backgroundImage: `url('/images/bg/${look}-${time}.webp')` } : undefined} />
      <div className="absolute inset-0 transition-[background] duration-700" style={{ background: tone === 'light' ? LIGHT : BRAND[time ?? 'night'] }} />
    </div>
  )
}
