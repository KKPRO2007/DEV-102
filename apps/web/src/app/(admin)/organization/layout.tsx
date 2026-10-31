'use client'
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BarChart3, ChevronRight, ClipboardList, Keyboard, KeyRound, LayoutDashboard, Library, LogOut, Menu,
  PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, ShieldAlert, ShieldCheck, Upload, Users, X,
  type LucideIcon,
} from 'lucide-react'
import { NotificationPopover } from '@/components/admin/NotificationPopover'
import { Toaster } from '@/components/admin/Toaster'
import { cx, useDismiss } from '@/lib/adminHooks'
import { toast, useAdminUi } from '@/lib/adminStore'
import { useRequireRole, useSession } from '@/lib/session'
import { post } from '@/lib/http'
import { useSystemStatus } from '@/components/layout/SystemStatus'

interface NavItem { label: string; href: string; icon: LucideIcon }

const NAV: { label: string; items: NavItem[] }[] = [
  { label: 'Overview', items: [
    { label: 'Dashboard', href: '/organization', icon: LayoutDashboard },
    { label: 'Exams', href: '/organization/exams', icon: ClipboardList },
  ] },
  { label: 'Content', items: [
    { label: 'Question bank', href: '/organization/questions', icon: Library },
    { label: 'Candidates', href: '/organization/candidates', icon: Users },
    { label: 'Credentials', href: '/organization/credentials', icon: KeyRound },
  ] },
  { label: 'Insights', items: [
    { label: 'Results', href: '/organization/results', icon: BarChart3 },
    { label: 'Violation reports', href: '/organization/reports', icon: ShieldAlert },
  ] },
]

interface SearchEntry { id: string; label: string; hint: string; href: string; icon: LucideIcon }

const SEARCH_ENTRIES: SearchEntry[] = [
  { id: 'p-dash', label: 'Dashboard', hint: 'Page · live overview', href: '/organization', icon: LayoutDashboard },
  { id: 'p-exams', label: 'Exams', hint: 'Page · all exams', href: '/organization/exams', icon: ClipboardList },
  { id: 'p-q', label: 'Question bank', hint: 'Page · MCQ manager', href: '/organization/questions', icon: Library },
  { id: 'p-cand', label: 'Candidates', hint: 'Page · import and manage', href: '/organization/candidates', icon: Users },
  { id: 'p-cred', label: 'Credentials and emails', hint: 'Page · send login details', href: '/organization/credentials', icon: KeyRound },
  { id: 'p-res', label: 'Results', hint: 'Page · scores and ranks', href: '/organization/results', icon: BarChart3 },
  { id: 'p-rep', label: 'Violation reports', hint: 'Page · review penalties', href: '/organization/reports', icon: ShieldAlert },
  { id: 'p-set', label: 'Settings', hint: 'Page · name and password', href: '/organization/settings', icon: Settings },
  { id: 'a-new', label: 'Create exam', hint: 'Action · open the exam wizard', href: '/organization/exams/new', icon: Plus },
  { id: 'a-mcq', label: 'Import MCQs from CSV or Excel', hint: 'Action · question bank', href: '/organization/questions?import=1', icon: Upload },
  { id: 'a-cand', label: 'Import candidates', hint: 'Action · candidates', href: '/organization/candidates?import=1', icon: Upload },
]

const SEGMENT_LABELS: Record<string, string> = {
  exams: 'Exams', new: 'New exam', questions: 'Question bank', candidates: 'Candidates', credentials: 'Credentials',
  results: 'Results', reports: 'Violation reports', settings: 'Settings', profile: 'Profile',
}

/* ---------------------------------- Brand --------------------------------- */

function Brand({ collapsed }: { collapsed: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <Link
      href="/organization"
      aria-label="Where U Elevate, organization home"
      className={cx('flex h-16 shrink-0 items-center gap-3 border-b border-border px-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent', collapsed && 'justify-center px-0')}
    >
      {failed ? (
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent font-heading text-sm font-bold text-white">WU</span>
      ) : (
        <img src="/images/logo.png" alt="" className="h-9 w-9 object-contain" onError={() => setFailed(true)} />
      )}
      {!collapsed && (
        <span className="leading-tight">
          <span className="block font-heading text-[15px] font-semibold text-primary">Where U Elevate</span>
          <span className="block text-[11px] font-medium uppercase tracking-wider text-muted">Proctor organization</span>
        </span>
      )}
    </Link>
  )
}

