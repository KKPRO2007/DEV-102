'use client'

import { io, type Socket } from 'socket.io-client'
import { API_ORIGIN, getToken } from './http'
import type { BrowsingLog, Session, Violation } from './types'

export interface ViolationEvent {
  sessionId: string
  examId: string
  candidateName: string
  userId: string
  violation: Violation
  session: Session
  riskScore: number
  warnings: number
  outcome: string
  status: Session['status']
}
export interface StatusEvent { session: Session; reason?: string; candidateName?: string }
export interface ProgressEvent { sessionId: string; progress: number; currentQuestion?: number }

type Handlers = {
  'violation:new': (e: ViolationEvent) => void
  'session:status': (e: StatusEvent) => void
  'session:progress': (e: ProgressEvent) => void
  'frame:snapshot': (e: { sessionId: string; image: string; at: string }) => void
  /** Sites opened and text typed or pasted in the candidate's sandbox tabs, as it happens. */
  'browsing:new': (e: { sessionId: string; entries: BrowsingLog[] }) => void
}

let socket: Socket | null = null
let refs = 0

/** One shared /monitor connection for staff pages; staff sockets receive every exam's events. */
function connect(): Socket {
  if (!socket) {
    socket = io(`${API_ORIGIN}/monitor`, { path: '/socket.io', auth: (cb) => cb({ token: getToken() }), transports: ['websocket'], reconnectionDelayMax: 8000 })
  }
  return socket
}

export function subscribe<K extends keyof Handlers>(event: K, handler: Handlers[K]): () => void {
  const s = connect()
  refs++
  s.on(event as string, handler as Parameters<Socket['on']>[1])
  return () => {
    s.off(event as string, handler as Parameters<Socket['on']>[1])
    if (--refs === 0) {
      s.disconnect()
      socket = null
    }
  }
}

export function joinExam(examId: string): () => void {
  const s = connect()
  const join = () => s.emit('session:join', { examId })
  if (s.connected) join()
  s.on('connect', join)
  return () => {
    s.off('connect', join)
    s.emit('session:leave', { examId })
  }
}

/** Buffers violation events so pages written for polling (pollLiveEvent) can drain them. */
const buffer: ViolationEvent[] = []
let buffering: (() => void) | null = null
export function takeBuffered(sessionId?: string): ViolationEvent | null {
  buffering ??= subscribe('violation:new', (e) => {
    buffer.push(e)
    if (buffer.length > 200) buffer.shift()
  })
  const i = buffer.findIndex((e) => !sessionId || e.sessionId === sessionId)
  return i >= 0 ? buffer.splice(i, 1)[0] ?? null : null
}

export type ScreenState = 'connecting' | 'live' | 'unavailable' | 'ended'
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
type RtcMessage = { sessionId: string; from?: string; payload?: { type?: string; sdp?: string; candidate?: string } & RTCIceCandidateInit }

/**
 * Asks a live candidate for their screen over WebRTC (receive-only); the API relays the signalling.
 * Returns a stop function that hangs up and tells the candidate to close its side.
 */
export function watchScreen(sessionId: string, onStream: (stream: MediaStream) => void, onState: (state: ScreenState) => void): () => void {
  const s = connect()
  refs++
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  let answered: (() => void) | null = null
  const remoteSet = new Promise<void>((resolve) => { answered = resolve })
  let stopped = false

  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })
  pc.ontrack = (e) => {
    onStream(e.streams[0] ?? new MediaStream([e.track]))
    onState('live')
  }
  pc.onicecandidate = (e) => { if (e.candidate) s.emit('rtc:ice', { sessionId, payload: e.candidate.toJSON() }) }
  pc.onconnectionstatechange = () => { if (!stopped && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) onState('ended') }

  const onAnswer = (m: RtcMessage) => {
    if (m.sessionId !== sessionId || stopped) return
    if (m.payload?.type === 'unavailable') return onState('unavailable')
    if (m.payload?.type !== 'answer') return
    void pc.setRemoteDescription({ type: 'answer', sdp: m.payload.sdp }).then(() => answered?.()).catch(() => onState('ended'))
  }
  const onIce = (m: RtcMessage) => {
    if (m.sessionId !== sessionId || !m.payload?.candidate) return
    const candidate = m.payload
    void remoteSet.then(() => pc.addIceCandidate(candidate)).catch(() => undefined)
  }
  s.on('rtc:answer', onAnswer)
  s.on('rtc:ice', onIce)

  onState('connecting')
  const offer = async () => {
    const desc = await pc.createOffer()
    await pc.setLocalDescription(desc)
    s.emit('rtc:offer', { sessionId, payload: { type: desc.type, sdp: desc.sdp } })
  }
  if (s.connected) void offer().catch(() => onState('ended'))
  else s.once('connect', () => void offer().catch(() => onState('ended')))

  return () => {
    stopped = true
    s.emit('rtc:ice', { sessionId, payload: { type: 'bye' } })
    s.off('rtc:answer', onAnswer)
    s.off('rtc:ice', onIce)
    pc.close()
    if (--refs === 0) {
      s.disconnect()
      socket = null
    }
  }
}
