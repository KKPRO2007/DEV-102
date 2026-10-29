import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/live', () => ({ enqueue: vi.fn(), restoreQueue: vi.fn() }))
vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
const { parseInviteToken, serverFromInviteLink } = await import('../src/lib/api')

const TOKEN = '3f'.repeat(24)

describe('parseInviteToken', () => {
  it('reads the token from the emailed link', () => {
    expect(parseInviteToken(`https://wue.in/join/${TOKEN}`)).toBe(TOKEN)
    expect(parseInviteToken(`  http://localhost:3000/join/${TOKEN}?utm=mail \n`)).toBe(TOKEN)
  })

  it('accepts a bare token in any case', () => {
    expect(parseInviteToken(TOKEN.toUpperCase())).toBe(TOKEN)
  })

  it('rejects text that is not a whole link', () => {
    for (const text of ['', 'CPA-26', `https://wue.in/join/${TOKEN.slice(2)}`, `https://wue.in/join/${TOKEN}ab`]) expect(parseInviteToken(text)).toBeNull()
  })
})

describe('serverFromInviteLink', () => {
  it('points at the API of an organizer laptop on the same Wi-Fi', () => {
    expect(serverFromInviteLink(`http://172.16.179.216:3000/join/${TOKEN}`)).toBe('http://172.16.179.216:4000')
    expect(serverFromInviteLink(` http://192.168.1.20:3001/join/${TOKEN} `)).toBe('http://192.168.1.20:4000')
    expect(serverFromInviteLink(`http://10.0.0.5:3000/join/${TOKEN}`)).toBe('http://10.0.0.5:4000')
  })

  it('leaves the server alone for localhost, public hosts, https and bare tokens', () => {
    for (const text of [`http://localhost:3000/join/${TOKEN}`, `https://wue.in/join/${TOKEN}`, `https://192.168.1.20/join/${TOKEN}`, `http://172.32.0.1:3000/join/${TOKEN}`, `http://8.8.8.8/join/${TOKEN}`, TOKEN, '']) {
      expect(serverFromInviteLink(text)).toBeNull()
    }
  })
})
