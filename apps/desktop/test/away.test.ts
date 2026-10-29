import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/api', () => ({ api: { reportViolation: vi.fn() } }))
vi.mock('../src/lib/live', () => ({ grabScreen: vi.fn() }))
const { aiWindow } = await import('../src/lib/away')

describe('aiWindow', () => {
  it('names the AI tool open in a browser tab, from the window title', () => {
    expect(aiWindow([{ app: 'POWERPNT', title: 'Deck - PowerPoint' }, { app: 'chrome', title: 'ChatGPT - Google Chrome' }]))
      .toEqual({ tool: 'ChatGPT', app: 'chrome', title: 'ChatGPT - Google Chrome' })
    expect(aiWindow([{ app: 'msedge', title: 'Google Gemini - Microsoft Edge' }])?.tool).toBe('Gemini')
    expect(aiWindow([{ app: 'firefox', title: 'Perplexity — Mozilla Firefox' }])?.tool).toBe('Perplexity')
  })

  it('names AI desktop apps by their program name', () => {
    expect(aiWindow([{ app: 'ChatGPT Classic', title: 'Clarify completion status' }])?.tool).toBe('ChatGPT')
    expect(aiWindow([{ app: 'claude', title: 'Claude' }])?.tool).toBe('Claude')
  })

  it('ignores ordinary windows', () => {
    expect(aiWindow([{ app: 'chrome', title: 'Prime number - Wikipedia - Google Chrome' }, { app: 'WhatsApp.Root', title: 'WhatsApp' }, { app: 'explorer', title: 'Downloads' }])).toBeNull()
    expect(aiWindow([])).toBeNull()
  })
})
