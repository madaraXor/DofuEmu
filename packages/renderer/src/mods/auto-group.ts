import type { DofusWindow } from '@/types/dofus-window'
import type { AutoGroupState } from '@dofemu/shared'

const MAP_CHANGE_TIMEOUT = 15000
const AUTO_GROUP_CHANNEL = 'dofemu-autogroup'

interface AutoGroupCallbacks {
  onLeaderMapChange: (mapId: number, position: { x: number; y: number }) => void
  onFollowerMoved: (tabId: string, mapId: number) => void
}

interface ConnectionManagerLike {
  on: (event: string, cb: (...args: unknown[]) => void) => void
  removeListener: (event: string, cb: (...args: unknown[]) => void) => void
}

interface CurrentMapMessage {
  mapId: number
}

const activeDisposers = new Set<() => void>()

export function initAutoGroup(
  gameWindow: DofusWindow,
  tabId: string,
  state: AutoGroupState,
  callbacks: AutoGroupCallbacks
): () => void {
  if (!state.enabled) return () => {}

  const connectionManager = gameWindow.dofus.connectionManager as ConnectionManagerLike | undefined
  if (!connectionManager?.on || !connectionManager?.removeListener) {
    logWarn('connection manager is not ready for tab', tabId)
    return () => {}
  }

  if (tabId === state.leaderTabId) {
    logInfo('watching leader tab', tabId)
    return initLeader(tabId, connectionManager, callbacks)
  }

  if (state.followerTabIds.includes(tabId)) {
    logInfo('watching follower tab', tabId, 'leader', state.leaderTabId)
    return initFollower(gameWindow, connectionManager, tabId, callbacks)
  }

  logInfo('tab ignored by auto-group', tabId)
  return () => {}
}

function initLeader(
  tabId: string,
  connectionManager: ConnectionManagerLike,
  callbacks: AutoGroupCallbacks
): () => void {
  const onCurrentMap = (...args: unknown[]) => {
    const msg = args[0] as CurrentMapMessage
    if (!msg || !msg.mapId) return
    logInfo('leader map changed', tabId, msg.mapId)
    callbacks.onLeaderMapChange(msg.mapId, { x: 0, y: 0 })
  }

  connectionManager.on('CurrentMapMessage', onCurrentMap)

  const dispose = () => {
    connectionManager.removeListener('CurrentMapMessage', onCurrentMap)
    logInfo('stopped watching leader tab', tabId)
  }

  return trackDispose(dispose)
}

function initFollower(
  gameWindow: DofusWindow,
  connectionManager: ConnectionManagerLike,
  tabId: string,
  callbacks: AutoGroupCallbacks
): () => void {
  let isMoving = false
  let pendingMapId: number | null = null

  const moveToMap = (targetMapId: number) => {
    if (isMoving) {
      pendingMapId = targetMapId
      return
    }

    isMoving = true

    try {
      const currentMapId = getCurrentMapId(gameWindow)
      logInfo('follower move requested', tabId, 'current', currentMapId, 'target', targetMapId)

      if (currentMapId === targetMapId) {
        isMoving = false
        logInfo('follower already on leader map', tabId, targetMapId)
        callbacks.onFollowerMoved(tabId, targetMapId)
        return
      }

      const dofus = gameWindow.dofus as Record<string, (...args: unknown[]) => void>
      if (typeof dofus.sendMessage !== 'function') {
        isMoving = false
        logWarn('sendMessage is not available for follower tab', tabId)
        return
      }

      logInfo('sending ChangeMapMessage for follower tab', tabId, targetMapId)
      dofus.sendMessage('ChangeMapMessage', { mapId: targetMapId })

      let timeoutId: number | null = null
      const finishMove = () => {
        connectionManager.removeListener('CurrentMapMessage', onMapChanged)
        if (timeoutId !== null) window.clearTimeout(timeoutId)
        isMoving = false
        logInfo('follower reached leader map', tabId, targetMapId)
        callbacks.onFollowerMoved(tabId, targetMapId)

        if (pendingMapId !== null && pendingMapId !== targetMapId) {
          const next = pendingMapId
          pendingMapId = null
          moveToMap(next)
        }
      }

      const onMapChanged = (...args: unknown[]) => {
        const msg = args[0] as CurrentMapMessage | undefined
        const mapId = msg?.mapId ?? getCurrentMapId(gameWindow)
        logInfo('follower map update while moving', tabId, mapId, 'target', targetMapId)
        if (mapId !== targetMapId) return
        finishMove()
      }

      connectionManager.on('CurrentMapMessage', onMapChanged)

      timeoutId = window.setTimeout(() => {
        if (isMoving) {
          connectionManager.removeListener('CurrentMapMessage', onMapChanged)
          isMoving = false
          logWarn('follower map change timed out', tabId, 'target', targetMapId)
        }
      }, MAP_CHANGE_TIMEOUT)
    } catch (error) {
      isMoving = false
      logError('failed to move follower tab', tabId, error)
    }
  }

  const channel = new BroadcastChannel(AUTO_GROUP_CHANNEL)

  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type: string; mapId: number }
    if (data.type === 'leader-map-change' && data.mapId) {
      logInfo('follower received leader map', tabId, data.mapId)
      moveToMap(data.mapId)
    }
  }

  channel.addEventListener('message', onMessage)

  const dispose = () => {
    channel.removeEventListener('message', onMessage)
    channel.close()
    logInfo('stopped watching follower tab', tabId)
  }

  return trackDispose(dispose)
}