/* ---------------------------------- Sidebar ------------------------------- */

function SidebarBody({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const status = useSystemStatus()
  const pathname = usePathname() ?? ''
  const isActive = (href: string) => (href === '/organization' ? pathname === '/organization' : pathname === href || pathname.startsWith(`${href}/`))

  return (
    <>
      <Brand collapsed={collapsed} />
      <nav aria-label="Organization navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV.map((group) => (
          <div key={group.label}>
            {collapsed ? (
              <div className="mx-3 mb-2 h-px bg-border" aria-hidden="true" />
            ) : (
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{group.label}</p>
            )}
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(item.href)
                const Icon = item.icon
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cx(
                        'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent',
                        collapsed && 'justify-center',
                        active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-soft hover:text-primary',
                      )}
                    >
                      {active && <span aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-primary" />}
                      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="p-3">
        <div role="status" className={cx('flex items-center gap-3 rounded-xl bg-soft p-3', collapsed && 'justify-center')} title={collapsed ? `${status.title}. ${status.detail}` : undefined}>
          <ShieldCheck className={cx('h-5 w-5 shrink-0', { ok: 'text-success', warn: 'text-warning', down: 'text-danger', checking: 'text-muted' }[status.tone])} aria-hidden="true" />
          {collapsed ? (
            <span className="sr-only">{status.title}</span>
          ) : (
            <p className="text-xs leading-snug">
              <span className="block font-semibold text-text">{status.title}</span>
              <span className="text-muted">{status.detail}</span>
            </p>
          )}
        </div>
      </div>
    </>
  )
}

/* -------------------------------- Breadcrumbs ----------------------------- */

function Breadcrumbs() {
  const pathname = usePathname() ?? ''
  const crumbs = useMemo(() => {
    const segs = pathname.split('/').filter(Boolean).slice(1)
    const list = [{ label: 'Organization', href: '/organization' }]
    if (segs.length === 0) return [...list, { label: 'Dashboard', href: '/organization' }]
    segs.forEach((s, i) => list.push({ label: SEGMENT_LABELS[s] ?? decodeURIComponent(s).toUpperCase(), href: `/organization/${segs.slice(0, i + 1).join('/')}` }))
    return list
  }, [pathname])

  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1
          return (
            <li key={`${c.href}-${i}`} className="flex items-center gap-1.5">
              {last ? (
                <span aria-current="page" className="font-semibold text-text">{c.label}</span>
              ) : (
                <Link href={c.href} className="rounded text-muted outline-none transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent">{c.label}</Link>
              )}
              {!last && <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ---------------------------------- Search -------------------------------- */

function GlobalSearch() {
  const router = useRouter()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  useDismiss(wrapRef, open, () => setOpen(false))

  const results = useMemo<SearchEntry[]>(() => {
    const term = q.trim().toLowerCase()
    const base = term ? SEARCH_ENTRIES.filter((e) => e.label.toLowerCase().includes(term) || e.hint.toLowerCase().includes(term)) : SEARCH_ENTRIES.slice(0, 6)
    return term
      ? [...base, { id: 'search-exams', label: `Search exams for “${q.trim()}”`, hint: 'Action · filter the exams table', href: `/organization/exams?q=${encodeURIComponent(q.trim())}`, icon: Search }]
      : base
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (entry: SearchEntry | undefined) => {
    if (!entry) return
    setOpen(false)
    setQ('')
    inputRef.current?.blur()
    router.push(entry.href)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % results.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]) }
    else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls="admin-search-list"
        aria-activedescendant={open && results[active] ? `search-${results[active].id}` : undefined}
        aria-autocomplete="list"
        aria-label="Search the organization panel"
        placeholder="Search exams, candidates, pages…"
        className="h-10 w-full rounded-xl border border-border bg-soft pl-10 pr-14 text-sm text-text outline-none transition placeholder:text-muted focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/30"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block">Ctrl K</kbd>
      <AnimatePresence>
        {open && (
          <motion.ul
            id="admin-search-list"
            role="listbox"
            aria-label="Search suggestions"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-[0_20px_48px_-16px_rgba(15,23,42,0.35)]"
          >
            {results.map((r, i) => {
              const Icon = r.icon
              return (
                <li key={r.id} id={`search-${r.id}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); go(r) }}
                  className={cx('flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5', i === active && 'bg-soft')}>
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-text">{r.label}</span>
                    <span className="block truncate text-xs text-muted">{r.hint}</span>
                  </span>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------- Profile menu ------------------------------ */

function ProfileMenu() {
  const router = useRouter()
  const user = useSession((st) => st.user)
  const name = user?.name ?? 'Organization'
  const initials = name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useDismiss(wrapRef, open, () => setOpen(false))

  const itemClass = 'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 outline-none transition hover:bg-soft focus-visible:ring-2 focus-visible:ring-accent'

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile menu"
        className="flex items-center gap-2 rounded-xl border border-border bg-surface py-1 pl-1 pr-2 outline-none transition hover:bg-soft focus-visible:ring-2 focus-visible:ring-accent sm:pr-3"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-xs font-bold text-white">{initials}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block text-sm font-semibold text-text">{name}</span>
          <span className="block text-[11px] text-muted">Exam organization</span>
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Profile"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-2xl border border-border bg-surface p-2 shadow-[0_20px_48px_-16px_rgba(15,23,42,0.35)]"
          >
            <div className="border-b border-border px-3 pb-3 pt-2">
              <p className="text-sm font-semibold text-text">{name}</p>
              <p className="truncate text-xs text-muted">{user?.email}</p>
            </div>
            <div className="py-2">
              <Link role="menuitem" href="/organization/settings" onClick={() => setOpen(false)} className={itemClass}><Settings className="h-4 w-4" aria-hidden="true" /> Organisation settings</Link>
              <button role="menuitem" type="button" className={itemClass} onClick={() => { setOpen(false); toast.info('Keyboard shortcuts', 'Ctrl K search · Ctrl B toggle sidebar · / search the exams table') }}>
                <Keyboard className="h-4 w-4" aria-hidden="true" /> Keyboard shortcuts
              </button>
            </div>
            <div className="border-t border-border pt-2">
              <button role="menuitem" type="button" className={cx(itemClass, 'text-danger hover:bg-danger/5')} onClick={() => { setOpen(false); void post('/auth/logout').catch(() => undefined).finally(() => { useSession.getState().logout(); toast.success('Signed out', 'You have been signed out of the organization panel.'); router.push('/login?role=organization') }) }}>
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------------------------------- Layout -------------------------------- */

export default function AdminLayout({ children }: { children: ReactNode }) {
  useRequireRole(['ADMIN'])
  const pathname = usePathname() ?? ''
  const collapsed = useAdminUi((s) => s.sidebarCollapsed)
  const mobileOpen = useAdminUi((s) => s.mobileNavOpen)
  const toggleSidebar = useAdminUi((s) => s.toggleSidebar)
  const setMobileNav = useAdminUi((s) => s.setMobileNav)

  useEffect(() => {
    void useAdminUi.persist.rehydrate()
  }, [])

  useEffect(() => {
    setMobileNav(false)
  }, [pathname, setMobileNav])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
      if (e.key === 'Escape') setMobileNav(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleSidebar, setMobileNav])

  return (
    <div className="flex min-h-screen bg-soft text-text">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>

      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 80 : 272 }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        aria-label="Sidebar"
        className="sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-surface lg:flex"
      >
        <SidebarBody collapsed={collapsed} />
      </motion.aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNav(false)} className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" aria-hidden="true" />
            <motion.aside
              key="drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.22 }}
              className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-2xl lg:hidden"
            >
              <button type="button" onClick={() => setMobileNav(false)} aria-label="Close navigation" className="absolute right-3 top-4 grid h-8 w-8 place-items-center rounded-lg text-muted outline-none hover:bg-soft focus-visible:ring-2 focus-visible:ring-accent">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
              <SidebarBody collapsed={false} onNavigate={() => setMobileNav(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-surface/85 backdrop-blur">
          <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
            <button type="button" onClick={() => setMobileNav(true)} aria-label="Open navigation" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-slate-600 outline-none hover:bg-soft focus-visible:ring-2 focus-visible:ring-accent lg:hidden">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={toggleSidebar} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed} title="Toggle sidebar (Ctrl B)" className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-slate-600 outline-none hover:bg-soft hover:text-primary focus-visible:ring-2 focus-visible:ring-accent lg:grid">
              {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
            </button>
            <GlobalSearch />
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              <NotificationPopover />
              <ProfileMenu />
            </div>
          </div>
        </header>

        <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <Breadcrumbs />
          <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {children}
          </motion.div>
        </main>
      </div>

      <Toaster />
    </div>
  )
}