export function broadcastLeaderPosition(mapId: number, position: { x: number; y: number }) {
  try {
    const channel = new BroadcastChannel(AUTO_GROUP_CHANNEL)
    logInfo('broadcasting leader map', mapId)
    channel.postMessage({
      type: 'leader-map-change',
      mapId,
      position
    })
    channel.close()
  } catch {}
}

export function sendPartyInvite(gameWindow: DofusWindow, targetName: string): void {
  try {
    const dofus = gameWindow.dofus as Record<string, (...args: unknown[]) => void>
    if (typeof dofus.sendMessage === 'function') {
      dofus.sendMessage('PartyInvitationRequestMessage', { name: targetName })
    }
  } catch (e) {
    window.dofemu?.logger.error('Failed to send party invite:', e)
  }
}

export function autoAcceptPartyInvite(gameWindow: DofusWindow, leaderName: string): () => void {
  const connectionManager = gameWindow.dofus.connectionManager as ConnectionManagerLike

  const onInvitation = (...args: unknown[]) => {
    const msg = args[0] as { partyId?: number; fromName?: string }
    if (msg?.fromName === leaderName && msg?.partyId) {
      const dofus = gameWindow.dofus as Record<string, (...args: unknown[]) => void>
      if (typeof dofus.sendMessage === 'function') {
        dofus.sendMessage('PartyAcceptInvitationMessage', { partyId: msg.partyId })
      }
    }
  }

  connectionManager.on('PartyInvitationMessage', onInvitation)

  const dispose = () => {
    connectionManager.removeListener('PartyInvitationMessage', onInvitation)
  }
  return trackDispose(dispose)
}

function getCurrentMapId(gameWindow: DofusWindow): number | null {
  const mapRenderer = gameWindow.isoEngine?.mapRenderer as { mapId?: unknown } | undefined
  const mapId = mapRenderer?.mapId
  if (typeof mapId === 'number') return mapId
  if (typeof mapId === 'string') {
    const parsed = Number(mapId)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function trackDispose(dispose: () => void): () => void {
  let disposed = false

  const trackedDispose = () => {
    if (disposed) return
    disposed = true
    activeDisposers.delete(trackedDispose)
    dispose()
  }

  activeDisposers.add(trackedDispose)
  return trackedDispose
}

function logInfo(...args: unknown[]) {
  window.dofemu?.logger.info('[auto-group]', ...args)
}

function logWarn(...args: unknown[]) {
  window.dofemu?.logger.warn('[auto-group]', ...args)
}

function logError(...args: unknown[]) {
  window.dofemu?.logger.error('[auto-group]', ...args)
}

export function destroyAutoGroup() {
  for (const dispose of [...activeDisposers]) {
    dispose()
  }
}
